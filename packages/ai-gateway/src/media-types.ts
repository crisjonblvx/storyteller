/**
 * Storyteller is local-first.
 * The gateway brokers generation but does not become the project media store.
 */

export type StorytellerGenerationIntent =
  | 'broll_text_to_video'
  | 'image_to_video'
  | 'concept_frame'
  | 'motion_graphic'
  | 'storyboard_frame'
  | 'prompt_refine'

export type StorytellerCreativeMode =
  | 'cinematic_documentary'
  | 'viral_social'
  | 'podcast_premium'
  | 'journalism'
  | 'motivational'
  | 'financial_explainer'

export type ProviderName = 'runway' | 'higgsfield' | 'openai' | 'xai' | 'gemini' | 'ideogram'

export type GenerationJobStatusValue =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface GenerateMediaRequest {
  projectId: string
  timelineId?: string
  slotId?: string
  intent: StorytellerGenerationIntent
  creativeMode: StorytellerCreativeMode
  prompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  durationSeconds?: number
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5'
  quality?: 'draft' | 'standard' | 'premium'
  providerPreference?: 'auto' | 'runway' | 'higgsfield' | 'openai' | 'ideogram'
  /** When true, skip credit deduction — one free courtesy regen per slot. */
  courtesyRegen?: boolean
  metadata?: Record<string, unknown>
}

export interface GenerateMediaResponse {
  jobId: string
  status: GenerationJobStatusValue
  provider: ProviderName
  estimatedCredits: number
  message?: string
}

export interface GenerationJobResult {
  url: string
  mimeType: string
  fileName: string
  expiresAt?: string
  width?: number
  height?: number
  durationSeconds?: number
}

export interface GenerationJobError {
  code: string
  message: string
  providerMessage?: string
}

export interface GenerationJobStatus {
  jobId: string
  status: GenerationJobStatusValue
  provider: ProviderName
  progress?: number
  result?: GenerationJobResult
  error?: GenerationJobError
}

export interface GenerationJobRecord extends GenerationJobStatus {
  userId: string
  projectId: string
  intent: StorytellerGenerationIntent
  providerJobId?: string
  creditsReserved: number
  createdAt: string
  updatedAt: string
}

/**
 * Capability layer — desktop-facing media generation surface.
 *
 * Desktop callers describe WHAT they want (a clip from text, a frame from a
 * prompt, a graphic from a beat). Provider/model selection stays entirely
 * server-side; capability requests intentionally do NOT carry a provider
 * preference and capability responses intentionally do NOT expose the
 * resolved provider name to the client.
 */
export type StorytellerMediaCapability =
  | 'video-clip-from-text'
  | 'video-clip-from-image'
  | 'concept-frame'
  | 'storyboard-frame'
  | 'motion-graphic'
  | 'refine-prompt'

export interface GenerateMediaCapabilityRequest {
  projectId: string
  timelineId?: string
  slotId?: string
  capability: StorytellerMediaCapability
  creativeMode: StorytellerCreativeMode
  prompt: string
  negativePrompt?: string
  referenceImageUrl?: string
  durationSeconds?: number
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5'
  quality?: 'draft' | 'standard' | 'premium'
  providerPreference?: 'auto' | 'runway' | 'higgsfield' | 'openai' | 'ideogram'
  /** When true, skip credit deduction — one free courtesy regen per slot. */
  courtesyRegen?: boolean
  /** Free-form audit metadata. Never used for provider routing. */
  metadata?: Record<string, unknown>
}

export interface GenerateMediaCapabilityResponse {
  jobId: string
  status: GenerationJobStatusValue
  estimatedCredits: number
  message?: string
}

export interface MediaCapabilityJobStatus {
  jobId: string
  status: GenerationJobStatusValue
  progress?: number
  result?: GenerationJobResult
  error?: GenerationJobError
}

const CAPABILITY_TO_INTENT: Record<StorytellerMediaCapability, StorytellerGenerationIntent> = {
  'video-clip-from-text': 'broll_text_to_video',
  'video-clip-from-image': 'image_to_video',
  'concept-frame': 'concept_frame',
  'storyboard-frame': 'storyboard_frame',
  'motion-graphic': 'motion_graphic',
  'refine-prompt': 'prompt_refine'
}

const INTENT_TO_CAPABILITY: Record<StorytellerGenerationIntent, StorytellerMediaCapability> = {
  broll_text_to_video: 'video-clip-from-text',
  image_to_video: 'video-clip-from-image',
  concept_frame: 'concept-frame',
  storyboard_frame: 'storyboard-frame',
  motion_graphic: 'motion-graphic',
  prompt_refine: 'refine-prompt'
}

export function capabilityToIntent(capability: StorytellerMediaCapability): StorytellerGenerationIntent {
  return CAPABILITY_TO_INTENT[capability]
}

export function intentToCapability(intent: StorytellerGenerationIntent): StorytellerMediaCapability {
  return INTENT_TO_CAPABILITY[intent]
}

/** Convert a capability request to the internal provider-aware request. */
export function buildInternalGenerateRequest(
  req: GenerateMediaCapabilityRequest
): GenerateMediaRequest {
  return {
    projectId: req.projectId,
    timelineId: req.timelineId,
    slotId: req.slotId,
    intent: capabilityToIntent(req.capability),
    creativeMode: req.creativeMode,
    prompt: req.prompt,
    negativePrompt: req.negativePrompt,
    referenceImageUrl: req.referenceImageUrl,
    durationSeconds: req.durationSeconds,
    aspectRatio: req.aspectRatio,
    quality: req.quality,
    courtesyRegen: req.courtesyRegen,
    providerPreference: req.providerPreference,
    metadata: req.metadata
  }
}

/** Strip provider/internal fields from a job status for capability callers. */
export function sanitizeJobStatusForCapability(status: GenerationJobStatus): MediaCapabilityJobStatus {
  return {
    jobId: status.jobId,
    status: status.status,
    progress: status.progress,
    result: status.result,
    error: status.error
  }
}
