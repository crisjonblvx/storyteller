import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import { postWhisperTranscription } from '@storyteller/transcription'

export type WhisperSegmentWire = { start: number; end: number; text: string }

type WhisperVerboseJson = {
  duration?: number
  language?: string
  segments?: Array<{ start: number; end: number; text?: string }>
}

export async function whisperFromBytes(
  env: GatewayEnv,
  bytes: Uint8Array,
  filename: string
): Promise<
  | { ok: true; segments: WhisperSegmentWire[]; duration?: number; language?: string }
  | { ok: false; error: string }
> {
  const apiKey = env.openaiApiKey
  if (!apiKey) {
    throw new GatewayError('OpenAI is not configured for transcription.', 'PROVIDER_UNAVAILABLE', 503)
  }

  const response = await postWhisperTranscription({
    apiKey,
    bytes,
    filename
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

  const segments: WhisperSegmentWire[] = (json.segments ?? [])
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: (s.text ?? '').trim()
    }))
    .filter((s) => s.text.length > 0)

  return {
    ok: true,
    segments,
    duration: json.duration,
    language: json.language
  }
}
