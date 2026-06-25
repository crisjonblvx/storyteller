import type { Asset } from '@storyteller/shared'
import { isTranscribableMediaAsset } from '@storyteller/shared'

export type SourceMediaStatus =
  | 'no_media'
  | 'no_transcribable'
  | 'missing_local_path'
  | 'cloud_only_ok'
  | 'ready_local'
  | 'checking'

/** Primary video, else first transcribable audio. */
export function pickPrimaryTranscribableAsset(assets: Asset[]): Asset | null {
  const v = assets.find((a) => a.asset_type === 'video' && isTranscribableMediaAsset(a))
  if (v) return v
  const au = assets.find((a) => a.asset_type === 'audio' && isTranscribableMediaAsset(a))
  return au ?? null
}

export function sourceMediaStatus(asset: Asset | null): SourceMediaStatus {
  if (!asset) return 'no_media'
  if (!isTranscribableMediaAsset(asset)) return 'no_transcribable'
  const lp = asset.local_path?.trim()
  if (lp) return 'ready_local'
  if (asset.storage_path && asset.is_uploaded) return 'cloud_only_ok'
  return 'missing_local_path'
}

/** User-facing message when analyze should stay disabled. */
export function analyzeBlockedReason(status: SourceMediaStatus): string | null {
  switch (status) {
    case 'no_media':
      return 'Upload a video or audio file on step 1 before analyzing.'
    case 'no_transcribable':
      return 'Add a video or audio file with a successful probe (or fix the failed import).'
    case 'missing_local_path':
      return 'This project has no usable file path for analysis. Re-import the media using Select files in the Storyteller app.'
    default:
      return null
  }
}

export function mapTranscriptionErrorForUser(raw: string): string {
  const lower = raw.toLowerCase()
  if (
    lower.includes('file not found') ||
    lower.includes('source_file_missing') ||
    lower.includes('media analysis failed') ||
    (lower.includes('ffprobe') && lower.includes('not found'))
  ) {
    return "We couldn't locate your media file on this computer. If you moved, renamed, or deleted it, go back to Upload and add the file again (use **Select files** or drag-and-drop in the Storyteller app window)."
  }
  if (lower.includes('invalid path') || lower.includes('provide localpath or signedurl')) {
    return 'No valid media path is available for analysis. Re-import your video or sign in to use cloud-backed media.'
  }
  if (lower.includes('transcript_segments_asset_id_fkey') || lower.includes('violates foreign key constraint')) {
    return "We couldn't save the transcript to your cloud project — the media record wasn't synced. Try re-importing the file on step 1, then run Analyze again."
  }
  if (lower.includes('could not find') && lower.includes('column')) {
    return "Your cloud database is missing a required schema update for local media. Retry in a moment — if this persists, contact support."
  }
  // Catch-all: strip any remaining vendor/implementation details before display
  if (
    lower.includes('openai') ||
    lower.includes('anthropic') ||
    lower.includes('whisper') ||
    lower.includes('api_key') ||
    lower.includes('.env') ||
    lower.includes('docs/')
  ) {
    return 'Storyteller AI encountered an error. Please try again or contact support.'
  }
  return raw
}
