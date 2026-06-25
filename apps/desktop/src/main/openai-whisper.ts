import type { RelativeTranscriptSegment } from '@storyteller/transcription'
import { postWhisperTranscription } from '@storyteller/transcription'

export type WhisperSegment = { start: number; end: number; text: string }

type WhisperVerboseJson = {
  duration?: number
  language?: string
  segments?: Array<{ start: number; end: number; text?: string }>
}

export type WhisperChunkResult =
  | { ok: true; segments: RelativeTranscriptSegment[]; duration?: number; language?: string }
  | { ok: false; error: string }

export async function whisperFromBytes(
  bytes: Uint8Array,
  filename: string,
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void
): Promise<WhisperChunkResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY is not set (add it to your .env — see docs/transcription.md).' }
  }

  const response = await postWhisperTranscription({
    apiKey,
    bytes,
    filename,
    onRetry
  })

  if (!response.ok) {
    return { ok: false, error: response.error }
  }

  let json: WhisperVerboseJson
  try {
    json = JSON.parse(response.text) as WhisperVerboseJson
  } catch {
    return { ok: false, error: 'Invalid JSON from Whisper API' }
  }

  const raw = json.segments ?? []
  const segments: RelativeTranscriptSegment[] = raw
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: (s.text ?? '').replace(/\s+/g, ' ').trim()
    }))
    .filter((s) => s.text.length > 0)

  return {
    ok: true,
    segments,
    duration: json.duration,
    language: json.language
  }
}
