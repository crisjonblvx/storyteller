/**
 * Storyteller is local-first.
 * The gateway brokers generation but does not become the project media store.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Asset } from '@storyteller/shared'
import { storytellerAiFileBase } from '@storyteller/shared'
import {
  StorytellerGatewayClient,
  capabilityToIntent,
  isHostedGatewayConfigured,
  resolveGatewayUrl,
  formatGatewayErrorDetail,
  GatewayRequestError,
  type GenerateMediaCapabilityRequest,
  type GenerateMediaRequest,
  type MediaCapabilityJobStatus,
  type StorytellerCreativeMode,
  type StorytellerGenerationIntent,
  type StorytellerMediaCapability
} from '@storyteller/ai-gateway'
import { runFfprobe } from './ffprobe.js'
import {
  normalizeImageToDeliverySize,
  normalizeVideoToDeliverySize
} from './ffmpeg-run.js'
import type { DeliveryAspectRatio } from '@storyteller/shared'
import {
  appendBrollFullFrameSuffix,
  buildDirectorStillPrompt,
  inferStillPromptCategory,
  parseStillStyleFromMetadata,
  shouldRefineStillPrompt,
  stillRefineInstruction,
  type StillPromptCategory
} from '@storyteller/shared'

export type GatewayBrollProgress =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string; progress?: number }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; jobId: string }
  | { phase: 'failed'; error: string }

export function isMediaGatewayEnabled(): boolean {
  return isHostedGatewayConfigured(process.env)
}

function gatewayClient(accessToken: string | null | undefined): StorytellerGatewayClient {
  const baseUrl = resolveGatewayUrl(process.env)
  if (!baseUrl) {
    throw new Error('STORYTELLER_GATEWAY_URL is not configured.')
  }
  return new StorytellerGatewayClient({
    baseUrl,
    accessToken: accessToken ?? null,
    proxyToken: process.env.STORYTELLER_PROXY_TOKEN ?? null
  })
}

function ratioToAspect(
  ratio: '1280:720' | '720:1280' | '16:9' | '9:16' | '1:1'
): GenerateMediaRequest['aspectRatio'] {
  if (ratio === '720:1280' || ratio === '9:16') return '9:16'
  if (ratio === '1:1') return '1:1'
  return '16:9'
}

export type CapabilityMediaResult =
  | { ok: true; asset: Asset; jobId: string; localPath: string }
  | { ok: false; error: string; code?: string; providerMessage?: string }

function formatJobFailure(error: { code?: string; message?: string; providerMessage?: string } | undefined): string {
  if (!error?.message) return 'Gateway generation failed.'
  const code = error.code ?? 'PROVIDER_ERROR'
  return formatGatewayErrorDetail(
    new GatewayRequestError(error.message, code, 502, error.providerMessage),
    error.providerMessage
  )
}

function decodeRefinedPromptFromResultUrl(url: string): string | null {
  if (!url.startsWith('data:text/plain;base64,')) return null
  try {
    return Buffer.from(url.slice('data:text/plain;base64,'.length), 'base64').toString('utf8').trim()
  } catch {
    return null
  }
}

async function refineStillPromptViaGateway(params: {
  client: StorytellerGatewayClient
  projectId: string
  slotId?: string
  prompt: string
  category: StillPromptCategory
  creativeMode: StorytellerCreativeMode
  courtesyRegen?: boolean
  onProgress?: (p: GatewayBrollProgress) => void
}): Promise<string> {
  const instruction = stillRefineInstruction(params.category)
  const refineRequest: GenerateMediaCapabilityRequest = {
    projectId: params.projectId,
    slotId: params.slotId,
    capability: 'refine-prompt',
    creativeMode: params.creativeMode,
    prompt: `${instruction}\n\nSOURCE PROMPT:\n${params.prompt}`,
    courtesyRegen: params.courtesyRegen,
    metadata: { stillPromptCategory: params.category }
  }

  params.onProgress?.({ phase: 'generating', detail: 'Refining director prompt…', progress: 5 })
  const started = await params.client.generateMediaCapability(refineRequest)
  const status = await pollCapabilityJob(params.client, started.jobId, params.onProgress, 'Refining prompt…', {
    // Prompt refinement is a fast LLM call (~2-10 s); cap it well below the image budget.
    timeoutMs: 90 * 1000,
    timeoutMessage: 'Prompt refinement timed out. Please try again.'
  })
  if (status.status !== 'succeeded' || !status.result?.url) {
    throw new Error(formatJobFailure(status.error))
  }
  const refined = decodeRefinedPromptFromResultUrl(status.result.url)
  if (!refined) throw new Error('Prompt refinement returned empty text.')
  return refined
}

async function prepareConceptFramePrompt(params: {
  client: StorytellerGatewayClient
  projectId: string
  slotId?: string
  basePrompt: string
  creativeMode: StorytellerCreativeMode
  metadata?: Record<string, unknown>
  courtesyRegen?: boolean
  onProgress?: (p: GatewayBrollProgress) => void
}): Promise<string> {
  const meta = params.metadata ?? {}
  const category = inferStillPromptCategory({
    promptCategory: typeof meta.promptCategory === 'string' ? meta.promptCategory : undefined,
    topLayerMode: typeof meta.topLayerMode === 'string' ? meta.topLayerMode : undefined,
    productionMode: typeof meta.productionMode === 'string' ? meta.productionMode : undefined
  })
  const style = parseStillStyleFromMetadata(meta)
  let prompt = buildDirectorStillPrompt({
    basePrompt: params.basePrompt,
    category,
    style
  })

  if (shouldRefineStillPrompt(prompt, category)) {
    try {
      const refined = await refineStillPromptViaGateway({
        client: params.client,
        projectId: params.projectId,
        slotId: params.slotId,
        prompt,
        category,
        creativeMode: params.creativeMode,
        courtesyRegen: params.courtesyRegen,
        onProgress: params.onProgress
      })
      prompt = /full-bleed|edge-to-edge/i.test(refined) ? refined : appendBrollFullFrameSuffix(refined)
    } catch (e) {
      console.warn('[gateway-media] still prompt refine failed; using enriched prompt', e)
    }
  }

  return prompt
}

/**
 * Unified capability-based media generation. Provider/model selection happens
 * entirely on the gateway. Callers describe what they want, not how to make it.
 *
 * Backwards-compat helpers (e.g. `generateBrollViaHostedGateway`) delegate to
 * this function so all hosted media generation funnels through a single path.
 */
export async function generateMediaViaCapability(params: {
  projectId: string
  slotId?: string
  capability: StorytellerMediaCapability
  creativeMode?: StorytellerCreativeMode
  prompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  durationSeconds?: number
  aspectRatio?: GenerateMediaRequest['aspectRatio']
  quality?: 'draft' | 'standard' | 'premium'
  providerPreference?: 'auto' | 'runway' | 'higgsfield' | 'openai' | 'ideogram'
  accessToken?: string | null
  outputDir: string
  /** Audit metadata (style pack, prompt category, etc). NEVER used for provider routing. */
  metadata?: Record<string, unknown>
  /** When true, skip credit deduction — one free courtesy regen per slot. */
  courtesyRegen?: boolean
  onProgress?: (p: GatewayBrollProgress) => void
}): Promise<CapabilityMediaResult> {
  if (!params.accessToken?.trim()) {
    return {
      ok: false,
      error: 'Sign in to Storyteller to generate media through the hosted gateway.'
    }
  }

  const client = gatewayClient(params.accessToken)
  const onProgress = params.onProgress
  const creativeMode = params.creativeMode ?? 'cinematic_documentary'

  let promptText = params.prompt
  if (params.capability === 'concept-frame' || params.capability === 'storyboard-frame') {
    try {
      promptText = await prepareConceptFramePrompt({
        client,
        projectId: params.projectId,
        slotId: params.slotId,
        basePrompt: params.prompt,
        creativeMode,
        metadata: params.metadata,
        courtesyRegen: params.courtesyRegen,
        onProgress
      })
      // Refinement phase is complete — signal image generation is about to start.
      onProgress?.({ phase: 'generating', detail: 'Generating image…', progress: 15 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onProgress?.({ phase: 'failed', error: msg })
      return { ok: false, error: msg }
    }
  }

  const request: GenerateMediaCapabilityRequest = {
    projectId: params.projectId,
    slotId: params.slotId,
    capability: params.capability,
    creativeMode,
    prompt: promptText,
    negativePrompt: params.negativePrompt,
    referenceImageUrl: params.referenceImageUrl,
    durationSeconds: params.durationSeconds,
    aspectRatio: params.aspectRatio,
    quality: params.quality ?? 'premium',
    providerPreference: params.providerPreference,
    courtesyRegen: params.courtesyRegen,
    metadata: {
      ...params.metadata,
      ...(params.capability === 'concept-frame' || params.capability === 'storyboard-frame'
        ? { promptUsedDigest: promptText.slice(0, 500) }
        : {})
    }
  }

  try {
    onProgress?.({ phase: 'queued', detail: 'Submitting to Storyteller AI…' })
    const started = await client.generateMediaCapability(request)
    const jobId = started.jobId
    onProgress?.({ phase: 'generating', detail: 'Generating image…', progress: 15 })

    const status = await pollCapabilityJob(client, jobId, onProgress, 'Generating image…', {
      timeoutMs: DEFAULT_JOB_TIMEOUT_MS,
      timeoutMessage:
        'Image generation timed out after 4 minutes. The server may be busy — please try again.'
    })
    if (status.status === 'cancelled') {
      return { ok: false, error: 'Generation was cancelled.' }
    }
    if (status.status !== 'succeeded' || !status.result?.url) {
      return {
        ok: false,
        error: formatJobFailure(status.error),
        code: status.error?.code,
        providerMessage: status.error?.providerMessage
      }
    }

    return await downloadCapabilityResult({
      projectId: params.projectId,
      slotId: params.slotId,
      capability: params.capability,
      jobId,
      resultUrl: status.result.url,
      mimeType: status.result.mimeType,
      fileName: status.result.fileName,
      durationFallback: params.durationSeconds ?? 5,
      outputDir: params.outputDir,
      aspectRatio: params.aspectRatio,
      metadata: params.metadata,
      onProgress
    })
  } catch (e) {
    const msg =
      e instanceof GatewayRequestError
        ? formatGatewayErrorDetail(e)
        : e instanceof Error
          ? e.message
          : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return {
      ok: false,
      error: msg,
      code: e instanceof GatewayRequestError ? e.code : undefined,
      providerMessage: e instanceof GatewayRequestError ? e.providerMessage : undefined
    }
  }
}

// Default overall budget for a single capability job (image generation).
// gpt-image-2 settles in ~90-120 s; 4 minutes leaves generous headroom while
// still surfacing a stuck/queued gateway job as a clear, actionable error
// instead of an indefinite spinner.
const DEFAULT_JOB_TIMEOUT_MS = 4 * 60 * 1000

async function pollCapabilityJob(
  client: StorytellerGatewayClient,
  jobId: string,
  onProgress?: (p: GatewayBrollProgress) => void,
  progressDetail = 'Generating…',
  options?: { timeoutMs?: number; timeoutMessage?: string }
): Promise<MediaCapabilityJobStatus> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let status = await client.getMediaCapabilityJob(jobId)
  while (status.status === 'queued' || status.status === 'running') {
    if (Date.now() > deadline) {
      await client.cancelMediaCapabilityJob(jobId).catch(() => undefined)
      const minutes = Math.round(timeoutMs / 60_000)
      throw new Error(
        options?.timeoutMessage ??
          `Generation timed out after ${minutes} minute${minutes === 1 ? '' : 's'}. The server may be busy — please try again.`
      )
    }
    onProgress?.({
      phase: 'generating',
      detail: progressDetail,
      progress: status.progress ?? 30
    })
    await sleep(4000)
    status = await client.getMediaCapabilityJob(jobId)
  }
  return status
}

/**
 * Backwards-compat shim for callers that previously asked for a specific
 * provider (Runway / Higgsfield). Internally routes through the capability
 * layer; the provider hint is preserved only as audit metadata.
 *
 * Prefer `generateMediaViaCapability` for new call sites.
 */
export async function generateBrollViaHostedGateway(params: {
  projectId: string
  slotId: string
  promptText: string
  provider: 'runway' | 'higgsfield'
  ratio: '1280:720' | '720:1280' | '16:9' | '9:16' | '1:1'
  durationSeconds: number
  referenceImageUrl?: string
  higgsfieldModelId?: string
  creativeMode?: StorytellerCreativeMode
  accessToken?: string | null
  outputDir: string
  audit: {
    stylePackId?: string
    promptCategory?: string
  }
  onProgress?: (p: GatewayBrollProgress) => void
}): Promise<
  | { ok: true; asset: Asset; jobId: string; localPath: string; provider: 'runway' | 'higgsfield' }
  | { ok: false; error: string }
> {
  const capability: StorytellerMediaCapability =
    params.provider === 'higgsfield' && params.referenceImageUrl?.trim()
      ? 'video-clip-from-image'
      : 'video-clip-from-text'

  const result = await generateMediaViaCapability({
    projectId: params.projectId,
    slotId: params.slotId,
    capability,
    creativeMode: params.creativeMode,
    prompt: params.promptText,
    referenceImageUrl: params.referenceImageUrl,
    durationSeconds: params.durationSeconds,
    aspectRatio: ratioToAspect(params.ratio),
    accessToken: params.accessToken,
    outputDir: params.outputDir,
    metadata: {
      stylePackId: params.audit.stylePackId,
      promptCategory: params.audit.promptCategory,
      ...(params.higgsfieldModelId ? { higgsfieldModelId: params.higgsfieldModelId } : {}),
      // Legacy hint surfaced to the gateway so existing per-provider routing
      // continues to honor the user's explicit choice. New capability callers
      // should NOT set this — the gateway picks the best provider.
      legacyProviderHint: params.provider
    },
    onProgress: params.onProgress
  })

  if (!result.ok) return result
  return {
    ok: true,
    asset: result.asset,
    jobId: result.jobId,
    localPath: result.localPath,
    provider: params.provider
  }
}

async function downloadCapabilityResult(params: {
  projectId: string
  slotId?: string
  capability: StorytellerMediaCapability
  jobId: string
  resultUrl: string
  mimeType: string
  fileName: string
  durationFallback: number
  outputDir: string
  aspectRatio?: DeliveryAspectRatio
  metadata?: Record<string, unknown>
  onProgress?: (p: GatewayBrollProgress) => void
}): Promise<CapabilityMediaResult> {
  const { onProgress } = params
  await mkdir(params.outputDir, { recursive: true })
  const ext = params.mimeType.startsWith('image/') ? '.png' : '.mp4'
  const kind = ext === '.mp4' ? 'motion' : 'still'
  const fileBase = storytellerAiFileBase({ kind, slotId: params.slotId ?? params.capability })
  const localPath = join(params.outputDir, `${fileBase}${ext}`)

  onProgress?.({ phase: 'downloading', detail: 'Downloading to your project folder…' })
  try {
    if (params.resultUrl.startsWith('data:')) {
      const base64 = params.resultUrl.split(',')[1]
      if (!base64) return { ok: false, error: 'Invalid data URL from gateway.' }
      await writeFile(localPath, Buffer.from(base64, 'base64'))
    } else {
      const res = await fetch(params.resultUrl)
      if (!res.ok) return { ok: false, error: `Download failed (${res.status})` }
      await writeFile(localPath, Buffer.from(await res.arrayBuffer()))
    }

    let duration = params.durationFallback
    let width: number | null = null
    let height: number | null = null
    let fps: number | null = null
    const deliveryAspect: DeliveryAspectRatio =
      params.aspectRatio === '9:16' ? '9:16' : params.aspectRatio === '1:1' ? '1:1' : '16:9'

    if (ext === '.mp4') {
      onProgress?.({ phase: 'probing', detail: 'Normalizing to delivery resolution…' })
      const probed = await runFfprobe(localPath)
      if (!probed.ok) {
        return { ok: false, error: probed.error || 'ffprobe failed on generated clip.' }
      }
      fps = probed.data.fps ?? null
      try {
        const normalized = await normalizeVideoToDeliverySize(localPath, deliveryAspect, fps)
        duration = normalized.durationSeconds ?? duration
        width = normalized.width
        height = normalized.height
      } catch (e) {
        console.warn('[gateway-media] normalizeVideoToDeliverySize failed; using source dimensions', e)
        duration = probed.data.durationSeconds ?? duration
        width = probed.data.width ?? null
        height = probed.data.height ?? null
      }
    } else {
      onProgress?.({ phase: 'probing', detail: 'Normalizing still to delivery resolution…' })
      try {
        const normalized = await normalizeImageToDeliverySize(localPath, deliveryAspect)
        width = normalized.width
        height = normalized.height
      } catch (e) {
        console.warn('[gateway-media] normalizeImageToDeliverySize failed; using source image', e)
      }
    }

    const assetId = randomUUID()
    const createdAt = new Date().toISOString()
    const intent: StorytellerGenerationIntent = capabilityToIntent(params.capability)
    const asset: Asset = {
      id: assetId,
      project_id: params.projectId,
      asset_type: ext === '.mp4' ? 'video' : 'image',
      storage_mode: 'local',
      local_path: localPath,
      storage_path: null,
      proxy_path: null,
      media_hash: null,
      is_uploaded: false,
      original_filename: `${fileBase}${ext}`,
      mime_type: params.mimeType,
      upload_status: 'not_uploaded',
      probe_status: 'success',
      duration_seconds: ext === '.mp4' ? duration : null,
      width,
      height,
      fps,
      metadata_json: {
        origin: 'storyteller-gateway',
        gatewayJobId: params.jobId,
        capability: params.capability,
        intent,
        slotId: params.slotId ?? null,
        ...(params.metadata ?? {}),
        createdAt,
        temporaryResultUrl: params.resultUrl.startsWith('http') ? params.resultUrl : undefined
      },
      sort_order: 9000,
      created_at: createdAt
    }

    onProgress?.({ phase: 'complete', localPath, jobId: params.jobId })
    return { ok: true, asset, jobId: params.jobId, localPath }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
