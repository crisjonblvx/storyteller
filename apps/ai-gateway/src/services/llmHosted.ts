import {
  buildFallbackGroundedReview,
  extractClipCandidatesPipeline,
  flattenAiBrollToPromptRows,
  generateBeatsPromptsWithFallback,
  generateBrollForSoundbiteOpenAI,
  generateDirectorPackageOpenAI,
  generateGroundedReviewOpenAI,
  type BrollBeat,
  type PromptPackDefinition
} from '@storyteller/analysis'
import { defaultSubjectProfile, normalizeSubjectProfile } from '@storyteller/shared'
import type {
  AnalyzeGroundedReviewParams,
  AnalyzeGroundedReviewResult,
  BrollProgressWire,
  DirectorCreativePackageWire,
  GenerateBrollForSoundbiteParams,
  GenerateBrollForSoundbiteResult,
  GenerateBrollPromptsFromBeatsParams,
  GenerateBrollPromptsFromBeatsResult,
  GenerateBrollPromptsParams,
  GenerateBrollPromptsResult
} from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'

function openAiKey(env: GatewayEnv): string {
  if (!env.openaiApiKey) {
    throw new GatewayError(
      'OpenAI is not configured on the gateway.',
      'PROVIDER_UNAVAILABLE',
      503
    )
  }
  return env.openaiApiKey
}

function model(env: GatewayEnv): string {
  return process.env.OPENAI_MODEL || 'gpt-5.4-mini'
}

export async function hostedGenerateBrollPrompts(
  env: GatewayEnv,
  params: GenerateBrollPromptsParams,
  onProgress?: (p: BrollProgressWire) => void
): Promise<GenerateBrollPromptsResult> {
  const apiKey = openAiKey(env)
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
    model: model(env),
    candidates: extracted,
    subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
    promptPack: params.promptPack as PromptPackDefinition,
    aiDirection: params.aiDirection,
    mode: params.mode,
    shotDurationSeconds: params.shotDurationSeconds,
    onProgress: (p) => onProgress?.({ phase: p.phase, detail: p.detail })
  })
  if (!gen.ok) return { ok: false, error: gen.error }
  const pack = params.promptPack as PromptPackDefinition & { id: string; label: string }
  const rows = flattenAiBrollToPromptRows(params.projectId, gen.aiResults, pack.id, pack.label)
  const prompts = rows.map((row, i) => ({
    ...row,
    metadata_json: {
      ...(row.metadata_json && typeof row.metadata_json === 'object' ? row.metadata_json : {}),
      ...(i === 0 ? { directorCreativePackage: gen.creativePackage } : {})
    }
  }))
  return {
    ok: true,
    prompts,
    creativePackage: gen.creativePackage as DirectorCreativePackageWire | undefined
  }
}

export async function hostedGenerateBrollPromptsFromBeats(
  env: GatewayEnv,
  params: GenerateBrollPromptsFromBeatsParams,
  onProgress?: (p: BrollProgressWire) => void
): Promise<GenerateBrollPromptsFromBeatsResult> {
  const apiKey = openAiKey(env)
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
  return generateBeatsPromptsWithFallback({
    apiKey,
    model: model(env),
    projectId: params.projectId,
    beats,
    subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
    promptPack: params.promptPack as PromptPackDefinition,
    aiDirection: params.aiDirection,
    mode: params.mode,
    shotDurationSeconds: params.shotDurationSeconds,
    onProgress: (p: { phase: string; detail?: string; chunk?: number; chunkTotal?: number }) =>
      onProgress?.({ phase: p.phase, detail: p.detail, chunk: p.chunk, chunkTotal: p.chunkTotal })
  })
}

export async function hostedGenerateBrollForSoundbite(
  env: GatewayEnv,
  params: GenerateBrollForSoundbiteParams
): Promise<GenerateBrollForSoundbiteResult> {
  const apiKey = openAiKey(env)
  const result = await generateBrollForSoundbiteOpenAI({
    apiKey,
    model: model(env),
    soundbiteId: params.soundbiteId,
    transcriptText: params.transcriptText,
    subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
    promptPack: params.promptPack as PromptPackDefinition,
    directionText: params.aiDirection,
    mode: params.mode,
    shotDurationSeconds: params.shotDurationSeconds,
    previousIdeas: params.previousIdeas
  })
  if (!result.ok) return result
  return { ok: true, brollIdeas: result.brollIdeas }
}

export async function hostedAnalyzeGroundedReview(
  env: GatewayEnv,
  params: AnalyzeGroundedReviewParams
): Promise<AnalyzeGroundedReviewResult> {
  if (!params.candidates?.length) {
    return { ok: false, error: 'No grounded candidates were provided.' }
  }
  const reviewModelOverride = process.env.STORYTELLER_REVIEW_MODEL?.trim()
  const result = env.openaiApiKey
    ? await generateGroundedReviewOpenAI({
        apiKey: env.openaiApiKey,
        model: reviewModelOverride || model(env),
        candidates: params.candidates as never,
        segments: params.segments as never,
        subjectProfile: normalizeSubjectProfile(params.subjectProfile ?? defaultSubjectProfile()),
        promptPack: params.promptPack as PromptPackDefinition,
        directionText: params.directionText,
        mode: params.mode,
        targetCount: params.targetCount,
        shotDurationSeconds: params.shotDurationSeconds
      })
    : { ok: false as const, error: 'OpenAI is not configured on the gateway.' }

  if (result.ok) {
    return { ok: true, source: 'ai', review: result.review, candidates: result.candidates as never }
  }
  return {
    ok: true,
    source: 'fallback',
    reason: result.error,
    review: buildFallbackGroundedReview({
      candidates: params.candidates as never,
      directionText: params.directionText,
      mode: params.mode,
      shotDurationSeconds: params.shotDurationSeconds
    })
  }
}
