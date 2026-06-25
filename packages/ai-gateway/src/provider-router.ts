import type { GenerateMediaRequest, ProviderName, StorytellerGenerationIntent } from './media-types.js'

function legacyVideoEnabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false
  return parseBool(process.env.ENABLE_LEGACY_VIDEO_PROVIDERS, false)
}

function defaultProviderForIntent(intent: StorytellerGenerationIntent): ProviderName {
  const legacy = legacyVideoEnabled()
  const map: Record<StorytellerGenerationIntent, ProviderName> = {
    broll_text_to_video: legacy ? 'runway' : 'xai',
    image_to_video: 'xai',
    concept_frame: 'openai',
    storyboard_frame: 'openai',
    prompt_refine: 'openai',
    motion_graphic: legacy ? 'runway' : 'xai'
  }
  return map[intent]
}

const PROVIDER_SUPPORTS: Record<ProviderName, Set<StorytellerGenerationIntent>> = {
  runway: new Set(['broll_text_to_video', 'motion_graphic']),
  higgsfield: new Set(['image_to_video', 'broll_text_to_video']),
  openai: new Set(['concept_frame', 'storyboard_frame', 'prompt_refine', 'motion_graphic']),
  xai: new Set(['image_to_video', 'motion_graphic', 'broll_text_to_video']),
  gemini: new Set(['image_to_video', 'motion_graphic', 'broll_text_to_video', 'concept_frame', 'storyboard_frame']),
  ideogram: new Set(['concept_frame', 'storyboard_frame'])
}

export function providerSupportsIntent(
  provider: ProviderName,
  intent: StorytellerGenerationIntent
): boolean {
  return PROVIDER_SUPPORTS[provider].has(intent)
}

/**
 * Fallback chain for when the primary provider is unavailable.
 * xai → gemini, ideogram → openai, everything else stays put.
 */
export function selectVideoFallbackProvider(primary: ProviderName): ProviderName {
  if (primary === 'xai') return 'gemini'
  if (primary === 'ideogram') return 'openai'
  return primary
}

/**
 * Fallback chain for still-frame intents (concept_frame, storyboard_frame).
 * openai → gemini (Imagen 3) → ideogram.
 */
export function selectStillFallbackProvider(primary: ProviderName): ProviderName {
  if (primary === 'openai') return 'gemini'
  if (primary === 'gemini') return 'ideogram'
  return primary
}

/**
 * Keywords that indicate the still-frame prompt contains text-bearing props
 * (documents, signs, screens with text, etc.). Ideogram's text-aware rendering
 * produces cleaner results for these — fewer hallucinated words, better honoring
 * of "no legible text" instructions.
 */
const TEXT_PROP_KEYWORDS = [
  'document', 'paperwork', 'legal pad', 'notepad', 'invoice', 'bill ', 'bills ',
  'statement', 'receipt', 'contract', 'inventory sheet', 'price tag', 'label',
  'signage', 'newspaper', 'magazine', 'textbook', 'chalkboard', 'whiteboard',
  'corkboard', 'clipboard', 'brochure', 'poster', 'menu ', 'certificate',
  'diploma', 'report ', 'spreadsheet', 'checklist', 'budget sheet', 'legal document',
  'bank statement', 'ticker', 'marquee', 'phone screen', 'notifications'
]

function hasTextBearingProps(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  return TEXT_PROP_KEYWORDS.some((kw) => lower.includes(kw))
}

/**
 * Route a generation request to a provider. Respects `providerPreference` only when
 * that provider supports the intent; otherwise uses intent defaults.
 */
export function selectProvider(request: GenerateMediaRequest): ProviderName {
  const intent = request.intent
  const pref = request.providerPreference ?? 'auto'

  const legacyHint = request.metadata?.legacyProviderHint
  if (
    legacyVideoEnabled() &&
    typeof legacyHint === 'string' &&
    (legacyHint === 'runway' || legacyHint === 'higgsfield' || legacyHint === 'openai') &&
    providerSupportsIntent(legacyHint, intent)
  ) {
    return legacyHint
  }

  if (pref !== 'auto' && providerSupportsIntent(pref, intent)) {
    return pref
  }

  if (intent === 'motion_graphic' && request.quality === 'draft') {
    return 'openai'
  }

  return defaultProviderForIntent(intent)
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === '') return defaultValue
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}
