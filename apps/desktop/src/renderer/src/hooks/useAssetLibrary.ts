import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Asset, AssetType, Project } from '@storyteller/shared'
import { queryKeys } from '@renderer/lib/query-client'
import { supabase } from '@renderer/lib/supabase'
import { backfillMissingThumbnails } from '@renderer/lib/thumbnail-backfill'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'

export type AssetLibraryFilters = {
  assetType?: AssetType | 'all'
  role?: string | 'all'
  projectId?: string | 'all'
  dateFrom?: string
  dateTo?: string
  search?: string
}

export type AssetWithProject = Asset & {
  project?: Pick<Project, 'id' | 'title' | 'mode'> | null
}

function mergeWithLocal(remote: AssetWithProject[]): AssetWithProject[] {
  const localByProject = useLocalAssetsStore.getState().byProject
  const remoteById = new Map(remote.map((a) => [a.id, a]))
  const merged = [...remote]
  const mergedIds = new Set(remote.map((a) => a.id))

  for (const [, localAssets] of Object.entries(localByProject)) {
    for (const local of localAssets) {
      const existing = remoteById.get(local.id)
      if (existing) {
        const idx = merged.findIndex((a) => a.id === local.id)
        if (idx >= 0) {
          merged[idx] = {
            ...existing,
            ...local,
            local_path: local.local_path?.trim() || existing.local_path,
            proxy_path: local.proxy_path ?? existing.proxy_path,
            project: existing.project
          }
        }
      } else if (!mergedIds.has(local.id)) {
        merged.push({ ...local, project: null })
        mergedIds.add(local.id)
      }
    }
  }

  return merged
}

function applyFilters(assets: AssetWithProject[], filters: AssetLibraryFilters): AssetWithProject[] {
  let out = assets

  if (filters.projectId && filters.projectId !== 'all') {
    out = out.filter((a) => a.project_id === filters.projectId)
  }
  if (filters.assetType && filters.assetType !== 'all') {
    out = out.filter((a) => a.asset_type === filters.assetType)
  }
  if (filters.role && filters.role !== 'all') {
    out = out.filter(
      (a) => a.clip_role === filters.role || a.creator_clip_role === filters.role
    )
  }
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime()
    if (Number.isFinite(from)) {
      out = out.filter((a) => new Date(a.created_at).getTime() >= from)
    }
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime()
    if (Number.isFinite(to)) {
      out = out.filter((a) => new Date(a.created_at).getTime() <= to + 86_400_000)
    }
  }
  if (filters.search?.trim()) {
    const q = filters.search.trim().toLowerCase()
    out = out.filter((a) => {
      const name = (a.original_filename ?? a.local_path ?? '').toLowerCase()
      const projectTitle = (a.project?.title ?? '').toLowerCase()
      return name.includes(q) || projectTitle.includes(q) || a.id.toLowerCase().includes(q)
    })
  }

  return out.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export function useAssetLibrary(filters: AssetLibraryFilters = {}) {
  const localByProject = useLocalAssetsStore((s) => s.byProject)

  const query = useQuery({
    queryKey: queryKeys.assets.list(filters),
    queryFn: async () => {
      if (!supabase) return [] as AssetWithProject[]

      const { data, error } = await supabase
        .from('assets')
        .select('*, projects(id, title, mode)')
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) throw error

      return (data ?? []).map((row) => {
        const projects = row.projects as Pick<Project, 'id' | 'title' | 'mode'> | null
        const { projects: _p, ...assetRow } = row as Record<string, unknown>
        return {
          ...(assetRow as Asset),
          project: projects
        } satisfies AssetWithProject
      })
    },
    staleTime: 1000 * 60 * 2
  })

  const assets = useMemo(() => {
    const remote = query.data ?? []
    const merged = mergeWithLocal(remote)
    return applyFilters(merged, filters)
  }, [query.data, filters, localByProject])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.storyteller?.extractAssetThumbnail) return
    const remote = query.data ?? []
    const merged = mergeWithLocal(remote)
    backfillMissingThumbnails(merged)
  }, [query.data, localByProject])

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of query.data ?? []) {
      if (a.project?.id) map.set(a.project.id, a.project.title)
    }
    for (const [pid] of Object.entries(localByProject)) {
      if (!map.has(pid)) map.set(pid, `Project ${pid.slice(0, 8)}`)
    }
    return [...map.entries()].map(([id, title]) => ({ id, title }))
  }, [query.data, localByProject])

  return {
    assets,
    projectOptions,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch
  }
}

/** MIME type used when dragging an asset from the library onto the timeline. */
export const ASSET_LIBRARY_DRAG_MIME = 'application/x-storyteller-asset'

export function assetDragPayload(asset: Asset): string {
  return JSON.stringify({
    assetId: asset.id,
    projectId: asset.project_id,
    assetType: asset.asset_type,
    durationSeconds: asset.duration_seconds,
    localPath: asset.local_path,
    filename: asset.original_filename
  })
}

export type AssetDragPayload = {
  assetId: string
  projectId: string
  assetType: AssetType
  durationSeconds: number | null
  localPath: string | null
  filename: string | null
}

export function parseAssetDragPayload(raw: string): AssetDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as AssetDragPayload
    if (!parsed?.assetId || !parsed?.projectId) return null
    return parsed
  } catch {
    return null
  }
}
