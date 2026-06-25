import type { SilenceRegion } from '@storyteller/shared'

/** Stub: detect silence from audio analysis in main process */
export async function detectSilence(_params: {
  assetId: string
  storagePath: string
}): Promise<Pick<SilenceRegion, 'start_time' | 'end_time' | 'severity'>[]> {
  return []
}
