import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

const OPENAI_API = 'https://api.openai.com/v1'

export function createOpenAiProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.openaiApiKey

  return {
    name: 'openai',
    isAvailable: () => Boolean(apiKey),
    async submit(request, jobId) {
      if (!apiKey) {
        throw new GatewayError('OpenAI is not configured on the gateway.', 'PROVIDER_UNAVAILABLE', 503)
      }
      if (request.intent === 'prompt_refine') {
        const refined = await refinePrompt(apiKey, request)
        return { providerJobId: `openai-refine:${jobId}:${encodeURIComponent(refined.slice(0, 200))}` }
      }
      const image = await generateImage(apiKey, request)
      return { providerJobId: `openai-image:${jobId}:${image.url}` }
    },
    async poll(providerJobId, request) {
      if (providerJobId.startsWith('openai-refine:')) {
        const text = decodeRefined(providerJobId)
        return {
          status: 'succeeded',
          progress: 100,
          result: {
            url: `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`,
            mimeType: 'text/plain',
            fileName: 'refined-prompt.txt'
          }
        }
      }
      const url = providerJobId.replace(/^openai-image:[^:]+:/, '')
      return {
        status: 'succeeded',
        progress: 100,
        result: buildImageResult(url, request)
      }
    }
  }
}

async function refinePrompt(apiKey: string, request: GenerateMediaRequest): Promise<string> {
  const model = (request.metadata?.openaiModel as string) || process.env.OPENAI_MODEL || 'gpt-5.4-mini'
  const category = typeof request.metadata?.stillPromptCategory === 'string' ? request.metadata.stillPromptCategory : ''
  const systemByCategory: Record<string, string> = {
    'typography-still':
      'You refine image-generation prompts for premium cinematic typography title cards. Expand with exact quoted text hierarchy, materials, environment, and lighting. Return only the improved prompt text.',
    'stat-still':
      'You refine image-generation prompts for premium cinematic stat infographics. Expand layout, materials, and lighting without inventing data. Return only the improved prompt text.',
    'empire-still':
      'You refine image-generation prompts for biographical empire-map infographics. Expand composition, nodes, and lighting without inventing entities. Return only the improved prompt text.',
    'broll-still':
      'You refine photoreal cinematic B-roll still-frame prompts for documentary video. Expand subject, environment, prop, motivated light, lens, framing, and color grade. Static frame only — no camera moves. Return only the improved prompt text.'
  }
  const system =
    systemByCategory[category] ??
    'You refine visual generation prompts for documentary and social video. Return only the improved prompt text.'
  const res = await fetch(`${OPENAI_API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: system
        },
        {
          role: 'user',
          content: `Creative mode: ${request.creativeMode}\n\nPrompt:\n${request.prompt}`
        }
      ],
      temperature: 0.7
    })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new GatewayError('OpenAI prompt refine failed.', 'PROVIDER_ERROR', 502, err.slice(0, 400))
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new GatewayError('OpenAI returned empty refinement.', 'PROVIDER_ERROR', 502)
  return text
}

/** GPT Image model sizes (1024x1024, 1536x1024, 1024x1536; see OpenAI images API). */
function openAiImageSize(aspectRatio: GenerateMediaRequest['aspectRatio']): string {
  if (aspectRatio === '9:16') return '1024x1536'
  if (aspectRatio === '1:1') return '1024x1024'
  return '1536x1024'
}

async function generateImage(apiKey: string, request: GenerateMediaRequest): Promise<{ url: string }> {
  const size = openAiImageSize(request.aspectRatio)
  const res = await fetch(`${OPENAI_API}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
      prompt: request.prompt.trim().slice(0, 4000),
      size,
      n: 1
    })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new GatewayError('OpenAI image generation failed.', 'PROVIDER_ERROR', 502, err.slice(0, 400))
  }
  const json = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> }
  const item = json.data?.[0]
  if (item?.url) return { url: item.url }
  if (item?.b64_json) {
    return { url: `data:image/png;base64,${item.b64_json}` }
  }
  throw new GatewayError('OpenAI returned no image.', 'PROVIDER_ERROR', 502)
}

function decodeRefined(providerJobId: string): string {
  const encoded = providerJobId.split(':').slice(2).join(':')
  return decodeURIComponent(encoded)
}

function buildImageResult(url: string, request: GenerateMediaRequest): GenerationJobResult {
  const slot = request.slotId ?? 'frame'
  return {
    url,
    mimeType: url.startsWith('data:') ? 'image/png' : 'image/png',
    fileName: storytellerAiFileName({ kind: 'still', id: slot })
  }
}
