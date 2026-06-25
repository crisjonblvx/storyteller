/**
 * User-facing metering units for Storyteller AI.
 *
 * Credits are an internal ledger; customers see passes, batches, and AI videos.
 * Stripe product mapping lands later — these types are the product contract.
 */

/** Long-form analyze: transcribe + grounded review, up to 90 minutes. */
export type EpisodePass = {
  unit: 'episode_pass'
  /** Included duration ceiling per pass (seconds). */
  maxDurationSec: number
}

/** Short-form batch: up to 10 clips, 5 minutes each, analyze + soundbite pass. */
export type ClipBatch = {
  unit: 'clip_batch'
  maxClips: number
  maxClipDurationSec: number
}

/** Optional AI-generated B-roll / concept / motion clip (~8s). */
export type AiVideo = {
  unit: 'ai_video'
  typicalDurationSec: number
}

export type MeteringUnit = EpisodePass | ClipBatch | AiVideo

export type MeteringUnitId = MeteringUnit['unit']

/** Monthly included units per plan (user-facing allowances). */
export type PlanMonthlyAllowances = {
  episodePasses: number
  clipBatches: number
  aiVideos: number
}

/** Intents the gateway will eventually reserve against allowances or credits. */
export type StorytellerMeteringIntent = MeteringUnitId

export const EPISODE_PASS: EpisodePass = {
  unit: 'episode_pass',
  maxDurationSec: 90 * 60
}

export const CLIP_BATCH: ClipBatch = {
  unit: 'clip_batch',
  maxClips: 10,
  maxClipDurationSec: 5 * 60
}

export const AI_VIDEO: AiVideo = {
  unit: 'ai_video',
  typicalDurationSec: 8
}

export const METERING_UNITS: Record<MeteringUnitId, MeteringUnit> = {
  episode_pass: EPISODE_PASS,
  clip_batch: CLIP_BATCH,
  ai_video: AI_VIDEO
}

/** Internal credit mapping per metering unit (approximate COGS alignment). */
export const METERING_CREDIT_COSTS: Record<StorytellerMeteringIntent, number> = {
  episode_pass: 170,
  clip_batch: 60,
  ai_video: 100
}

/** USD overage when monthly allowances are exhausted (informational until Stripe). */
export const OVERAGE_PRICING_USD = {
  episodePass: 4,
  clipBatch: 3,
  aiVideoPack5: 8
} as const
