import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta'
const IMAGEN3_MODEL = 'imagen-3.0-generate-002'
const GEMINI_IMAGE_PREFIX = 'gemini-image:'

/** Veo 3.1 supports 4, 6, 8 — map app duration to nearest supported value. */
function veoDurationSeconds(raw: number | undefined): number {
  const n = Math.round(raw ?? 8)
  if (n <= 5) return 4
  if (n <= 7) return 6
  return 8
}

/** Map generic aspect ratio to Imagen 3 supported values. */
function imagenAspectRatio(raw: string | undefined): string {
  if (raw === '9:16') return '9:16'
  if (raw === '1:1') return '1:1'
  if (raw === '3:4') return '3:4'
  if (raw === '4:3') return '4:3'
  return '16:9'
}

async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new GatewayError(`Could not fetch still image (${res.status}).`, 'INVALID_REQUEST', 400)
  }
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  return { data: buf.toString('base64'), mimeType }
}

export function createGeminiProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.geminiApiKey

  return {
    name: 'gemini',
    isAvailable: () => Boolean(apiKey),
    async submit(request, _jobId) {
      if (!apiKey) {
        throw new GatewayError('Gemini is not configured on the gateway.', 'PROVIDER_UNAVAILABLE', 503)
      }

      // Still image generation via Imagen 3
      if (request.intent === 'concept_frame' || request.intent === 'storyboard_frame') {
        const url = `${GEMINI_API}/models/${IMAGEN3_MODEL}:predict?key=${encodeURIComponent(apiKey)}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: request.prompt.trim().slice(0, 2000) }],
            parameters: {
              sampleCount: 1,
              aspectRatio: imagenAspectRatio(request.aspectRatio)
            }
          })
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new GatewayError(
            `Imagen 3 submit failed (${res.status}).`,
            'PROVIDER_ERROR',
            502,
            errText.slice(0, 400)
          )
        }
        const json = (await res.json()) as {
          predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
        }
        const prediction = json.predictions?.[0]
        if (!prediction?.bytesBase64Encoded) {
          throw new GatewayError('Imagen 3 response missing image data.', 'PROVIDER_ERROR', 502)
        }
        const mime = prediction.mimeType ?? 'image/png'
        const dataUrl = `data:${mime};base64,${prediction.bytesBase64Encoded}`
        // Encode the data URL inline in the providerJobId so poll() can return immediately.
        return { providerJobId: `${GEMINI_IMAGE_PREFIX}${dataUrl}` }
      }

      // Video generation via Veo
      const ref = request.referenceImageUrl?.trim() ?? ''
      if (!ref) {
        throw new GatewayError(
          'video-clip-from-image requires an approved still image URL.',
          'INVALID_REQUEST',
          400
        )
      }
      const image = await fetchImageBase64(ref)
      const model = env.geminiVideoModel
      const url = `${GEMINI_API}/models/${model}:predictLongRunning?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [
            {
              prompt: request.prompt.trim().slice(0, 4000),
              image: {
                bytesBase64Encoded: image.data,
                mimeType: image.mimeType
              }
            }
          ],
          parameters: {
            aspectRatio: request.aspectRatio === '9:16' ? '9:16' : '16:9',
            durationSeconds: veoDurationSeconds(request.durationSeconds),
            sampleCount: 1
          }
        })
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new GatewayError(
          `Gemini video submit failed (${res.status}).`,
          'PROVIDER_ERROR',
          502,
          errText.slice(0, 400)
        )
      }
      const json = (await res.json()) as { name?: string }
      if (!json.name) {
        throw new GatewayError('Gemini response missing operation name.', 'PROVIDER_ERROR', 502)
      }
      return { providerJobId: json.name }
    },
    async poll(providerJobId) {
      if (!apiKey) {
        return { status: 'failed' as const, errorMessage: 'Gemini is not configured.', errorCode: 'PROVIDER_UNAVAILABLE' }
      }

      // Synchronous Imagen 3 result — return immediately.
      if (providerJobId.startsWith(GEMINI_IMAGE_PREFIX)) {
        const dataUrl = providerJobId.slice(GEMINI_IMAGE_PREFIX.length)
        return {
          status: 'succeeded' as const,
          progress: 100,
          result: {
            url: dataUrl,
            mimeType: 'image/png',
            fileName: storytellerAiFileName({ kind: 'still' })
          } satisfies GenerationJobResult
        }
      }

      const opUrl = providerJobId.startsWith('http')
        ? providerJobId
        : `${GEMINI_API}/${providerJobId}?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(opUrl)
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return {
          status: 'failed' as const,
          errorMessage: `Gemini poll failed (${res.status}): ${errText.slice(0, 200)}`,
          errorCode: 'PROVIDER_ERROR'
        }
      }
      const op = (await res.json()) as {
        done?: boolean
        error?: { message?: string }
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{ video?: { uri?: string } }>
          }
        }
      }
      if (op.error?.message) {
        return { status: 'failed' as const, errorMessage: op.error.message, errorCode: 'PROVIDER_ERROR' }
      }
      if (!op.done) {
        return { status: 'running' as const, progress: 45 }
      }
      const videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      if (!videoUri) {
        return { status: 'failed' as const, errorMessage: 'Gemini returned no video URI.', errorCode: 'PROVIDER_ERROR' }
      }
      const dl = await fetch(videoUri, { headers: { 'x-goog-api-key': apiKey } })
      if (!dl.ok) {
        return {
          status: 'failed' as const,
          errorMessage: `Gemini video download failed (${dl.status}).`,
          errorCode: 'PROVIDER_ERROR'
        }
      }
      const buf = Buffer.from(await dl.arrayBuffer())
      const dataUrl = `data:video/mp4;base64,${buf.toString('base64')}`
      return {
        status: 'succeeded' as const,
        progress: 100,
        result: {
          url: dataUrl,
          mimeType: 'video/mp4',
          fileName: storytellerAiFileName({ kind: 'motion' })
        } satisfies GenerationJobResult
      }
    }
  }
}
