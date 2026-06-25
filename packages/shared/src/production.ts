export type ProductionMode = 'broll' | 'broll-with-graphics' | 'motion-graphics'

export type ProductionOfferRole = 'recommended' | 'alternate'

export type ProductionPackage = {
  id: string
  offerRole: ProductionOfferRole
  sourceSoundbiteId?: string
  mode: ProductionMode
  conceptSummary: string
  stillImagePrompt: string
  motionPrompt: string
  style?: 'literal' | 'emotional' | 'symbolic'
  why?: string
  /**
   * True when this package came from the deterministic keyword fallback rather than a
   * scene-specific AI prompt. The UI surfaces these as "starter" ideas and invites
   * regeneration with AI.
   */
  isStarterIdea?: boolean
}

export type ProductionRegenBudget = {
  conceptRegensUsed: number
  stillRegensUsed: number
  videoRegensUsed: number
  /** True when the one free courtesy regen has been used for this slot. */
  courtesyRegenUsed: boolean
}

export type ProductionPipelinePhase =
  | 'concept'
  | 'still-pending-approval'
  | 'still-approved'
  | 'video'
  | 'ready'

export type ProductionSlotMetadata = {
  activePackageId: string
  package: ProductionPackage
  approvedStillAssetId?: string
  pendingStillAssetId?: string
  /** User-selected Grok clip length (6–15s), persisted across reload. */
  videoDurationSeconds?: number
  regens: ProductionRegenBudget
  pipelinePhase: ProductionPipelinePhase
}

export const PRODUCTION_REGEN_LIMITS = {
  concept: 1,
  still: 2,
  video: 1
} as const

export function defaultProductionRegenBudget(): ProductionRegenBudget {
  return { conceptRegensUsed: 0, stillRegensUsed: 0, videoRegensUsed: 0, courtesyRegenUsed: false }
}
