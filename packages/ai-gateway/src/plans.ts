import type { PlanMonthlyAllowances } from './metering-types.js'

/** Product plan tiers — billing integration can map Stripe products to these ids. */
export type StorytellerPlanId = 'starter' | 'intro_pro' | 'reel_creator' | 'studio' | 'student' | 'owner'

/** @deprecated Pre-pricing-model id — maps to `intro_pro` via {@link getPlanDefinition}. */
export type LegacyStorytellerPlanId = 'creator'

export type StorytellerPlanDefinition = {
  id: StorytellerPlanId
  label: string
  /** USD/month — informational until Stripe lands. */
  priceUsdMonthly: number
  /** User-facing monthly included units. */
  allowances: PlanMonthlyAllowances
  /**
   * Internal monthly credit pool (rough sum of allowance × unit credit cost).
   * Retained for existing ledger UI until allowance-based metering is fully wired.
   */
  monthlyCredits: number
  /** Short marketing blurb for upgrade UI. */
  tagline: string
}

const studentAllowances: PlanMonthlyAllowances = {
  episodePasses: 1,
  clipBatches: 1,
  aiVideos: 2
}

const starterAllowances: PlanMonthlyAllowances = {
  episodePasses: 2,
  clipBatches: 1,
  aiVideos: 3
}

const introProAllowances: PlanMonthlyAllowances = {
  episodePasses: 10,
  clipBatches: 2,
  aiVideos: 10
}

const reelCreatorAllowances: PlanMonthlyAllowances = {
  episodePasses: 4,
  clipBatches: 12,
  aiVideos: 20
}

const studioAllowances: PlanMonthlyAllowances = {
  episodePasses: 20,
  clipBatches: 30,
  aiVideos: 50
}

const ownerAllowances: PlanMonthlyAllowances = {
  episodePasses: 9999,
  clipBatches: 9999,
  aiVideos: 9999
}

/** Sum allowance × internal unit credits for legacy balance display. */
function monthlyCreditsFromAllowances(allowances: PlanMonthlyAllowances): number {
  return (
    allowances.episodePasses * 170 +
    allowances.clipBatches * 60 +
    allowances.aiVideos * 100
  )
}

export const STORYTELLER_PLANS: Record<StorytellerPlanId, StorytellerPlanDefinition> = {
  student: {
    id: 'student',
    label: 'Student',
    priceUsdMonthly: 9,
    allowances: studentAllowances,
    monthlyCredits: monthlyCreditsFromAllowances(studentAllowances),
    tagline: 'One project per month — perfect for learning and course assignments.'
  },
  starter: {
    id: 'starter',
    label: 'Starter',
    priceUsdMonthly: 19,
    allowances: starterAllowances,
    monthlyCredits: monthlyCreditsFromAllowances(starterAllowances),
    tagline: 'Try Storyteller AI — a couple of long-form analyzes and reel batches each month.'
  },
  intro_pro: {
    id: 'intro_pro',
    label: 'Intro Pro',
    priceUsdMonthly: 39,
    allowances: introProAllowances,
    monthlyCredits: monthlyCreditsFromAllowances(introProAllowances),
    tagline: 'For editors building intros and trailers every week.'
  },
  reel_creator: {
    id: 'reel_creator',
    label: 'Reel Creator',
    priceUsdMonthly: 59,
    allowances: reelCreatorAllowances,
    monthlyCredits: monthlyCreditsFromAllowances(reelCreatorAllowances),
    tagline: 'High-volume short-form — many clip batches for reels and social cuts.'
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    priceUsdMonthly: 99,
    allowances: studioAllowances,
    monthlyCredits: monthlyCreditsFromAllowances(studioAllowances),
    tagline: 'Teams and production shops with priority generation and deep catalogs.'
  },
  owner: {
    id: 'owner',
    label: 'Owner',
    priceUsdMonthly: 0,
    allowances: ownerAllowances,
    monthlyCredits: 999999,
    tagline: 'Unrestricted access for the app creator.'
  }
}

const LEGACY_PLAN_ALIASES: Record<string, StorytellerPlanId> = {
  creator: 'intro_pro'
}

export function getPlanDefinition(planId: string | null | undefined): StorytellerPlanDefinition {
  const normalized = LEGACY_PLAN_ALIASES[planId ?? ''] ?? planId
  const id = normalized as StorytellerPlanId
  return STORYTELLER_PLANS[id] ?? STORYTELLER_PLANS.starter
}
