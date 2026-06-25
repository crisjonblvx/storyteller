import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, JournalismClipRole, CreatorClipRole, StoryMode } from '@storyteller/shared'
import { suggestJournalismClipRole, suggestCreatorClipRole } from '@storyteller/shared'
import { classifyAssetType } from '@storyteller/media'
import type { MediaProbeResult } from '@storyteller/media'
import { ensureProjectRow } from '@renderer/lib/projects-api'
import { listProjectAssets, insertCloudAssetRow } from '@renderer/lib/storage-assets'
import { getLocalAssetsSnapshot, useLocalAssetsStore } from '@renderer/stores/local-assets'
import { backfillAssetThumbnail } from '@renderer/lib/thumbnail-backfill'

function mirrorAssetToLocalRegistry(projectId: string, row: Asset) {
  useLocalAssetsStore.getState().addAssets(projectId, [row])
}

type StorytellerApi = {
  probeMedia?: (path: string) => Promise<unknown>
  getPathForFile?: (file: File) => string
}

function getBridge(): StorytellerApi {
  return (typeof window !== 'undefined' && window.storyteller) || {}
}

async function extractAndAttachThumbnail(
  projectId: string,
  assetId: string,
  path: string,
  assetType: Asset['asset_type']
): Promise<void> {
  if (assetType !== 'video' && assetType !== 'image' && assetType !== 'photo') return
  await backfillAssetThumbnail({
    id: assetId,
    project_id: projectId,
    local_path: path,
    proxy_path: null,
    asset_type: assetType
  })
}

/**
 * Electron 32+ stopped exposing `File.path`. Prefer the explicit
 * `getPathForFile` bridge; fall back to the legacy property if present.
 */
function resolveFilePath(file: File): string {
  const legacy = (file as File & { path?: string }).path
  if (typeof legacy === 'string' && legacy) return legacy
  const fromBridge = getBridge().getPathForFile?.(file)
  return typeof fromBridge === 'string' ? fromBridge : ''
}

function withFfprobeMeta(
  base: Record<string, unknown> | null | undefined,
  probe: MediaProbeResult | null
): Record<string, unknown> {
  const b = base && typeof base === 'object' ? { ...base } : {}
  if (probe) {
    b.ffprobe = {
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      codecVideo: probe.codecVideo,
      codecAudio: probe.codecAudio,
      hasVideoStream: probe.hasVideoStream,
      hasAudioStream: probe.hasAudioStream,
      audioChannels: probe.audioChannels
    }
  }
  return b
}

/**
 * The Supabase schema in production may or may not carry `sort_order` on
 * `assets` — we don't depend on it for ordering anymore. The local registry
 * is the source of truth for display order, so we always compute it from
 * there, regardless of whether the cloud row tracks it.
 */
function getNextSortOrderLocal(projectId: string): number {
  const local = getLocalAssetsSnapshot(projectId)
  const max = local.reduce((m, a) => Math.max(m, a.sort_order ?? 0), -1)
  return max + 1
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Treat any non-UUID id (e.g. demo placeholder) as offline so Supabase writes don't 400. */
function looksLikeRealUserId(id: string | undefined): id is string {
  return !!id && UUID_RE.test(id)
}

function buildAssetRecord(params: {
  assetId: string
  projectId: string
  path: string
  fileName: string
  mime: string | null
  assetType: Asset['asset_type']
  probeResult: MediaProbeResult | null
  probeStatus: Asset['probe_status']
  sortOrder: number
  localOnly: boolean
  projectMode?: StoryMode
  clipRole?: JournalismClipRole
  creatorClipRole?: CreatorClipRole
}): Asset {
  const readyForTranscription =
    (params.assetType === 'video' || params.assetType === 'audio') && params.probeStatus !== 'error'

  const autoJournalismRole =
    params.clipRole ??
    (params.projectMode === 'journalism'
      ? suggestJournalismClipRole(params.fileName, params.assetType, params.probeResult?.durationSeconds ?? null)
      : null)

  const autoCreatorRole =
    params.creatorClipRole ??
    (params.projectMode === 'creator'
      ? suggestCreatorClipRole(params.fileName, params.assetType, params.probeResult?.durationSeconds ?? null)
      : null)

  return {
    id: params.assetId,
    project_id: params.projectId,
    asset_type: params.assetType,
    storage_mode: 'local',
    local_path: params.path,
    storage_path: null,
    proxy_path: null,
    media_hash: null,
    is_uploaded: false,
    original_filename: params.fileName,
    mime_type: params.mime,
    upload_status: 'not_uploaded',
    probe_status: params.probeStatus,
    duration_seconds: params.probeResult?.durationSeconds ?? null,
    width: params.probeResult?.width ?? null,
    height: params.probeResult?.height ?? null,
    fps: params.probeResult?.fps ?? null,
    metadata_json: {
      ...withFfprobeMeta({}, params.probeResult),
      readyForTranscription,
      importSource: params.localOnly ? 'local_disk_offline' : 'local_disk',
      localOnly: params.localOnly
    },
    sort_order: params.sortOrder,
    clip_role: autoJournalismRole,
    creator_clip_role: autoCreatorRole,
    created_at: new Date().toISOString()
  }
}

export type ImportProgress = {
  assetId: string
  name: string
  phase: 'queued' | 'probing' | 'saving' | 'done' | 'error'
  message?: string
}

export type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string }

/**
 * Local-first import: register assets with `local_path`, run ffprobe on disk.
 * With Supabase: persists rows. Without Supabase: stores in local device registry (no auth).
 */
export async function importLocalMediaToProject(params: {
  supabase: SupabaseClient | null
  userId?: string
  projectId: string
  projectTitle: string
  projectMode: StoryMode
  files: File[]
  onProgress?: (p: ImportProgress) => void
}): Promise<ImportResult> {
  const { supabase, userId, projectId, projectTitle, projectMode, files, onProgress } = params

  /**
   * Offline path covers: no Supabase configured, no signed-in user, or a
   * placeholder/demo user id. This avoids `invalid input syntax for type uuid`
   * 400s and lets the desktop import keep working without cloud sync.
   */
  if (!supabase || !looksLikeRealUserId(userId)) {
    return importLocalMediaOffline({ projectId, projectMode, files, onProgress })
  }

  /**
   * Best-effort cloud sync. If the project row or any asset row fails (e.g.
   * RLS, schema drift, missing columns) we still register the asset locally
   * so the user can keep working — the failure is surfaced on the row only.
   */
  const ensured = await ensureProjectRow(supabase, projectId, userId, { title: projectTitle, mode: projectMode })
  const cloudSyncEnabled = ensured.ok
  if (!cloudSyncEnabled) {
    console.error('[import] ensureProjectRow failed:', ensured.error)
    onProgress?.({ assetId: '—', name: 'project', phase: 'error', message: ensured.error })
  }

  let imported = 0
  let skipped = 0

  for (const file of files) {
    const assetType = classifyAssetType(file.type, file.name)
    if (!assetType) {
      console.warn('[import] skipping unsupported file type:', file.name, 'mime:', file.type)
      onProgress?.({
        assetId: '—',
        name: file.name,
        phase: 'error',
        message: `Unsupported file type (${file.type || file.name.split('.').pop() || 'unknown'})`
      })
      skipped++
      continue
    }

    const path = resolveFilePath(file)
    if (!path) {
      console.warn('[import] could not resolve path for file:', file.name)
      onProgress?.({
        assetId: '—',
        name: file.name,
        phase: 'error',
        message:
          'Could not resolve a filesystem path for this file. If you pasted from a browser, save it to disk first and re-import.'
      })
      skipped++
      continue
    }

    const assetId = crypto.randomUUID()
    const sortOrder = getNextSortOrderLocal(projectId)

    onProgress?.({ assetId, name: file.name, phase: 'queued' })

    let probeResult: MediaProbeResult | null = null
    let probeStatus: Asset['probe_status'] = 'pending'

    if (getBridge().probeMedia) {
      onProgress?.({ assetId, name: file.name, phase: 'probing' })
      try {
        const raw = await getBridge().probeMedia!(path)
        const pr = raw as { ok?: boolean; data?: MediaProbeResult; error?: string }
        if (pr && typeof pr === 'object' && pr.ok && pr.data) {
          probeResult = pr.data
          probeStatus = 'success'
        } else {
          console.warn('[import] probe returned non-ok for:', file.name, pr)
          probeStatus = 'error'
        }
      } catch (err) {
        console.error('[import] probeMedia threw for:', file.name, err)
        probeStatus = 'error'
      }
    } else {
      probeStatus = 'skipped'
    }

    onProgress?.({ assetId, name: file.name, phase: 'saving' })

    const mirrored = buildAssetRecord({
      assetId,
      projectId,
      path,
      fileName: file.name,
      mime: file.type || null,
      assetType,
      probeResult,
      probeStatus,
      sortOrder,
      localOnly: !cloudSyncEnabled,
      projectMode
    })

    /**
     * Mirror to the local registry FIRST so the UI updates even if the cloud
     * insert fails. The cloud insert is best-effort and never sends columns
     * that may not exist on the live schema (e.g. `sort_order`).
     */
    mirrorAssetToLocalRegistry(projectId, mirrored)
    console.log('[import] mirrored asset to local store:', assetId, file.name, 'projectId:', projectId)
    void extractAndAttachThumbnail(projectId, assetId, path, assetType)

    if (cloudSyncEnabled) {
      const ins = await insertCloudAssetRow(supabase, mirrored)
      if (!ins.ok) {
        console.error('[import] cloud insert failed for:', file.name, ins.error)
        onProgress?.({
          assetId,
          name: file.name,
          phase: 'error',
          message: `Saved locally — cloud sync failed: ${ins.error}`
        })
        imported++
        continue
      }
    }

    imported++
    onProgress?.({ assetId, name: file.name, phase: 'done' })
  }

  console.log('[import] done. imported:', imported, 'skipped:', skipped)
  return { ok: true, imported, skipped }
}

async function importLocalMediaOffline(params: {
  projectId: string
  projectMode?: StoryMode
  files: File[]
  onProgress?: (p: ImportProgress) => void
}): Promise<ImportResult> {
  const { projectId, files, onProgress } = params
  const addAssets = useLocalAssetsStore.getState().addAssets

  let imported = 0
  let skipped = 0

  for (const file of files) {
    const assetType = classifyAssetType(file.type, file.name)
    if (!assetType) {
      console.warn('[import:offline] skipping unsupported file type:', file.name, 'mime:', file.type)
      onProgress?.({
        assetId: '—',
        name: file.name,
        phase: 'error',
        message: `Unsupported file type (${file.type || file.name.split('.').pop() || 'unknown'})`
      })
      skipped++
      continue
    }

    const path = resolveFilePath(file)
    if (!path) {
      console.warn('[import:offline] could not resolve path for file:', file.name)
      onProgress?.({
        assetId: '—',
        name: file.name,
        phase: 'error',
        message:
          'Could not resolve a filesystem path for this file. If you pasted from a browser, save it to disk first and re-import.'
      })
      skipped++
      continue
    }

    const assetId = crypto.randomUUID()
    const sortOrder = getNextSortOrderLocal(projectId)

    onProgress?.({ assetId, name: file.name, phase: 'queued' })

    let probeResult: MediaProbeResult | null = null
    let probeStatus: Asset['probe_status'] = 'pending'

    if (getBridge().probeMedia) {
      onProgress?.({ assetId, name: file.name, phase: 'probing' })
      try {
        const raw = await getBridge().probeMedia!(path)
        const pr = raw as { ok?: boolean; data?: MediaProbeResult; error?: string }
        if (pr && typeof pr === 'object' && pr.ok && pr.data) {
          probeResult = pr.data
          probeStatus = 'success'
        } else {
          console.warn('[import:offline] probe returned non-ok for:', file.name, pr)
          probeStatus = 'error'
        }
      } catch (err) {
        console.error('[import:offline] probeMedia threw for:', file.name, err)
        probeStatus = 'error'
      }
    } else {
      probeStatus = 'skipped'
    }

    onProgress?.({ assetId, name: file.name, phase: 'saving' })

    const asset = buildAssetRecord({
      assetId,
      projectId,
      path,
      fileName: file.name,
      mime: file.type || null,
      assetType,
      probeResult,
      probeStatus,
      sortOrder,
      localOnly: true,
      projectMode: params.projectMode
    })

    addAssets(projectId, [asset])
    console.log('[import:offline] added asset to local store:', assetId, file.name, 'projectId:', projectId)
    void extractAndAttachThumbnail(projectId, assetId, path, assetType)
    imported++
    onProgress?.({ assetId, name: file.name, phase: 'done' })
  }

  console.log('[import:offline] done. imported:', imported, 'skipped:', skipped)
  return { ok: true, imported, skipped }
}

/** @deprecated Use importLocalMediaToProject — kept as alias for gradual migration */
export const uploadFilesToProject = importLocalMediaToProject

export type UploadProgress = ImportProgress

export async function refreshAssets(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ data: Asset[]; error: string | null }> {
  const { data, error } = await listProjectAssets(supabase, projectId)
  return { data: data ?? [], error }
}

/**
 * Ensure a local-first asset row exists in Supabase before writing child rows
 * (e.g. transcript_segments) that reference assets.id.
 */
export async function ensureCloudAssetRow(
  supabase: SupabaseClient,
  asset: Asset
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error: selErr } = await supabase.from('assets').select('id').eq('id', asset.id).maybeSingle()
  if (selErr) return { ok: false, error: selErr.message }
  if (data?.id) return { ok: true }

  return insertCloudAssetRow(supabase, asset)
}

/** Project + asset rows required before cloud transcript writes. */
export async function ensureCloudSyncForTranscription(
  supabase: SupabaseClient,
  params: { projectId: string; projectTitle: string; projectMode: StoryMode; asset: Asset }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (user) {
    const project = await ensureProjectRow(supabase, params.projectId, user.id, {
      title: params.projectTitle,
      mode: params.projectMode
    })
    if (!project.ok) return project
  }
  return ensureCloudAssetRow(supabase, params.asset)
}
