import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset } from '@storyteller/shared'
import { refreshAssets } from '@renderer/lib/asset-upload'
import { EMPTY_ASSET_LIST, useLocalAssetsStore } from '@renderer/stores/local-assets'

/**
 * Merge remote (Supabase) rows with the local device registry.
 * Prefer `local_path` from the local copy when present — it is the authoritative path on this machine.
 */
function mergeAssets(local: Asset[], remote: Asset[]): Asset[] {
  const remoteById = new Map(remote.map((a) => [a.id, a]))
  const localById = new Map(local.map((a) => [a.id, a]))
  const ids = new Set<string>([...remoteById.keys(), ...localById.keys()])
  const merged: Asset[] = []
  for (const id of ids) {
    const r = remoteById.get(id)
    const l = localById.get(id)
    if (r && l) {
      const lp = l.local_path?.trim() || r.local_path?.trim() || ''
      merged.push({
        ...r,
        ...l,
        local_path: lp.length > 0 ? lp : null,
        storage_path: r.storage_path ?? l.storage_path ?? null,
        is_uploaded: Boolean(r.is_uploaded || l.is_uploaded),
        sort_order: r.sort_order ?? l.sort_order ?? 0,
        probe_status: r.probe_status === 'error' ? 'error' : l.probe_status === 'success' ? l.probe_status : r.probe_status,
        duration_seconds: r.duration_seconds ?? l.duration_seconds,
        width: r.width ?? l.width,
        height: r.height ?? l.height,
        fps: r.fps ?? l.fps,
        metadata_json: r.metadata_json ?? l.metadata_json
      })
    } else {
      merged.push((r ?? l)!)
    }
  }
  return merged.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

export function useProjectAssets(projectId: string | undefined, supabase: SupabaseClient | null) {
  const local = useLocalAssetsStore((s) => {
    if (!projectId) return EMPTY_ASSET_LIST
    return s.byProject[projectId] ?? EMPTY_ASSET_LIST
  })
  const [remoteAssets, setRemoteAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) {
      setRemoteAssets([])
      setLoading(false)
      setError(null)
      return
    }
    if (!supabase) {
      setRemoteAssets([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error: e } = await refreshAssets(supabase, projectId)
    setRemoteAssets(data)
    setError(e)
    setLoading(false)
  }, [projectId, supabase])

  useEffect(() => {
    void load()
  }, [load])

  const assets = useMemo(() => {
    if (!projectId) return []
    return mergeAssets(local, remoteAssets)
  }, [projectId, local, remoteAssets])

  return { assets, loading, error, refresh: load }
}
