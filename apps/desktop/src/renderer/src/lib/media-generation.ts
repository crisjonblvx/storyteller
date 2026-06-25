import type { Asset } from '@storyteller/shared'
import { formatAiJobStatus, type AiJobPhase } from '@renderer/lib/ai-job-status'
import { backfillAssetThumbnail } from '@renderer/lib/thumbnail-backfill'

/** Legacy ratio strings used by timeline / provider UIs. */
export type BrollRatio = '1280:720' | '720:1280' | '16:9' | '9:16' | '1:1'

export type MediaGenerationProgress = {
  phase: AiJobPhase
  detail?: string
  progress?: number
  localPath?: string
  jobId?: string
  error?: string
}

export type MediaGenerationResult =
  | {
      ok: true
      asset: Asset
      jobId: string
      localPath: string
    }
  | { ok: false; error: string }

export function hasCapabilityMediaBridge(): boolean {
  return typeof window.storyteller?.generateMedia === 'function'
}

export function hasLegacyMediaBridge(provider: 'runway' | 'higgsfield' | 'kling'): boolean {
  if (provider === 'runway') return typeof window.storyteller?.generateRunwayBroll === 'function'
  if (provider === 'higgsfield') return typeof window.storyteller?.generateHiggsfieldBroll === 'function'
  return typeof window.storyteller?.generateKlingBroll === 'function'
}

export function hasMediaGenerationBridge(
  opts: { hostedGateway: boolean; localProvider: 'runway' | 'higgsfield' | 'kling' }
): boolean {
  return opts.hostedGateway ? hasCapabilityMediaBridge() : hasLegacyMediaBridge(opts.localProvider)
}

function ratioToAspect(ratio: BrollRatio): '16:9' | '9:16' | '1:1' | '4:5' {
  if (ratio === '720:1280' || ratio === '9:16') return '9:16'
  if (ratio === '1:1') return '1:1'
  return '16:9'
}

/** Subscribe to capability media progress (hosted gateway). */
export function subscribeMediaGenerationProgress(
  onUpdate: (p: MediaGenerationProgress) => void
): (() => void) | undefined {
  const unsub = window.storyteller?.onMediaProgress?.((p) => {
    onUpdate({
      phase: p.phase,
      detail: p.detail,
      progress: p.progress,
      localPath: p.localPath,
      jobId: p.jobId,
      error: p.error
    })
  })
  return unsub
}

export function formatMediaProgressStatus(p: MediaGenerationProgress): string {
  return formatAiJobStatus(p)
}

/** User-facing label for generate buttons — hides provider names outside dev mode. */
export function storytellerAiGenerationLabel(opts: {
  hostedGateway: boolean
  showDevProviderControls?: boolean
  localProvider?: 'runway' | 'higgsfield' | 'kling'
}): string {
  if (opts.hostedGateway) return 'Storyteller AI'
  if (opts.showDevProviderControls && opts.localProvider) {
    if (opts.localProvider === 'higgsfield') return 'Higgsfield'
    if (opts.localProvider === 'kling') return 'Kling'
    return 'Runway'
  }
  return 'Storyteller AI'
}

function withGeneratedThumbnail(result: MediaGenerationResult): MediaGenerationResult {
  if (result.ok) void backfillAssetThumbnail(result.asset)
  return result
}

/**
 * Generate a video clip via the hosted capability API or a legacy provider IPC
 * (dev BYOK / direct keys when the gateway is not configured).
 */
export async function generateVideoClip(params: {
  hostedGateway: boolean
  localProvider: 'runway' | 'higgsfield' | 'kling'
  projectId: string
  slotId: string
  promptText: string
  ratio: BrollRatio
  durationSeconds: number
  accessToken?: string | null
  referenceImageUrl?: string
  higgsfieldModelId?: string
  audit?: { stylePackId?: string; promptCategory?: string }
}): Promise<MediaGenerationResult> {
  if (params.hostedGateway) {
    const bridge = window.storyteller?.generateMedia
    if (!bridge) {
      return { ok: false, error: 'AI media generation requires the Storyteller desktop app.' }
    }
    const capability =
      params.referenceImageUrl?.trim() ? ('video-clip-from-image' as const) : ('video-clip-from-text' as const)
    const res = await bridge({
      projectId: params.projectId,
      slotId: params.slotId,
      capability,
      creativeMode: 'cinematic_documentary',
      prompt: params.promptText,
      referenceImageUrl: params.referenceImageUrl,
      durationSeconds: params.durationSeconds,
      aspectRatio: ratioToAspect(params.ratio),
      accessToken: params.accessToken ?? undefined,
      metadata: {
        stylePackId: params.audit?.stylePackId,
        promptCategory: params.audit?.promptCategory,
        ...(params.higgsfieldModelId ? { higgsfieldModelId: params.higgsfieldModelId } : {})
      }
    })
    if (!res.ok) return res
    return withGeneratedThumbnail({
      ok: true,
      asset: res.asset as Asset,
      jobId: res.jobId,
      localPath: res.localPath
    })
  }

  if (params.localProvider === 'runway') {
    const bridge = window.storyteller?.generateRunwayBroll
    if (!bridge) {
      return { ok: false, error: 'Video generation requires the Storyteller desktop app.' }
    }
    const ratio =
      params.ratio === '9:16' || params.ratio === '720:1280'
        ? '720:1280'
        : params.ratio === '1:1'
          ? '1280:720'
          : params.ratio === '16:9' || params.ratio === '1280:720'
            ? '1280:720'
            : '1280:720'
    const res = await bridge({
      projectId: params.projectId,
      slotId: params.slotId,
      promptText: params.promptText,
      ratio: ratio as '1280:720' | '720:1280',
      durationSeconds: params.durationSeconds,
      accessToken: params.accessToken ?? undefined,
      audit: params.audit
    })
    if (!res.ok) return res
    return withGeneratedThumbnail({
      ok: true,
      asset: res.asset as Asset,
      jobId: res.taskId,
      localPath: res.localPath
    })
  }

  if (params.localProvider === 'higgsfield') {
    const bridge = window.storyteller?.generateHiggsfieldBroll
    if (!bridge) {
      return { ok: false, error: 'Video generation requires the Storyteller desktop app.' }
    }
    if (!params.higgsfieldModelId?.trim()) {
      return { ok: false, error: 'Higgsfield model id is required for local generation.' }
    }
    const ratio =
      params.ratio === '9:16' || params.ratio === '720:1280' ? '720:1280' : '1280:720'
    const res = await bridge({
      projectId: params.projectId,
      slotId: params.slotId,
      promptText: params.promptText,
      referenceImageUrl: params.referenceImageUrl,
      modelId: params.higgsfieldModelId,
      ratio,
      durationSeconds: params.durationSeconds,
      accessToken: params.accessToken ?? undefined,
      audit: params.audit
    })
    if (!res.ok) return res
    return withGeneratedThumbnail({
      ok: true,
      asset: res.asset as Asset,
      jobId: res.requestId,
      localPath: res.localPath
    })
  }

  const bridge = window.storyteller?.generateKlingBroll
  if (!bridge) {
    return { ok: false, error: 'Video generation requires the Storyteller desktop app.' }
  }
  const ratio =
    params.ratio === '9:16' || params.ratio === '720:1280'
      ? '9:16'
      : params.ratio === '1:1'
        ? '1:1'
        : '16:9'
  const res = await bridge({
    projectId: params.projectId,
    slotId: params.slotId,
    promptText: params.promptText,
    ratio,
    durationSeconds: params.durationSeconds,
    accessToken: params.accessToken ?? undefined,
    audit: params.audit
  })
  if (!res.ok) return res
  return withGeneratedThumbnail({
    ok: true,
    asset: res.asset as Asset,
    jobId: res.taskId,
    localPath: res.localPath
  })
}

/** Generate a still concept frame via the hosted capability API. */
export async function generateConceptFrame(params: {
  projectId: string
  slotId: string
  promptText: string
  ratio: BrollRatio
  imageStyle?: 'visual' | 'text'
  accessToken?: string | null
  audit?: { stylePackId?: string; promptCategory?: string }
  topLayerMode?: string
  style?: {
    referenceStyle?: string
    palette?: string[]
    typography?: string
    layout?: string
    tone?: string
  }
  styleTags?: string[]
}): Promise<MediaGenerationResult> {
  const bridge = window.storyteller?.generateMedia
  if (!bridge) {
    return { ok: false, error: 'AI media generation requires the Storyteller desktop app.' }
  }
  const promptCategory =
    params.audit?.promptCategory ??
    (params.topLayerMode === 'typography'
      ? 'typography-still'
      : params.topLayerMode === 'stat'
        ? 'stat-still'
        : params.topLayerMode === 'empire'
          ? 'empire-still'
          : 'graphics-still')
  const res = await bridge({
    projectId: params.projectId,
    slotId: params.slotId,
    capability: 'concept-frame',
    creativeMode: 'cinematic_documentary',
    prompt: params.promptText,
    aspectRatio: ratioToAspect(params.ratio),
    providerPreference: params.imageStyle === 'text' ? 'ideogram' : 'openai',
    quality: 'premium',
    accessToken: params.accessToken ?? undefined,
    metadata: {
      stylePackId: params.audit?.stylePackId,
      promptCategory,
      topLayerMode: params.topLayerMode,
      styleTags: params.styleTags,
      style: params.style,
      imageStyle: params.imageStyle
    }
  })
  if (!res.ok) return res
  return withGeneratedThumbnail({
    ok: true,
    asset: res.asset as Asset,
    jobId: res.jobId,
    localPath: res.localPath
  })
}
