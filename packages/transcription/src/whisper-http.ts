/** Default per-chunk Whisper HTTP timeout — long episodes need more than Node's ~5 min body cap. */
export function whisperRequestTimeoutMs(): number {
  const raw = Number(process.env.STORYTELLER_WHISPER_REQUEST_TIMEOUT_MS)
  if (Number.isFinite(raw) && raw >= 60_000) return Math.min(raw, 30 * 60_000)
  return 15 * 60_000
}

export function whisperMaxRetries(): number {
  const raw = Number(process.env.STORYTELLER_WHISPER_MAX_RETRIES)
  if (Number.isFinite(raw) && raw >= 0) return Math.min(8, Math.floor(raw))
  return 4
}

export function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message} (${cause.message})`
  }
  return error.message
}

export function isRetryableWhisperHttpError(error: unknown, status?: number): boolean {
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) return true
  if (!(error instanceof Error)) return false
  const msg = `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`.toLowerCase()
  return (
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enetunreach') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('aborted') ||
    msg.includes('body timeout')
  )
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function whisperRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const asSeconds = Number(retryAfterHeader)
    if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.min(asSeconds * 1000, 120_000)
    const asDate = Date.parse(retryAfterHeader)
    if (Number.isFinite(asDate)) return Math.min(Math.max(0, asDate - Date.now()), 120_000)
  }
  const base = Math.min(1000 * 2 ** attempt, 30_000)
  const jitter = Math.floor(Math.random() * 400)
  return base + jitter
}

type WhisperFetchInit = RequestInit & { dispatcher?: unknown }

let whisperDispatcher: unknown | undefined
let whisperDispatcherReady = false

/** Extend undici body/header timeouts for multi-minute Whisper uploads. */
async function whisperFetchDispatcher(): Promise<unknown | undefined> {
  if (whisperDispatcherReady) return whisperDispatcher
  whisperDispatcherReady = true
  try {
    const { Agent } = await import('undici')
    const timeoutMs = whisperRequestTimeoutMs()
    whisperDispatcher = new Agent({
      headersTimeout: 120_000,
      bodyTimeout: timeoutMs,
      connectTimeout: 60_000
    })
  } catch {
    whisperDispatcher = undefined
  }
  return whisperDispatcher
}

export async function postWhisperTranscription(params: {
  apiKey: string
  bytes: Uint8Array
  filename: string
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; reason: string }) => void
}): Promise<
  | { ok: true; text: string; status: number }
  | { ok: false; error: string; status?: number; retryable: boolean }
> {
  const maxAttempts = whisperMaxRetries() + 1
  let lastError = 'Whisper request failed'

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ab = new ArrayBuffer(params.bytes.byteLength)
    new Uint8Array(ab).set(params.bytes)
    const form = new FormData()
    form.append('file', new Blob([ab]), params.filename || 'audio.mp3')
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')

    const dispatcher = await whisperFetchDispatcher()
    const init: WhisperFetchInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.apiKey}` },
      body: form
    }
    if (dispatcher) init.dispatcher = dispatcher

    try {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', init)
      const text = await res.text()
      if (res.ok) {
        return { ok: true, text, status: res.status }
      }

      lastError = `Whisper API error ${res.status}: ${text.slice(0, 500)}`
      if (!isRetryableWhisperHttpError(new Error(lastError), res.status) || attempt >= maxAttempts - 1) {
        return { ok: false, error: lastError, status: res.status, retryable: false }
      }

      const delayMs = whisperRetryDelayMs(attempt, res.headers.get('retry-after'))
      params.onRetry?.({
        attempt: attempt + 1,
        maxAttempts: maxAttempts - 1,
        delayMs,
        reason: lastError
      })
      await sleepMs(delayMs)
    } catch (error) {
      lastError = formatFetchError(error)
      if (!isRetryableWhisperHttpError(error) || attempt >= maxAttempts - 1) {
        return {
          ok: false,
          error:
            lastError === 'fetch failed'
              ? 'Network error reaching OpenAI Whisper (connection timed out or dropped). Check your connection and retry.'
              : lastError,
          retryable: isRetryableWhisperHttpError(error)
        }
      }

      const delayMs = whisperRetryDelayMs(attempt)
      params.onRetry?.({
        attempt: attempt + 1,
        maxAttempts: maxAttempts - 1,
        delayMs,
        reason: lastError
      })
      await sleepMs(delayMs)
    }
  }

  return { ok: false, error: lastError, retryable: true }
}
