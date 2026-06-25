export type SoundDesignSlotCategory =
  | 'ambient'      // Room tone, environmental background
  | 'movement'     // Footsteps, chair creaks, foley
  | 'impact'       // Cinematic booms, accents on key words
  | 'transition'   // Whooshes, swells between segments
  | 'silence'      // Intentional removal of audio

export type SoundDesignSlotStatus = 'empty' | 'suggested' | 'accepted' | 'rejected'

export interface SoundDesignSlot {
  id: string
  projectId: string
  category: SoundDesignSlotCategory
  /** Tags describing the sound character, e.g. ["office", "HVAC", "quiet"] */
  tags: string[]
  /** Transcript keywords that triggered this suggestion */
  transcriptKeywords?: string[]
  /** Linked transcript segment ids */
  linkedTranscriptSegmentIds?: string[]
  /** Timeline position */
  timelineStart: number
  timelineEnd: number
  /** 0–1, drives volume/density in export */
  intensity: number
  /** Word in transcript this impact is timed to (for 'impact' category) */
  timingAnchorWord?: string
  /** Resolved asset id once a sound is matched from the library */
  assetId?: string
  status: SoundDesignSlotStatus
  metadata?: Record<string, unknown>
}

export interface SoundMotivatedTimingNote {
  transcriptSegmentId: string
  /** The specific word the impact lands on */
  anchorWord: string
  noteType: 'hold-before' | 'cut-earlier' | 'cut-on-word' | 'silence-after'
  /** Positive = extend, negative = trim */
  framesAdjustment: number
  sfxCategory: SoundDesignSlotCategory
  rationale: string
}

export interface AudioImmersionScore {
  /** 0–100 */
  score: number
  missingAmbient: number
  harshCuts: number
  dryDialogue: boolean
  missingImpacts: number
  silenceOpportunities: number
}
