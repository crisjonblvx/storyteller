import type { StorytellerGenerationIntent } from './media-types.js'
import {
  METERING_CREDIT_COSTS,
  type StorytellerMeteringIntent
} from './metering-types.js'

/** Analyze modes mapped to user-facing metering units. */
export type AnalyzeMode = 'episode' | 'clip_batch'

export type AnalyzeCostEstimate = {
  credits: number
  meteringIntent: Extract<StorytellerMeteringIntent, 'episode_pass' | 'clip_batch'>
  durationSec: number
  /** True when duration exceeds the included unit limit — caller may need multiple passes. */
  exceedsUnitLimit: boolean
}

export const CREDIT_COSTS: Record<StorytellerGenerationIntent, number> = {
  prompt_refine: 1,
  concept_frame: 2,
  storyboard_frame: 2,
  /** ~8s B-roll / concept / motion — COGS ~$0.40–0.64 */
  broll_text_to_video: 100,
  motion_graphic: 100,
  image_to_video: 120
}

export function estimateCredits(intent: StorytellerGenerationIntent): number {
  return CREDIT_COSTS[intent] ?? 5
}

/** Clamp Grok image-to-video duration to provider limits (6–15s). */
export function clampProductionVideoDuration(durationSeconds: number): number {
  const n = Math.round(durationSeconds)
  if (!Number.isFinite(n)) return 8
  if (n < 6) return 6
  if (n > 15) return 15
  return n
}

/** Tiered Grok I2V credits by clip length. */
export function estimateImageToVideoCredits(durationSeconds: number): number {
  const d = clampProductionVideoDuration(durationSeconds)
  if (d <= 8) return 100
  if (d <= 12) return 110
  return 120
}

export function estimateMediaCredits(
  intent: StorytellerGenerationIntent,
  opts?: { durationSeconds?: number }
): number {
  if (intent === 'image_to_video') {
    return estimateImageToVideoCredits(opts?.durationSeconds ?? 8)
  }
  return estimateCredits(intent)
}

/**
 * Estimate credits and metering intent for a new analyze (transcribe + grounded review).
 * Gateway reserve/commit is not wired yet — desktop should call this before starting Analyze.
 */
export function estimateAnalyzeCost(durationSec: number, mode: AnalyzeMode): AnalyzeCostEstimate {
  const safeDuration = Math.max(0, durationSec)
  if (mode === 'episode') {
    const maxDurationSec = 90 * 60
    return {
      credits: METERING_CREDIT_COSTS.episode_pass,
      meteringIntent: 'episode_pass',
      durationSec: safeDuration,
      exceedsUnitLimit: safeDuration > maxDurationSec
    }
  }
  const maxBatchDurationSec = 10 * 5 * 60
  return {
    credits: METERING_CREDIT_COSTS.clip_batch,
    meteringIntent: 'clip_batch',
    durationSec: safeDuration,
    exceedsUnitLimit: safeDuration > maxBatchDurationSec
  }
}

/** Map a media-generation intent to the AI Video metering unit credit cost. */
export function estimateAiVideoCredits(intent: StorytellerGenerationIntent): number {
  if (intent === 'broll_text_to_video' || intent === 'motion_graphic' || intent === 'image_to_video') {
    return METERING_CREDIT_COSTS.ai_video
  }
  return estimateCredits(intent)
}

/**
 * Stub for future gateway integration — returns the estimate without reserving.
 * Replace with credits.reserve(userId, estimate.credits, jobId) when analyze metering lands.
 */
export function stubAnalyzeMeteringEstimate(
  durationSec: number,
  mode: AnalyzeMode
): AnalyzeCostEstimate & { note: string } {
  const estimate = estimateAnalyzeCost(durationSec, mode)
  return {
    ...estimate,
    note: 'Analyze metering reserve not wired — estimate only.'
  }
}
