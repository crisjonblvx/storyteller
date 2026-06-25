import type { StorytellerGenerationIntent } from '@storyteller/ai-gateway'

/** Rough provider COGS per intent — aligned with docs/pricing.md. */
const INTENT_USD_COGS: Partial<Record<StorytellerGenerationIntent | string, number>> = {
  broll_text_to_video: 0.52,
  motion_graphic: 0.52,
  image_to_video: 0.58,
  concept_frame: 0.04,
  storyboard_frame: 0.04,
  prompt_refine: 0.02,
  episode_pass: 0.85,
  clip_batch: 0.5,
  ai_video: 0.52
}

const DEFAULT_USD_PER_CREDIT = 0.005

export function estimateUsdForJob(intent: string, creditsReserved: number): number {
  const fixed = INTENT_USD_COGS[intent]
  if (fixed != null) return fixed
  return Math.max(0, creditsReserved) * DEFAULT_USD_PER_CREDIT
}

export function sumEstimatedUsd(
  rows: Array<{ intent: string; credits: number }>
): number {
  return rows.reduce((sum, row) => sum + estimateUsdForJob(row.intent, row.credits), 0)
}
