import type { RelativeTranscriptSegment } from './types.js'

/**
 * Swappable transcription backend (OpenAI Whisper, local Whisper, Deepgram, etc.).
 * Implementations run in the Electron main process or a trusted worker.
 */
export interface TranscriptionProvider {
  readonly id: string
  transcribeAudioChunk(params: {
    bytes: Uint8Array
    filename: string
  }): Promise<{ ok: true; segments: RelativeTranscriptSegment[]; duration?: number; language?: string } | { ok: false; error: string }>
}
