import type { Asset } from './entities.js'

/** Video/audio that can be sent to analysis (local path or cloud object already uploaded). */
export function isTranscribableMediaAsset(a: Asset): boolean {
  if (a.asset_type !== 'video' && a.asset_type !== 'audio') return false
  const lp = typeof a.local_path === 'string' ? a.local_path.trim() : ''
  // A local file is always worth attempting even when ffprobe failed — probe
  // errors only mean we lack metadata; the transcription layer surfaces its
  // own error if the file truly cannot be read.
  if (lp.length > 0) return true
  // For cloud-only assets a successful (or skipped) probe is required.
  if (a.probe_status === 'error') return false
  return Boolean(a.storage_path && a.is_uploaded)
}

export function storageBadgeLabel(a: Asset): 'Local' | 'Cloud' | 'Hybrid' {
  const hasL = Boolean(a.local_path?.trim())
  const hasC = Boolean(a.storage_path && a.is_uploaded)
  if (hasL && hasC) return 'Hybrid'
  if (hasC) return 'Cloud'
  return 'Local'
}
