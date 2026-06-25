import { app } from 'electron'
import {
  resolveAiGatewayConfig,
  ProxyStorytellerAiGateway,
  type AnalyzeGroundedReviewParams,
  type AnalyzeGroundedReviewResult,
  type BrollProgressWire,
  type GenerateBrollForSoundbiteParams,
  type GenerateBrollForSoundbiteResult,
  type GenerateBrollPromptsFromBeatsParams,
  type GenerateBrollPromptsFromBeatsResult,
  type GenerateBrollPromptsParams,
  type GenerateBrollPromptsResult,
  type ResolvedAiGatewayConfig,
  type StorytellerAiGateway,
  type TranscribeParams,
  type TranscribeResult
} from '@storyteller/ai-gateway'
import {
  buildFallbackGroundedReview,
  extractClipCandidatesPipeline,
  flattenAiBrollToPromptRows,
  generateBrollForSoundbiteOpenAI,
  generateGroundedReviewOpenAI,
  generateBeatsPromptsWithFallback,
  generateDirectorPackageOpenAI,
  type BrollBeat
} from '@storyteller/analysis'
import type { PromptPackDefinition } from '@storyteller/analysis'
import { defaultSubjectProfile, normalizeSubjectProfile } from '@storyteller/shared'
import { transcribeAsset } from './chunked-transcription.js'

const UNCONFIGURED_ERROR =
  'Storyteller AI is not configured on this build. Set STORYTELLER_GATEWAY_URL to enable hosted AI.'

const LOCAL_IN_PROD_ERROR =
  'STORYTELLER_AI_MODE=local is a developer-only setting and cannot be used in packaged builds. Configure STORYTELLER_GATEWAY_URL instead.'

/**
 * Resolve the gateway implementation for this process.
 *
 * - `proxy` mode: route every capability call through the hosted gateway.
 * - `local` mode: **dev-only**. Requires an explicit `STORYTELLER_AI_MODE=local`
 *   opt-in AND a non-packaged build. Used for offline development with a
 *   developer's own `OPENAI_API_KEY`. Refused in packaged Storyteller builds.
 * - `unconfigured`: no `STORYTELLER_GATEWAY_URL` and no explicit local opt-in.
 *   Returns a stub gateway whose methods report a clear configuration error
 *   to the renderer (we never silently fall back to provider keys on device).
 */
export function createStorytellerAiGateway(): StorytellerAiGateway {
  const cfg = resolveAiGatewayConfig(process.env)

  if (cfg.mode === 'proxy') {
    if (!cfg.apiBaseUrl) {
      return createUnconfiguredStorytellerAiGateway(
        'STORYTELLER_AI_MODE=proxy requires STORYTELLER_GATEWAY_URL to be set.'
      )
    }
    return createHostedStorytellerAiGateway(new ProxyStorytellerAiGateway(cfg))
  }

  if (cfg.mode === 'local') {
    if (!isDevOnlyEnvironment()) {
      logLocalModeRefusal(cfg)
      return createUnconfiguredStorytellerAiGateway(LOCAL_IN_PROD_ERROR)
    }
    logLocalModeEnabled(cfg)
    return createLocalStorytellerAiGateway()
  }

  // mode === 'unconfigured'
  return createUnconfiguredStorytellerAiGateway(UNCONFIGURED_ERROR)
}

/**
 * True for `npm run dev`, electron-vite watcher, and unpackaged CI builds.
 * Packaged production builds (DMG / AppImage / NSIS) return false.
 */
function isDevOnlyEnvironment(): boolean {
  // Electron's `app` is undefined inside non-electron contexts (e.g. tests
  // importing this module directly). Treat that as dev-only.
  const isPackaged = typeof app !== 'undefined' && app?.isPackaged === true
  if (isPackaged) return false
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
  if (nodeEnv === 'production') return false
  return true
}

function logLocalModeRefusal(cfg: ResolvedAiGatewayConfig): void {
  // eslint-disable-next-line no-console
  console.warn(
    '[storyteller-ai] Refusing STORYTELLER_AI_MODE=local in packaged build. Falling back to unconfigured gateway. reason:',
    cfg.reason
  )
}

function logLocalModeEnabled(cfg: ResolvedAiGatewayConfig): void {
  // eslint-disable-next-line no-console
  console.warn(
    '[storyteller-ai] Local AI mode enabled (dev-only). reason:',
    cfg.reason,
    '— Direct provider calls use OPENAI_API_KEY from .env. End-user builds MUST use the hosted gateway.'
  )
}

/**
 * Hosted gateway for review / prompts / media, with local-first transcription.
 *
 * Long-form local media (30–60+ min, multi-GB 4K files) is chunked on-device
 * via FFmpeg and sent to Whisper part-by-part. The hosted transcribe endpoint
 * only accepts single uploads ≤ ~24MB and must never receive a full source file.
 */
function createHostedStorytellerAiGateway(proxy: StorytellerAiGateway): StorytellerAiGateway {
  return {
    transcribe: (params: TranscribeParams) => transcribeAsset(params),
    generateBrollPrompts: (params, onProgress) => proxy.generateBrollPrompts(params, onProgress),
    generateBrollPromptsFromBeats: (params, onProgress) =>
      proxy.generateBrollPromptsFromBeats(params, onProgress),
    generateBrollForSoundbite: async (params) => {
      const proxied = await proxy.generateBrollForSoundbite(params)
      if (proxied.ok || !process.env.OPENAI_API_KEY) return proxied
      return runLocalBrollForSoundbite(params)
    },
    analyzeGroundedReview: async (params) => {
      const proxied = await proxy.analyzeGroundedReview(params)
      if (proxied.ok || !process.env.OPENAI_API_KEY) return proxied
      return runLocalGroundedReview(params)
    }
  }
}

async function runLocalBrollForSoundbite(
  params: GenerateBrollForSoundbiteParams
): Promise<GenerateBrollForSoundbiteResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { ok: false, error: 'Sign in to Storyteller or configure OPENAI_API_KEY for local development.' }
  }
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
  return generateBrollForSoundbiteOpenAI({
    apiKey,
    model,
    soundbiteId: params.soundbiteId,
    transcriptText: params.transcriptText,
    subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
    promptPack: params.promptPack as PromptPackDefinition,
    directionText: params.aiDirection,
    mode: params.mode,
    shotDurationSeconds: params.shotDurationSeconds,
    previousIdeas: params.previousIdeas
  })
}

async function runLocalGroundedReview(
  params: AnalyzeGroundedReviewParams
): Promise<AnalyzeGroundedReviewResult> {
  if (!params.candidates?.length) {
    return { ok: false, error: 'No grounded candidates were provided.' }
  }
  const reviewModelOverride = process.env.STORYTELLER_REVIEW_MODEL?.trim()
  const apiKey = process.env.OPENAI_API_KEY
  const model = reviewModelOverride || process.env.OPENAI_MODEL || 'gpt-5.4-mini'
  if (!apiKey) {
    return {
      ok: true,
      source: 'fallback',
      reason: 'Local AI mode without OPENAI_API_KEY.',
      review: buildFallbackGroundedReview({
        candidates: params.candidates,
        directionText: params.directionText,
        mode: params.mode,
        shotDurationSeconds: params.shotDurationSeconds
      })
    }
  }
  const result = await generateGroundedReviewOpenAI({
    apiKey,
    model,
    candidates: params.candidates,
    segments: params.segments,
    subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
    promptPack: params.promptPack as PromptPackDefinition,
    directionText: params.directionText,
    mode: params.mode,
    targetCount: params.targetCount,
    shotDurationSeconds: params.shotDurationSeconds
  })

  if (result.ok) {
    return { ok: true, source: 'ai', review: result.review, candidates: result.candidates }
  }

  return {
    ok: true,
    source: 'fallback',
    reason: result.error,
    review: buildFallbackGroundedReview({
      candidates: params.candidates,
      directionText: params.directionText,
      mode: params.mode,
      shotDurationSeconds: params.shotDurationSeconds
    })
  }
}

/**
 * Stub gateway used when Storyteller AI is not configured. Every method
 * returns a clear, end-user-safe error — never a provider/model detail.
 */
function createUnconfiguredStorytellerAiGateway(message: string): StorytellerAiGateway {
  return {
    transcribe: async (): Promise<TranscribeResult> => ({ ok: false, error: message }),
    generateBrollPrompts: async (
      _params: GenerateBrollPromptsParams,
      _onProgress?: (p: BrollProgressWire) => void
    ): Promise<GenerateBrollPromptsResult> => ({ ok: false, error: message }),
    generateBrollPromptsFromBeats: async (
      _params: GenerateBrollPromptsFromBeatsParams,
      _onProgress?: (p: BrollProgressWire) => void
    ): Promise<GenerateBrollPromptsFromBeatsResult> => ({ ok: false, error: message }),
    generateBrollForSoundbite: async (
      _params: GenerateBrollForSoundbiteParams
    ): Promise<GenerateBrollForSoundbiteResult> => ({ ok: false, error: message }),
    analyzeGroundedReview: async (
      _params: AnalyzeGroundedReviewParams
    ): Promise<AnalyzeGroundedReviewResult> => ({ ok: false, error: message })
  }
}

/**
 * DEV-ONLY: direct-to-provider gateway using `OPENAI_API_KEY` from the
 * developer's `.env`. Never bundled into packaged builds — see `createStorytellerAiGateway`.
 */
function createLocalStorytellerAiGateway(): StorytellerAiGateway {
  return {
    transcribe: (params: TranscribeParams) => transcribeAsset(params),
    generateBrollPrompts: async (params, onProgress) => {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        return {
          ok: false,
          error:
            'Local AI mode requires OPENAI_API_KEY in .env for development. Use STORYTELLER_GATEWAY_URL for production.'
        }
      }
      const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
      const maxCandidates = Number(process.env.STORYTELLER_DIRECTOR_MAX_CANDIDATES)

      const extracted = await extractClipCandidatesPipeline(params.segments, {
        maxCandidates: Number.isFinite(maxCandidates) && maxCandidates >= 8 ? maxCandidates : 96,
        mode: params.mode,
        onProgress: (p: { totalShards: number; completedShards: number }) =>
          onProgress?.({
            phase: 'extracting',
            detail:
              p.totalShards <= 1
                ? 'Stage 1: extracting complete-thought candidates…'
                : `Stage 1: shards ${p.completedShards}/${p.totalShards}`,
            chunk: p.completedShards,
            chunkTotal: p.totalShards
          })
      })

      const gen = await generateDirectorPackageOpenAI({
        apiKey,
        model,
        candidates: extracted,
        subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
        promptPack: params.promptPack as PromptPackDefinition,
        aiDirection: params.aiDirection,
        mode: params.mode,
        shotDurationSeconds: params.shotDurationSeconds,
        onProgress: (p) => onProgress?.({ phase: p.phase, detail: p.detail })
      })
      if (!gen.ok) return { ok: false, error: gen.error }
      const pack = params.promptPack as PromptPackDefinition
      const rows = flattenAiBrollToPromptRows(params.projectId, gen.aiResults, pack.id, pack.label)
      const prompts = rows.map((row, i) => ({
        ...row,
        metadata_json: {
          ...(row.metadata_json && typeof row.metadata_json === 'object' ? row.metadata_json : {}),
          ...(i === 0 ? { directorCreativePackage: gen.creativePackage } : {})
        }
      }))
      return { ok: true, prompts, creativePackage: gen.creativePackage }
    },
    generateBrollPromptsFromBeats: async (params, onProgress) => {
      const apiKey = process.env.OPENAI_API_KEY
      const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
      const beats: BrollBeat[] = (params.beats ?? []).map((b) => ({
        id: b.id,
        source_start: b.source_start,
        source_end: b.source_end,
        transcript_text: b.transcript_text,
        score: b.score ?? null,
        origin: b.origin
      }))
      onProgress?.({
        phase: 'generating',
        detail: `Writing ${beats.length} beat prompt${beats.length === 1 ? '' : 's'}…`
      })
      const res = await generateBeatsPromptsWithFallback({
        apiKey,
        model,
        projectId: params.projectId,
        beats,
        subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
        promptPack: params.promptPack as PromptPackDefinition,
        aiDirection: params.aiDirection,
        mode: params.mode,
        shotDurationSeconds: params.shotDurationSeconds,
        onProgress: (p) => onProgress?.({ phase: p.phase, detail: p.detail, chunk: p.chunk, chunkTotal: p.chunkTotal })
      })
      return res
    },
    generateBrollForSoundbite: (params) => runLocalBrollForSoundbite(params),
    analyzeGroundedReview: (params) => runLocalGroundedReview(params)
  }
}

let singleton: StorytellerAiGateway | null = null

export function getStorytellerAiGateway(): StorytellerAiGateway {
  if (!singleton) singleton = createStorytellerAiGateway()
  return singleton
}

/** Tests or hot-reload (optional). */
export function resetStorytellerAiGatewayForTests(): void {
  singleton = null
}
