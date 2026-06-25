import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

const IDEOGRAM_V3_URL = 'https://api.ideogram.ai/v1/ideogram-v3/generate'

/**
 * Map Storyteller aspect ratios to Ideogram V3 enum values.
 * V3 uses "16x9" format (x-separated, no colon, no ASPECT_ prefix).
 */
function ideogramAspectRatio(aspectRatio: GenerateMediaRequest['aspectRatio']): string {
  if (aspectRatio === '9:16') return '9x16'
  if (aspectRatio === '1:1') return '1x1'
  if (aspectRatio === '4:5') return '4x5'
  return '16x9'
}

/**
 * Default negative prompt applied to every Ideogram still-frame request.
 * Prevents the model from hallucinating background screens, TVs, and broadcast
 * text that it commonly infers for domestic/office settings — even when the
 * prompt never mentions them.
 */
const BASE_NEGATIVE_PROMPT =
  'television, TV monitor, computer monitor, laptop screen, tablet screen, ' +
  'broadcast text, news chyron, subtitle, caption, on-screen text, legible text, ' +
  'readable words, signage with text, newspaper headline, magazine cover text'

async function generateImage(
  apiKey: string,
  request: GenerateMediaRequest
): Promise<{ url: string }> {
  const category =
    typeof request.metadata?.promptCategory === 'string' ? request.metadata.promptCategory : ''
  const topLayerMode =
    typeof request.metadata?.topLayerMode === 'string' ? request.metadata.topLayerMode : ''
  const isTypographyStill =
    category === 'typography-still' ||
    topLayerMode === 'typography' ||
    request.metadata?.imageStyle === 'text'

  const negativePrompt = request.negativePrompt?.trim()
    ? isTypographyStill
      ? request.negativePrompt.trim()
      : `${BASE_NEGATIVE_PROMPT}, ${request.negativePrompt.trim()}`
    : isTypographyStill
      ? 'watermark, blurry, low quality, distorted anatomy'
      : BASE_NEGATIVE_PROMPT

  const form = new FormData()
  form.append('prompt', request.prompt.trim().slice(0, 4000))
  form.append('aspect_ratio', ideogramAspectRatio(request.aspectRatio))
  form.append('magic_prompt', 'OFF')
  form.append('style_type', 'REALISTIC')
  form.append('rendering_speed', 'DEFAULT')
  form.append('negative_prompt', negativePrompt)

  const res = await fetch(IDEOGRAM_V3_URL, {
    method: 'POST',
    headers: { 'Api-Key': apiKey },
    body: form
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new GatewayError(
      'Ideogram image generation failed.',
      'PROVIDER_ERROR',
      502,
      err.slice(0, 400)
    )
  }
  const json = (await res.json()) as { data?: Array<{ url?: string }> }
  const url = json.data?.[0]?.url
  if (!url) {
    throw new GatewayError('Ideogram returned no image URL.', 'PROVIDER_ERROR', 502)
  }
  return { url }
}

function buildImageResult(url: string, request: GenerateMediaRequest): GenerationJobResult {
  const slot = request.slotId ?? 'frame'
  return {
    url,
    mimeType: 'image/jpeg',
    fileName: storytellerAiFileName({ kind: 'still', id: slot })
  }
}

export function createIdeogramProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.ideogramApiKey

  return {
    name: 'ideogram',
    isAvailable: () => Boolean(apiKey),
    async submit(request, jobId) {
      if (!apiKey) {
        throw new GatewayError(
          'Ideogram is not configured on the gateway.',
          'PROVIDER_UNAVAILABLE',
          503
        )
      }
      const image = await generateImage(apiKey, request)
      return { providerJobId: `ideogram-image:${jobId}:${image.url}` }
    },
    async poll(providerJobId, request) {
      const url = providerJobId.replace(/^ideogram-image:[^:]+:/, '')
      return {
        status: 'succeeded',
        progress: 100,
        result: buildImageResult(url, request)
      }
    }
  }
}
