/**
 * Editorial clip pipeline types (smart stitching → classification → within-type ranking → selection).
 */

export type ClipCandidateType = 'HOOK' | 'PAYOFF' | 'EXPLAINER' | 'QUESTION' | 'CTA' | 'CULTURE' | 'DATA'

/** Stage 1 — smart-stitched contiguous clip */
export interface SmartStitchedClip {
  id: string
  text: string
  start: number
  end: number
  duration: number
  completenessScore: number
  sourceSegmentIds: string[]
}

/** Stage 2 — single dominant editorial type */
export interface ClassifiedClip extends SmartStitchedClip {
  clipType: ClipCandidateType
}

/** Stage 3 — scored within type (before cross-type merge for sound bites) */
export interface ScoredClip extends ClassifiedClip {
  scores: ClipEditorialScores
  /** Rank 1 = best within this clipType bucket */
  withinTypeRank: number
  compositeWithinType: number
}

export interface ClipEditorialScores {
  completeness: number
  standaloneImpact: number
  emotionalIntensity: number
  clarityOfMessage: number
  clipWorthiness: number
  scrollStopPotential: number
  narrativeTension: number
  quotability: number
  contrarianEdge: number
  consequence: number
  setupPenalty: number
  viralPriority: number
  /** Extra signal for DATA-type strength */
  dataAuthority?: number
}

export const PRIORITY_SOUND_BITE_TYPES: ClipCandidateType[] = ['PAYOFF', 'HOOK', 'CULTURE', 'DATA']

export const LOW_PRIORITY_SOUND_BITE_TYPES: ClipCandidateType[] = ['QUESTION', 'EXPLAINER', 'CTA']
