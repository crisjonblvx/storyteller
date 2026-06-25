import type { AudioChunkPlan } from './types.js'

/** Target at most this many Whisper requests for very long media (parallel + fewer round-trips). */
export const WHISPER_TARGET_MAX_CHUNKS = 36

/** Minimum slice length (seconds) — matches legacy default window. */
export const WHISPER_MIN_CHUNK_DURATION_SEC = 600

/**
 * ~64kbps mono MP3 ≈ 8KB/s → stay under OpenAI 25MB per request (~52 minutes theoretical max).
 * Cap below that for headroom.
 */
export const WHISPER_MAX_CHUNK_DURATION_SEC = 3000

/**
 * Pick a chunk duration so long jobs land near {@link WHISPER_TARGET_MAX_CHUNKS} parts (clamped).
 */
export function computeWhisperChunkDurationSec(totalDurationSec: number): number {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return WHISPER_MIN_CHUNK_DURATION_SEC
  }
  if (totalDurationSec <= WHISPER_MIN_CHUNK_DURATION_SEC + 1e-6) {
    return WHISPER_MIN_CHUNK_DURATION_SEC
  }
  const raw = Math.ceil(totalDurationSec / WHISPER_TARGET_MAX_CHUNKS)
  return Math.min(
    WHISPER_MAX_CHUNK_DURATION_SEC,
    Math.max(WHISPER_MIN_CHUNK_DURATION_SEC, raw)
  )
}

export interface PlanChunksOptions {
  /** Default 600 (10 minutes) — conservative for ~64kbps mono MP3 under API limits */
  chunkDurationSec?: number
  /** Boundary overlap for smoother joins; merge layer should dedupe if > 0 */
  overlapSec?: number
}

/**
 * Duration-based chunking for long-form media. Non-overlapping by default to simplify merge.
 */
export function planAudioChunks(totalDurationSec: number, options?: PlanChunksOptions): AudioChunkPlan[] {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return []
  }

  const chunkDurationSec = options?.chunkDurationSec ?? 600
  const overlapSec = options?.overlapSec ?? 0
  const step = Math.max(1, chunkDurationSec - overlapSec)

  const chunks: AudioChunkPlan[] = []
  let start = 0
  let index = 0

  while (start < totalDurationSec - 1e-6) {
    const remaining = totalDurationSec - start
    const durationSec = Math.min(chunkDurationSec, remaining)
    chunks.push({ index, startSec: start, durationSec })
    index += 1
    start += step
    if (durationSec < chunkDurationSec - 1e-6) break
  }

  return chunks
}
