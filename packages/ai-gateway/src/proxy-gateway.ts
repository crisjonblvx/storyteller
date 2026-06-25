import type { ResolvedAiGatewayConfig } from './config.js'
import type {
  AnalyzeGroundedReviewParams,
  AnalyzeGroundedReviewResult,
  BrollProgressWire,
  GenerateBrollPromptsFromBeatsParams,
  GenerateBrollPromptsFromBeatsResult,
  GenerateBrollPromptsParams,
  GenerateBrollPromptsResult,
  StorytellerAiCapability,
  StorytellerAiGateway,
  TranscribeParams,
  TranscribeResult
} from './types.js'
import { STORYTELLER_AI_CAPABILITY_PATHS } from './types.js'

/**
 * HTTP client for Storyteller-hosted AI endpoints (production).
 * Contract is versioned; paths are stable for desktop clients.
 */
export class ProxyStorytellerAiGateway implements StorytellerAiGateway {
  constructor(private readonly cfg: ResolvedAiGatewayConfig) {
    if (!cfg.apiBaseUrl) {
      throw new Error(
        'STORYTELLER_API_BASE_URL is required when STORYTELLER_AI_MODE=proxy. Set it to your Storyteller API origin.'
      )
    }
  }

  private headersJson(accessToken?: string | null): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = (typeof accessToken === 'string' && accessToken.trim().length > 0
      ? accessToken.trim()
      : null) ?? this.cfg.proxyToken
    if (token) {
      h.Authorization = `Bearer ${token}`
    }
    return h
  }

  async transcribe(params: TranscribeParams): Promise<TranscribeResult> {
    const base = this.cfg.apiBaseUrl!
    const form = new FormData()
    form.append('filename', params.filename)
    if (params.assetType) form.append('assetType', params.assetType)
    if (params.localPath) {
      const { readFile, stat } = await import('node:fs/promises')
      const st = await stat(params.localPath)
      /** Node `readFile` cannot load buffers larger than 2 GiB. */
      const NODE_READFILE_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1
      if (st.size > NODE_READFILE_MAX_BYTES) {
        return {
          ok: false,
          error:
            'Media file is too large for single-shot upload. Transcribe locally on the device (chunked FFmpeg pipeline).'
        }
      }
      const buf = await readFile(params.localPath)
      form.append('file', new Blob([buf]), params.filename)
    } else if (params.signedUrl) {
      form.append('signedUrl', params.signedUrl)
    } else {
      return { ok: false, error: 'Missing media source for transcription.' }
    }

    const headers: Record<string, string> = {}
    if (this.cfg.proxyToken) {
      headers.Authorization = `Bearer ${this.cfg.proxyToken}`
    }

    let res: Response
    try {
      res = await fetch(`${base}${capabilityPath('transcribe')}`, {
        method: 'POST',
        headers,
        body: form
      })
    } catch (err) {
      return { ok: false, error: `Storyteller AI gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, error: `Transcribe proxy ${res.status}: ${text.slice(0, 500)}` }
    }
    try {
      const json = JSON.parse(text) as TranscribeResult
      if (json && typeof json === 'object' && 'ok' in json) {
        return json
      }
      return { ok: false, error: 'Unexpected transcribe response shape' }
    } catch {
      return { ok: false, error: 'Invalid JSON from transcribe proxy' }
    }
  }

  async generateBrollPrompts(
    params: GenerateBrollPromptsParams,
    onProgress?: (p: BrollProgressWire) => void
  ): Promise<GenerateBrollPromptsResult> {
    onProgress?.({ phase: 'generating', detail: 'Requesting Storyteller API…' })
    const base = this.cfg.apiBaseUrl!
    let res: Response
    try {
      res = await fetch(`${base}${capabilityPath('broll-prompts')}`, {
        method: 'POST',
        headers: this.headersJson(params.accessToken),
        body: JSON.stringify(params)
      })
    } catch (err) {
      return { ok: false, error: `Storyteller AI gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Invalid JSON from Storyteller API' }
    }
    const body = parsed as GenerateBrollPromptsResult
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      return { ok: false, error: `Unexpected response (${res.status})` }
    }
    if (res.ok) {
      if (body.ok === true) return body
      if (body.ok === false && 'error' in body) return body
      return { ok: false, error: 'Invalid response body' }
    }
    if (body.ok === false && 'error' in body) return body
    return { ok: false, error: text.slice(0, 400) || `HTTP ${res.status}` }
  }

  async generateBrollPromptsFromBeats(
    params: GenerateBrollPromptsFromBeatsParams,
    onProgress?: (p: BrollProgressWire) => void
  ): Promise<GenerateBrollPromptsFromBeatsResult> {
    onProgress?.({ phase: 'generating', detail: 'Requesting Storyteller API…' })
    const base = this.cfg.apiBaseUrl!
    let res: Response
    try {
      res = await fetch(`${base}${capabilityPath('broll-prompts-from-beats')}`, {
        method: 'POST',
        headers: this.headersJson(params.accessToken),
        body: JSON.stringify(params)
      })
    } catch (err) {
      return { ok: false, error: `Storyteller AI gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Invalid JSON from Storyteller API' }
    }
    const body = parsed as GenerateBrollPromptsFromBeatsResult
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      return { ok: false, error: `Unexpected response (${res.status})` }
    }
    if (res.ok && body.ok === true) return body
    if (body.ok === false && 'error' in body) return body
    return { ok: false, error: text.slice(0, 400) || `HTTP ${res.status}` }
  }

  async generateBrollForSoundbite(
    params: import('./types.js').GenerateBrollForSoundbiteParams
  ): Promise<import('./types.js').GenerateBrollForSoundbiteResult> {
    const base = this.cfg.apiBaseUrl!
    let res: Response
    try {
      res = await fetch(`${base}${capabilityPath('broll-for-soundbite')}`, {
        method: 'POST',
        headers: this.headersJson(params.accessToken),
        body: JSON.stringify(params)
      })
    } catch (err) {
      return { ok: false, error: `Storyteller AI gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Invalid JSON from Storyteller API' }
    }
    const body = parsed as import('./types.js').GenerateBrollForSoundbiteResult
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      return { ok: false, error: `Unexpected response (${res.status})` }
    }
    if (res.ok && body.ok === true) return body
    if (body.ok === false && 'error' in body) return body
    return { ok: false, error: text.slice(0, 400) || `HTTP ${res.status}` }
  }

  async analyzeGroundedReview(
    params: AnalyzeGroundedReviewParams
  ): Promise<AnalyzeGroundedReviewResult> {
    const base = this.cfg.apiBaseUrl!
    let res: Response
    try {
      res = await fetch(`${base}${capabilityPath('grounded-review')}`, {
        method: 'POST',
        headers: this.headersJson(params.accessToken),
        body: JSON.stringify(params)
      })
    } catch (err) {
      return { ok: false, error: `Storyteller AI gateway unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Invalid JSON from Storyteller API' }
    }
    const body = parsed as AnalyzeGroundedReviewResult
    if (typeof body !== 'object' || body === null || !('ok' in body)) {
      return { ok: false, error: `Unexpected response (${res.status})` }
    }
    if (res.ok && body.ok === true) return body
    if (body.ok === false && 'error' in body) return body
    return { ok: false, error: text.slice(0, 400) || `HTTP ${res.status}` }
  }
}

function capabilityPath(
  capability: StorytellerAiCapability
): string {
  return STORYTELLER_AI_CAPABILITY_PATHS[capability]
}
