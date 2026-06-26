import type {
  GenerateMediaCapabilityRequest,
  GenerateMediaCapabilityResponse,
  GenerateMediaRequest,
  GenerateMediaResponse,
  GenerationJobStatus,
  MediaCapabilityJobStatus
} from './media-types.js'
import type {
  StorytellerAccountSummaryWire,
  StorytellerUsageHistory,
  GatewayErrorBody
} from './account-types.js'
import { parseGatewayErrorBody, GatewayRequestError } from './account-types.js'

export interface StorytellerGatewayClientOptions {
  baseUrl: string
  /** Supabase user JWT (access token). */
  accessToken?: string | null
  /** Optional service/dev token when not using Supabase session. */
  proxyToken?: string | null
}

/**
 * HTTP client for the hosted Storyteller AI Gateway media API.
 * Desktop downloads completed assets locally — temporary URLs are not stored in projects.
 */
export class StorytellerGatewayClient {
  constructor(private readonly opts: StorytellerGatewayClientOptions) {
    const base = opts.baseUrl.replace(/\/+$/, '')
    if (!base) throw new Error('StorytellerGatewayClient requires a non-empty baseUrl')
    this.opts = { ...opts, baseUrl: base }
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.opts.accessToken) {
      h.Authorization = `Bearer ${this.opts.accessToken}`
    } else if (this.opts.proxyToken) {
      h.Authorization = `Bearer ${this.opts.proxyToken}`
    }
    return h
  }

  async generateMedia(request: GenerateMediaRequest): Promise<GenerateMediaResponse> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/media/generate`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(request)
      })
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as GenerateMediaResponse & { error?: string }
    if (!res.ok) {
      throw new Error(body?.message ?? (body as { error?: string }).error ?? `Generate failed (${res.status})`)
    }
    return body
  }

  async getJob(jobId: string): Promise<GenerationJobStatus> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/media/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: this.authHeaders()
      })
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as GenerationJobStatus & { error?: string }
    if (!res.ok) {
      throw new Error(body?.error?.message ?? (body as { error?: string }).error ?? `Job fetch failed (${res.status})`)
    }
    return body
  }

  async cancelJob(jobId: string): Promise<void> {
    let res: Response
    try {
      res = await fetch(
        `${this.opts.baseUrl}/v1/media/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: 'POST', headers: this.authHeaders() }
      )
    } catch {
      return
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 300) || `Cancel failed (${res.status})`)
    }
  }

  /**
   * Capability media generation — provider/model selection is opaque.
   * Preferred over `generateMedia` for new callers.
   */
  async generateMediaCapability(
    request: GenerateMediaCapabilityRequest
  ): Promise<GenerateMediaCapabilityResponse> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/capabilities/media-generate`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(request)
      })
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as GenerateMediaCapabilityResponse & GatewayErrorBody
    if (!res.ok) {
      throw parseGatewayErrorBody(res.status, body)
    }
    return body
  }

  async getAccount(): Promise<StorytellerAccountSummaryWire> {
    let res: Response
    try {
      res = await fetch(`${this.opts.baseUrl}/v1/capabilities/account`, {
        method: 'GET',
        headers: this.authHeaders()
      })
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as StorytellerAccountSummaryWire & GatewayErrorBody
    if (!res.ok) {
      throw parseGatewayErrorBody(res.status, body)
    }
    return body
  }

  async getUsage(opts?: { limit?: number; offset?: number }): Promise<StorytellerUsageHistory> {
    const params = new URLSearchParams()
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.offset != null) params.set('offset', String(opts.offset))
    const qs = params.toString()
    let res: Response
    try {
      res = await fetch(
        `${this.opts.baseUrl}/v1/capabilities/account/usage${qs ? `?${qs}` : ''}`,
        { method: 'GET', headers: this.authHeaders() }
      )
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as StorytellerUsageHistory & GatewayErrorBody
    if (!res.ok) {
      throw parseGatewayErrorBody(res.status, body)
    }
    return body
  }

  async getMediaCapabilityJob(jobId: string): Promise<MediaCapabilityJobStatus> {
    let res: Response
    try {
      res = await fetch(
        `${this.opts.baseUrl}/v1/capabilities/media-jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET', headers: this.authHeaders() }
      )
    } catch (err) {
      throw new GatewayRequestError(
        `Storyteller AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
        'NETWORK_ERROR', 0
      )
    }
    const body = (await res.json()) as MediaCapabilityJobStatus & { error?: string }
    if (!res.ok) {
      throw new Error(body?.error?.message ?? (body as { error?: string }).error ?? `Job fetch failed (${res.status})`)
    }
    return body
  }

  async cancelMediaCapabilityJob(jobId: string): Promise<void> {
    let res: Response
    try {
      res = await fetch(
        `${this.opts.baseUrl}/v1/capabilities/media-jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: 'POST', headers: this.authHeaders() }
      )
    } catch {
      return
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 300) || `Cancel failed (${res.status})`)
    }
  }
}
