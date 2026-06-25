import type { StoryMode } from '@storyteller/shared'
import type { SubjectProfile } from '@storyteller/shared'

/** Same shape as Whisper / UI transcript segments */
export type TranscriptSegmentWire = { start: number; end: number; text: string }

export type TranscribeResult =
  | { ok: true; segments: TranscriptSegmentWire[]; duration?: number; language?: string }
  | { ok: false; error: string }

/** Progress events for long / chunked transcription (local OpenAI path). */
export type TranscribeProgress = {
  phase: 'preparing' | 'chunking' | 'transcribing_chunk' | 'merging' | 'done'
  detail?: string
  chunkIndex?: number
  chunkTotal?: number
  chunksCompleted?: number
  estimatedSecondsRemaining?: number
}

export type TranscribeParams = {
  signedUrl?: string
  localPath?: string
  filename: string
  assetType?: string
  /** Local mode forwards to chunked Whisper; proxy may ignore until server streams progress. */
  onProgress?: (p: TranscribeProgress) => void
}

/**
 * Stable capability names desktop calls against the hosted gateway.
 * Provider/model routing stays server-side and opaque to the client.
 */
export type StorytellerAiCapability =
  | 'transcribe'
  | 'broll-prompts'
  | 'broll-prompts-from-beats'
  | 'broll-for-soundbite'
  | 'grounded-review'
  | 'media-generate'
  | 'media-job-status'
  | 'media-job-cancel'

export const STORYTELLER_AI_CAPABILITY_PATHS: Record<StorytellerAiCapability, string> = {
  transcribe: '/v1/capabilities/transcribe',
  'broll-prompts': '/v1/capabilities/broll-prompts',
  'broll-prompts-from-beats': '/v1/capabilities/broll-prompts-from-beats',
  'broll-for-soundbite': '/v1/capabilities/broll-for-soundbite',
  'grounded-review': '/v1/capabilities/grounded-review',
  'media-generate': '/v1/capabilities/media-generate',
  'media-job-status': '/v1/capabilities/media-jobs/:jobId',
  'media-job-cancel': '/v1/capabilities/media-jobs/:jobId/cancel'
}

/** Serializable prompt pack (matches analysis `PromptPackDefinition`) */
export type PromptPackWire = {
  id: string
  label: string
  tone: string
  cameraStyle: string
  lighting: string
  motionStyle: string
  environmentStyle: string
  detailLevel: string
}

export type BrollSegmentWire = {
  id: string
  start: number
  end: number
  text: string
}

export type GenerateBrollPromptsParams = {
  projectId: string
  segments: BrollSegmentWire[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackWire
  aiDirection: string
  mode: StoryMode
  /** Per-shot duration the writer should target (defaults to 8s). */
  shotDurationSeconds?: number
  /** Supabase session JWT for hosted gateway auth. */
  accessToken?: string
}

/** A single beat — usually a saved soundbite, an intro clip, or any timeline-anchored moment. */
export type BrollBeatWire = {
  id: string
  source_start: number
  source_end: number
  transcript_text: string
  score?: number | null
  origin?: 'intro' | 'saved-timeline' | 'soundbite'
}

export type GenerateBrollPromptsFromBeatsParams = {
  projectId: string
  beats: BrollBeatWire[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackWire
  aiDirection: string
  mode: StoryMode
  /** Per-shot duration the writer should target (defaults to 8s). */
  shotDurationSeconds?: number
  /** Supabase session JWT for hosted gateway auth. */
  accessToken?: string
}

export type GenerateBrollPromptsFromBeatsResult =
  | { ok: true; prompts: unknown[]; source: 'ai' | 'deterministic'; reason?: string }
  | { ok: false; error: string }

export type BrollIdeaWire = {
  style: 'literal' | 'emotional' | 'symbolic'
  prompt: string
  stillImagePrompt?: string
  motionPrompt?: string
  why?: string
}

export type GenerateBrollForSoundbiteParams = {
  projectId: string
  soundbiteId: string
  transcriptText: string
  subjectProfile: SubjectProfile
  promptPack: PromptPackWire
  aiDirection: string
  mode: StoryMode
  shotDurationSeconds?: number
  accessToken?: string
  /** Still-image summaries from prior generations — AI avoids repeating these visual approaches. */
  previousIdeas?: string[]
}

export type GenerateBrollForSoundbiteResult =
  | { ok: true; brollIdeas: BrollIdeaWire[] }
  | { ok: false; error: string }

export type GroundedReviewCandidateWire = {
  id: string
  text: string
  start: number
  end: number
  duration: number
  completenessScore: number
  sourceSegmentIds: string[]
  clipType: string
  heuristicComposite: number
  heuristicWithinTypeRank: number
  heuristicScores: {
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
    dataAuthority?: number
  }
}

export type GroundedReviewNarrativeRoleWire =
  | 'cold-open'
  | 'transformation'
  | 'teaser'
  | 'emotional-low'
  | 'gut-punch'
  | 'viral-hook'
  | 'quotable-shift'
  | 'tension-setup'
  | 'payoff'
  | 'mission-close'
  | 'context'

export type GroundedReviewItemWire = {
  candidateId: string
  narrativeRole?: GroundedReviewNarrativeRoleWire
  purpose?: string
  overallScore: number
  viralScore: number
  emotionalScore: number
  introScore: number
  graphScore: number
  labels: string[]
  rationale?: string
  whyBullets: string[]
  sectionReasons?: {
    viral?: string
    intro?: string
    graph?: string
  }
  graphicsPackage?: {
    graphImagePrompt?: string
    overlayTextImagePrompt?: string
    motionPromptFromImage?: string
    styleTags?: string[]
    style?: {
      referenceStyle?: string
      palette?: string[]
      typography?: string
      layout?: string
      tone?: string
      durationSeconds?: number
    }
  }
  brollIdeas: BrollIdeaWire[]
  graphIdea?: {
    chartType: 'bar' | 'line' | 'counter' | 'comparison' | 'text'
    title: string
    why?: string
    dataText?: string
    visualTreatment?: string
  }
}

export type AnalyzeGroundedReviewParams = {
  candidates: GroundedReviewCandidateWire[]
  segments?: Array<{
    id: string
    start: number
    end: number
    text: string
    speaker_label?: string | null
  }>
  subjectProfile: SubjectProfile
  promptPack: PromptPackWire
  directionText: string
  mode: StoryMode
  targetCount?: number
  shotDurationSeconds?: number
  /** Supabase session JWT for hosted gateway auth. */
  accessToken?: string
}

export type AnalyzeGroundedReviewResult =
  | {
      ok: true
      review: {
        rankedIds: string[]
        viralIds: string[]
        introIds: string[]
        graphIds: string[]
        trailerArc: string[]
        items: GroundedReviewItemWire[]
      }
      candidates?: GroundedReviewCandidateWire[]
      source: 'ai' | 'fallback'
      reason?: string
    }
  | { ok: false; error: string }

export type BrollProgressWire = {
  phase: string
  detail?: string
  chunk?: number
  chunkTotal?: number
}

/** Optional structured output from the single-call director stage (local OpenAI path). */
export type DirectorCreativePackageWire = {
  viralIntroScript?: string
  soundBites?: unknown[]
  microHooks?: string[]
  cliffhangers?: string[]
  visualIdeas?: string[]
  creativeDirection?: string
}

export type GenerateBrollPromptsResult =
  | { ok: true; prompts: unknown[]; creativePackage?: DirectorCreativePackageWire }
  | { ok: false; error: string }

/**
 * Unified entry for AI features from the Electron main process.
 * Local mode uses developer/provider keys in `.env`; proxy mode calls Storyteller infrastructure.
 */
export interface StorytellerAiGateway {
  transcribe(params: TranscribeParams): Promise<TranscribeResult>
  generateBrollPrompts(
    params: GenerateBrollPromptsParams,
    onProgress?: (p: BrollProgressWire) => void
  ): Promise<GenerateBrollPromptsResult>
  /**
   * Beat-anchored writer: ONE B-roll prompt per beat. Style (literal | emotional |
   * symbolic) is chosen to match the spoken line, imagery is drawn from the
   * line itself. Always succeeds — falls back to a deterministic writer if AI
   * is not configured or errors out.
   */
  generateBrollPromptsFromBeats(
    params: GenerateBrollPromptsFromBeatsParams,
    onProgress?: (p: BrollProgressWire) => void
  ): Promise<GenerateBrollPromptsFromBeatsResult>
  /** On-demand B-roll for a single soundbite with empty brollIdeas. */
  generateBrollForSoundbite(params: GenerateBrollForSoundbiteParams): Promise<GenerateBrollForSoundbiteResult>
  analyzeGroundedReview(params: AnalyzeGroundedReviewParams): Promise<AnalyzeGroundedReviewResult>
}
