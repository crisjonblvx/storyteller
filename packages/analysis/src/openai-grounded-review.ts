import type { StoryMode, SubjectProfile } from '@storyteller/shared'
import { clampBrollShotDurationSeconds } from '@storyteller/shared'
import type { PromptPackDefinition } from './prompt-packs.js'
import type { ExtractedClipCandidate } from './clip-candidate-extractor.js'
import { isMustKeepLateBookendText, isMustKeepPlanColdOpenText } from './clip-candidate-extractor.js'
import { inferBrollTone } from './ai-direction.js'
import { buildCinematicBrollPrompt, tryConcreteFallbackScene } from './broll-providers.js'
import { classifyClip } from './clip-classifier.js'
import { scoreClipEditorially } from './clip-pipeline.js'
import { extractSmartStitchedClips, scoreCompleteness } from './extractor.js'
import { packInstructionsCompact, subjectInstructions, subjectQualityBar } from './openai-broll.js'

export type GroundedReviewGraphChartType = 'bar' | 'line' | 'counter' | 'comparison' | 'text'

export interface GroundedReviewBrollIdea {
  style: 'literal' | 'emotional' | 'symbolic'
  /** Unified director paragraph — legacy alias; prefer stillImagePrompt + motionPrompt. */
  prompt: string
  /** Static opening frame: subject, environment, props, light — no camera move language. */
  stillImagePrompt?: string
  /** I2V motion from the approved still: camera move, action, duration suffix. */
  motionPrompt?: string
  why?: string
}

export interface GroundedReviewGraphIdea {
  chartType: GroundedReviewGraphChartType
  title: string
  why?: string
  /** TTAO-style "TEXT / DATA" line: the exact numbers/claims to render, grounded in the quote. */
  dataText?: string
  /** TTAO-style "VISUAL TREATMENT": how the chart/graphic should look and animate on screen. */
  visualTreatment?: string
}

/**
 * Narrative role within a trailer/intro arc, mirroring the TTAO production package
 * (cold open -> transformation reveal -> teaser -> emotional low -> gut-punch ->
 * viral hook -> quotable shift -> tension setup -> payoff -> mission close).
 */
export type GroundedReviewNarrativeRole =
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

export const NARRATIVE_ROLE_LABELS: Record<GroundedReviewNarrativeRole, string> = {
  'cold-open': 'Cold open',
  transformation: 'Transformation reveal',
  teaser: 'Teaser',
  'emotional-low': 'Emotional low point',
  'gut-punch': 'Gut-punch',
  'viral-hook': 'Viral hook',
  'quotable-shift': 'Quotable shift',
  'tension-setup': 'Tension setup',
  payoff: 'Payoff',
  'mission-close': 'Mission close',
  context: 'Context'
}

const VALID_NARRATIVE_ROLES = new Set<string>(Object.keys(NARRATIVE_ROLE_LABELS))
const RANKED_SOUND_BITE_MIN = 6
const RANKED_SOUND_BITE_MAX = 8
const VIRAL_LIST_MAX = 6
const INTRO_LIST_MAX = 6
const GRAPH_LIST_MAX = 6
/** Curated trailer/intro arc — not the full ranked pool. */
const TRAILER_ARC_MAX = 10
const TRAILER_ARC_MIN = 6
const MAX_REVIEW_SOUND_BITE_DURATION_SEC = 32
const MAX_REVIEW_GRAPH_DURATION_SEC = 40

export interface GroundedReviewGraphicsStyle {
  referenceStyle?: string
  palette?: string[]
  typography?: string
  layout?: string
  tone?: string
  durationSeconds?: number
}

export interface GroundedReviewGraphicsPackage {
  graphImagePrompt?: string
  overlayTextImagePrompt?: string
  motionPromptFromImage?: string
  styleTags?: string[]
  style?: GroundedReviewGraphicsStyle
}

export interface GroundedReviewSectionReasons {
  viral?: string
  intro?: string
  graph?: string
}

export interface GroundedReviewItem {
  candidateId: string
  overallScore: number
  viralScore: number
  emotionalScore: number
  introScore: number
  graphScore: number
  labels: string[]
  /** Narrative role within the trailer arc (e.g. cold-open, gut-punch, mission-close). */
  narrativeRole?: GroundedReviewNarrativeRole
  /** TTAO-style one-line PURPOSE: what this bite accomplishes in the edit. */
  purpose?: string
  rationale?: string
  whyBullets: string[]
  sectionReasons?: GroundedReviewSectionReasons
  graphicsPackage?: GroundedReviewGraphicsPackage
  brollIdeas: GroundedReviewBrollIdea[]
  graphIdea?: GroundedReviewGraphIdea
}

export interface GroundedReviewResult {
  rankedIds: string[]
  viralIds: string[]
  introIds: string[]
  graphIds: string[]
  /** Candidate ids ordered as a cold-open -> mission-close trailer arc. */
  trailerArc: string[]
  items: GroundedReviewItem[]
}

export interface GenerateGroundedReviewOpenAIParams {
  apiKey: string
  model?: string
  candidates: ExtractedClipCandidate[]
  segments?: Array<{ id: string; start: number; end: number; text: string; speaker_label?: string | null }>
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  directionText: string
  mode: StoryMode
  targetCount?: number
  shotDurationSeconds?: number
}

export type GenerateGroundedReviewModelResult =
  | { ok: true; review: GroundedReviewResult; candidates?: ExtractedClipCandidate[] }
  | { ok: false; error: string }

function reviewSystemPrompt(): string {
  return [
    'You are a senior documentary trailer editor and creative strategist who delivers production packages: best sound bites ordered by narrative arc, graph/visual callouts, and cinematic B-roll prompts.',
    'Your job is not to write new content. Your job is to choose from a fixed list of real transcript-backed candidate clips and attach grounded planning metadata (including narrative role, one-line purpose, and a trailer arc ordering).',
    'Never invent a candidate id, quote, fact, statistic, or story beat.',
    'Only output valid JSON.'
  ].join(' ')
}

function clampScore(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

function cleanStringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    if (out.includes(trimmed.toLowerCase())) continue
    out.push(trimmed)
    if (out.length >= max) break
  }
  return out
}

function normalizeSectionReasons(value: unknown): GroundedReviewSectionReasons | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const viral = typeof row.viral === 'string' ? row.viral.trim() : ''
  const intro = typeof row.intro === 'string' ? row.intro.trim() : ''
  const graph = typeof row.graph === 'string' ? row.graph.trim() : ''
  if (!viral && !intro && !graph) return undefined
  return {
    ...(viral ? { viral } : {}),
    ...(intro ? { intro } : {}),
    ...(graph ? { graph } : {})
  }
}

function normalizeBrollIdeas(value: unknown): GroundedReviewBrollIdea[] {
  if (!Array.isArray(value)) return []
  const out: GroundedReviewBrollIdea[] = []
  const seenStyles = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const style =
      r.style === 'emotional' || r.style === 'symbolic' ? r.style : ('literal' as const)
    if (seenStyles.has(style)) continue
    const stillImagePrompt =
      typeof r.stillImagePrompt === 'string' ? r.stillImagePrompt.trim() : ''
    const motionPrompt = typeof r.motionPrompt === 'string' ? r.motionPrompt.trim() : ''
    const promptRaw = typeof r.prompt === 'string' ? r.prompt.trim() : ''
    const prompt =
      promptRaw ||
      (stillImagePrompt && motionPrompt ? `${stillImagePrompt} ${motionPrompt}`.trim() : stillImagePrompt || motionPrompt)
    if (!prompt) continue
    const why = typeof r.why === 'string' ? r.why.trim() : undefined
    out.push({
      style,
      prompt,
      ...(stillImagePrompt ? { stillImagePrompt } : {}),
      ...(motionPrompt ? { motionPrompt } : {}),
      why
    })
    seenStyles.add(style)
    if (out.length >= 3) break
  }
  return out
}

function fallbackBrollIdeasForCandidate(
  candidate: ExtractedClipCandidate,
  mode: StoryMode,
  directionText: string,
  shotDurationSeconds: number
): GroundedReviewBrollIdea[] {
  const concrete = tryConcreteFallbackScene(candidate.text, shotDurationSeconds)
  if (concrete) {
    return [
      {
        style: concrete.style,
        prompt: `${concrete.stillImagePrompt} ${concrete.motionPrompt}`,
        stillImagePrompt: concrete.stillImagePrompt,
        motionPrompt: concrete.motionPrompt,
        why: concrete.why
      }
    ]
  }

  const tone = inferBrollTone(candidate.text, directionText)
  const bundle = buildCinematicBrollPrompt({
    ideaSummary: candidate.text,
    mode,
    directionText,
    toneHint: tone,
    shotDurationSeconds
  })
  const literalIdea: GroundedReviewBrollIdea = bundle.literalStill && bundle.literalMotion
    ? {
        style: 'literal',
        prompt: bundle.literal,
        stillImagePrompt: bundle.literalStill,
        motionPrompt: bundle.literalMotion,
        why: 'Literal coverage rooted in the spoken idea.'
      }
    : {
        style: 'literal',
        prompt: bundle.literal,
        why: 'Literal coverage rooted in the spoken idea.'
      }
  return [
    literalIdea,
    {
      style: 'emotional',
      prompt: bundle.emotional,
      why: 'Human reaction version of the same beat.'
    },
    {
      style: 'symbolic',
      prompt: bundle.symbolic,
      why: 'Abstract metaphor that still supports the exact line.'
    }
  ]
}

function backfillEmptyBrollIdeas(
  items: GroundedReviewItem[],
  byId: Map<string, ExtractedClipCandidate>,
  mode: StoryMode,
  directionText: string,
  shotDurationSeconds: number
): void {
  for (const item of items) {
    if (item.brollIdeas.length > 0) continue
    const candidate = byId.get(item.candidateId)
    if (!candidate) continue
    item.brollIdeas = fallbackBrollIdeasForCandidate(candidate, mode, directionText, shotDurationSeconds)
  }
}

function normalizeGraphIdea(value: unknown): GroundedReviewGraphIdea | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const chartType =
    row.chartType === 'bar' ||
    row.chartType === 'line' ||
    row.chartType === 'counter' ||
    row.chartType === 'comparison'
      ? row.chartType
      : ('text' as const)
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  if (!title) return undefined
  const why = typeof row.why === 'string' ? row.why.trim() : undefined
  const dataText = typeof row.dataText === 'string' ? row.dataText.trim() : undefined
  const visualTreatment = typeof row.visualTreatment === 'string' ? row.visualTreatment.trim() : undefined
  return {
    chartType,
    title,
    ...(why ? { why } : {}),
    ...(dataText ? { dataText } : {}),
    ...(visualTreatment ? { visualTreatment } : {})
  }
}

function normalizeNarrativeRole(value: unknown): GroundedReviewNarrativeRole | undefined {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  return VALID_NARRATIVE_ROLES.has(key) ? (key as GroundedReviewNarrativeRole) : undefined
}

function normalizeGraphicsPackage(value: unknown): GroundedReviewGraphicsPackage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const graphImagePrompt = typeof row.graphImagePrompt === 'string' ? row.graphImagePrompt.trim() : ''
  const overlayTextImagePrompt = typeof row.overlayTextImagePrompt === 'string' ? row.overlayTextImagePrompt.trim() : ''
  const motionPromptFromImage = typeof row.motionPromptFromImage === 'string' ? row.motionPromptFromImage.trim() : ''
  const styleTags = cleanStringArray(row.styleTags, 8)
  const style = normalizeGraphicsStyle(row.style)
  if (!graphImagePrompt && !overlayTextImagePrompt && !motionPromptFromImage && styleTags.length === 0 && !style) {
    return undefined
  }
  return {
    ...(graphImagePrompt ? { graphImagePrompt } : {}),
    ...(overlayTextImagePrompt ? { overlayTextImagePrompt } : {}),
    ...(motionPromptFromImage ? { motionPromptFromImage } : {}),
    ...(styleTags.length > 0 ? { styleTags } : {}),
    ...(style ? { style } : {})
  }
}

function normalizeGraphicsStyle(value: unknown): GroundedReviewGraphicsStyle | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const referenceStyle = typeof row.referenceStyle === 'string' ? row.referenceStyle.trim() : ''
  const typography = typeof row.typography === 'string' ? row.typography.trim() : ''
  const layout = typeof row.layout === 'string' ? row.layout.trim() : ''
  const tone = typeof row.tone === 'string' ? row.tone.trim() : ''
  const palette = cleanStringArray(row.palette, 6)
  const durationSeconds =
    typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds)
      ? Math.min(20, Math.max(3, row.durationSeconds))
      : undefined
  if (!referenceStyle && !typography && !layout && !tone && palette.length === 0 && durationSeconds == null) {
    return undefined
  }
  return {
    ...(referenceStyle ? { referenceStyle } : {}),
    ...(palette.length > 0 ? { palette } : {}),
    ...(typography ? { typography } : {}),
    ...(layout ? { layout } : {}),
    ...(tone ? { tone } : {}),
    ...(durationSeconds != null ? { durationSeconds } : {})
  }
}

function pickIds(value: unknown, validIds: Set<string>, max: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !validIds.has(item) || out.includes(item)) continue
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

function overlapRatio(a: ExtractedClipCandidate, b: ExtractedClipCandidate): number {
  const overlapStart = Math.max(a.start, b.start)
  const overlapEnd = Math.min(a.end, b.end)
  const overlap = Math.max(0, overlapEnd - overlapStart)
  if (overlap <= 0) return 0
  return overlap / Math.min(a.duration || 0.01, b.duration || 0.01)
}

function normalizedClipText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const IDEA_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had',
  'has', 'have', 'here', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'let', 'like',
  'me', 'my', 'now', 'of', 'on', 'or', 'our', 'say', 'so', 'that', 'the', 'their', 'this',
  'to', 'was', 'we', 'were', 'what', 'with', 'you', 'your'
])

function normalizeIdeaToken(token: string): string {
  if (!token || token === 'num') return token
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function normalizedIdeaText(text: string): string {
  return normalizedClipText(text)
    .replace(/\b(?:like i said earlier|from the very beginning of the show|get straight to it)\b/g, ' ')
    .replace(/\b(?:here s the thing|let me say this|you see|i wanna|i want to|watch this|all right|alright|family)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' num ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantIdeaTokens(text: string): string[] {
  return normalizedIdeaText(text)
    .split(' ')
    .map((token) => normalizeIdeaToken(token))
    .filter((token) => token.length >= 3 && !IDEA_STOPWORDS.has(token))
}

function tokenOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const bSet = new Set(b)
  let shared = 0
  for (const token of new Set(a)) {
    if (bSet.has(token)) shared += 1
  }
  return shared / Math.min(new Set(a).size, new Set(b).size)
}

function ideaFingerprint(text: string): string {
  return significantIdeaTokens(text)
    .filter((token) => token !== 'num')
    .slice(0, 5)
    .join(' ')
}

function commonPrefixTokenCount(a: string, b: string): number {
  const aTokens = a.split(' ').filter(Boolean)
  const bTokens = b.split(' ').filter(Boolean)
  const length = Math.min(aTokens.length, bTokens.length)
  let count = 0
  for (let i = 0; i < length; i += 1) {
    if (aTokens[i] !== bTokens[i]) break
    count += 1
  }
  return count
}

function isTitleLikePromotionalLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (
    /\b(stop living paycheck to paycheck|the proven path to|break free from consumer debt|build real wealth|live free on any income)\b/i.test(
      trimmed
    )
  ) {
    return true
  }
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < 8) return false
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z'-]+$/.test(word.replace(/[^A-Za-z'-]/g, ''))).length
  return /[,:-]/.test(trimmed) && titleCaseWords / words.length >= 0.7
}

function isLikelyPromotionalCta(candidate: ExtractedClipCandidate): boolean {
  const text = candidate.text.trim().toLowerCase()
  return (
    candidate.clipType === 'CTA' ||
    isTitleLikePromotionalLine(candidate.text) ||
    /\b(show description|link is inside|forward slash|get the book|this book|inside the book|anthonyoneal|anthony o'?neill|buy the book|download|subscribe|share it|consultation|go to|free bonuses?|bonus(?:es)?|first chapter|money challenge|exclusive masterclass|masterclass|early access|pre[\s-]?order(?:ing)?|order from amazon|barnes and noble|book launch team|two-minute quiz|personalized plan)\b/i.test(
      text
    ) ||
    /\b(in the black|coach in your pocket|number one coach|i built one|my brand|specifically i built|utilizing ai to help you|utilizing the tools|tools that is that we have|help you get out of debt within)\b/i.test(
      text
    ) ||
    (/\b(ai app|ai tool|ai coach)\b/i.test(text) && /\b(debt|wealth|download|sign up|get out of)\b/i.test(text))
  )
}

function isPrayerLikeOrDevotionalLine(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return /\b(god|lord jesus|pray|prayer|good steward|hopefully you see my heart|give me something creative)\b/i.test(
    lower
  )
}

function isNearDuplicate(a: ExtractedClipCandidate, b: ExtractedClipCandidate): boolean {
  if (overlapRatio(a, b) >= 0.5) return true
  const aText = normalizedClipText(a.text)
  const bText = normalizedClipText(b.text)
  if (!aText || !bText) return false
  const sharedPrefixLength = Math.min(aText.length, bText.length, 42)
  if (sharedPrefixLength >= 24 && aText.slice(0, sharedPrefixLength) === bText.slice(0, sharedPrefixLength)) {
    return Math.abs(a.start - b.start) <= 8
  }
  const aIdea = normalizedIdeaText(stripRestatementCue(a.text))
  const bIdea = normalizedIdeaText(stripRestatementCue(b.text))
  if (aIdea && bIdea) {
    if (commonPrefixTokenCount(aIdea, bIdea) >= 4 && Math.abs(a.start - b.start) <= 35) return true
    if ((aIdea.includes(bIdea) && bIdea.length >= 24) || (bIdea.includes(aIdea) && aIdea.length >= 24)) return true
    const overlap = tokenOverlapRatio(
      significantIdeaTokens(stripRestatementCue(a.text)),
      significantIdeaTokens(stripRestatementCue(b.text))
    )
    if (overlap >= 0.8) return true
    const aFingerprint = ideaFingerprint(stripRestatementCue(a.text))
    const bFingerprint = ideaFingerprint(stripRestatementCue(b.text))
    if (aFingerprint && bFingerprint && aFingerprint === bFingerprint && overlap >= 0.6) return true
    // Back-to-back restatements (one line literally re-says the previous within ~20s).
    const adjacent = Math.abs(a.start - b.start) <= 20
    const isRestatement = RESTATEMENT_CUE.test(a.text) || RESTATEMENT_CUE.test(b.text)
    if (adjacent && overlap >= 0.5) return true
    if (isRestatement && overlap >= 0.4 && Math.abs(a.start - b.start) <= 60) return true
  }
  return false
}

/**
 * Audience-survey / option-poll questions and self-correcting filler lines. These read
 * fine in the room but make weak standalone bites, so we demote them when stronger
 * editorial moments exist. (e.g. "Are you under 50K, over 50K, or over 100K?",
 * "...I would say around, oh yeah, around the clock care, right?")
 */
function isWeakConversationalLine(text: string): boolean {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  // Option-list survey question aimed at the audience.
  if (/\b(are|do)\s+you\b/.test(lower) && /\b(under|over|above|below|less than|more than)\b[^?]*\bor\b/.test(lower)) {
    return true
  }
  if (/\b(under|over)\s*\$?\d+\s*k?\b[^?]*\b(over|under)\s*\$?\d+\s*k?\b/.test(lower)) return true
  // Audience-retention prompts are useful in the room but weak as standalone trailer bites.
  if (/\b(if you're watching this|stay with me|stick with me|hear me out|watch this all the way|don't go anywhere)\b/.test(lower)) {
    return true
  }
  // Leading filler / discourse markers signal a mid-stream, non-standalone cut.
  if (/^(oh yeah|yeah|yep|okay|ok|alright|so yeah|and yeah|um|uh|well,|i mean|i would say)\b/.test(lower)) return true
  if (/^(rewind|again|like i said|as i said|in other words|let me say (?:it|that) again|let me say one more time|so again|repeat)\b/.test(lower)) {
    return true
  }
  if (/\bcool\.?\s+great man\b/.test(lower)) return true
  // Self-correction / verbal-tic filler clusters.
  const fillerHits = (lower.match(/\b(i would say|i mean|you know|kind of|sort of|like i said|oh yeah|uh|um)\b/g) ?? []).length
  if (fillerHits >= 2) return true
  // Immediate word/phrase echo inside the same line ("around the clock ... around the clock").
  if (/\b(\w+(?:\s+\w+){0,2})\b[\s,]+\1\b/.test(lower)) return true
  // Hedged, trailing-tag fragments that never resolve into a claim.
  if (/,\s*(right|okay|ok|you know|you feel me)\?\s*$/.test(lower) && fillerHits >= 1) return true
  // Trailing filler tag on a short line ("...wasn't income, okay?").
  if (/,\s*(okay|ok|right)\?\s*$/.test(lower) && trimmed.split(/\s+/).length <= 11) return true
  return false
}

function isOverlongReviewCandidate(candidate: ExtractedClipCandidate, context: 'soundbite' | 'graph' = 'soundbite'): boolean {
  const maxDuration = context === 'graph' ? MAX_REVIEW_GRAPH_DURATION_SEC : MAX_REVIEW_SOUND_BITE_DURATION_SEC
  return candidate.duration > maxDuration
}

function hasVividPersonalScene(text: string): boolean {
  return /\b(i remember|they told me|to my name|called my bank|calling my bank|walked in there|i was in my|i had|lights|bank|wallet|broke|scared)\b/i.test(
    text
  )
}

const RESTATEMENT_CUE = /^\s*(rewind|again|like i said|as i said|in other words|let me say (?:it|that) again|so again|repeat)\b[\s,:-]*/i

function stripRestatementCue(text: string): string {
  return text.replace(RESTATEMENT_CUE, '').trim()
}

function isSafeExplainerCandidate(candidate: ExtractedClipCandidate): boolean {
  const scores = candidate.heuristicScores
  if (candidate.clipType === 'HOOK' || candidate.clipType === 'DATA' || candidate.clipType === 'QUESTION') return false
  return (
    (scores.viralPriority ?? 0) < 0.58 &&
    (scores.scrollStopPotential ?? 0) < 0.58 &&
    (scores.emotionalIntensity ?? 0) < 0.26 &&
    (scores.consequence ?? 0) < 0.22 &&
    (scores.standaloneImpact ?? 0) < 0.62 &&
    (scores.clarityOfMessage ?? 0) >= 0.5
  )
}

function isStrongGraphCandidate(candidate: ExtractedClipCandidate): boolean {
  const text = candidate.text
  const lower = text.toLowerCase()
  const hasNumber = /[$\d%]/.test(text)
  const hasDataLanguage =
    /\b(percent|percentage|million|billion|thousand|x|times|half|double|triple|increase|decrease|drop|gain|grew|grow|rises?|falls?|cost|costs|debt|income|salary|net worth|worth|interest|inflation|return|roi|from\b.+\bto\b|vs\b|versus\b|more than|less than|paycheck to paycheck)\b/i.test(
      lower
    )
  const hasVisualMathSignal =
    /\b(percent|percentage|inflation|interest|rate|growth|grew|increase|decrease|drop|rise|return|roi|over \d+ years?|for \d+ years?|monthly|annually|per month|per year|from\b.+\bto\b|vs\b|versus\b|more than|less than|compound)\b/i.test(
      lower
    )
  if (candidate.clipType === 'DATA') {
    return (hasNumber && hasVisualMathSignal) || (candidate.heuristicScores.dataAuthority ?? 0) >= 0.72
  }
  return hasNumber && hasVisualMathSignal && ((candidate.heuristicScores.dataAuthority ?? 0) >= 0.46 || hasDataLanguage)
}

function dedupeOverlappingIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  minKeep: number
): string[] {
  const kept: string[] = []
  for (const id of ids) {
    const candidate = byId.get(id)
    if (!candidate) continue
    if (kept.some((existingId) => {
      const existing = byId.get(existingId)
      return existing ? isNearDuplicate(existing, candidate) : false
    })) {
      continue
    }
    kept.push(id)
  }
  if (kept.length >= minKeep) return kept
  for (const id of ids) {
    if (!kept.includes(id)) kept.push(id)
    if (kept.length >= minKeep) break
  }
  return kept
}

function sanitizeRankedIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  options?: { allowPromotional?: boolean; minKeep?: number; suppressSafeExplainer?: boolean }
): string[] {
  const filtered = ids.filter((id) => {
    const candidate = byId.get(id)
    if (!candidate) return false
    if (options?.allowPromotional) return true
    if (isPrayerLikeOrDevotionalLine(candidate.text) && sourceFractionForCandidate(candidate, byId) > 0.55) return false
    if (isOverlongReviewCandidate(candidate, 'soundbite')) return false
    if (options?.suppressSafeExplainer && isSafeExplainerCandidate(candidate)) return false
    if (options?.suppressSafeExplainer && isWeakConversationalLine(candidate.text)) return false
    return !isLikelyPromotionalCta(candidate)
  })
  const deduped = dedupeOverlappingIds(filtered, byId, options?.minKeep ?? 0)
  return deduped
}

function cleanGraphTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim().replace(/[—-]\s*$/, '')
  if (clean.length <= 72) return clean
  const shortened = clean.slice(0, 72)
  const boundary = shortened.lastIndexOf(' ')
  return `${(boundary > 36 ? shortened.slice(0, boundary) : shortened).trim()}...`
}

function fallbackGraphTitle(candidate: ExtractedClipCandidate): string {
  const text = candidate.text.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  if (/\$\s?\d+.*(month|monthly).*(year|years)|\b(month|monthly).*\$\s?\d+.*(year|years)/i.test(text)) {
    return 'Monthly Investment Growth Over Time'
  }
  if (/\b(inflation|rising costs?|cost of living|shrinking)\b/i.test(lower)) {
    return 'Inflation Impact on Buying Power'
  }
  if (/\b(percent|percentage|rate)\b/i.test(lower) && /\b(increase|decrease|drop|growth|return)\b/i.test(lower)) {
    return 'Rate and Growth Trend Snapshot'
  }
  const firstSentence = text.split(/[.!?]/).map((part) => part.trim()).find(Boolean) ?? text
  return cleanGraphTitle(firstSentence)
}

function sanitizeGraphIds(ids: string[], byId: Map<string, ExtractedClipCandidate>): string[] {
  const filtered = ids.filter((id) => {
    const candidate = byId.get(id)
    return candidate ? isStrongGraphCandidate(candidate) && !isOverlongReviewCandidate(candidate, 'graph') : false
  })
  const deduped = dedupeOverlappingIds(filtered, byId, 0)
  return deduped
}

function removeRepeatedIdeasAgainst(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  existingIds: string[]
): string[] {
  const kept: string[] = []
  for (const id of ids) {
    const candidate = byId.get(id)
    if (!candidate) continue
    if (kept.includes(id)) continue
    const clashes = [...existingIds, ...kept].some((existingId) => {
      if (existingId === id) return false
      const existing = byId.get(existingId)
      return existing ? isNearDuplicate(existing, candidate) : false
    })
    if (clashes) continue
    kept.push(id)
  }
  return kept
}

function isConcretePersonalColdOpenCandidate(candidate: ExtractedClipCandidate): boolean {
  const text = stripRestatementCue(candidate.text)
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  if (RESTATEMENT_CUE.test(candidate.text)) return false
  if (isPrayerLikeOrDevotionalLine(text)) return false
  const firstPerson = /\b(i|me|my)\b/i.test(lower)
  const vividScene = hasVividPersonalScene(lower)
  const concreteStake = /[$\d%]/.test(text) || /\b(under|over)\s+\$?\d/i.test(lower)
  return firstPerson && words.length >= 6 && words.length <= 28 && (vividScene || concreteStake)
}

function isPreferredColdOpenRoleCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (!isConcretePersonalColdOpenCandidate(candidate)) return false
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  const vividScene =
    hasVividPersonalScene(lower) ||
    /\b(power had been cut off|turned off your lights|light switch|nothing happened)\b/i.test(lower)
  if (vividScene) return sourceFraction <= 0.45
  return sourceFraction <= 0.22
}

function concreteColdOpenPriority(candidate: ExtractedClipCandidate): number {
  const text = stripRestatementCue(candidate.text)
  const lower = text.toLowerCase()
  const scores = candidate.heuristicScores
  let priority = candidate.heuristicComposite + (scores.scrollStopPotential ?? 0) + (scores.viralPriority ?? 0)
  if (/[$\d%]/.test(text)) priority += 0.25
  if (/\b(i remember|they told me|to my name|called my bank|walked in there)\b/i.test(lower)) priority += 0.24
  if (/\b(scared|free|broke|lights)\b/i.test(lower)) priority += 0.14
  return priority
}

function isStrongThesisColdOpenCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  const text = stripRestatementCue(candidate.text)
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean).length
  const scores = candidate.heuristicScores
  if (sourceFraction > 0.35) return false
  if (candidate.clipType === 'CTA' || candidate.clipType === 'QUESTION') return false
  if (isLikelyPromotionalCta(candidate) || isWeakConversationalLine(text) || isPrayerLikeOrDevotionalLine(text)) return false
  if (isOverlongReviewCandidate(candidate, 'soundbite')) return false
  if (words < 6 || words > 34) return false
  if (isEarlyThesisTeaserCandidate(candidate, sourceFraction)) return false
  const thesisPattern =
    /\b(only the people who are positioned|get to take advantage|wealth is about position|it starts with getting in position|question is whether you are in position|three[- ]level plan|get positioned|when the door opens|i'?m gonna give you|i am going to give you|here'?s (?:the|what)|this is going to be a)\b/i.test(
      lower
    )
  return (
    thesisPattern ||
    ((scores.viralPriority ?? 0) >= 0.6 &&
      ((scores.scrollStopPotential ?? 0) >= 0.55 || (scores.quotability ?? 0) >= 0.58 || (scores.consequence ?? 0) >= 0.22))
  )
}

function thesisColdOpenPriority(candidate: ExtractedClipCandidate, sourceFraction: number): number {
  const text = stripRestatementCue(candidate.text).toLowerCase()
  const scores = candidate.heuristicScores
  let priority =
    candidate.heuristicComposite +
    (scores.viralPriority ?? 0) +
    (scores.scrollStopPotential ?? 0) +
    (scores.quotability ?? 0) +
    (scores.consequence ?? 0)
  if (/\b(every generation gets one shot|ai revolution|wealth transfer)\b/i.test(text)) priority += 0.34
  if (/\b(only the people who are positioned|wealth is about position|starts with getting in position|three[- ]level plan|i'?m gonna give you)\b/i.test(text)) {
    priority += 0.28
  }
  priority -= sourceFraction * 0.65
  return priority
}

function isAcceptableColdOpenCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (isDisqualifiedColdOpenCandidate(candidate)) return false
  if (isOpeningFramingCandidate(candidate, sourceFraction)) return false
  if (isSecondaryThesisCandidate(candidate)) return false
  if (isEarlyThesisTeaserCandidate(candidate, sourceFraction)) return false
  return isPreferredColdOpenRoleCandidate(candidate, sourceFraction) || isStrongThesisColdOpenCandidate(candidate, sourceFraction)
}

/** Mid-show gut punches that must never bookend the arc as a cold open. */
function isDisqualifiedColdOpenCandidate(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return /\b(debt costs you opportunity|missed opportunity doesn'?t just cost|in an age of ai, a missed opportunity|does ?n'?t just cost you this year)\b/i.test(
    lower
  )
}

/** Early show-framing lines — not cold opens (e.g. "today we're having a wealth conversation"). */
function isOpeningFramingCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (sourceFraction > 0.22) return false
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return (
    /\b(this is going to be a|we'?re going to (?:talk|have) a|wealth conversation today|sick and tired of seeing|bust our butts|brothers and sisters)\b/i.test(
      lower
    )
  )
}

function isAcceptableIntroCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (isAcceptableColdOpenCandidate(candidate, sourceFraction)) return true
  if (sourceFraction > 0.45) return false
  if (isLikelyPromotionalCta(candidate) || isWeakConversationalLine(candidate.text) || isPrayerLikeOrDevotionalLine(candidate.text)) {
    return false
  }
  if (isOverlongReviewCandidate(candidate, 'soundbite')) return false
  const scores = candidate.heuristicScores
  return (scores.scrollStopPotential ?? 0) >= 0.62 && (scores.viralPriority ?? 0) >= 0.58
}

function isEliteTruthBombCandidate(candidate: ExtractedClipCandidate): boolean {
  const text = stripRestatementCue(candidate.text)
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean).length
  const scores = candidate.heuristicScores
  if (candidate.clipType === 'CTA' || candidate.clipType === 'QUESTION') return false
  if (isLikelyPromotionalCta(candidate) || isWeakConversationalLine(text)) return false
  if (words < 4 || words > 16) return false
  const structuralPunch =
    /\b(does ?n'?t|ca ?n'?t|is ?n'?t|not\b.+\bbut\b|reveals?|before it'?s|steals?|builds?|fixes?)\b/i.test(lower)
  return (scores.viralPriority ?? 0) >= 0.62 && ((scores.quotability ?? 0) >= 0.62 || (scores.contrarianEdge ?? 0) >= 0.24 || structuralPunch)
}

function eliteTruthBombPriority(candidate: ExtractedClipCandidate): number {
  const text = stripRestatementCue(candidate.text).toLowerCase()
  const scores = candidate.heuristicScores
  let priority =
    candidate.heuristicComposite +
    (scores.viralPriority ?? 0) +
    (scores.quotability ?? 0) +
    (scores.contrarianEdge ?? 0)
  if (/\b(does ?n'?t|ca ?n'?t|reveals?|before it'?s|not\b.+\bbut\b)\b/i.test(text)) priority += 0.18
  if (/\b(income|wealth|debt|behavior|character)\b/i.test(text)) priority += 0.08
  if (/\bdoes ?n'?t fix\b/i.test(text)) priority += 0.12
  if (/\bpiss poor\b/i.test(text)) priority += 0.18
  return priority
}

function isMustKeepQuoteCandidate(candidate: ExtractedClipCandidate): boolean {
  const text = stripRestatementCue(candidate.text).toLowerCase()
  return /\bincome\b[^.?!]{0,40}\bdoes ?n'?t fix\b[^.?!]{0,40}\bbehavior\b/i.test(text)
}

/** Late-trailer mission hooks (e.g. "you're late / positioned to participate") — always surface in viral + arc. */
function isStrongMissionCloseHookCandidate(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  if (isProceduralContextCandidate(candidate)) return false
  return (
    /\b(you'?re late|it'?s already here|wealth transfer is not coming|ai wealth transfer)\b/i.test(lower) ||
    (/\bpositioned to participate\b/i.test(lower) && /\bquestion is\b/i.test(lower)) ||
    (/\bnot coming\b/i.test(lower) && /\b(i'?m sorry|already here)\b/i.test(lower))
  )
}

function isMustKeepMissionCloseCandidate(candidate: ExtractedClipCandidate): boolean {
  return isStrongMissionCloseHookCandidate(candidate)
}

function ensureMustKeepMissionCloseIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  max: number
): string[] {
  let out = [...ids]
  const mustKeep = [...byId.values()]
    .filter((candidate) => isMustKeepMissionCloseCandidate(candidate))
    .sort((a, b) => {
      const aFrac = sourceFractionForCandidate(a, byId)
      const bFrac = sourceFractionForCandidate(b, byId)
      if (Math.abs(aFrac - bFrac) > 1e-6) return bFrac - aFrac
      return b.heuristicComposite - a.heuristicComposite
    })

  for (const candidate of mustKeep) {
    if (out.includes(candidate.id)) continue
    if (out.length >= max) {
      const replaceIndex = [...out]
        .map((id, index) => ({ id, index, candidate: byId.get(id) }))
        .reverse()
        .find(
          ({ candidate: existing }) =>
            existing &&
            !isMustKeepMissionCloseCandidate(existing) &&
            !isMustKeepQuoteCandidate(existing) &&
            !isAcceptableColdOpenCandidate(existing, sourceFractionForCandidate(existing, byId))
        )?.index
      if (replaceIndex == null) break
      out.splice(replaceIndex, 1)
    }
    out.push(candidate.id)
  }

  return out.slice(0, max)
}

function sourceFractionForCandidate(
  candidate: ExtractedClipCandidate,
  byId: Map<string, ExtractedClipCandidate>
): number {
  const all = [...byId.values()]
  const sourceMin = all.reduce((min, row) => Math.min(min, row.start), Number.POSITIVE_INFINITY)
  const sourceMax = all.reduce((max, row) => Math.max(max, row.end), 0)
  const sourceSpan = Math.max(1, sourceMax - sourceMin)
  return (candidate.start - sourceMin) / sourceSpan
}

/** Position within the curated arc pool — not the full transcript candidate span. */
function arcPoolSourceFraction(
  candidate: ExtractedClipCandidate,
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>
): number {
  let sourceMin = Number.POSITIVE_INFINITY
  let sourceMax = 0
  for (const id of pool) {
    const row = byId.get(id)
    if (!row) continue
    sourceMin = Math.min(sourceMin, row.start)
    sourceMax = Math.max(sourceMax, row.end)
  }
  if (!Number.isFinite(sourceMin)) {
    return sourceFractionForCandidate(candidate, byId)
  }
  return Math.max(0, (candidate.start - sourceMin) / Math.max(1, sourceMax - sourceMin))
}

function ensureConcreteColdOpenIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  max: number
): string[] {
  if (
    ids.some((id) => {
      const candidate = byId.get(id)
      return candidate ? isAcceptableColdOpenCandidate(candidate, sourceFractionForCandidate(candidate, byId)) : false
    })
  ) {
    return ids
  }
  const best = [...byId.values()]
    .filter(
      (candidate) =>
        isAcceptableColdOpenCandidate(candidate, sourceFractionForCandidate(candidate, byId)) &&
        !ids.includes(candidate.id)
    )
    .sort((a, b) => {
      const aSource = sourceFractionForCandidate(a, byId)
      const bSource = sourceFractionForCandidate(b, byId)
      const aPriority = isPreferredColdOpenRoleCandidate(a, aSource)
        ? concreteColdOpenPriority(a)
        : thesisColdOpenPriority(a, aSource)
      const bPriority = isPreferredColdOpenRoleCandidate(b, bSource)
        ? concreteColdOpenPriority(b)
        : thesisColdOpenPriority(b, bSource)
      return bPriority - aPriority
    })[0]
  if (!best) return ids
  return [best.id, ...ids].slice(0, max)
}

function ensureMustKeepQuoteIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  max: number
): string[] {
  let out = [...ids]
  const mustKeep = [...byId.values()]
    .filter((candidate) => isMustKeepQuoteCandidate(candidate))
    .sort((a, b) => eliteTruthBombPriority(b) - eliteTruthBombPriority(a))

  for (const candidate of mustKeep) {
    if (out.includes(candidate.id)) continue
    if (out.length >= max) {
      const replaceIndex = [...out]
        .map((id, index) => ({ id, index, candidate: byId.get(id) }))
        .reverse()
        .find(
          ({ candidate: existing }) =>
            existing &&
            !isAcceptableColdOpenCandidate(existing, sourceFractionForCandidate(existing, byId)) &&
            !isMustKeepQuoteCandidate(existing)
        )?.index
      if (replaceIndex == null) break
      out.splice(replaceIndex, 1)
    }
    out.push(candidate.id)
  }

  return out.slice(0, max)
}

function ensureEliteTruthBombIds(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  max: number,
  minKeep = 4
): string[] {
  let out = [...ids]
  let kept = out.filter((id) => {
    const candidate = byId.get(id)
    return candidate ? isEliteTruthBombCandidate(candidate) : false
  }).length
  if (kept >= minKeep) return out

  const candidates = [...byId.values()]
    .filter((candidate) => isEliteTruthBombCandidate(candidate) && !out.includes(candidate.id))
    .sort((a, b) => eliteTruthBombPriority(b) - eliteTruthBombPriority(a))

  for (const candidate of candidates) {
    if (kept >= minKeep) break
    if (out.length >= max) {
      const replaceIndex = [...out]
        .map((id, index) => ({ id, index, candidate: byId.get(id) }))
        .reverse()
        .find(
          ({ candidate: existing }) =>
            existing &&
            !isAcceptableColdOpenCandidate(existing, sourceFractionForCandidate(existing, byId)) &&
            !isEliteTruthBombCandidate(existing)
        )?.index
      if (replaceIndex == null) break
      out.splice(replaceIndex, 1)
    }
    out.push(candidate.id)
    kept += 1
  }

  return out.slice(0, max)
}

function fallbackRankedCandidatePriority(candidate: ExtractedClipCandidate): number {
  const scores = candidate.heuristicScores
  let priority =
    candidate.heuristicComposite +
    (scores.viralPriority ?? 0) +
    (scores.quotability ?? 0) +
    (scores.scrollStopPotential ?? 0) +
    (scores.consequence ?? 0)
  if (candidate.clipType === 'HOOK' || candidate.clipType === 'PAYOFF') priority += 0.16
  if (candidate.clipType === 'DATA' && (scores.dataAuthority ?? 0) >= 0.58) priority += 0.08
  return priority
}

function isFallbackRankedCandidate(candidate: ExtractedClipCandidate): boolean {
  const scores = candidate.heuristicScores
  if (candidate.clipType === 'CTA') return false
  if (isLikelyPromotionalCta(candidate) || isWeakConversationalLine(candidate.text) || isPrayerLikeOrDevotionalLine(candidate.text)) {
    return false
  }
  if (isOverlongReviewCandidate(candidate, 'soundbite')) return false
  if (candidate.clipType === 'QUESTION') return (scores.viralPriority ?? 0) >= 0.78
  if (candidate.clipType === 'EXPLAINER') {
    return (scores.viralPriority ?? 0) >= 0.68 && ((scores.consequence ?? 0) >= 0.22 || (scores.quotability ?? 0) >= 0.56)
  }
  return (
    (scores.viralPriority ?? 0) >= 0.56 ||
    (scores.quotability ?? 0) >= 0.58 ||
    (scores.consequence ?? 0) >= 0.22 ||
    (scores.scrollStopPotential ?? 0) >= 0.6
  )
}

function fillRankedIdsToMinimum(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  minKeep: number,
  maxKeep: number
): string[] {
  const out = [...ids]
  if (out.length >= minKeep) return out.slice(0, maxKeep)
  const sortedFallbacks = [...byId.values()]
    .filter((candidate) => isFallbackRankedCandidate(candidate) && !out.includes(candidate.id))
    .sort((a, b) => fallbackRankedCandidatePriority(b) - fallbackRankedCandidatePriority(a))

  for (const candidate of sortedFallbacks) {
    const clashes = out.some((existingId) => {
      const existing = byId.get(existingId)
      return existing ? isNearDuplicate(existing, candidate) : false
    })
    if (clashes) continue
    out.push(candidate.id)
    if (out.length >= minKeep) break
  }
  return out.slice(0, maxKeep)
}

function isTransformationRevealCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  if (sourceFraction > 0.45) return false
  return /\b(today i am|net worth millionaire|millionaire|closed on the biggest home|from broke to freedom|this changed my life)\b/i.test(
    lower
  )
}

function isEmotionalResolutionPayoffCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (sourceFraction < 0.6) return false
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return /\b(i wasn't scared|i felt free|i feel free|not with excitement, with relief|be present for the people you love|relief)\b/i.test(
    lower
  )
}

function isOpeningThesisCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (isOpeningFramingCandidate(candidate, sourceFraction)) return true
  return isEarlyThesisTeaserCandidate(candidate, sourceFraction) || isSecondaryThesisCandidate(candidate)
}

/** Early generational thesis lines — teaser after the concrete cold open, not a second opener. */
function isEarlyThesisTeaserCandidate(candidate: ExtractedClipCandidate, sourceFraction: number): boolean {
  if (sourceFraction > 0.25) return false
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return /\b(every generation gets one shot|one revolution that separates|families who build generational wealth|families who watch it happen from the sidelines)\b/i.test(
    lower
  )
}

function hasMissionCloseLanguage(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  if (isProceduralContextCandidate(candidate)) return false
  return (
    /\b(i need you to|this is why|that's the order|build(?:ing)? generational wealth|estate plan|chase strategy|what i want you to understand|here'?s what i need you to know|that'?s the point|this is the (?:whole )?point|reason (?:this|we)|why (?:this|i)|legacy|generational wealth|positioned to participate|you'?re late|wealth transfer is not coming|already here)\b/i.test(
      lower
    ) ||
    ((candidate.heuristicScores.consequence ?? 0) >= 0.28 &&
      /\b(wealth|legacy|position|opportunity|future|generations?)\b/i.test(lower))
  )
}

function isAcceptableMissionCloseCandidate(
  candidate: ExtractedClipCandidate,
  sourceFraction: number
): boolean {
  if (isOpeningThesisCandidate(candidate, sourceFraction)) return false
  if (isProceduralContextCandidate(candidate)) return false
  if (isEmotionalResolutionPayoffCandidate(candidate, sourceFraction)) return true

  const lower = stripRestatementCue(candidate.text).toLowerCase()
  const strongClose =
    /\b(i need you to|this is why|that's the order|what i want you to understand|here'?s what i need you to know|that'?s the point|this is the (?:whole )?point)\b/i.test(
      lower
    )
  const legacyClose =
    /\b(build(?:ing)? generational wealth|estate plan|legacy|positioned to participate|generations?)\b/i.test(
      lower
    )

  if (strongClose && sourceFraction >= 0.35) return true
  if (legacyClose && sourceFraction >= 0.45) return true
  if (sourceFraction >= 0.78 && /\b(mission|legacy|generational wealth|why|purpose|estate plan)\b/i.test(lower)) {
    return true
  }
  if (
    sourceFraction >= 0.55 &&
    hasMissionCloseLanguage(candidate) &&
    (candidate.heuristicScores.consequence ?? 0) >= 0.35
  ) {
    return true
  }
  if (isStrongMissionCloseHookCandidate(candidate) && sourceFraction >= 0.52) return true
  return false
}

function isQuestionOnlyStingerCandidate(candidate: ExtractedClipCandidate): boolean {
  const text = stripRestatementCue(candidate.text).trim()
  const words = text.split(/\s+/).filter(Boolean).length
  return words <= 12 && /\?\s*$/.test(text) && !isStrongMissionCloseHookCandidate(candidate)
}

/** Early pivot lines that follow the real cold open — thesis, not a second opener. */
function isSecondaryThesisCandidate(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return /\b(internet generation built|beginning of the ai revolution|right now, literally right now|we are in the beginning of the ai revolution)\b/i.test(
    lower
  )
}

/** Language-only check — prefer isAcceptableMissionCloseCandidate when position is known. */
function isMissionCloseCandidate(candidate: ExtractedClipCandidate): boolean {
  return hasMissionCloseLanguage(candidate)
}

function isProceduralContextCandidate(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  return (
    /\b(list every|pay minimums|smallest to largest|smallest debt|step \d|level \d|write down every|throw every extra dollar|debt snowball|here is level|here'?s level)\b/i.test(
      lower
    ) || /\b(you list|minimums on everything except)\b/i.test(lower)
  )
}

function isArcEligibleCandidate(
  candidate: ExtractedClipCandidate,
  role: GroundedReviewNarrativeRole
): boolean {
  if (isLikelyPromotionalCta(candidate)) return false
  if (isProceduralContextCandidate(candidate)) return false
  if (role === 'context') return false
  if (isWeakConversationalLine(candidate.text)) return false
  if (isOverlongReviewCandidate(candidate, 'soundbite')) return false
  return true
}

function missionClosePriority(
  candidate: ExtractedClipCandidate,
  introScore: number,
  role: GroundedReviewNarrativeRole,
  sourceFraction: number
): number {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  const scores = candidate.heuristicScores
  let priority =
    candidate.heuristicComposite +
    (scores.consequence ?? 0) +
    (scores.quotability ?? 0) +
    introScore * 0.15 +
    sourceFraction * 1.35
  if (role === 'mission-close') priority += 0.35
  if (isStrongMissionCloseHookCandidate(candidate)) priority += 0.45
  if (role === 'emotional-low' && sourceFraction >= 0.5) priority += 0.25
  if (/\b(generational wealth|legacy|this is why|positioned|mission)\b/i.test(lower)) priority += 0.2
  if (isOpeningThesisCandidate(candidate, sourceFraction)) priority -= 2
  if (isStatOnlyPayoffCandidate(candidate)) priority -= 0.85
  if (sourceFraction < 0.35) priority -= 0.75
  if (isProceduralContextCandidate(candidate)) priority -= 1
  return priority
}

function coldOpenPriorityForArc(
  candidate: ExtractedClipCandidate,
  arcPool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  introScore: number,
  role: GroundedReviewNarrativeRole
): number {
  const sourceFraction = arcPoolSourceFraction(candidate, arcPool, byId)
  const base = isPreferredColdOpenRoleCandidate(candidate, sourceFraction)
    ? concreteColdOpenPriority(candidate)
    : thesisColdOpenPriority(candidate, sourceFraction)
  let priority = base + introScore * 0.25
  if (role === 'cold-open') priority += 0.4
  if (sourceFraction <= 0.08) priority += 0.2
  if (/\b(i'?m gonna give you|three[- ]level|get positioned|when the door opens)\b/i.test(candidate.text.toLowerCase())) {
    priority += 0.25
  }
  if (/\b(three[- ]level plan|i'?m gonna give you the exact)\b/i.test(candidate.text.toLowerCase())) {
    priority += 0.55
  }
  return priority
}

function isStatOnlyPayoffCandidate(candidate: ExtractedClipCandidate): boolean {
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  const scores = candidate.heuristicScores
  const hasMissionLanguage = hasMissionCloseLanguage(candidate)
  const statHeavy =
    /\b(\$\d|swing just for|versus|compared to|\d+\s*(?:%|percent)|moving your money, not adding)\b/i.test(lower) ||
    (scores.dataAuthority ?? 0) >= 0.65
  const lowEmotional = (scores.emotionalIntensity ?? 0) < 0.32 && (scores.consequence ?? 0) < 0.4
  return statHeavy && lowEmotional && !hasMissionLanguage
}

function isArcColdOpenPoolCandidate(
  candidate: ExtractedClipCandidate,
  sourceFraction: number,
  role: GroundedReviewNarrativeRole
): boolean {
  if (role === 'emotional-low' || role === 'gut-punch' || role === 'context') return false
  if (isDisqualifiedColdOpenCandidate(candidate)) return false
  if (isOpeningFramingCandidate(candidate, sourceFraction)) return false
  if (isLikelyPromotionalCta(candidate)) return false
  const lower = stripRestatementCue(candidate.text).toLowerCase()
  if (/\b(i am the guy|i once cut|didn'?t think my story|mcdonald|cheeseburger|kitchen knife)\b/i.test(lower)) {
    return false
  }
  if (isSecondaryThesisCandidate(candidate)) return false
  if (isEarlyThesisTeaserCandidate(candidate, sourceFraction)) return false
  if (isPreferredPlanColdOpenCandidate(candidate) && sourceFraction <= 0.12) return true
  if (sourceFraction > 0.22) {
    return role === 'cold-open' && isStrongThesisColdOpenCandidate(candidate, sourceFraction)
  }
  return isStrongThesisColdOpenCandidate(candidate, sourceFraction) || role === 'cold-open' || role === 'teaser'
}

function pickColdOpenIntroFallback(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  excludeId: string | null
): string | null {
  const scored = pool
    .map((id) => {
      if (id === excludeId) return null
      const candidate = byId.get(id)
      if (!candidate) return null
      const sourceFraction = arcPoolSourceFraction(candidate, pool, byId)
      const role = roleById.get(id) ?? 'context'
      if (sourceFraction > 0.25) return null
      if (role === 'emotional-low' || role === 'gut-punch' || role === 'context') return null
      if (isOpeningFramingCandidate(candidate, sourceFraction)) return null
      if (isStatOnlyPayoffCandidate(candidate)) return null
      if (isLikelyPromotionalCta(candidate)) return null
      if (isEarlyThesisTeaserCandidate(candidate, sourceFraction)) return null
      if (isSecondaryThesisCandidate(candidate)) return null
      if (!isAcceptableColdOpenCandidate(candidate, sourceFraction)) return null
      const introScore = introScoreById.get(id) ?? 0
      if (role !== 'teaser' && role !== 'cold-open' && role !== 'transformation' && introScore < 0.55) {
        return null
      }
      return {
        id,
        priority:
          introScore * 2 +
          candidate.heuristicComposite +
          (role === 'teaser' || role === 'cold-open' ? 0.25 : 0) -
          sourceFraction * 0.4
      }
    })
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  return scored[0]?.id ?? null
}

function pickColdOpenForArc(
  ids: string[],
  arcPool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>
): string | null {
  const scored = ids
    .map((id) => {
      const candidate = byId.get(id)
      if (!candidate) return null
      const sourceFraction = arcPoolSourceFraction(candidate, arcPool, byId)
      const role = roleById.get(id) ?? 'context'
      if (!isArcColdOpenPoolCandidate(candidate, sourceFraction, role)) return null
      return {
        id,
        priority: coldOpenPriorityForArc(candidate, arcPool, byId, introScoreById.get(id) ?? 0, role)
      }
    })
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  return scored[0]?.id ?? null
}

function resolveColdOpenForArc(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  missionCloseId: string | null = null
): string | null {
  const fromPool = pickColdOpenForArc(pool, pool, byId, roleById, introScoreById)
  if (fromPool) return fromPool
  const fromAll = pickColdOpenForArc([...byId.keys()], pool, byId, roleById, introScoreById)
  if (fromAll) return fromAll
  const strict = pickStrictColdOpenFallback(byId)
  if (strict) return strict
  return pickColdOpenIntroFallback(pool, byId, roleById, introScoreById, missionCloseId)
}

function isMissionCloseFallbackCandidate(
  candidate: ExtractedClipCandidate,
  role: GroundedReviewNarrativeRole,
  sourceFraction: number
): boolean {
  if (isOpeningFramingCandidate(candidate, sourceFraction)) return false
  if (isStatOnlyPayoffCandidate(candidate)) return false
  if (isProceduralContextCandidate(candidate)) return false
  if (isQuestionOnlyStingerCandidate(candidate)) return false
  if (isStrongMissionCloseHookCandidate(candidate)) return true
  if (sourceFraction < 0.42) return false
  if (
    role === 'emotional-low' ||
    role === 'gut-punch' ||
    role === 'quotable-shift' ||
    role === 'mission-close' ||
    role === 'viral-hook'
  ) {
    return true
  }
  if (role === 'payoff' && (candidate.heuristicScores.emotionalIntensity ?? 0) >= 0.22) {
    return true
  }
  return (candidate.heuristicScores.consequence ?? 0) >= 0.32
}

function pickMissionCloseForArc(
  ids: string[],
  arcPool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  coldOpenId: string | null,
  useFullSourceSpan = false
): string | null {
  const coldOpen = coldOpenId ? byId.get(coldOpenId) : null
  const sourceFractionFor = (candidate: ExtractedClipCandidate) =>
    useFullSourceSpan
      ? sourceFractionForCandidate(candidate, byId)
      : arcPoolSourceFraction(candidate, arcPool, byId)

  const scoreCandidate = (id: string, mode: 'primary' | 'fallback') => {
    if (id === coldOpenId) return null
    const candidate = byId.get(id)
    if (!candidate) return null
    const sourceFraction = sourceFractionFor(candidate)
    const role = roleById.get(id) ?? 'context'
    const acceptableClose = isAcceptableMissionCloseCandidate(candidate, sourceFraction)
    const latePayoffFallback =
      mode === 'primary' &&
      !acceptableClose &&
      !isStatOnlyPayoffCandidate(candidate) &&
      sourceFraction >= 0.5 &&
      (role === 'payoff' || role === 'gut-punch' || role === 'emotional-low' || role === 'quotable-shift') &&
      (candidate.heuristicScores.consequence ?? 0) >= 0.25 &&
      isArcEligibleCandidate(candidate, role)
    const genericFallback =
      mode === 'fallback' &&
      isMissionCloseFallbackCandidate(candidate, role, sourceFraction) &&
      isArcEligibleCandidate(candidate, role)
    if (mode === 'primary' && !acceptableClose && !latePayoffFallback) return null
    if (mode === 'fallback' && !genericFallback) return null
    if (!isArcEligibleCandidate(candidate, role) && !acceptableClose && mode === 'primary') return null
    if (coldOpen && isNearDuplicate(coldOpen, candidate)) return null
    return {
      id,
      priority: missionClosePriority(candidate, introScoreById.get(id) ?? 0, role, sourceFraction)
    }
  }

  const scored = ids
    .map((id) => scoreCandidate(id, 'primary'))
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  if (scored[0]?.id) return scored[0].id

  const fallback = ids
    .map((id) => scoreCandidate(id, 'fallback'))
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  return fallback[0]?.id ?? null
}

function pickLateArcBookend(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  coldOpenId: string | null
): string | null {
  const scored = pool
    .map((id) => {
      if (id === coldOpenId) return null
      const candidate = byId.get(id)
      if (!candidate) return null
      const sourceFraction = arcPoolSourceFraction(candidate, pool, byId)
      const role = roleById.get(id) ?? 'context'
      if (sourceFraction < 0.18) return null
      if (isQuestionOnlyStingerCandidate(candidate)) return null
      if (isStatOnlyPayoffCandidate(candidate)) return null
      if (isProceduralContextCandidate(candidate)) return null
      if (isOpeningFramingCandidate(candidate, sourceFraction)) return null
      if (isSecondaryThesisCandidate(candidate)) return null
      if (!isArcEligibleCandidate(candidate, role)) return null
      return {
        id,
        priority: missionClosePriority(candidate, introScoreById.get(id) ?? 0, role, sourceFraction)
      }
    })
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  return scored[0]?.id ?? null
}

function pickPreCloseStinger(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  exclude: Set<string>,
  coldOpenId: string | null
): string | null {
  const scored = pool
    .map((id) => {
      if (exclude.has(id) || id === coldOpenId) return null
      const candidate = byId.get(id)
      if (!candidate) return null
      const sourceFraction = arcPoolSourceFraction(candidate, pool, byId)
      const role = roleById.get(id) ?? 'context'
      if (sourceFraction < 0.55) return null
      if (!isArcEligibleCandidate(candidate, role)) return null
      const graphStinger =
        isQuestionOnlyStingerCandidate(candidate) ||
        role === 'tension-setup' ||
        role === 'teaser' ||
        (candidate.heuristicScores.dataAuthority ?? 0) >= 0.55
      if (!graphStinger) return null
      return {
        id,
        priority:
          (introScoreById.get(id) ?? 0) * 0.35 +
          candidate.heuristicComposite +
          (candidate.heuristicScores.dataAuthority ?? 0) * 0.45 +
          sourceFraction * 0.8 +
          (role === 'tension-setup' ? 0.2 : 0)
      }
    })
    .filter((row): row is { id: string; priority: number } => row != null)
    .sort((a, b) => b.priority - a.priority)
  return scored[0]?.id ?? null
}

function resolveMissionCloseForArc(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  introScoreById: Map<string, number>,
  coldOpenId: string | null
): string | null {
  const fromPool = pickMissionCloseForArc(pool, pool, byId, roleById, introScoreById, coldOpenId, false)
  if (fromPool) return fromPool
  return pickMissionCloseForArc([...byId.keys()], pool, byId, roleById, introScoreById, coldOpenId, true)
}

function isPreferredPlanColdOpenCandidate(candidate: ExtractedClipCandidate): boolean {
  return /\b(i'?m gonna give you|three[- ]level plan|get positioned|when the door opens)\b/i.test(
    stripRestatementCue(candidate.text).toLowerCase()
  )
}

function ensureColdOpenInArcPool(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>
): string[] {
  if (
    pool.some((id) => {
      const row = byId.get(id)
      return row ? isAcceptableColdOpenCandidate(row, sourceFractionForCandidate(row, byId)) : false
    })
  ) {
    return pool
  }
  const best = [...byId.values()]
    .filter((candidate) => isAcceptableColdOpenCandidate(candidate, sourceFractionForCandidate(candidate, byId)))
    .sort((a, b) => {
      const aPlan = isPreferredPlanColdOpenCandidate(a) ? 1 : 0
      const bPlan = isPreferredPlanColdOpenCandidate(b) ? 1 : 0
      if (aPlan !== bPlan) return bPlan - aPlan
      return sourceFractionForCandidate(a, byId) - sourceFractionForCandidate(b, byId)
    })[0]
  if (!best) return pool
  return [best.id, ...pool.filter((id) => id !== best.id)]
}

function pickStrictColdOpenFallback(byId: Map<string, ExtractedClipCandidate>): string | null {
  const best = [...byId.values()]
    .filter((candidate) => isAcceptableColdOpenCandidate(candidate, sourceFractionForCandidate(candidate, byId)))
    .sort((a, b) => {
      const aPlan = isPreferredPlanColdOpenCandidate(a) ? 1 : 0
      const bPlan = isPreferredPlanColdOpenCandidate(b) ? 1 : 0
      if (aPlan !== bPlan) return bPlan - aPlan
      const aPriority = isPreferredColdOpenRoleCandidate(a, sourceFractionForCandidate(a, byId))
        ? concreteColdOpenPriority(a)
        : thesisColdOpenPriority(a, sourceFractionForCandidate(a, byId))
      const bPriority = isPreferredColdOpenRoleCandidate(b, sourceFractionForCandidate(b, byId))
        ? concreteColdOpenPriority(b)
        : thesisColdOpenPriority(b, sourceFractionForCandidate(b, byId))
      if (Math.abs(aPriority - bPriority) > 1e-6) return bPriority - aPriority
      return sourceFractionForCandidate(a, byId) - sourceFractionForCandidate(b, byId)
    })[0]
  return best?.id ?? null
}

function candidateOverlapsExisting(
  clip: { start: number; end: number; text: string },
  candidate: ExtractedClipCandidate
): boolean {
  const overlap = Math.min(clip.end, candidate.end) - Math.max(clip.start, candidate.start)
  if (overlap > 0.5) return true
  const a = stripRestatementCue(clip.text).toLowerCase().replace(/\s+/g, ' ').trim()
  const b = stripRestatementCue(candidate.text).toLowerCase().replace(/\s+/g, ' ').trim()
  return a === b || (a.length > 24 && b.includes(a.slice(0, 24))) || (b.length > 24 && a.includes(b.slice(0, 24)))
}

function bookendCandidateFromStitchedClip(
  clip: ReturnType<typeof extractSmartStitchedClips>[number],
  mode: StoryMode
): ExtractedClipCandidate | null {
  const clipType = classifyClip(clip.text)
  const scored = scoreClipEditorially(
    {
      id: clip.id,
      text: clip.text,
      start: clip.start,
      end: clip.end,
      duration: clip.duration,
      completenessScore: clip.completenessScore,
      sourceSegmentIds: clip.sourceSegmentIds,
      clipType
    },
    mode
  )
  const forceKeep = isMustKeepPlanColdOpenText(clip.text) || isMustKeepLateBookendText(clip.text)
  if (scored.rejected && !forceKeep) return null
  const composite = Math.max(
    scored.scores.viralPriority ?? 0,
    scored.scores.scrollStopPotential ?? 0,
    scored.scores.quotability ?? 0,
    forceKeep ? 0.82 : 0
  )
  return {
    id: `bookend_${clip.start.toFixed(2)}_${clip.end.toFixed(2)}`,
    text: clip.text,
    start: clip.start,
    end: clip.end,
    duration: clip.duration,
    completenessScore: clip.completenessScore,
    sourceSegmentIds: clip.sourceSegmentIds,
    clipType,
    heuristicComposite: composite,
    heuristicWithinTypeRank: 0,
    heuristicScores: { ...scored.scores }
  }
}

/** Transcript-driven analyze only keeps LLM selections — inject stitched bookends the model skipped. */
function injectMustKeepBookendCandidates(
  candidates: ExtractedClipCandidate[],
  segments: Array<{ id: string; start: number; end: number; text: string; speaker_label?: string | null }>,
  mode: StoryMode
): ExtractedClipCandidate[] {
  const stitched = extractSmartStitchedClips(
    segments.map((segment) => ({
      id: segment.id,
      start_time: segment.start,
      end_time: segment.end,
      text: segment.text,
      speaker_label: segment.speaker_label ?? null
    }))
  )
  const out = [...candidates]
  const bookends = stitched
    .filter((clip) => isMustKeepPlanColdOpenText(clip.text) || isMustKeepLateBookendText(clip.text))
    .map((clip) => bookendCandidateFromStitchedClip(clip, mode))
    .filter((row): row is ExtractedClipCandidate => row != null)
    .sort((a, b) => {
      const aPlan = isMustKeepPlanColdOpenText(a.text) ? 1 : 0
      const bPlan = isMustKeepPlanColdOpenText(b.text) ? 1 : 0
      if (aPlan !== bPlan) return bPlan - aPlan
      return a.start - b.start
    })

  for (const candidate of bookends) {
    if (out.some((existing) => candidateOverlapsExisting(candidate, existing))) continue
    if (isMustKeepPlanColdOpenText(candidate.text)) {
      out.unshift(candidate)
    } else {
      out.push(candidate)
    }
  }
  return out
}

function applyArcBookendRoles(
  items: GroundedReviewItem[],
  roleById: Map<string, GroundedReviewNarrativeRole>,
  coldOpenId: string | null,
  missionCloseId: string | null,
  byId: Map<string, ExtractedClipCandidate>,
  graphIds: string[] = []
): void {
  const patch = (id: string | null, role: GroundedReviewNarrativeRole, purpose: string) => {
    if (!id) return
    roleById.set(id, role)
    let item = items.find((row) => row.candidateId === id)
    if (!item) {
      const candidate = byId.get(id)
      if (!candidate) return
      item = {
        candidateId: id,
        narrativeRole: role,
        purpose,
        overallScore: clampScore(candidate.heuristicComposite, 0.7),
        viralScore: clampScore(candidate.heuristicScores.viralPriority, 0.6),
        emotionalScore: clampScore(candidate.heuristicScores.emotionalIntensity, 0.22),
        introScore: clampScore(
          Math.max(candidate.heuristicScores.scrollStopPotential, candidate.heuristicScores.viralPriority),
          0.55
        ),
        graphScore: clampScore(candidate.heuristicScores.dataAuthority, 0),
        labels: fallbackLabels(candidate),
        whyBullets: [],
        graphicsPackage: fallbackGraphicsPackage(candidate, fallbackGraphIdea(candidate)),
        brollIdeas: fallbackBrollIdeasForCandidate(candidate, 'story', '', 8),
        graphIdea: graphIds.includes(id) ? fallbackGraphIdea(candidate) : undefined
      }
      items.push(item)
    } else {
      item.narrativeRole = role
      item.purpose = purpose
    }
  }
  patch(coldOpenId, 'cold-open', 'Instant relatability — establishes the stakes in the first seconds.')
  patch(missionCloseId, 'mission-close', 'Powerful close — the reason the whole piece exists.')
}

function ensureMissionCloseInArcPool(
  pool: string[],
  byId: Map<string, ExtractedClipCandidate>
): string[] {
  if (pool.some((id) => {
    const row = byId.get(id)
    return row ? isMustKeepMissionCloseCandidate(row) : false
  })) {
    return pool
  }
  const best = [...byId.values()]
    .filter((candidate) => isMustKeepMissionCloseCandidate(candidate))
    .sort((a, b) => {
      const aFrac = sourceFractionForCandidate(a, byId)
      const bFrac = sourceFractionForCandidate(b, byId)
      if (Math.abs(aFrac - bFrac) > 1e-6) return bFrac - aFrac
      return b.heuristicComposite - a.heuristicComposite
    })[0]
  if (!best) return pool
  return [best.id, ...pool.filter((id) => id !== best.id)]
}

const TRAILER_ARC_ROLE_RANK: Record<GroundedReviewNarrativeRole, number> = {
  'cold-open': 0,
  transformation: 1,
  teaser: 2,
  'emotional-low': 3,
  'gut-punch': 4,
  'viral-hook': 5,
  'quotable-shift': 6,
  'tension-setup': 7,
  payoff: 8,
  'mission-close': 9,
  context: 10
}

/**
 * Compose a curated cold-open → mission-close arc from the ranked pool.
 * Universal rules (any show): promise/hook first, procedural context excluded,
 * narrative role order (not source timecode), distinct bookends.
 */
function composeTrailerArc(
  rankedIds: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  items: GroundedReviewItem[] = [],
  extraPoolIds: string[] = [],
  graphIds: string[] = []
): string[] {
  const introScoreById = new Map(items.map((item) => [item.candidateId, item.introScore ?? 0]))
  let pool = [...new Set([...rankedIds, ...extraPoolIds])].filter((id) => byId.has(id))
  pool = ensureColdOpenInArcPool(pool, byId)
  pool = ensureMissionCloseInArcPool(pool, byId)
  if (pool.length === 0) return []

  const missionCloseId = resolveMissionCloseForArc(pool, byId, roleById, introScoreById, null)
  const coldOpenId = resolveColdOpenForArc(pool, byId, roleById, introScoreById, missionCloseId)
  let resolvedMissionCloseId =
    missionCloseId && missionCloseId !== coldOpenId
      ? missionCloseId
      : resolveMissionCloseForArc(pool, byId, roleById, introScoreById, coldOpenId)
  if (!resolvedMissionCloseId) {
    resolvedMissionCloseId = pickLateArcBookend(pool, byId, roleById, introScoreById, coldOpenId)
  }
  if (!resolvedMissionCloseId) {
    resolvedMissionCloseId = pickLateArcBookend([...byId.keys()], byId, roleById, introScoreById, coldOpenId)
  }

  const reserved = new Set<string>()
  if (coldOpenId) reserved.add(coldOpenId)
  if (resolvedMissionCloseId) reserved.add(resolvedMissionCloseId)

  const middleSlots = Math.max(0, TRAILER_ARC_MAX - reserved.size)
  const middle = pool
    .filter((id) => !reserved.has(id))
    .filter((id) => {
      const candidate = byId.get(id)
      if (!candidate) return false
      const role = roleById.get(id) ?? 'context'
      const sourceFraction = arcPoolSourceFraction(candidate, pool, byId)
      if (role === 'cold-open' && id !== coldOpenId) return false
      if (isOpeningFramingCandidate(candidate, sourceFraction)) return false
      if (isStatOnlyPayoffCandidate(candidate)) return false
      if (isSecondaryThesisCandidate(candidate)) return false
      if (isQuestionOnlyStingerCandidate(candidate) && sourceFraction < 0.55) return false
      if (isStrongMissionCloseHookCandidate(candidate)) return false
      return isArcEligibleCandidate(candidate, role)
    })
    .sort((a, b) => {
      const roleA = TRAILER_ARC_ROLE_RANK[roleById.get(a) ?? 'context']
      const roleB = TRAILER_ARC_ROLE_RANK[roleById.get(b) ?? 'context']
      if (roleA !== roleB) return roleA - roleB
      const ca = byId.get(a)!
      const cb = byId.get(b)!
      return cb.heuristicComposite - ca.heuristicComposite
    })

  const arc: string[] = []
  if (coldOpenId) arc.push(coldOpenId)

  let middlePayoffCount = 0
  const middlePayoffMax = 1
  let middlePositionPayoffCount = 0

  for (const id of middle) {
    if (arc.length >= TRAILER_ARC_MAX - (resolvedMissionCloseId ? 1 : 0)) break
    const candidate = byId.get(id)
    if (!candidate) continue
    const role = roleById.get(id) ?? 'context'
    const lower = stripRestatementCue(candidate.text).toLowerCase()
    const positioningPayoff =
      role === 'payoff' &&
      /\b(put ourselves in position|two to three to four|say yes when the opportunity|working two to three)\b/i.test(lower)
    if (positioningPayoff && middlePositionPayoffCount >= 1) continue
    if (role === 'payoff' && middlePayoffCount >= middlePayoffMax) continue
    if (arc.some((existingId) => {
      const existing = byId.get(existingId)
      return existing ? isNearDuplicate(existing, candidate) : false
    })) {
      continue
    }
    if (role === 'payoff') middlePayoffCount += 1
    if (positioningPayoff) middlePositionPayoffCount += 1
    arc.push(id)
  }

  const preCloseSlots = TRAILER_ARC_MAX - arc.length - (resolvedMissionCloseId ? 1 : 0)
  if (preCloseSlots > 0) {
    const preCloseId = pickPreCloseStinger(pool, byId, roleById, introScoreById, new Set(arc), coldOpenId)
    if (preCloseId) arc.push(preCloseId)
  }

  if (resolvedMissionCloseId) {
    const close = byId.get(resolvedMissionCloseId)
    const open = coldOpenId ? byId.get(coldOpenId) : null
    if (close && (!open || !isNearDuplicate(open, close))) {
      arc.push(resolvedMissionCloseId)
    }
  }

  const deduped = dedupeOverlappingIds(arc, byId, 0)
  applyArcBookendRoles(items, roleById, coldOpenId, resolvedMissionCloseId, byId, graphIds)
  if (deduped.length >= TRAILER_ARC_MIN) return deduped
  return deduped.length > 0 ? deduped : pool.slice(0, Math.min(TRAILER_ARC_MAX, pool.length))
}

/** @deprecated Use composeTrailerArc — kept as alias for tests/callers. */
function buildTrailerArc(
  ids: string[],
  byId: Map<string, ExtractedClipCandidate>,
  roleById: Map<string, GroundedReviewNarrativeRole>,
  items: GroundedReviewItem[] = [],
  extraPoolIds: string[] = [],
  graphIds: string[] = []
): string[] {
  return composeTrailerArc(ids, byId, roleById, items, extraPoolIds, graphIds)
}

function acceptModelNarrativeRole(
  role: GroundedReviewNarrativeRole | undefined,
  candidate: ExtractedClipCandidate,
  context: { isGraph: boolean; sourceFraction: number }
): boolean {
  if (!role) return false
  if (isAcceptableMissionCloseCandidate(candidate, context.sourceFraction)) {
    return role === 'mission-close'
  }
  if (isAcceptableColdOpenCandidate(candidate, context.sourceFraction)) {
    return role === 'cold-open'
  }
  if (role === 'mission-close') {
    return isAcceptableMissionCloseCandidate(candidate, context.sourceFraction)
  }
  if (role === 'cold-open') return isAcceptableColdOpenCandidate(candidate, context.sourceFraction)
  if (role === 'transformation') return isTransformationRevealCandidate(candidate, context.sourceFraction)
  if (role === 'tension-setup') return context.isGraph
  return true
}

const PURPOSE_PREFIX_BY_ROLE: Record<GroundedReviewNarrativeRole, string> = {
  'cold-open': 'Cold open.',
  transformation: 'Transformation reveal.',
  teaser: 'Curiosity gap.',
  'emotional-low': 'Emotional low point.',
  'gut-punch': 'Gut punch.',
  'viral-hook': 'Viral hook.',
  'quotable-shift': 'Quotable shift.',
  'tension-setup': 'Data point.',
  payoff: 'Payoff.',
  'mission-close': 'Mission statement.',
  context: 'Context.'
}

function purposeMatchesRole(purpose: string | undefined, role: GroundedReviewNarrativeRole): boolean {
  if (!purpose) return false
  return purpose.trim().toLowerCase().startsWith(PURPOSE_PREFIX_BY_ROLE[role].toLowerCase())
}

function harmonizeReviewIds(params: {
  rankedIds: string[]
  viralIds: string[]
  introIds: string[]
  graphIds: string[]
  byId: Map<string, ExtractedClipCandidate>
}): Pick<GroundedReviewResult, 'rankedIds' | 'viralIds' | 'introIds' | 'graphIds'> {
  const { rankedIds, viralIds, introIds, graphIds, byId } = params
  const cleanRanked = fillRankedIdsToMinimum(
    ensureEliteTruthBombIds(
      ensureMustKeepQuoteIds(
        ensureConcreteColdOpenIds(
          dedupeOverlappingIds(rankedIds, byId, RANKED_SOUND_BITE_MIN).slice(0, RANKED_SOUND_BITE_MAX),
          byId,
          RANKED_SOUND_BITE_MAX
        ),
        byId,
        RANKED_SOUND_BITE_MAX
      ),
      byId,
      RANKED_SOUND_BITE_MAX
    ),
    byId,
    RANKED_SOUND_BITE_MIN,
    RANKED_SOUND_BITE_MAX
  )
  const cleanViral = ensureMustKeepMissionCloseIds(
    ensureMustKeepQuoteIds(
      removeRepeatedIdeasAgainst(viralIds, byId, cleanRanked).slice(0, VIRAL_LIST_MAX),
      byId,
      VIRAL_LIST_MAX
    ),
    byId,
    VIRAL_LIST_MAX
  )
  const cleanIntro = ensureConcreteColdOpenIds(
    removeRepeatedIdeasAgainst(
      introIds.filter((id) => {
        const candidate = byId.get(id)
        return candidate ? isAcceptableIntroCandidate(candidate, sourceFractionForCandidate(candidate, byId)) : false
      }),
      byId,
      [...cleanRanked, ...cleanViral]
    ).slice(0, INTRO_LIST_MAX),
    byId,
    INTRO_LIST_MAX
  )
  const cleanGraph = removeRepeatedIdeasAgainst(graphIds, byId, [...cleanRanked, ...cleanViral, ...cleanIntro]).slice(
    0,
    GRAPH_LIST_MAX
  )
  return {
    rankedIds: cleanRanked,
    viralIds: cleanViral,
    introIds: cleanIntro,
    graphIds: cleanGraph
  }
}

function fallbackLabels(candidate: ExtractedClipCandidate): string[] {
  const labels = new Set<string>()
  const scores = candidate.heuristicScores
  labels.add(candidate.clipType.toLowerCase())
  if (scores.viralPriority >= 0.72) labels.add('viral')
  if (scores.emotionalIntensity >= 0.28 || scores.narrativeTension >= 0.45) labels.add('emotional')
  if (scores.consequence >= 0.24) labels.add('motivational')
  if ((scores.dataAuthority ?? 0) >= 0.48 || /\d/.test(candidate.text)) labels.add('data')
  if (candidate.clipType === 'HOOK' || scores.scrollStopPotential >= 0.72) labels.add('intro')
  return [...labels]
}

function extractGroundedDataText(text: string): string {
  const numbers = text.match(/\$?\d[\d,.]*\s?(?:%|percent|million|billion|thousand|k|years?|months?|x)?/gi)
  if (numbers && numbers.length > 0) {
    return numbers.map((token) => token.trim()).filter(Boolean).slice(0, 4).join(' • ')
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function fallbackGraphIdea(candidate: ExtractedClipCandidate): GroundedReviewGraphIdea | undefined {
  if (!isStrongGraphCandidate(candidate)) return undefined
  const chartType: GroundedReviewGraphChartType = /\b(vs|versus|compared|than)\b/i.test(candidate.text)
    ? 'comparison'
    : /\b(percent|%|million|billion|thousand)\b/i.test(candidate.text)
      ? 'counter'
      : 'text'
  const treatmentByType: Record<GroundedReviewGraphChartType, string> = {
    comparison:
      'Split-screen bar comparison. Left vs right panels animate up one at a time; the larger value lands with a subtle slam and rim light.',
    counter:
      'Big metallic number counter that rolls up to the spoken figure, then holds with a soft glow and a one-line caption beneath.',
    line: 'Single clean line that draws on across a dark grid, ending on the spoken endpoint with a pulsing node.',
    bar: 'Stepped bar build, one bar per beat, with the final bar accented in the highlight color.',
    text: 'Pure typographic stat card — the key figure dominates, the context line fades in below it.'
  }
  return {
    chartType,
    title: fallbackGraphTitle(candidate),
    why: 'Ground this line with a simple visual that reinforces the number or comparison already stated.',
    dataText: extractGroundedDataText(candidate.text),
    visualTreatment: treatmentByType[chartType]
  }
}

/**
 * Assign a narrative role + one-line purpose to a bite, mirroring the TTAO package's
 * PURPOSE column. Heuristic only: derives from clip type, position in the source, and scores.
 */
function assignNarrativeRoleAndPurpose(
  candidate: ExtractedClipCandidate,
  context: { arcIndex: number; arcTotal: number; sourceFraction: number; isGraph: boolean }
): { role: GroundedReviewNarrativeRole; purpose: string } {
  const scores = candidate.heuristicScores
  const earlyInSource = context.sourceFraction <= 0.18
  const lateInSource = context.sourceFraction >= 0.82
  const emotional = (scores.emotionalIntensity ?? 0) >= 0.32 || (scores.narrativeTension ?? 0) >= 0.5
  const viral = (scores.viralPriority ?? 0) >= 0.7 || (scores.quotability ?? 0) >= 0.7
  const consequence = (scores.consequence ?? 0) >= 0.28
  const strippedText = stripRestatementCue(candidate.text)

  if (isSecondaryThesisCandidate(candidate) || isEarlyThesisTeaserCandidate(candidate, context.sourceFraction)) {
    return { role: 'teaser', purpose: 'Curiosity gap — escalates the premise after the cold open.' }
  }
  if (isAcceptableColdOpenCandidate(candidate, context.sourceFraction)) {
    return { role: 'cold-open', purpose: 'Instant relatability — establishes the stakes in the first seconds.' }
  }
  if (
    isAcceptableMissionCloseCandidate(candidate, context.sourceFraction) ||
    (isStrongMissionCloseHookCandidate(candidate) && context.sourceFraction >= 0.5) ||
    (lateInSource && /\bwhy|purpose|mission|legacy|generational wealth|estate plan\b/i.test(strippedText))
  ) {
    return { role: 'mission-close', purpose: 'Powerful close — the reason the whole piece exists.' }
  }
  if (isOpeningThesisCandidate(candidate, context.sourceFraction)) {
    return { role: 'teaser', purpose: 'Curiosity gap — frames what the conversation is about.' }
  }
  if (context.isGraph) {
    return { role: 'tension-setup', purpose: 'Sets up a data beat the viewer can see, not just hear.' }
  }
  if (isTransformationRevealCandidate(candidate, context.sourceFraction) || (/\bmillionaire|net worth|closed on|today (?:i|we)\b/i.test(strippedText) && earlyInSource)) {
    return { role: 'transformation', purpose: 'Transformation reveal — hooks aspirational viewers.' }
  }
  if (candidate.clipType === 'QUESTION' || /\bone (?:belief|thing|truth)\b/i.test(strippedText)) {
    return { role: 'teaser', purpose: 'Curiosity gap — teases why this moment matters.' }
  }
  if (isEmotionalResolutionPayoffCandidate(candidate, context.sourceFraction)) {
    return { role: 'payoff', purpose: 'Payoff. Emotional resolution — the story finally lands.' }
  }
  if (emotional && consequence) {
    return { role: 'emotional-low', purpose: 'Emotional low point — cinematic, specific, raw.' }
  }
  if (viral && candidate.text.split(/\s+/).length <= 16) {
    return { role: 'viral-hook', purpose: 'Provocative, shareable, title-worthy one-liner.' }
  }
  if ((scores.contrarianEdge ?? 0) >= 0.3 || (scores.quotability ?? 0) >= 0.6) {
    return { role: 'quotable-shift', purpose: 'Reframes the conversation in a single quotable line.' }
  }
  if (candidate.clipType === 'PAYOFF' || consequence) {
    return { role: 'payoff', purpose: 'Payoff beat — lands the lesson after the build-up.' }
  }
  return { role: 'context', purpose: 'Supporting beat that bridges stronger moments.' }
}

/** Ranked soundbite list stays in editorial score order; trailer arc is composed separately. */
function orderRankedIdsForNarrativePackage(
  ids: string[],
  _byId: Map<string, ExtractedClipCandidate>,
  _roleById: Map<string, GroundedReviewNarrativeRole>
): string[] {
  return ids
}

/**
 * Detect whether a soundbite text matches the "person + multiple companies/ventures" pattern
 * that warrants the biographical empire-map infographic style (MODE A).
 * Returns true only when both a proper-person name AND ≥ 2 company/entity signals are present.
 */
function isEmpireMapCandidate(text: string): boolean {
  // Must have a capitalized proper-name token (first+last or first+capitalized) that looks like a person
  const hasPerson = /\b[A-Z][a-z]{1,14}(?:\s+[A-Z][a-z]{1,14}){1,3}\b/.test(text)
  if (!hasPerson) return false
  // Count distinct company/org signals: capitalized noun runs (≥2 uppercase words OR a known brand pattern)
  const capRuns = text.match(/\b(?:[A-Z][A-Za-z0-9&.'-]{1,}(?:\s+[A-Z][A-Za-z0-9&.'-]{1,})*)\b/g) ?? []
  // Filter out sentence-start words and pronouns/titles that are not companies
  const NOT_COMPANIES = new Set(['He', 'She', 'They', 'We', 'His', 'Her', 'Their', 'Our', 'The', 'A', 'An', 'And', 'But', 'Or', 'I', 'It', 'Its', 'In', 'On', 'At', 'To', 'For', 'Of', 'From', 'With', 'By'])
  const entityLike = capRuns.filter((token) => !NOT_COMPANIES.has(token.split(' ')[0] ?? ''))
  return entityLike.length >= 3 // person name + ≥2 company entities
}

function fallbackGraphicsPackage(
  candidate: ExtractedClipCandidate,
  graphIdea: GroundedReviewGraphIdea | undefined
): GroundedReviewGraphicsPackage {
  const text = candidate.text

  if (isEmpireMapCandidate(text)) {
    // MODE A — Biographical Empire Map
    return {
      graphImagePrompt: `Cinematic biographical empire infographic grounded only in this spoken line: "${text}". Composition: large photorealistic portrait of the person named in the line, centered, with slight cinematic rim light and sharp eyes. Backdrop: deep-space Earth-from-orbit view — dark navy field (#0A1628), star field, subtle atmospheric glow. Orbiting the portrait: one interconnected circular company/venture node for each entity explicitly named in the line — each node has the exact company name, a glowing icon silhouette, a teal ring border, and a holographic gold pathway connecting back to the portrait with flowing energy-trail particles. Left edge: minimalist vertical TIMELINE showing only milestones mentioned in the line. Right edge: IMPACT STATS panel with metallic-gold large numerals for any figures actually spoken. Color palette: deep navy base, electric orange (#FF6B00) and metallic gold (#C9A84C) accents, neon white highlights, teal node glow (#00D4D4). Style: Bloomberg Businessweek meets Antoine Fuqua premium documentary, 16:9, 4K photorealistic rendering. No invented companies, dates, or figures beyond what is spoken.`,
      overlayTextImagePrompt: `Bold cinematic title card from the exact words of this soundbite: "${text}". Pull the single most powerful 6-10 word phrase as the main typographic hit — massive condensed white uppercase letters with subtle metallic sheen, positioned lower-third on a near-black cinema background. Below it, a smaller secondary line with the person's name in electric orange (#FF6B00) if named in the line. Bold, readable at half-screen size. No invented wording.`,
      motionPromptFromImage: `Cinematic orbital empire-map reveal grounded in this soundbite: "${text}". OPENING: camera holds on the central portrait; subject's eyes catch the light as frame slowly breathes in with a gentle push. SEQUENCE: company/venture nodes illuminate one by one in the exact order they are named in the line — each node pulses with an orange energy ring and the holographic gold pathway to the portrait ignites with flowing particles. ENVIRONMENT: Earth rotates slowly in the background; faint satellite trails arc across frame; deep-space atmosphere subtly brightens as each node activates; ambient nebula particles drift. CLOSING: camera pulls back just enough to reveal the complete network simultaneously illuminated — all pathways glowing, particles streaming, full empire map at peak luminosity. 8 seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover`,
      styleTags: ['biographical empire map', 'Bloomberg documentary', 'Antoine Fuqua', 'orbital nodes', 'holographic'],
      style: {
        referenceStyle: 'cinematic biographical empire infographic — Bloomberg Businessweek meets Antoine Fuqua',
        palette: ['deep navy #0A1628', 'electric orange #FF6B00', 'metallic gold #C9A84C', 'neon white #F0F8FF', 'teal node glow #00D4D4'],
        typography: 'large condensed uppercase portrait label + metallic node names + impact stat callouts',
        layout: 'portrait centered, company nodes orbiting, timeline panel left, stats panel right, holographic connecting lines',
        tone: 'epic, authoritative, premium documentary, Bloomberg-grade',
        durationSeconds: 8
      }
    }
  }

  // MODE B — Stat / Chart (has a number/percentage/figure)
  const hasNumber = /\$[\d,.]+[BbMmKkTt]?|\b\d[\d,.]*\s*(?:percent|%|billion|million|trillion|thousand|x\b)|\b(?:double|triple|quadruple|10x|100x)\b/i.test(text)
  if (hasNumber || graphIdea) {
    return {
      graphImagePrompt: graphIdea
        ? `Premium cinematic stat infographic grounded only in this spoken line: "${text}". Main headline: "${graphIdea.title}". Dark documentary environment: oversized 3D beveled metallic-gold primary stat or number anchored center-frame; neon-green ${graphIdea.chartType ?? 'bar'} chart element showing only the data actually spoken; warm white condensed label; realistic polished surface with dramatic rim light raking across; subtle particle field; soft lens flare. Do not add any numbers, names, or claims not present in the spoken line.`
        : `Premium cinematic stat infographic grounded only in this spoken line: "${text}". Dark documentary environment: oversized 3D beveled metallic-gold number or key phrase anchored center-frame; neon-green chart or counter accent showing only data spoken; warm white supporting label; dramatic rim light, subtle particles, lens flare. No invented figures, names, or claims.`,
      overlayTextImagePrompt: `High-end overlay text image from the exact spoken line: "${text}". Extract the key stat or strongest 3-7 words as the primary typographic element — oversized metallic gold on near-black cinema background; subtle neon green glow. No invented wording.`,
      motionPromptFromImage: `Premium finance/documentary motion graphic grounded in this soundbite: "${text}". Opening: dark environment, reference image rises from black with golden rim light. Typography: massive metallic-gold stat or headline animates in with a rapid counter-up or slam. Chart: neon-green element builds to the exact figure spoken. Accents: subtle particle field, lens flare streak, slow push-in camera. Closing: final frame holds at full brightness with subtle camera shake, then settles. 8 seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover`,
      styleTags: ['premium documentary', 'cinematic stat infographic', 'high contrast', 'metallic typography', 'chart-driven'],
      style: {
        referenceStyle: 'premium finance documentary stat infographic',
        palette: ['black', 'metallic gold', 'neon green', 'warm white'],
        typography: 'massive condensed uppercase with metallic texture and readable stat callouts',
        layout: 'hero stat centered, supporting label below, neon chart accents flanking',
        tone: 'cinematic, authoritative, high-contrast, finance-documentary',
        durationSeconds: 10
      }
    }
  }

  // MODE C — Typographic / Symbolic
  return {
    graphImagePrompt: `Premium cinematic typography title card grounded only in this spoken line: "${text}". Environment: dark documentary set-piece with motivated practical light (e.g. marble corridor, vault anteroom, or spotlighted stage) and subtle volumetric atmosphere. Typography: pull the strongest 4-8 exact words as the HERO line in massive 3D brushed-gold serif; one smaller supporting exact-quote line below in white condensed sans; optional tiny footer with the shortest exact phrase from the line. Materials: realistic metallic texture, rim light, soft shadow depth. Layout: clear hierarchy, readable at half-screen, 16:9 full-bleed. No invented facts, numbers, people, or claims.`,
    overlayTextImagePrompt: `High-end cinematic text card from the exact spoken line: "${text}". HERO (exact words, largest): strongest 4-8 word phrase in 3D brushed-gold uppercase serif. SUB (exact words, smaller): next most important phrase in white condensed type. ENVIRONMENT: near-black cinematic background with one motivated light source and subtle texture (marble, stone, or brushed metal). Optional symbolic graphic element only if clearly implied by the words (shield, framework, path). 16:9, full-bleed, legible at any crop. No invented wording.`,
    motionPromptFromImage: `Cinematic text animation grounded in this soundbite: "${text}". Opening: dark documentary environment. Typography: key phrase slams in with controlled kinetic energy and metallic gold treatment; accented by subtle floating particles, lens flare, and a slow environmental push-in. Closing: final frame holds the exact takeaway word or phrase. 8 seconds, single continuous take, photoreal, no dialogue, No additional text beyond the selected exact phrase. No captions, labels, subtitles, logos, or extra words. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover`,
    styleTags: ['premium documentary', 'cinematic text graphic', 'high contrast', 'metallic typography'],
    style: {
      referenceStyle: 'premium Netflix documentary title-card — Bloomberg Originals restraint, Apple keynote material quality',
      palette: ['black', 'metallic gold', 'teal', 'warm white'],
      typography: 'massive condensed uppercase headlines with metallic texture',
      layout: 'hero phrase centered, supporting label below, gold and teal accent lighting',
      tone: 'cinematic, high-status, dramatic, documentary',
      durationSeconds: 8
    }
  }
}

export function buildFallbackGroundedReview(params: {
  candidates: ExtractedClipCandidate[]
  directionText: string
  mode: StoryMode
  shotDurationSeconds?: number
}): GroundedReviewResult {
  const { candidates, directionText, mode, shotDurationSeconds } = params
  const tone = inferBrollTone(directionText)
  const sorted = [...candidates].sort((a, b) => {
    const scoreDiff = (b.heuristicScores.viralPriority ?? 0) - (a.heuristicScores.viralPriority ?? 0)
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff
    return b.heuristicComposite - a.heuristicComposite
  })
  const byId = new Map(sorted.map((candidate) => [candidate.id, candidate]))
  const rankedIds = sanitizeRankedIds(
    sorted.map((candidate) => candidate.id),
    byId,
    { minKeep: RANKED_SOUND_BITE_MIN, suppressSafeExplainer: true }
  ).slice(0, RANKED_SOUND_BITE_MAX)
  const viralIds = sanitizeRankedIds(
    sorted
      .filter((candidate) => (candidate.heuristicScores.viralPriority ?? 0) >= 0.6)
      .map((candidate) => candidate.id),
    byId,
    { suppressSafeExplainer: true }
  ).slice(0, VIRAL_LIST_MAX)
  const introIds = sanitizeRankedIds(
    sorted
      .filter(
        (candidate) =>
          candidate.clipType === 'HOOK' ||
          candidate.clipType === 'PAYOFF' ||
          (candidate.heuristicScores.scrollStopPotential ?? 0) >= 0.66
      )
      .map((candidate) => candidate.id),
    byId,
    { suppressSafeExplainer: true }
  ).slice(0, INTRO_LIST_MAX)
  const graphIds = sanitizeGraphIds(
    sorted
      .filter((candidate) => isStrongGraphCandidate(candidate))
      .map((candidate) => candidate.id),
    byId
  ).slice(0, GRAPH_LIST_MAX)
  const harmonized = harmonizeReviewIds({ rankedIds, viralIds, introIds, graphIds, byId })

  const unionIds = [...new Set([...harmonized.rankedIds, ...harmonized.viralIds, ...harmonized.introIds, ...harmonized.graphIds])].slice(0, 18)
  const sourceMin = candidates.reduce((min, c) => Math.min(min, c.start), Number.POSITIVE_INFINITY)
  const sourceMax = candidates.reduce((max, c) => Math.max(max, c.end), 0)
  const sourceSpan = Math.max(1, sourceMax - sourceMin)
  const roleById = new Map<string, GroundedReviewNarrativeRole>()
  const items: GroundedReviewItem[] = unionIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is ExtractedClipCandidate => Boolean(candidate))
    .map((candidate) => {
      const bundle = buildCinematicBrollPrompt({
        ideaSummary: candidate.text,
        mode,
        directionText,
        toneHint: tone,
        shotDurationSeconds
      })
      const rankedIndex = harmonized.rankedIds.indexOf(candidate.id)
      const { role, purpose } = assignNarrativeRoleAndPurpose(candidate, {
        arcIndex: rankedIndex >= 0 ? rankedIndex : unionIds.indexOf(candidate.id),
        arcTotal: unionIds.length,
        sourceFraction: (candidate.start - sourceMin) / sourceSpan,
        isGraph: harmonized.graphIds.includes(candidate.id)
      })
      roleById.set(candidate.id, role)
      return {
        candidateId: candidate.id,
        narrativeRole: role,
        purpose,
        overallScore: clampScore(candidate.heuristicComposite, 0.6),
        viralScore: clampScore(candidate.heuristicScores.viralPriority, 0.6),
        emotionalScore: clampScore(candidate.heuristicScores.emotionalIntensity, 0.25),
        introScore: clampScore(
          Math.max(candidate.heuristicScores.scrollStopPotential, candidate.heuristicScores.viralPriority),
          0.55
        ),
        graphScore: clampScore(
          Math.max(candidate.heuristicScores.dataAuthority ?? 0, /\d/.test(candidate.text) ? 0.58 : 0),
          0
        ),
        labels: fallbackLabels(candidate),
        rationale: `Heuristic fallback: ${candidate.clipType.toLowerCase()} with strong editorial score and source-backed timing.`,
        whyBullets: [
          'Grounded in a real transcript span with a clean standalone setup.',
          'Carries enough clarity and consequence to survive outside the full interview.',
          candidate.clipType === 'HOOK'
            ? 'Has immediate cold-open energy without needing extra context.'
            : 'Feels usable as a cut point, payoff, or supporting beat in an edit.'
        ],
        sectionReasons: {
          ...(harmonized.viralIds.includes(candidate.id)
            ? { viral: 'This line has the cleanest shareable punch among the available transcript moments.' }
            : {}),
          ...(harmonized.introIds.includes(candidate.id)
            ? { intro: 'This opens with enough tension or curiosity to earn the first few seconds.' }
            : {}),
          ...(harmonized.graphIds.includes(candidate.id)
            ? { graph: 'The spoken number or comparison is visual enough to justify a graphic beat.' }
            : {})
        },
        graphicsPackage: fallbackGraphicsPackage(candidate, fallbackGraphIdea(candidate)),
        brollIdeas: [
          {
            style: 'literal',
            prompt: bundle.literal,
            why: 'Literal coverage rooted in the spoken idea.'
          },
          {
            style: 'emotional',
            prompt: bundle.emotional,
            why: 'Human reaction version of the same beat.'
          },
          {
            style: 'symbolic',
            prompt: bundle.symbolic,
            why: 'Abstract metaphor that still supports the exact line.'
          }
        ],
        graphIdea: fallbackGraphIdea(candidate)
      }
    })

  const trailerArc = composeTrailerArc(harmonized.rankedIds, byId, roleById, items, [
    ...harmonized.viralIds,
    ...harmonized.introIds
  ], harmonized.graphIds)
  return { ...harmonized, trailerArc, items }
}

function buildPrompt(params: {
  candidates: ExtractedClipCandidate[]
  promptPack: PromptPackDefinition
  subjectProfile: SubjectProfile
  directionText: string
  mode: StoryMode
  shotDurationSeconds: number
}): string {
  const { candidates, promptPack, subjectProfile, directionText, mode, shotDurationSeconds } = params
  const payload = candidates.map((candidate) => ({
    id: candidate.id,
    start: candidate.start,
    end: candidate.end,
    duration: Math.round(candidate.duration * 100) / 100,
    clipType: candidate.clipType,
    text: candidate.text,
    sourceSegmentIds: candidate.sourceSegmentIds,
    heuristicComposite: Math.round(candidate.heuristicComposite * 1000) / 1000,
    heuristicScores: Object.fromEntries(
      Object.entries(candidate.heuristicScores).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 1000) / 1000 : value])
    )
  }))

  return [
    `PROJECT_MODE: ${mode}`,
    `AI_DIRECTION: ${directionText || '(none)'}`,
    `SHOT_DURATION_SECONDS: ${shotDurationSeconds}`,
    '',
    'You are reranking a grounded candidate pool that was already extracted from the transcript.',
    'You may ONLY reference candidate ids that appear in CANDIDATES_JSON.',
    'You may NOT invent quotes, paraphrase unseen lines, merge candidates, create new timestamps, or introduce facts not present in the spoken line.',
    'You are allowed to do editorial judgment only: decide which real lines are strongest, which are best for intros, which deserve graph support, and what B-roll directions would visualize them.',
    'Make the feedback feel like a professional VIDEO PRODUCTION PACKAGE for a YouTube intro/trailer: best sound bites ordered by narrative arc, graph/visual moment callouts, and cinematic B-roll prompts.',
    'Think like a trailer editor assembling a story arc: a cold open that sets the stakes, a transformation reveal, a teaser/curiosity gap, an emotional low point, a gut-punch line, a viral hook, a quotable reframe, tension setups, payoffs, and a mission-statement close.',
    'Prefer the kind of picks an editor would actually build around: concise truth-bomb lines, strong cold opens, emotional stakes, clear consequences, and visualizable stats.',
    'For viralIds and introIds, short self-contained lines beat long explanatory lines. If a quote needs too much setup, it should usually rank lower.',
    'Do not reward generic scene-setting, list housekeeping, filler phrases, or numerically dense explanation unless the line has undeniable payoff.',
    'Strongly demote audience-survey or option-poll questions (e.g. "Are you under 50K, over 50K, or over 100K?") — these are interactive prompts, not standalone bites.',
    'Strongly demote self-correcting or filler-laden lines (e.g. "...I would say around, oh yeah, around the clock care, right?"). Punchy, resolved statements always beat lines full of "I mean", "you know", "I would say", or repeated words.',
    'Strongly demote teleprompter / setup-pointer lines that point at a graphic instead of standing alone (e.g. "watch this", "and watch this", "hopefully we\'ll have this up on a screen", "we\'re talking about 25%"). A bite must make its point WITHOUT the on-screen visual it references.',
    'Strongly demote lines that begin with a restatement cue like "Rewind,", "Again,", "Like I said,", or "In other words,". Those are usually second-pass paraphrases, not the cleanest editorial version.',
    'For the COLD OPEN (the first beat of the trailer arc) and for introIds, strongly prefer a concrete personal moment — a vivid first-person scene, a specific turning point, or a shocking personal number (e.g. "they told me I had about $6 to my name") — over an abstract rule or maxim. Open on a PERSON and real stakes, not a thesis statement. Save the quotable rules/reframes for the gut-punch and payoff beats.',
    'If two lines restate the same idea back-to-back (especially when one starts with "Rewind", "Again", or "Like I said"), keep ONLY the single strongest version.',
    'Favor short declarative truth-bombs and concrete emotional story climaxes (a specific scene, a turning point, a one-line reframe) over long meandering explanations.',
    'If the same core idea appears multiple times in different phrasings, lengths, or restatements, keep only the single cleanest version.',
    '',
    packInstructionsCompact(promptPack),
    '',
    subjectInstructions(subjectProfile),
    '',
    `Quality bar for cinematic specificity: "${subjectQualityBar(subjectProfile, shotDurationSeconds)}"`,
    '',
    'CANDIDATES_JSON:',
    JSON.stringify(payload, null, 2),
    '',
    'TASKS:',
    `1. Return rankedIds: the best final ${RANKED_SOUND_BITE_MIN}-${RANKED_SOUND_BITE_MAX} candidates for the production package, ordered by narrative arc (cold open first, closer last), NOT by raw score.`,
    '2. Return viralIds: the strongest scroll-stopping lines.',
    '3. Return introIds: the strongest opening pulls / cold opens.',
    '4. Return graphIds: the candidates most worth supporting with a chart / stat / number graphic.',
    '5. Return trailerArc: a subset of rankedIds re-ordered as a real trailer would play — cold open first, mission-statement close last. This is narrative order, NOT score order.',
    '6. Return items ONLY for candidates that appear in any of those arrays.',
    '',
    'For each item:',
    '- candidateId must exactly match a candidate id from CANDIDATES_JSON.',
    '- scores must be 0..1.',
    '- labels should be short tags like viral, hook, payoff, emotional, data, motivational, intro.',
    '- narrativeRole must be exactly one of: cold-open, transformation, teaser, emotional-low, gut-punch, viral-hook, quotable-shift, tension-setup, payoff, mission-close, context. Pick the single role this line plays in a trailer arc.',
    '- purpose must be ONE tight production-note sentence in the TTAO style, e.g. "Cold open. Instant relatability, stakes established." or "Viral hook. Provocative, shareable, title-worthy." Describe the editorial FUNCTION, not the literal content.',
    '- rationale must explain why THIS exact quote is useful editorially in one tight sentence.',
    '- whyBullets should contain 2-3 short bullet fragments about what makes the line strong.',
    '- sectionReasons is optional, but if the candidate appears in viralIds, introIds, or graphIds, include the matching reason(s).',
    '- graphicsPackage is optional, but strongly preferred for usable moments. Provide graphImagePrompt, overlayTextImagePrompt, motionPromptFromImage, styleTags, and style when possible.',
    '- brollIdeas must contain up to 3 grounded shot ideas with styles literal/emotional/symbolic.',
    '- graphIdea is optional and should only be present when a visual stat / chart / number treatment is truly helpful.',
    '- Do NOT pick promotional CTAs, sponsor copy, URLs, book ads, or "go to this link" lines for rankedIds, viralIds, or introIds unless there are truly no stronger editorial moments.',
    '- Do NOT pick book-title copy, subtitle copy, cover copy, or repeated thesis restatements as separate winners.',
    '- Prefer distinct moments. If two candidates substantially overlap or are basically the same line in a short and long version, keep only the stronger one.',
    '- If a quote lands in viralIds, say why it is shareable. If it lands in introIds, say why it earns the opening seconds. If it lands in graphIds, say what visual transformation makes it pop.',
    '- Any graphicsPackage prompt must stay source-grounded: no invented numbers, names, or claims beyond the candidate text.',
    '',
    'GRAPHICS PACKAGE RULES:',
    '- Think of graphicsPackage as a premium visual package for high-end editorial graphics, not simple B-roll.',
    '- CRITICAL ROUTING: Determine which visual mode to use BEFORE writing any field:',
    '  MODE A — BIOGRAPHICAL EMPIRE MAP: Use when the soundbite names a real, identifiable person AND also mentions two or more companies, ventures, organizations, or career-defining entities associated with that person (e.g. "Elon built Tesla, SpaceX, and X" or "Jeff started Amazon, Blue Origin, and the Washington Post"). This is the premium mode — use it whenever the pattern fits.',
    '  MODE B — STAT / CHART / COMPARISON: Use when the soundbite contains a specific dollar figure, percentage, year span, numerical comparison, trend, or quantifiable claim but does NOT clearly fit MODE A.',
    '  MODE C — TYPOGRAPHIC / SYMBOLIC: Use when neither MODE A nor MODE B apply — the line is a quote, maxim, or abstract idea without a specific named person+company ecosystem or a specific number.',
    '',
    'MODE A — BIOGRAPHICAL EMPIRE MAP (person + companies/ventures):',
    '- graphImagePrompt must describe a CINEMATIC BIOGRAPHICAL EMPIRE INFOGRAPHIC with ALL of these elements: (1) A large, photorealistic portrait of the named person centered on the canvas — sharp eyes, slight cinematic rim light, no invented appearance beyond what the quote implies; (2) A deep-space or Earth-from-orbit backdrop — dark navy, stars, subtle atmospheric glow; (3) Interconnected circular company/venture nodes arranged in an orbital ring around the portrait — each node contains the exact company name from the soundbite, a glowing icon or logo silhouette, and a subtle circular ring border; (4) Holographic golden pathways connecting the portrait to each node, with soft energy-trail particles flowing along the lines; (5) A vertical TIMELINE panel on the left edge showing a minimalist chronological arc of key milestones mentioned or clearly implied by the quote — use only dates/events actually named; (6) An IMPACT STATS panel on the right edge with large metallic-gold numbers for any figures actually spoken in the quote; (7) Color palette: deep navy blue (#0A1628) base, electric orange (#FF6B00) and metallic gold (#C9A84C) accents, neon white highlights, subtle teal glow on node rings; (8) Bloomberg Businessweek / Antoine Fuqua premium documentary aesthetic, 16:9 horizontal composition, 4K photorealistic rendering. NO invented companies, dates, or figures beyond what is spoken.',
    '- overlayTextImagePrompt for MODE A: Pull the single most powerful exact phrase (6-10 words) from the quote as the main typographic hit — massive condensed white uppercase letters with subtle metallic sheen, positioned lower-third on a near-black cinema background. Below it, a smaller secondary line with the person\'s name (if named in the soundbite) in electric orange. Keep it bold, readable at half-screen size. No invented wording.',
    `- motionPromptFromImage for MODE A: Describe a cinematic 8-second orbital camera sequence: OPENING — camera holds on the central portrait; subject\'s eyes catch the light as the frame slowly breathes in. SEQUENCE — company nodes illuminate one by one in the exact order they are named in the soundbite: each node pulses with a ring of orange energy and the holographic pathway to the portrait ignites with flowing gold particles. ENVIRONMENT — the Earth rotates slowly in the background; faint satellite trails arc across the frame; the deep-space atmosphere subtly brightens as each node activates. CLOSING — camera pulls back just enough to reveal the full network simultaneously illuminated, all pathways glowing, particles streaming, final frame is the complete empire map at peak luminosity. End with "${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".`,
    '- style for MODE A: referenceStyle "cinematic biographical empire infographic — Bloomberg Businessweek meets Antoine Fuqua", palette ["deep navy #0A1628", "electric orange #FF6B00", "metallic gold #C9A84C", "neon white #F0F8FF", "teal node glow #00D4D4"], typography "large condensed uppercase portrait label + metallic node names + impact stat callouts", layout "portrait centered, nodes orbiting, timeline left, stats right, holographic connecting lines", tone "epic, authoritative, premium documentary, Bloomberg-grade", durationSeconds 8.',
    '',
    'MODE B — STAT / CHART / COMPARISON (dollar figure, percentage, trend, year span):',
    '- graphImagePrompt for MODE B: Create a premium cinematic stat infographic grounded ONLY in this spoken line. Build a dark documentary-style composition: (1) Massive metallic-gold headline number or percentage as the visual anchor — 3D beveled numerals with soft shadow; (2) A neon-green chart element (bar, counter, or comparison bars) showing only the data explicitly spoken; (3) Dark cinema environment with motivated rim light raking across a polished surface; (4) Short contextual label in warm white condensed type; (5) Subtle particle field and soft lens flare. DO NOT add numbers, comparisons, or entities not present in the spoken line.',
    '- overlayTextImagePrompt for MODE B: Extract the exact stat/figure from the quote as the primary typographic element — oversized metallic gold numerals. Support with the shortest explanatory phrase from the quote in condensed white uppercase. Dark near-black background, subtle green glow.',
    `- motionPromptFromImage for MODE B: 8-12 second premium finance/documentary motion graphic. Opening: dark environment, reference image slowly rising from black with golden rim light. Typography: massive metallic-gold number/percentage animates in with a rapid counter-up or slam effect. Chart: neon-green bars or counter builds to the exact figure spoken. Accents: subtle particle field, lens flare streak, slow push-in camera. Closing: final frame holds the stat at full brightness with a subtle camera shake, then settles. End with "${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".`,
    '- style for MODE B: referenceStyle "premium finance documentary stat infographic", palette ["black", "metallic gold", "neon green", "warm white"], typography "massive condensed uppercase with metallic texture and readable stat callouts", layout "hero stat centered, supporting label below, neon chart accents flanking", tone "cinematic, authoritative, high-contrast, finance-documentary", durationSeconds 10.',
    '',
    'MODE C — TYPOGRAPHIC / SYMBOLIC (no clear empire map, no specific number):',
    '- graphImagePrompt for MODE C: Premium cinematic typography still from the exact spoken line — dark environment with motivated practical light, 3D brushed-gold HERO exact phrase (4-8 words), smaller supporting exact-quote line, materials and hierarchy, 16:9 full-bleed photoreal polish. No invented facts, numbers, or people.',
    '- overlayTextImagePrompt for MODE C: Bold cinematic title card — spell out HERO exact phrase in massive 3D brushed-gold type, supporting exact-quote line smaller below, dark cinematic environment, readable at any crop.',
    `- motionPromptFromImage for MODE C: 8-10 second cinematic text animation from reference image. Typography slams in with controlled kinetic energy, accented by subtle particles and a slow environmental push-in. End with "${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, No additional text beyond the selected exact phrase. No captions, labels, subtitles, logos, or extra words. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".`,
    '',
    'UNIVERSAL GRAPHICS RULES:',
    '- Every graphImagePrompt, overlayTextImagePrompt, and motionPromptFromImage must stay source-grounded: no invented numbers, names, companies, dates, or claims beyond what is in the candidate text.',
    '- If the candidate names a real person or company, use that exact name. If it does not, do not invent one.',
    '- style.referenceStyle should name the visual family (example: "cinematic biographical empire infographic" or "premium finance documentary stat infographic").',
    '- style.palette should be 3-6 concrete colors. style.typography, style.layout, and style.tone should be short production cues. style.durationSeconds should reflect the motion duration.',
    '',
    'GRAPHICS PACKAGE FEW-SHOT EXAMPLES (adapt nouns to the actual soundbite, do not copy these literally):',
    '- MODE A EXAMPLE — soundbite: "He built Tesla, SpaceX, and then turned Twitter into X, all in the same decade." → graphImagePrompt: "Cinematic biographical empire infographic: large photorealistic portrait of Elon Musk centered, deep navy Earth-from-orbit backdrop with star field, four interconnected circular nodes in orbital ring — Tesla (red lightning bolt), SpaceX (rocket silhouette), Twitter bird icon transitioning to X logo, each connected to portrait by holographic gold pathways with flowing energy particles; left edge: minimalist timeline showing decade arc; right edge: impact stat panel \'4 companies | 1 decade\' in metallic gold; palette deep navy, electric orange, metallic gold, neon white; Bloomberg Businessweek meets Antoine Fuqua premium documentary, 16:9, 4K photorealistic, no invented entities." motionPromptFromImage: "Camera opens tight on Musk portrait as rim light ignites; Tesla node pulses orange and gold pathway fires; SpaceX node activates next; Twitter/X node illuminates with the X letterform morphing from the bird; final pull-back reveals full four-node network simultaneously glowing; Earth rotates slowly behind; particle streams flow continuously; 8 seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover."',
    '- MODE B EXAMPLE — soundbite: "We went from $0 to $4 billion in revenue in under five years." → graphImagePrompt: "Premium cinematic stat infographic, dark documentary environment: oversized 3D beveled metallic-gold \'$4B\' anchored center-frame, neon green bar chart below showing $0 to $4B growth over five annual bars, warm white condensed label \'5-Year Revenue Arc\', realistic polished surface with rim light raking across, subtle particle field, soft lens flare. Only the data spoken in the line — no invented figures." motionPromptFromImage: "Dark opening, reference image rises from black with golden rim light; \'$0\' slams in metallic gold then counter-surges up to \'$4B\' with green bar building simultaneously; final frame holds \'$4B\' at full brightness with subtle shake; 10 seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover."',
    '',
    'B-ROLL RULES:',
    '- Every B-roll idea must stay grounded in the exact spoken line. The selected soundbite is the source of truth; do not invent extra story facts, people, places, companies, numbers, or outcomes.',
    '- Return THREE brollIdeas per candidate, ordered by editorial strength: the strongest idea first, then two real alternates. When possible, diversify across literal / emotional / symbolic instead of repeating one visual logic three times.',
    '- FIRST QUESTION before writing any B-roll: Does this line describe a personal memory, sacrifice, family tension, first-generation struggle, or a specific real job or domestic moment? If yes, write a plausible real-world scene implied by those exact words — a car dealership lot at closing, a kitchen table with handwritten bills under a single lamp, a church parking lot conversation, a family member across the dinner table — rather than an abstract financial symbol. The specific prop named or strongly implied by the spoken words must appear in the stillImagePrompt.',
    '- If the line is about a relationship tension (family vs. finances, personal vs. community, insider vs. outsider) — show a human scene with two people, or the physical domestic or community environment where that tension lives.',
    '- Use concrete nouns from the transcript, but do NOT default to surface-level noun illustration when the line is really about a mechanism, constraint, or invisible system.',
    '- If the line explains valuation opacity, private holdings, liquidity, qualification barriers, confusion, market structure, or other abstract stakes, at least one of the three ideas should be a restrained real-world metaphor that makes that mechanism legible.',
    '- Generic finance/business shorthand is forbidden unless the quote is explicitly about a screen or terminal: no default brokerage laptop, no random ticker wall, no person typing at a desk, no empty trading floor unless the line is literally about trading, no bank vault unless the line mentions a vault, no control-room screens as the main concept.',
    '- B-roll should feel premium and cinematic: Antoine Fuqua-inspired realism / premium financial documentary when the genre fits — high-end production design, motivated practical light, atmosphere, texture, precise props. Keep metaphors restrained and documentary-plausible, not fantasy VFX or over-art-directed concept art.',
    '- Do not write a talking-head shot of the speaker explaining to camera.',
    '- For EACH brollIdea provide THREE fields:',
    '  • stillImagePrompt — the static opening frame ONLY: subject, environment, visible prop, motivated practical light, composition/framing (e.g. doorway frame, over-shoulder, wide master), lens and depth-of-field feel, color-grade note. NO camera move language. Name a 35mm or 50mm lens and shallow depth of field when people are present. No legible news chyrons or readable headlines unless the quote explicitly requires them — screens show blurred abstract footage; documents may appear as soft-text props.',
    '  • motionPrompt — I2V motion FROM that still: micro-action, camera move, environmental motion, ending with duration suffix and diegetic ambient SFX only (no music, no narrator, no broadcast news audio, no scripted dialogue).',
    '  • prompt — one unified director-ready paragraph combining both (legacy alias; still + motion must agree).',
    '- When the subject/genre supports it, anchor the look with a director/cinematographer reference (e.g. "Antoine Fuqua-inspired realism", "Roger Deakins-style motivated light") — but never invent story facts.',
    `- motionPrompt MUST end with "${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".`,
    '',
    'B-ROLL FEW-SHOT EXAMPLES (financial documentary style — adapt nouns to the actual line):',
    '- Line about personal sacrifice ("I was selling cars at the time, grinding, cutting back"): strongest idea is emotional — car dealership lot at night, a lone salesperson at a cluttered desk past closing, fluorescent light, inventory sheet and half-eaten meal beside a phone showing a low bank balance. NOT a trading floor or brokerage laptop.',
    '- Line about first-generation wealth ("$1,000 in the bank, nobody in your family has ever built real wealth"): strongest idea is emotional — worn kitchen table at night, single hanging lamp, handwritten budget on a legal pad, bank envelope with a small fold of bills, a mug of coffee. The kitchen table IS the story. NOT a vault or glass elevator lobby.',
    '- Line about SpaceX IPO: literal idea can show a real launch pad; alternate symbolic idea can show Earth from orbit wrapped in illuminated satellite belts rather than another trading screen.',
    '- Line about private holdings distorting ETF returns: strongest idea may be symbolic — a corridor of transparent and frosted asset cases, some holdings visible and some glowing behind obscured glass, so the opacity itself becomes the visual.',
    '- Line about qualified-investor barriers: strongest idea may be a private-club entrance with a doorman and clipboard, heavy brass door ajar with warm light spilling through — not another desk-and-laptop setup.',
    '- Line about illiquidity: strongest idea may be physical flow contrast — one channel moving freely, another dense and resistant — as a restrained metaphor for harder-to-liquidate assets.',
    '',
    'GRAPH RULES (treat these like the TTAO "Graph & Visual Moment Callouts"):',
    '- Only suggest graphIdea when the line contains a number, comparison, percentile, trend, or other clearly visualizable claim.',
    '- chartType must be one of: bar, line, counter, comparison, text.',
    '- title should be a short on-screen VISUAL TITLE grounded in the exact line, not a made-up slogan.',
    '- dataText must list ONLY the exact figures/claims spoken in the line (the TEXT / DATA to render). Never add numbers not present in the quote.',
    '- visualTreatment must describe how the graphic looks and animates on screen (the VISUAL TREATMENT): chart type, build/reveal, palette accents, and the moment it lands. Keep it cinematic and specific.',
    '',
    'OUTPUT ONLY VALID JSON WITH THIS SHAPE:',
    JSON.stringify(
      {
        rankedIds: ['candidate-id'],
        viralIds: ['candidate-id'],
        introIds: ['candidate-id'],
        graphIds: ['candidate-id'],
        trailerArc: ['cold-open-id', 'transformation-id', 'gut-punch-id', 'mission-close-id'],
        items: [
          {
            candidateId: 'candidate-id',
            narrativeRole: 'cold-open',
            purpose: 'Cold open. Instant relatability, stakes established.',
            overallScore: 0.92,
            viralScore: 0.95,
            emotionalScore: 0.48,
            introScore: 0.9,
            graphScore: 0.18,
            labels: ['viral', 'hook', 'intro'],
            rationale: 'One short editorial explanation.',
            whyBullets: ['Short standalone strength.', 'Why the line hooks fast.'],
            sectionReasons: {
              viral: 'Why this is shareable.',
              intro: 'Why this earns the opening seconds.'
            },
            graphicsPackage: {
              graphImagePrompt: 'Prompt for a static graph/stat image.',
              overlayTextImagePrompt: 'Prompt for an overlay text image style card.',
              motionPromptFromImage: 'Prompt to animate a selected image into motion graphics.',
              styleTags: ['premium documentary', 'metallic typography'],
              style: {
                referenceStyle: 'premium finance documentary infographic',
                palette: ['black', 'metallic gold', 'neon green', 'warm white'],
                typography: 'large condensed uppercase type with metallic texture',
                layout: 'hero subject left, chart/stat panel right, final takeaway bottom',
                tone: 'cinematic, authoritative, high contrast',
                durationSeconds: 10
              }
            },
            brollIdeas: [
              {
                style: 'symbolic',
                stillImagePrompt:
                  'A restrained real-world metaphor grounded in the line — environment, prop, motivated practical light, no camera move.',
                motionPrompt: `I2V motion from that still — the mechanism or stakes become legible through one controlled camera move and one physical micro-action, ending with ${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text, no music.`,
                prompt:
                  'One dense cinematic paragraph using a documentary-plausible metaphor to explain the line, with setting, prop, action, light, lens, move, and duration.',
                why: 'Why this metaphor is stronger than a more obvious literal shot.'
              },
              {
                style: 'emotional',
                stillImagePrompt:
                  'A human-scale opening frame grounded in the line — subject, environment, visible prop, motivated practical light, no camera move.',
                motionPrompt: `I2V motion from that still — body language and a small emotional micro-arc carry the meaning, ending with ${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text, no music.`,
                prompt:
                  'One dense cinematic paragraph where posture, gesture, and environment make the stakes felt without a talking head, with prop, light, lens, move, and duration.',
                why: 'Why the emotional version gives the audience a stronger feeling-based read of the line.'
              },
              {
                style: 'literal',
                stillImagePrompt:
                  'A concrete documentary opening frame grounded in the line — real subject, place, prop, motivated light, no camera move.',
                motionPrompt: `I2V motion from that still — precise environmental motion and one controlled camera move, ending with ${shotDurationSeconds} seconds, single continuous take, photoreal, no dialogue, no on-screen text, no music.`,
                prompt:
                  'One dense cinematic paragraph showing the literal subject matter with premium documentary realism, including subject, place, prop, action, light, lens, move, and duration.',
                why: 'Why the literal coverage is still editorially useful as one alternate.'
              }
            ],
            graphIdea: {
              chartType: 'counter',
              title: 'Short grounded heading',
              why: 'Why a stat visual helps.',
              dataText: 'Only the exact figures spoken in the line.',
              visualTreatment: 'How the chart builds and lands on screen.'
            }
          }
        ]
      },
      null,
      2
    )
  ].join('\n')
}

function goalBriefFromDirection(directionText: string, mode: StoryMode): string {
  const raw = directionText.trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('viral moments')) {
    return 'Prioritize the most shareable, scroll-stopping, provocative, high-clarity lines. Favor punchy hooks, surprising reframes, mic-drop quotes, and lines with thumbnail/title potential.'
  }
  if (lower.startsWith('topic-based clips')) {
    const topic = raw.includes(':') ? raw.split(':').slice(1).join(':').trim() : ''
    return topic
      ? `Prioritize clips directly about this topic: "${topic}". Favor the clearest, most self-contained, most useful lines that speak to that subject.`
      : 'Prioritize clips tied to the chosen topic. Favor clear, self-contained, explainer-friendly lines that stay tightly on subject.'
  }
  if (lower.startsWith('emotional moments')) {
    return 'Prioritize emotional stakes, vulnerability, pain, relief, conviction, tension, and lines that make the audience feel something immediately.'
  }
  if (lower.startsWith('motivational moments')) {
    return 'Prioritize action-driving, encouraging, belief-shifting, and challenge-based lines that feel quotable, energizing, and useful for transformation content.'
  }
  if (lower.startsWith('cinematic intro / story')) {
    return 'Prioritize lines an editor could build a story trailer around: cold open, tension, thesis, emotional stakes, gut-punch, payoff, and mission-statement close. Favor early hooks and strong narrative turns. Thesis lines, gut punches, quotable definitions, and emotional backstory should outrank utility/process/context beats. Keep instructional or narrow finance-stat lines as support, not as the dominant winners, unless they are extraordinary.'
  }
  if (mode === 'creator') {
    return 'Prioritize hooky, shareable, short-form friendly moments with strong retention value.'
  }
  return 'Prioritize the strongest standalone sound bites for editing: clear hooks, strong quotes, emotional stakes, sharp reframes, and memorable payoff lines.'
}

function buildTranscriptDrivenPrompt(params: {
  segments: Array<{ id: string; start: number; end: number; text: string; speaker_label?: string | null }>
  promptPack: PromptPackDefinition
  subjectProfile: SubjectProfile
  directionText: string
  mode: StoryMode
  shotDurationSeconds: number
  targetCount: number
}): string {
  const { segments, promptPack, subjectProfile, directionText, mode, shotDurationSeconds, targetCount } = params
  const goalBrief = goalBriefFromDirection(directionText, mode)
  const payload = segments.map((segment, index) => ({
    segmentKey: `SEG${String(index + 1).padStart(4, '0')}`,
    start: Math.round(segment.start * 100) / 100,
    end: Math.round(segment.end * 100) / 100,
    text: segment.text,
    speaker_label: segment.speaker_label ?? null
  }))

  return [
    `PROJECT_MODE: ${mode}`,
    `AI_DIRECTION: ${directionText || '(none)'}`,
    `TARGET_SOUND_BITE_COUNT: ${targetCount}`,
    `SHOT_DURATION_SECONDS: ${shotDurationSeconds}`,
    '',
    'You are Storyteller\'s senior transcript editor.',
    'Read the FULL transcript and pick the exact sound bites a user would expect from the selected goal.',
    'Think like the best version of ChatGPT doing editorial selection for a video editor, but stay 100% grounded in the transcript.',
    goalBrief,
    '',
    'CRITICAL RULES:',
    '- Choose directly from the transcript segments in SEGMENTS_JSON.',
    '- You may only select CONTIGUOUS segment ranges using the provided segmentKey values.',
    '- Do not paraphrase, summarize, merge disconnected moments, or invent wording.',
    '- Prefer lines that can stand alone and still feel powerful.',
    '- Avoid promo copy, URL/book/app/sales copy, housekeeping, filler, self-corrections, weak fragments, and late devotional/prayer lines unless they are undeniably the strongest editorial picks.',
    '- For cold opens and intros, prefer early hooks or vivid early personal stakes over late reflective/prayer language.',
    `- Return around ${targetCount} ranked sound bites so the editor has a deeper pool for longer intros and story assemblies.`,
    '- Favor the same kind of winners a strong human editor or ChatGPT-style editorial pass would surface: thesis-defining quotes, urgency, fear/FOMO, strong reframes, emotional cost, clear definitions, mic-drop lines, and memorable payoff.',
    '',
    packInstructionsCompact(promptPack),
    '',
    subjectInstructions(subjectProfile),
    '',
    `Quality bar for cinematic specificity: "${subjectQualityBar(subjectProfile, shotDurationSeconds)}"`,
    '',
    'TASKS:',
    `1. Return selections: about ${targetCount} exact transcript-backed sound bites. Each selection must identify a contiguous transcript span using startSegmentKey and endSegmentKey.`,
    `2. Return rankedIds: the best final ${Math.max(10, targetCount - 3)}-${targetCount} sound bites ordered by editorial strength / story usefulness.`,
    '3. Return viralIds: the most scroll-stopping, shareable, title-worthy lines.',
    '4. Return introIds: the best opening pulls / cold-open lines.',
    '5. Return graphIds: the lines most worth supporting with a chart, stat, or motion graphic.',
    '6. Return trailerArc: the strongest subset of rankedIds reordered as a real trailer/story arc.',
    '7. Return items for every candidateId referenced in any of those arrays.',
    '',
    'For selections:',
    '- candidateId must be unique.',
    '- startSegmentKey and endSegmentKey must exactly match segmentKey values from SEGMENTS_JSON.',
    '- Keep clips reasonably tight: prefer the shortest self-contained range that preserves the power of the line.',
    '',
    'For items:',
    '- Reuse candidateId values from selections.',
    '- scores must be 0..1.',
    '- labels should be short tags like viral, hook, payoff, emotional, data, motivational, intro.',
    '- narrativeRole must be one of: cold-open, transformation, teaser, emotional-low, gut-punch, viral-hook, quotable-shift, tension-setup, payoff, mission-close, context.',
    '- purpose should be one short production note sentence.',
    '- rationale should explain why this exact quote is editorially useful.',
    '- whyBullets should be 2-3 short fragments.',
    '- graphicsPackage and graphIdea should only be used when truly justified by the selected line.',
    '- When writing graphicsPackage, apply the same three-mode routing as in GRAPHICS PACKAGE RULES:',
    '  MODE A (person + companies/ventures) → biographical empire map with portrait, orbital company nodes, holographic pathways, timeline, stats panel, deep navy + electric orange + metallic gold palette.',
    '  MODE B (specific number/stat/comparison) → cinematic stat infographic with oversized metallic-gold numerals and neon-green chart element.',
    '  MODE C (quote/maxim/abstract) → premium typographic/symbolic treatment.',
    '- motionPromptFromImage must always end with the standard suffix: "8 seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".',
    '- Never invent companies, people, numbers, or dates not spoken in the selected line.',
    '',
    'SEGMENTS_JSON:',
    JSON.stringify(payload, null, 2),
    '',
    'OUTPUT ONLY VALID JSON WITH THIS SHAPE:',
    JSON.stringify(
      {
        selections: [
          {
            candidateId: 'cand_01',
            startSegmentKey: 'SEG0001',
            endSegmentKey: 'SEG0003'
          }
        ],
        rankedIds: ['cand_01'],
        viralIds: ['cand_01'],
        introIds: ['cand_01'],
        graphIds: ['cand_01'],
        trailerArc: ['cand_01'],
        items: [
          {
            candidateId: 'cand_01',
            narrativeRole: 'cold-open',
            purpose: 'Cold open. Immediate stakes and curiosity.',
            overallScore: 0.93,
            viralScore: 0.92,
            emotionalScore: 0.44,
            introScore: 0.94,
            graphScore: 0.12,
            labels: ['viral', 'hook', 'intro'],
            rationale: 'Short explanation.',
            whyBullets: ['Standalone and sharp.', 'Hooks quickly.'],
            sectionReasons: {
              viral: 'Why this is shareable.',
              intro: 'Why this earns the opening seconds.'
            },
            graphicsPackage: {
              graphImagePrompt: 'Prompt for a static graph/stat image.',
              overlayTextImagePrompt: 'Prompt for an overlay text image style card.',
              motionPromptFromImage: 'Prompt to animate a selected image into motion graphics.',
              styleTags: ['premium documentary'],
              style: {
                referenceStyle: 'premium finance documentary infographic',
                palette: ['black', 'metallic gold', 'neon green', 'warm white'],
                typography: 'large condensed uppercase type with metallic texture',
                layout: 'hero subject left, chart/stat panel right, final takeaway bottom',
                tone: 'cinematic, authoritative, high contrast',
                durationSeconds: 10
              }
            },
            brollIdeas: [
              {
                style: 'literal',
                stillImagePrompt: 'Static opening frame — subject, place, prop, light, no camera move.',
                motionPrompt: 'I2V motion from that still with duration suffix.',
                prompt: 'One dense cinematic paragraph grounded in the line.',
                why: 'Why this shot fits.'
              }
            ],
            graphIdea: {
              chartType: 'counter',
              title: 'Short grounded heading',
              why: 'Why a stat visual helps.',
              dataText: 'Only the exact figures spoken in the line.',
              visualTreatment: 'How the chart builds and lands on screen.'
            }
          }
        ]
      },
      null,
      2
    )
  ].join('\n')
}

function buildTranscriptDrivenCandidatesFromRaw(
  raw: string,
  segments: Array<{ id: string; start: number; end: number; text: string; speaker_label?: string | null }>,
  mode: StoryMode
): ExtractedClipCandidate[] {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const selections = Array.isArray(parsed.selections) ? parsed.selections : []
  const ordered = [...segments].sort((a, b) => a.start - b.start)
  const keyed = ordered.map((segment, index) => ({
    ...segment,
    segmentKey: `SEG${String(index + 1).padStart(4, '0')}`
  }))
  const indexByKey = new Map(keyed.map((segment, index) => [segment.segmentKey, index]))
  const itemById = new Map(
    (Array.isArray(parsed.items) ? parsed.items : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => [String(item.candidateId ?? ''), item])
  )
  const stitchedPool = extractSmartStitchedClips(
    keyed.map((segment) => ({
      id: segment.id,
      start_time: segment.start,
      end_time: segment.end,
      text: segment.text,
      speaker_label: segment.speaker_label ?? null
    }))
  )
  const stitchedMeta = stitchedPool
    .map((clip) => {
      const clipStartIdx = clip.sourceSegmentIds.length > 0 ? ordered.findIndex((segment) => segment.id === clip.sourceSegmentIds[0]) : -1
      const clipEndIdx =
        clip.sourceSegmentIds.length > 0
          ? ordered.findIndex((segment) => segment.id === clip.sourceSegmentIds[clip.sourceSegmentIds.length - 1])
          : -1
      if (clipStartIdx < 0 || clipEndIdx < 0) return null
      const clipType = classifyClip(clip.text)
      const scored = scoreClipEditorially(
        {
          ...clip,
          clipType
        },
        mode
      )
      return {
        clip,
        clipType,
        clipStartIdx,
        clipEndIdx,
        scores: scored.scores,
        rejected: scored.rejected
      }
    })
    .filter(
      (
        row
      ): row is {
        clip: (typeof stitchedPool)[number]
        clipType: ReturnType<typeof classifyClip>
        clipStartIdx: number
        clipEndIdx: number
        scores: ReturnType<typeof scoreClipEditorially>['scores']
        rejected: boolean
      } => Boolean(row)
    )
  const out: ExtractedClipCandidate[] = []
  const seen = new Set<string>()

  for (const row of selections) {
    if (!row || typeof row !== 'object') continue
    const selection = row as Record<string, unknown>
    const startSegmentKey = typeof selection.startSegmentKey === 'string' ? selection.startSegmentKey : ''
    const endSegmentKey = typeof selection.endSegmentKey === 'string' ? selection.endSegmentKey : ''
    const startIdx = indexByKey.get(startSegmentKey)
    const endIdx = indexByKey.get(endSegmentKey)
    if (startIdx == null || endIdx == null || endIdx < startIdx) continue
    const rawSlice = keyed.slice(startIdx, endIdx + 1)
    const snapped =
      stitchedMeta
        .filter((row) => row.clipEndIdx >= startIdx && row.clipStartIdx <= endIdx && !row.rejected)
        .sort((a, b) => {
          const aContains = a.clipStartIdx <= startIdx && a.clipEndIdx >= endIdx ? 1 : 0
          const bContains = b.clipStartIdx <= startIdx && b.clipEndIdx >= endIdx ? 1 : 0
          if (aContains !== bContains) return bContains - aContains
          const aOverlap = Math.min(a.clipEndIdx, endIdx) - Math.max(a.clipStartIdx, startIdx) + 1
          const bOverlap = Math.min(b.clipEndIdx, endIdx) - Math.max(b.clipStartIdx, startIdx) + 1
          if (aOverlap !== bOverlap) return bOverlap - aOverlap
          const aCenter = (a.clip.start + a.clip.end) / 2
          const bCenter = (b.clip.start + b.clip.end) / 2
          const rawCenter = (rawSlice[0]!.start + rawSlice[rawSlice.length - 1]!.end) / 2
          const aCenterDistance = Math.abs(aCenter - rawCenter)
          const bCenterDistance = Math.abs(bCenter - rawCenter)
          if (Math.abs(aCenterDistance - bCenterDistance) > 0.05) return aCenterDistance - bCenterDistance
          const aPriority = (a.scores.viralPriority ?? 0) + (a.scores.quotability ?? 0) + (a.scores.consequence ?? 0)
          const bPriority = (b.scores.viralPriority ?? 0) + (b.scores.quotability ?? 0) + (b.scores.consequence ?? 0)
          if (Math.abs(aPriority - bPriority) > 1e-6) return bPriority - aPriority
          return a.clip.duration - b.clip.duration
        })[0] ?? null
    const slice = snapped
      ? keyed.filter((segment, index) => index >= snapped.clipStartIdx && index <= snapped.clipEndIdx)
      : rawSlice
    if (slice.length === 0) continue
    const text = snapped
      ? snapped.clip.text
      : slice.map((segment) => segment.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const candidateId =
      typeof selection.candidateId === 'string' && selection.candidateId.trim()
        ? selection.candidateId.trim()
        : `cand_${startSegmentKey}_${endSegmentKey}`
    const key = `${slice[0]!.id}:${slice[slice.length - 1]!.id}:${text}`
    if (seen.has(key)) continue
    seen.add(key)
    const start = snapped ? snapped.clip.start : slice[0]!.start
    const end = snapped ? snapped.clip.end : slice[slice.length - 1]!.end
    const duration = Math.max(0, end - start)
    const completenessScore = snapped ? snapped.clip.completenessScore : Math.max(0.72, scoreCompleteness(text))
    const clipType = snapped ? snapped.clipType : classifyClip(text)
    const scored = snapped
      ? {
          scores: snapped.scores,
          rejected: false
        }
      : scoreClipEditorially(
          {
            id: candidateId,
            text,
            start,
            end,
            duration,
            completenessScore,
            sourceSegmentIds: slice.map((segment) => segment.id),
            clipType
          },
          mode
        )
    if (scored.rejected) continue
    const item = itemById.get(candidateId)
    const overallScore = typeof item?.overallScore === 'number' ? item.overallScore : undefined
    out.push({
      id: candidateId,
      text,
      start,
      end,
      duration,
      completenessScore,
      sourceSegmentIds: slice.map((segment) => segment.id),
      clipType,
      heuristicComposite: clampScore(overallScore, scored.scores.viralPriority),
      heuristicWithinTypeRank: 0,
      heuristicScores: { ...scored.scores }
    })
  }

  return out
}

function normalizeTranscriptDrivenReview(
  raw: string,
  segments: Array<{ id: string; start: number; end: number; text: string; speaker_label?: string | null }>,
  mode: StoryMode,
  targetCount = 15
): { review: GroundedReviewResult; candidates: ExtractedClipCandidate[] } {
  const transcriptCandidates = injectMustKeepBookendCandidates(
    buildTranscriptDrivenCandidatesFromRaw(raw, segments, mode),
    segments,
    mode
  )
  if (!transcriptCandidates.length) {
    throw new Error('No valid transcript-driven selections were returned.')
  }
  const base = normalizeGroundedReview(raw, transcriptCandidates)
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const byId = new Map(transcriptCandidates.map((candidate) => [candidate.id, candidate]))
  const validIds = new Set(byId.keys())
  const rankedMin = Math.min(Math.max(10, targetCount - 3), targetCount)

  let rankedIds = fillRankedIdsToMinimum(
    ensureEliteTruthBombIds(
      ensureMustKeepQuoteIds(
        ensureConcreteColdOpenIds(
          dedupeOverlappingIds(
            sanitizeRankedIds(pickIds(parsed.rankedIds, validIds, targetCount), byId, {
              minKeep: rankedMin,
              suppressSafeExplainer: true
            }),
            byId,
            rankedMin
          ).slice(0, targetCount),
          byId,
          targetCount
        ),
        byId,
        targetCount
      ),
      byId,
      targetCount
    ),
    byId,
    rankedMin,
    targetCount
  )

  const viralIds = ensureMustKeepMissionCloseIds(
    ensureMustKeepQuoteIds(
      removeRepeatedIdeasAgainst(
        sanitizeRankedIds(pickIds(parsed.viralIds, validIds, VIRAL_LIST_MAX), byId, {
          suppressSafeExplainer: true
        }),
        byId,
        rankedIds
      ).slice(0, VIRAL_LIST_MAX),
      byId,
      VIRAL_LIST_MAX
    ),
    byId,
    VIRAL_LIST_MAX
  )

  const introIds = ensureConcreteColdOpenIds(
    removeRepeatedIdeasAgainst(
      sanitizeRankedIds(pickIds(parsed.introIds, validIds, INTRO_LIST_MAX), byId, {
        suppressSafeExplainer: true
      }).filter((id) => {
        const candidate = byId.get(id)
        return candidate ? isAcceptableIntroCandidate(candidate, sourceFractionForCandidate(candidate, byId)) : false
      }),
      byId,
      [...rankedIds, ...viralIds]
    ).slice(0, INTRO_LIST_MAX),
    byId,
    INTRO_LIST_MAX
  )

  const graphIds = sanitizeGraphIds(
    removeRepeatedIdeasAgainst(pickIds(parsed.graphIds, validIds, GRAPH_LIST_MAX), byId, [...rankedIds, ...viralIds, ...introIds]),
    byId
  ).slice(0, GRAPH_LIST_MAX)

  const roleById = new Map(
    base.items
      .filter((item) => typeof item.candidateId === 'string')
      .map((item) => [item.candidateId, item.narrativeRole ?? 'context'] as const)
  )
  rankedIds = orderRankedIdsForNarrativePackage(rankedIds, byId, roleById)
  return {
    candidates: transcriptCandidates,
    review: {
      rankedIds,
      viralIds,
      introIds,
      graphIds,
      trailerArc: composeTrailerArc(rankedIds, byId, roleById, base.items, [...viralIds, ...introIds], graphIds),
      items: base.items
    }
  }
}

function normalizeGroundedReview(
  raw: string,
  candidates: ExtractedClipCandidate[],
  context?: { mode?: StoryMode; directionText?: string; shotDurationSeconds?: number }
): GroundedReviewResult {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const validIds = new Set(byId.keys())

  const harmonized = harmonizeReviewIds({
    rankedIds: sanitizeRankedIds(
      pickIds(parsed.rankedIds, validIds, RANKED_SOUND_BITE_MAX),
      byId,
      { minKeep: RANKED_SOUND_BITE_MIN, suppressSafeExplainer: true }
    ).slice(0, RANKED_SOUND_BITE_MAX),
    viralIds: sanitizeRankedIds(
      pickIds(parsed.viralIds, validIds, VIRAL_LIST_MAX),
      byId,
      { suppressSafeExplainer: true }
    ).slice(0, VIRAL_LIST_MAX),
    introIds: sanitizeRankedIds(
      pickIds(parsed.introIds, validIds, INTRO_LIST_MAX),
      byId,
      { suppressSafeExplainer: true }
    ).slice(0, INTRO_LIST_MAX),
    graphIds: sanitizeGraphIds(pickIds(parsed.graphIds, validIds, GRAPH_LIST_MAX), byId).slice(0, GRAPH_LIST_MAX),
    byId
  })

  const sourceMin = candidates.reduce((min, c) => Math.min(min, c.start), Number.POSITIVE_INFINITY)
  const sourceMax = candidates.reduce((max, c) => Math.max(max, c.end), 0)
  const sourceSpan = Math.max(1, sourceMax - sourceMin)
  const roleById = new Map<string, GroundedReviewNarrativeRole>()
  const fallbackRoleFor = (id: string): GroundedReviewNarrativeRole => {
    const candidate = byId.get(id)
    if (!candidate) return 'context'
    const rankedIndex = harmonized.rankedIds.indexOf(id)
    return assignNarrativeRoleAndPurpose(candidate, {
      arcIndex: rankedIndex >= 0 ? rankedIndex : harmonized.rankedIds.length,
      arcTotal: harmonized.rankedIds.length,
      sourceFraction: (candidate.start - sourceMin) / sourceSpan,
      isGraph: harmonized.graphIds.includes(id)
    }).role
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  const items: GroundedReviewItem[] = []

  for (const row of rawItems) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const candidateId = typeof item.candidateId === 'string' ? item.candidateId : ''
    if (!validIds.has(candidateId)) continue
    const candidate = byId.get(candidateId)
    if (!candidate) continue
    const rankedIndex = harmonized.rankedIds.indexOf(candidateId)
    const fallbackAssignment = assignNarrativeRoleAndPurpose(candidate, {
      arcIndex: rankedIndex >= 0 ? rankedIndex : harmonized.rankedIds.length,
      arcTotal: harmonized.rankedIds.length,
      sourceFraction: (candidate.start - sourceMin) / sourceSpan,
      isGraph: harmonized.graphIds.includes(candidateId)
    })
    const parsedRole = normalizeNarrativeRole(item.narrativeRole)
    const narrativeRole: GroundedReviewNarrativeRole =
      acceptModelNarrativeRole(parsedRole, candidate, {
        isGraph: harmonized.graphIds.includes(candidateId),
        sourceFraction: (candidate.start - sourceMin) / sourceSpan
      }) && parsedRole
        ? parsedRole
        : fallbackAssignment.role
    const modelPurpose = typeof item.purpose === 'string' && item.purpose.trim() ? item.purpose.trim() : undefined
    roleById.set(candidateId, narrativeRole)
    items.push({
      candidateId,
      narrativeRole,
      purpose: purposeMatchesRole(modelPurpose, narrativeRole)
        ? modelPurpose
        : PURPOSE_PREFIX_BY_ROLE[narrativeRole] === PURPOSE_PREFIX_BY_ROLE[fallbackAssignment.role]
          ? fallbackAssignment.purpose
          : PURPOSE_PREFIX_BY_ROLE[narrativeRole],
      overallScore: clampScore(item.overallScore, 0.7),
      viralScore: clampScore(item.viralScore, 0.6),
      emotionalScore: clampScore(item.emotionalScore, 0.2),
      introScore: clampScore(item.introScore, 0.55),
      graphScore: clampScore(item.graphScore, 0),
      labels: cleanStringArray(item.labels),
      rationale: typeof item.rationale === 'string' ? item.rationale.trim() : undefined,
      whyBullets: cleanStringArray(item.whyBullets, 3),
      sectionReasons: normalizeSectionReasons(item.sectionReasons),
      graphicsPackage: normalizeGraphicsPackage(item.graphicsPackage),
      brollIdeas: normalizeBrollIdeas(item.brollIdeas),
      graphIdea: harmonized.graphIds.includes(candidateId)
        ? normalizeGraphIdea(item.graphIdea) ?? fallbackGraphIdea(candidate)
        : undefined
    })
  }

  const referencedIds = new Set([...harmonized.rankedIds, ...harmonized.viralIds, ...harmonized.introIds, ...harmonized.graphIds])
  const itemIds = new Set(items.map((item) => item.candidateId))
  for (const id of referencedIds) {
    if (itemIds.has(id)) continue
    const candidate = byId.get(id)
    if (!candidate) continue
    const narrativeRole = fallbackRoleFor(id)
    roleById.set(id, narrativeRole)
    items.push({
      candidateId: id,
      narrativeRole,
      overallScore: clampScore(candidate.heuristicComposite, 0.65),
      viralScore: clampScore(candidate.heuristicScores.viralPriority, 0.58),
      emotionalScore: clampScore(candidate.heuristicScores.emotionalIntensity, 0.22),
      introScore: clampScore(candidate.heuristicScores.scrollStopPotential, 0.5),
      graphScore: clampScore(candidate.heuristicScores.dataAuthority, 0),
      labels: fallbackLabels(candidate),
      rationale: undefined,
      whyBullets: [],
      sectionReasons: undefined,
      graphicsPackage: fallbackGraphicsPackage(candidate, fallbackGraphIdea(candidate)),
      brollIdeas: [],
      graphIdea: fallbackGraphIdea(candidate)
    })
  }

  const rankedIds = orderRankedIdsForNarrativePackage(harmonized.rankedIds, byId, roleById)
  backfillEmptyBrollIdeas(items, byId, context?.mode ?? 'story', context?.directionText ?? '', context?.shotDurationSeconds ?? 8)
  const trailerArc = composeTrailerArc(rankedIds, byId, roleById, items, [
    ...harmonized.viralIds,
    ...harmonized.introIds
  ], harmonized.graphIds)

  return {
    rankedIds,
    viralIds: harmonized.viralIds,
    introIds: harmonized.introIds,
    graphIds: harmonized.graphIds,
    trailerArc,
    items
  }
}

export async function generateGroundedReviewOpenAI(
  params: GenerateGroundedReviewOpenAIParams
): Promise<GenerateGroundedReviewModelResult> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    candidates,
    segments,
    subjectProfile,
    promptPack,
    directionText,
    mode,
    targetCount,
    shotDurationSeconds
  } = params

  if (!candidates.length) {
    return { ok: false, error: 'No grounded clip candidates were provided.' }
  }

  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)
  const prompt =
    Array.isArray(segments) && segments.length > 0
      ? buildTranscriptDrivenPrompt({
          segments,
          promptPack,
          subjectProfile,
          directionText,
          mode,
          shotDurationSeconds: dur,
          targetCount: Math.max(8, Math.min(20, targetCount ?? 15))
        })
      : buildPrompt({
          candidates,
          promptPack,
          subjectProfile,
          directionText,
          mode,
          shotDurationSeconds: dur
        })

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: reviewSystemPrompt()
        },
        { role: 'user', content: prompt }
      ]
    })
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return { ok: false, error: `OpenAI ${res.status}: ${errText.slice(0, 400)}` }
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const raw = data.choices?.[0]?.message?.content
  if (!raw) return { ok: false, error: 'Empty response from OpenAI.' }

  try {
    if (Array.isArray(segments) && segments.length > 0) {
      const transcriptDriven = normalizeTranscriptDrivenReview(
        raw,
        segments,
        mode,
        Math.max(8, Math.min(20, targetCount ?? 15))
      )
      return {
        ok: true,
        review: transcriptDriven.review,
        candidates: transcriptDriven.candidates
      }
    }
    return { ok: true, review: normalizeGroundedReview(raw, candidates, { mode, directionText, shotDurationSeconds: dur }) }
  } catch {
    return { ok: false, error: 'Could not parse grounded review JSON from OpenAI.' }
  }
}

