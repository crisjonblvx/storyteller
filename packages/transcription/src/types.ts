/** One planned segment of source media for FFmpeg extraction + transcription. */
export interface AudioChunkPlan {
  index: number
  /** Start time in seconds within the source file */
  startSec: number
  /** Duration in seconds (last chunk may be shorter) */
  durationSec: number
}

/** Raw segment from a provider (times relative to chunk audio, starting at 0). */
export interface RelativeTranscriptSegment {
  start: number
  end: number
  text: string
}

/** Result of transcribing one chunk, before global offset is applied. */
export interface ChunkTranscriptionResult {
  chunkIndex: number
  /** Add to each segment time to get asset-relative seconds */
  offsetSec: number
  segments: RelativeTranscriptSegment[]
}
