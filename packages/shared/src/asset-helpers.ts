import type { Asset } from './entities.js'

/** Video/audio that can be sent to analysis (local path or cloud object already uploaded). */
export function isTranscribableMediaAsset(a: Asset): boolean {
  if (a.asset_type !== 'video' && a.asset_type !== 'audio') return false
  if (a.probe_status === 'error') return false
  const lp = typeof a.local_path === 'string' ? a.local_path.trim() : ''
  if (lp.length > 0) return true
  return Boolean(a.storage_path && a.is_uploaded)
}

export function storageBadgeLabel(a: Asset): 'Local' | 'Cloud' | 'Hybrid' {
  const hasL = Boolean(a.local_path?.trim())
  const hasC = Boolean(a.storage_path && a.is_uploaded)
  if (hasL && hasC) return 'Hybrid'
  if (hasC) return 'Cloud'
  return 'Local'
}
