import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, JournalismClipRole, CreatorClipRole } from '@storyteller/shared'
import { STORAGE_BUCKET } from '@renderer/lib/constants'

export function buildStorageObjectKey(projectId: string, assetId: string, sanitizedFilename: string): string {
  return `projects/${projectId}/assets/${assetId}-${sanitizedFilename}`
}

function normalizeAsset(row: Record<string, unknown>): Asset {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    asset_type: row.asset_type as Asset['asset_type'],
    storage_mode: (row.storage_mode as Asset['storage_mode']) ?? 'local',
    local_path: row.local_path != null ? String(row.local_path) : null,
    storage_path: row.storage_path != null ? String(row.storage_path) : null,
    proxy_path: row.proxy_path != null ? String(row.proxy_path) : null,
    media_hash: row.media_hash != null ? String(row.media_hash) : null,
    is_uploaded: Boolean(row.is_uploaded),
    original_filename: row.original_filename != null ? String(row.original_filename) : null,
    mime_type: row.mime_type != null ? String(row.mime_type) : null,
    upload_status: (row.upload_status as Asset['upload_status']) ?? 'not_uploaded',
    probe_status: (row.probe_status as Asset['probe_status']) ?? 'pending',
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    width: row.width != null ? Number(row.width) : null,
    height: row.height != null ? Number(row.height) : null,
    fps: row.fps != null ? Number(row.fps) : null,
    metadata_json: (row.metadata_json as Record<string, unknown>) ?? null,
    /**
     * `sort_order` may be absent in the live Supabase schema. Fall back to 0
     * — display ordering is driven by the local registry / created_at.
     */
    sort_order:
      typeof row.sort_order === 'number'
        ? row.sort_order
        : Number(row.sort_order) || 0,
    clip_role: row.clip_role != null ? (row.clip_role as JournalismClipRole) : null,
    creator_clip_role: row.creator_clip_role != null ? (row.creator_clip_role as CreatorClipRole) : null,
    created_at: String(row.created_at)
  }
}

export async function listProjectAssets(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ data: Asset[] | null; error: string | null }> {
  /**
   * The Supabase `assets` table in production may not have `sort_order`.
   * Order by `created_at` only — the local-asset registry is the source of
   * truth for display order on the desktop app.
   */
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) return { data: null, error: error.message }
  const rows = (data ?? []) as Record<string, unknown>[]
  return { data: rows.map(normalizeAsset), error: null }
}

export async function getSignedAssetUrl(
  supabase: SupabaseClient,
  storagePath: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!storagePath) return null
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

export async function deleteAssetObject(
  supabase: SupabaseClient,
  storagePath: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([storagePath])
  return { error: error?.message ?? null }
}

/**
 * Upload a still image (Higgsfield reference frame, etc.) to Supabase Storage
 * under the project-scoped path layout, then return the storage key so the
 * caller can sign a URL with `getSignedAssetUrl`.
 *
 * We do this in the renderer rather than the main process because the
 * renderer already holds the Supabase auth session — main would otherwise
 * need a service-role key, which is the kind of thing we don't want sitting
 * on user disks.
 */
export async function uploadReferenceImageToStorage(
  supabase: SupabaseClient,
  params: {
    projectId: string
    file: File
    /** Optional id for the storage key — mirrors `Asset.id`. */
    assetId: string
  }
): Promise<{ storagePath: string; error: null } | { storagePath: null; error: string }> {
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'image'
  const storagePath = buildStorageObjectKey(params.projectId, params.assetId, safeName)
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, params.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: params.file.type || 'image/jpeg'
    })
  if (error) return { storagePath: null, error: error.message }
  return { storagePath, error: null }
}

function isMissingColumnError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('could not find') && lower.includes('column')
}

/** Full local-first asset row (requires hybrid + upload migrations). */
export function buildPreferredCloudAssetInsert(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    project_id: asset.project_id,
    asset_type: asset.asset_type,
    storage_mode: asset.storage_mode ?? 'local',
    local_path: asset.local_path,
    storage_path: asset.storage_path,
    proxy_path: asset.proxy_path,
    media_hash: asset.media_hash,
    is_uploaded: asset.is_uploaded ?? false,
    original_filename: asset.original_filename,
    mime_type: asset.mime_type,
    upload_status: asset.upload_status ?? 'not_uploaded',
    probe_status: asset.probe_status ?? 'pending',
    duration_seconds: asset.duration_seconds,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
    metadata_json: asset.metadata_json,
    ...(asset.clip_role != null && asset.clip_role !== 'unassigned' ? { clip_role: asset.clip_role } : {}),
    ...(asset.creator_clip_role != null && asset.creator_clip_role !== 'unassigned' ? { creator_clip_role: asset.creator_clip_role } : {})
  }
}

/** Legacy assets table (initial schema only) — local path lives in metadata_json. */
export function buildLegacyCloudAssetInsert(asset: Asset): Record<string, unknown> {
  const meta = {
    ...(asset.metadata_json && typeof asset.metadata_json === 'object' ? asset.metadata_json : {}),
    local_path: asset.local_path ?? undefined,
    storage_mode: asset.storage_mode ?? 'local',
    is_uploaded: asset.is_uploaded ?? false,
    original_filename: asset.original_filename ?? undefined,
    mime_type: asset.mime_type ?? undefined,
    upload_status: asset.upload_status ?? 'not_uploaded',
    probe_status: asset.probe_status ?? 'pending'
  }
  const storagePath =
    asset.storage_path?.trim() || `local-reference/${asset.project_id}/${asset.id}`

  return {
    id: asset.id,
    project_id: asset.project_id,
    asset_type: asset.asset_type,
    storage_path: storagePath,
    duration_seconds: asset.duration_seconds,
    width: asset.width,
    height: asset.height,
    fps: asset.fps,
    metadata_json: meta
  }
}

export async function insertCloudAssetRow(
  supabase: SupabaseClient,
  asset: Asset
): Promise<{ ok: true } | { ok: false; error: string }> {
  const preferred = buildPreferredCloudAssetInsert(asset)
  let { error: insErr } = await supabase.from('assets').insert(preferred)
  if (insErr && isMissingColumnError(insErr.message)) {
    ;({ error: insErr } = await supabase.from('assets').insert(buildLegacyCloudAssetInsert(asset)))
  }
  if (insErr) return { ok: false, error: insErr.message }
  return { ok: true }
}
