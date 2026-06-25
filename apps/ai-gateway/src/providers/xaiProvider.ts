import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

const XAI_API = 'https://api.x.ai/v1'

function clampDuration(raw: number | undefined): number {
  const n = Math.round(raw ?? 8)
  if (n < 6) return 6
  if (n > 15) return 15
  return n
}

export function createXaiProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.xaiApiKey

  return {
    name: 'xai',
    isAvailable: () => Boolean(apiKey),
    async submit(request, _jobId) {
      if (!apiKey) {
        throw new GatewayError('xAI Grok is not configured on the gateway.', 'PROVIDER_UNAVAILABLE', 503)
      }
      const ref = request.referenceImageUrl?.trim() ?? ''
      if (!ref) {
        throw new GatewayError(
          'video-clip-from-image requires an approved still image URL.',
          'INVALID_REQUEST',
          400
        )
      }
      const body: Record<string, unknown> = {
        model: env.xaiVideoModel,
        prompt: request.prompt.trim().slice(0, 4000),
        image: { url: ref },
        duration: clampDuration(request.durationSeconds)
      }
      const res = await fetch(`${XAI_API}/videos/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new GatewayError(
          `xAI video submit failed (${res.status}).`,
          'PROVIDER_ERROR',
          502,
          errText.slice(0, 400)
        )
      }
      const json = (await res.json()) as { request_id?: string; id?: string }
      const requestId = json.request_id ?? json.id
      if (!requestId) {
        throw new GatewayError('xAI response missing request id.', 'PROVIDER_ERROR', 502)
      }
      return { providerJobId: requestId }
    },
    async poll(providerJobId) {
      if (!apiKey) {
        return { status: 'failed' as const, errorMessage: 'xAI is not configured.', errorCode: 'PROVIDER_UNAVAILABLE' }
      }
      const res = await fetch(`${XAI_API}/videos/${providerJobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return {
          status: 'failed' as const,
          errorMessage: `xAI status poll failed (${res.status}): ${errText.slice(0, 200)}`,
          errorCode: 'PROVIDER_ERROR'
        }
      }
      const status = (await res.json()) as {
        status?: string
        video?: { url?: string }
        url?: string
        error?: string
      }
      const state = (status.status ?? '').toLowerCase()
      if (state === 'done' || state === 'completed' || state === 'succeeded') {
        const url = status.video?.url ?? status.url
        if (!url) {
          return { status: 'failed' as const, errorMessage: 'xAI returned no video URL.', errorCode: 'PROVIDER_ERROR' }
        }
        return {
          status: 'succeeded' as const,
          progress: 100,
          result: {
            url,
            mimeType: 'video/mp4',
            fileName: storytellerAiFileName({ kind: 'motion', id: providerJobId.slice(0, 8) })
          } satisfies GenerationJobResult
        }
      }
      if (state === 'expired') {
        return {
          status: 'failed' as const,
          errorMessage: 'xAI video generation expired before completion.',
          errorCode: 'PROVIDER_EXPIRED'
        }
      }
      if (state === 'failed' || state === 'error') {
        return {
          status: 'failed' as const,
          errorMessage: status.error ?? 'xAI video generation failed.',
          errorCode: 'PROVIDER_ERROR'
        }
      }
      return { status: 'running' as const, progress: state === 'processing' ? 60 : 30 }
    }
  }
}
