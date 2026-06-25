import type { TranscriptSegment } from '@storyteller/shared'

/** Stub: wire to Whisper / cloud STT via API or Electron main */
export async function transcribeAsset(_params: {
  assetId: string
  storagePath: string
}): Promise<Pick<TranscriptSegment, 'start_time' | 'end_time' | 'text' | 'confidence'>[]> {
  return []
}
