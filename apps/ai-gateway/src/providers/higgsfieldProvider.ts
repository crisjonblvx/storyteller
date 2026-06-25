import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

const HIGGSFIELD_API = 'https://platform.higgsfield.ai'
const DEFAULT_I2V_MODEL = 'bytedance/seedance/v1/pro/image-to-video'
const DEFAULT_T2V_MODEL = 'bytedance/seedance/v1/pro/text-to-video'

export function createHiggsfieldProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.higgsfieldApiKey
  const apiSecret = env.higgsfieldApiSecret

  return {
    name: 'higgsfield',
    isAvailable: () => Boolean(apiKey && apiSecret),
    async submit(request, _jobId) {
      if (!apiKey || !apiSecret) {
        throw new GatewayError('Higgsfield is not configured on the gateway.', 'PROVIDER_UNAVAILABLE', 503)
      }
      const ref = request.referenceImageUrl?.trim() ?? ''
      const isI2v = Boolean(ref)
      const modelId =
        (typeof request.metadata?.higgsfieldModelId === 'string' && request.metadata.higgsfieldModelId) ||
        (isI2v ? DEFAULT_I2V_MODEL : DEFAULT_T2V_MODEL)
      const duration = Math.min(10, Math.max(4, Math.round(request.durationSeconds ?? 5)))
      const body: Record<string, unknown> = {
        prompt: request.prompt.trim().slice(0, 2000),
        duration,
        aspect_ratio: request.aspectRatio === '9:16' || request.aspectRatio === '4:5' ? '9:16' : '16:9'
      }
      if (isI2v) {
        body.image_url = ref
      }
      const res = await fetch(`${HIGGSFIELD_API}/${modelId}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}:${apiSecret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new GatewayError(
          `Higgsfield submit failed (${res.status}).`,
          'PROVIDER_ERROR',
          502,
          errText.slice(0, 400)
        )
      }
      const json = (await res.json()) as { request_id?: string }
      if (!json.request_id) {
        throw new GatewayError('Higgsfield response missing request_id.', 'PROVIDER_ERROR', 502)
      }
      return { providerJobId: json.request_id }
    },
    async poll(providerJobId) {
      if (!apiKey || !apiSecret) {
        throw new GatewayError('Higgsfield is not configured.', 'PROVIDER_UNAVAILABLE', 503)
      }
      const statusRes = await fetch(`${HIGGSFIELD_API}/requests/${providerJobId}/status`, {
        headers: { Authorization: `Key ${apiKey}:${apiSecret}` }
      })
      if (!statusRes.ok) {
        const errText = await statusRes.text().catch(() => '')
        return {
          status: 'failed',
          errorMessage: `Higgsfield status poll failed (${statusRes.status}): ${errText.slice(0, 200)}`
        }
      }
      const status = (await statusRes.json()) as {
        status?: string
        video?: { url?: string }
        error?: string
      }
      if (status.status === 'completed' && status.video?.url) {
        return {
          status: 'succeeded',
          progress: 100,
          result: {
            url: status.video.url,
            mimeType: 'video/mp4',
            fileName: storytellerAiFileName({ kind: 'motion', id: providerJobId.slice(0, 8) })
          }
        }
      }
      if (status.status === 'failed' || status.status === 'nsfw') {
        return {
          status: 'failed',
          errorMessage:
            status.status === 'nsfw'
              ? 'Higgsfield rejected the shot for content moderation.'
              : status.error ?? 'Higgsfield generation failed.'
        }
      }
      return { status: 'running', progress: 40 }
    }
  }
}
