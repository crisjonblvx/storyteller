import type { StoryMode } from '@storyteller/shared'
import { classifyClip } from './clip-classifier.js'
import type {
  ClassifiedClip,
  ClipCandidateType,
  ClipEditorialScores,
  ScoredClip,
  SmartStitchedClip
} from './clip-model.js'
import { LOW_PRIORITY_SOUND_BITE_TYPES } from './clip-model.js'

const FILLER_PHRASES =
  /\b(you know what i mean|kind of like|sort of|anyway|um+|uh+|like, you know)\b/gi

const GENERIC_SETUP_OPENERS =
  /^(?:here'?s (?:skill|job|part|what|number)|here'?s the part|here'?s a number|skill number|job number|step one|first thing|second thing|i want to give|i would say|the method here is|and a quick plug|listen(?: to me)?[, ]|i really want you to hear|let me say this clearly|huh\?)/i

const HEDGING_LANGUAGE =
  /\b(i think|i guess|kind of|sort of|probably|maybe|i would say|in a way)\b/gi

function dataAuthorityScore(text: string): number {
  const lower = text.toLowerCase()
  let s = 0.15
  if (/\d/.test(text)) s += 0.2
  if (/\b(percent|study|research|data|according|million|billion)\b/.test(lower)) s += 0.25
  return Math.min(1, s)
}

function emotionalIntensityScore(text: string): number {
  const hits =
    (text.match(
      /\b(love|hate|fear|afraid|scared|terrified|hope|hopeless|angry|joy|cried|cry|tears|amazing|terrible|proud|ashamed|shame|hypocrite|broke|broken|alone|lonely|stress|stressed|pain|painful|devastated|unbelievable|shocking|heartbreaking|beautiful|free|freedom|trapped|drowning|wrong|desperate|panic|grief)\b/gi
    ) ?? []).length
  return Math.min(1, hits * 0.18 + 0.08)
}

/**
 * Universal aphoristic / truth-bomb detector — structural, NOT vocabulary-specific.
 * Recognizes the shape of quotable one-liners that travel: negations of expectation,
 * antithesis ("X, not Y" / "it's not X, it's Y"), "X reveals Y", "X before Y",
 * and short self-contained declaratives. This is what lets lines like
 * "income doesn't fix piss poor behavior", "income reveals character, it doesn't create it",
 * and "wealth is a behavior before it's a balance" rank as the punchlines they are.
 */
function aphoristicPunchScore(text: string): number {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const lower = normalized.toLowerCase()
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 3 || words.length > 26) return 0
  let score = 0

  // Negation of an expectation: "X doesn't/does not/won't/can't Y", "it wasn't X".
  if (/\b(does ?n'?t|do ?n'?t|did ?n'?t|wo ?n'?t|ca ?n'?t|is ?n'?t|was ?n'?t|are ?n'?t|never)\b/i.test(lower)) {
    score += 0.18
  }
  // Antithesis / contrast: "it's not X, it's Y" or "X, not Y" or "not X but Y".
  if (/\bnot\b[^.?!]*\bbut\b/i.test(lower)) score += 0.22
  if (/\b(it'?s|that'?s|this is)\s+not\b[^.?!]*,\s*(it'?s|that'?s)\b/i.test(lower)) score += 0.24
  if (/,\s*not\s+\w+/i.test(lower)) score += 0.16
  // "X reveals/creates/steals/builds Y" — punchy transitive aphorisms.
  if (/\b(reveals?|creates?|steals?|builds?|destroys?|breaks?|fixes?|costs?|buys?)\b/i.test(lower)) score += 0.1
  // "X is Y before it's Z" / "X is Y before you Z" — reframe structure.
  if (/\bis\b[^.?!]*\bbefore\b/i.test(lower)) score += 0.18
  // "X is a behavior/mindset/choice/decision" — definitional reframe.
  if (/\bis (?:a |an |just |the )?(behavior|behaviour|mindset|choice|decision|discipline|habit|trap|lie|gift|freedom)\b/i.test(lower)) {
    score += 0.14
  }
  // Direct second-person stakes: "you can't / you will not / you don't".
  if (/\byou (?:ca ?n'?t|wo ?n'?t|do ?n'?t|will not|can never)\b/i.test(lower)) score += 0.12
  // Crisp 4-12 word declarative that ends clean gets a tightness bonus.
  if (words.length >= 4 && words.length <= 12 && /[.!?]$/.test(normalized)) score += 0.12

  return Math.min(1, score)
}

function isConciseHookLine(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 4 || words.length > 14) return false
  if (
    /^(a hundred dollars a month|you are officially|three simple investments|just three investments|your money is actually shrinking|the stock market isn'?t just for rich people|math doesn'?t care|you can'?t invest if)\b/i.test(
      normalized
    )
  ) {
    return true
  }
  if (
    /\b(millionaire|zip code|rich people|stock market|shrinking|generational wealth|future family|compound interest)\b/i.test(
      normalized
    ) &&
    (normalized.match(/[.?!]/g) ?? []).length >= 1
  ) {
    return true
  }
  // Universal: a tight aphoristic punchline (negation/antithesis/reframe) in 4-14 words
  // counts as a concise hook regardless of topic vocabulary.
  if (words.length <= 14 && aphoristicPunchScore(normalized) >= 0.3) return true
  return (normalized.match(/[.?!]/g) ?? []).length >= 2 && words.length <= 10
}

function isMathExampleLine(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return /^(that'?s on a small level|if we bump that up|if you can stretch it to|that same \d+ years turns into|in \d+ years,? you'?ve put|that means for every \$?\d+|here'?s why[, ]? they let you open an account|an etf stands for|you can open an account today|take your first step(?: today)?|start with just \$?\d+|we got moo?moo)\b/i.test(
    lower
  )
}

function narrativeTensionScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.08
  if (/\b(but|however|instead|the real question|what people miss|nobody talks about)\b/.test(lower)) score += 0.16
  if (/\b(not for everyone|wrong path|pressure|trap|steals from your future|dangerous|costs you|lose your job)\b/.test(lower)) score += 0.26
  if (/\b(shrinking|can't invest if every dollar is already spent|losing it)\b/.test(lower)) score += 0.18
  if (/\b(should not|don'?t push|cannot be done remotely|cannot be offshored|cannot be replaced)\b/.test(lower)) score += 0.24
  if (/\b(front of the classroom|that'?s not love|that'?s pressure|working.?class trap|bulletproof)\b/.test(lower)) score += 0.22
  if (/\b(if you|unless you|or else|that means)\b/.test(lower)) score += 0.12
  return Math.min(1, score)
}

function quotabilityScore(text: string): number {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const words = normalized.split(/\s+/).filter(Boolean)
  let score = 0.12

  if (isConciseHookLine(normalized)) score += 0.22
  else if (words.length >= 10 && words.length <= 34) score += 0.24
  else if (words.length <= 45) score += 0.1

  if (/\bnot\b.+\bbut\b/i.test(normalized)) score += 0.14
  if (/\b[a-z]+ is for [a-z]+\b/i.test(normalized)) score += 0.12
  if (/\b(can(?:not|'t) be .+?\. can(?:not|'t) be .+?)\b/i.test(normalized)) score += 0.18
  if (/\bthe .+ is still the .+/i.test(normalized)) score += 0.14
  if ((normalized.match(/[.?!]/g) ?? []).length >= 2) score += 0.08
  if (/[:;—-]/.test(normalized)) score += 0.05
  score += aphoristicPunchScore(normalized) * 0.4

  return Math.min(1, score)
}

function contrarianEdgeScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.06
  if (/\b(should not|not for everyone|you don'?t need|the wrong path|that'?s not love|the real question|most people think)\b/.test(lower)) {
    score += 0.34
  }
  if (/\b(about half|nobody|everyone|wrong path|trap|pressure|steals from your future)\b/.test(lower)) {
    score += 0.2
  }
  if (/\b(front of the classroom|bulletproof|that'?s not love|working.?class trap)\b/.test(lower)) {
    score += 0.18
  }
  if (/\b(college|debt|ai|jobs|income|future)\b/.test(lower) && /\b(not|wrong|pressure|trap|steals|don'?t)\b/.test(lower)) {
    score += 0.14
  }
  score += aphoristicPunchScore(text) * 0.32
  return Math.min(1, score)
}

function consequenceScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.08
  if (/\b(future|pressure|trap|steals|lose your job|wrong path|results|income)\b/.test(lower)) score += 0.22
  if (/\b(if your child|if you|unless you|or else|that means)\b/.test(lower)) score += 0.14
  if (/\b(love|pressure|fear|danger|gift|discipline)\b/.test(lower)) score += 0.1
  if (/\b(front of the classroom|hands|gifted|working.?class trap|bulletproof)\b/.test(lower)) score += 0.12
  return Math.min(1, score)
}

function scrollStopPotentialScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0.18
  if (/\?/.test(text)) score += 0.12
  if (/^(imagine|what if|stop|listen|here's|nobody)\b/i.test(lower)) score += 0.28
  if (
    /^(a hundred dollars a month|you are officially|three simple investments|your money is actually shrinking|the stock market isn'?t just for rich people|math doesn'?t care|you can'?t invest if)\b/i.test(
      lower
    )
  ) {
    score += 0.26
  }
  if (/\b(millionaire|zip code|rich people|shrinking|generational wealth)\b/i.test(lower)) score += 0.14
  if (/\b(not what you think|changes everything|unpopular opinion)\b/i.test(lower)) score += 0.2
  if (/\b(should not|not for everyone|wrong path|that'?s not love|working-class trap)\b/i.test(lower)) score += 0.2
  return Math.min(1, score)
}

function clarityOfMessageScore(text: string): number {
  const filler = (text.match(FILLER_PHRASES) ?? []).length
  const words = text.trim().split(/\s+/).filter(Boolean).length
  let penalty = Math.min(0.45, filler * 0.1)
  if (words > 0 && words < 6 && !isConciseHookLine(text)) penalty += 0.12
  return Math.max(0, 1 - penalty)
}

function standaloneImpactScore(text: string, completeness: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  let lenM = 1
  if (isConciseHookLine(text)) lenM = 1.06
  else if (words < 10) lenM = 0.72
  else if (words > 55) lenM = 0.82
  return completeness * lenM
}

function setupPenaltyScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  if (GENERIC_SETUP_OPENERS.test(lower)) score += 0.42
  if (/^(rewind|again|like i said|as i said|in other words|let me say (?:it|that) again|let me say one more time|so again|repeat)\b/i.test(lower)) {
    score += 0.28
  }
  if (isMathExampleLine(text)) score += 0.18
  const hedges = (text.match(HEDGING_LANGUAGE) ?? []).length
  score += Math.min(0.22, hedges * 0.08)
  if (/\b(and|so)\s+(yeah|anyway|basically)\b/i.test(lower)) score += 0.12
  if (/^(now,|well,)/i.test(lower)) score += 0.08
  // Teleprompter / graphic-pointer lines that lean on an on-screen visual instead of standing alone.
  if (/\b(watch this|hopefully we'?ll have this|we'?re talking about|on (?:a|the) screen|put this up)\b/i.test(lower)) {
    score += 0.3
  }
  return Math.min(1, score)
}

function clipWorthinessScore(
  text: string,
  completeness: number,
  scroll: number,
  impact: number,
  emotion: number
): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const lengthFit = isConciseHookLine(text) ? 1.08 : words >= 12 && words <= 48 ? 1 : words < 12 ? 0.75 : 0.85
  return Math.min(1, (0.28 * completeness + 0.22 * scroll + 0.22 * impact + 0.18 * emotion) * lengthFit)
}

function viralPriorityScore(
  text: string,
  type: ClipCandidateType,
  completeness: number,
  scroll: number,
  impact: number,
  emotion: number,
  tension: number,
  quotability: number,
  contrarian: number,
  consequence: number,
  setupPenalty: number,
  dataAuthority: number
): number {
  const conciseHook = isConciseHookLine(text)
  let score =
    0.12 * completeness +
    0.15 * impact +
    0.12 * emotion +
    0.18 * scroll +
    0.16 * tension +
    0.13 * quotability +
    0.1 * contrarian +
    0.08 * consequence +
    0.04 * dataAuthority -
    0.14 * setupPenalty

  if (type === 'HOOK' || type === 'PAYOFF' || type === 'CULTURE') score += 0.06
  if (type === 'DATA') score += dataAuthority >= 0.55 ? 0.04 : -0.03
  if (type === 'EXPLAINER') score -= 0.09
  if (type === 'CTA') score -= 0.06
  if (type === 'QUESTION') score -= 0.05
  if (conciseHook) score += 0.1
  if (isMathExampleLine(text)) score -= 0.08

  if (/^(about half|you don'?t need|college is for some people|if your child|your income should be tied|the wrong path|when i tell you|these jobs are bulletproof)\b/i.test(text.trim())) {
    score += 0.08
  }

  // Universal: reward aphoristic truth-bombs and clean antithesis lines regardless of topic.
  score += aphoristicPunchScore(text) * 0.16

  return Math.max(0, Math.min(1, score))
}

function hasUnresolvedEnding(text: string): boolean {
  const t = text.trim()
  return /\b(and|but|so|because|if|when|or)\s*[,…]?\s*$/i.test(t)
}

function hasSuspiciousCutoffEnding(text: string): boolean {
  const t = text.trim()
  return /\b(anywhere between(?:\s+\w+)?|between(?:\s+\w+)?|from|up to|as much as|more than|less than)\.?$/i.test(t)
}

function startsWithDependentPluralPronoun(text: string): boolean {
  return /^(they|these|those)\b/i.test(text.trim())
}

function isPromotionalCta(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return (
    /\b[a-z0-9.-]+\.(com|net|org)\b/i.test(lower) ||
    /\b(show description|forward slash|get on a plan|download the app|join the app|get (?:this|the) book|this book is my gift|brand new book|inside of my book|inside my book|share it with|link is inside|subscribe|follow me|buy now|open an account today|take the first step today|take your first step|start with just \$?\d+|open an account with \$?0|pre[\s-]?order(?:ing)?|free bonuses?|bonus(?:es)?|order from amazon|barnes and noble|masterclass|book launch team|first chapter|money challenge|two-minute quiz|personalized plan)\b/i.test(
      lower
    ) ||
    /\b(moomoo|robinhood|fidelity|schwab|vanguard)\b/i.test(lower) ||
    /\b(start with just five)\b/i.test(
      lower
    )
  )
}

function isPureOutro(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return /\b(peace out|god bless|see you in the next show|see you in the next episode|love you all|i love you all|thanks for watching)\b/i.test(lower)
}

function overlapsTooMuch(a: ScoredClip, b: ScoredClip): boolean {
  const overlapStart = Math.max(a.start, b.start)
  const overlapEnd = Math.min(a.end, b.end)
  const overlap = Math.max(0, overlapEnd - overlapStart)
  if (overlap <= 0) return false
  const shorter = Math.min(a.duration, b.duration)
  return overlap / Math.max(shorter, 0.001) >= 0.6
}

function isLowEnergy(text: string, emotion: number, scroll: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words < 8) return false
  const exclaims = (text.match(/!/g) ?? []).length
  const strong = emotion + scroll
  return strong < 0.22 && exclaims === 0 && !/\?/.test(text) && words < 25
}

const PRIMARY_WINNER_VIRAL_FLOOR = 0.64
const QUESTION_WINNER_VIRAL_FLOOR = 0.82
const EXPLAINER_WINNER_VIRAL_FLOOR = 0.76
const EXCEPTIONAL_LOW_PRIORITY = 0.9
const STRONG_DATA_THRESHOLD = 0.55
const MAX_SOUND_BITE_DURATION_SEC = 32
const MAX_DATA_SOUND_BITE_DURATION_SEC = 38

function hasStrongStandalonePayoffSignal(scores: ClipEditorialScores): boolean {
  return (
    (scores.quotability ?? 0) >= 0.58 ||
    (scores.consequence ?? 0) >= 0.24 ||
    (scores.narrativeTension ?? 0) >= 0.46 ||
    (scores.scrollStopPotential ?? 0) >= 0.64
  )
}

function canCompeteAsTopSoundBite(clip: ScoredClip): boolean {
  const scores = clip.scores
  if (clip.clipType === 'CTA') return false
  const maxDuration = clip.clipType === 'DATA' ? MAX_DATA_SOUND_BITE_DURATION_SEC : MAX_SOUND_BITE_DURATION_SEC
  if (clip.duration > maxDuration) return false
  if (clip.clipType === 'QUESTION') {
    return (scores.viralPriority ?? 0) >= QUESTION_WINNER_VIRAL_FLOOR && hasStrongStandalonePayoffSignal(scores)
  }
  if (clip.clipType === 'EXPLAINER') {
    return (scores.viralPriority ?? 0) >= EXPLAINER_WINNER_VIRAL_FLOOR && hasStrongStandalonePayoffSignal(scores)
  }
  if (clip.clipType === 'DATA') {
    return (
      (scores.viralPriority ?? 0) >= PRIMARY_WINNER_VIRAL_FLOOR &&
      ((scores.dataAuthority ?? 0) >= STRONG_DATA_THRESHOLD || hasStrongStandalonePayoffSignal(scores))
    )
  }
  return (scores.viralPriority ?? 0) >= PRIMARY_WINNER_VIRAL_FLOOR && hasStrongStandalonePayoffSignal(scores)
}

/** Heuristic: setup-heavy explainer without landing punch */
function feelsLikeSetupWithoutPayoff(text: string, type: ClipCandidateType, payoffSignals: number): boolean {
  if (type !== 'EXPLAINER' && type !== 'QUESTION') return false
  const lower = text.toLowerCase()
  const hasPayoff =
    /\b(so|therefore|that'?s why|the point|lesson|takeaway|here'?s what)\b/i.test(lower) && text.length > 40
  return !hasPayoff && payoffSignals < 0.35
}

export function scoreClipEditorially(
  clip: ClassifiedClip,
  _mode: StoryMode
): { scores: ClipEditorialScores; rejected: boolean; rejectReason?: string } {
  const text = clip.text
  const conciseHook = isConciseHookLine(text)
  const completeness = clip.completenessScore
  const emotion = emotionalIntensityScore(text)
  const tension = narrativeTensionScore(text)
  const quotability = quotabilityScore(text)
  const contrarian = contrarianEdgeScore(text)
  const consequence = consequenceScore(text)
  const scroll = scrollStopPotentialScore(text)
  const clarity = clarityOfMessageScore(text)
  const impact = standaloneImpactScore(text, completeness)
  const clipWorthy = clipWorthinessScore(text, completeness, scroll, impact, emotion)
  const dataAuthority = dataAuthorityScore(text)
  const setupPenalty = setupPenaltyScore(text)
  const viralPriority = viralPriorityScore(
    text,
    clip.clipType,
    completeness,
    scroll,
    impact,
    emotion,
    tension,
    quotability,
    contrarian,
    consequence,
    setupPenalty,
    dataAuthority
  )

  const scores: ClipEditorialScores = {
    completeness,
    standaloneImpact: impact,
    emotionalIntensity: emotion,
    clarityOfMessage: clarity,
    clipWorthiness: clipWorthy,
    scrollStopPotential: scroll,
    narrativeTension: tension,
    quotability,
    contrarianEdge: contrarian,
    consequence,
    setupPenalty,
    viralPriority,
    dataAuthority
  }

  if (hasUnresolvedEnding(text)) {
    return { scores, rejected: true, rejectReason: 'unresolved_ending' }
  }
  if (startsWithDependentPluralPronoun(text)) {
    return { scores, rejected: true, rejectReason: 'dependent_plural_pronoun_start' }
  }
  if (hasSuspiciousCutoffEnding(text)) {
    return { scores, rejected: true, rejectReason: 'suspicious_cutoff_ending' }
  }
  if (isPureOutro(text)) {
    return { scores, rejected: true, rejectReason: 'pure_outro' }
  }
  if (clip.clipType !== 'CTA' && isPromotionalCta(text)) {
    return { scores, rejected: true, rejectReason: 'misclassified_promotional_cta' }
  }
  if (completeness < 0.68) {
    return { scores, rejected: true, rejectReason: 'low_completeness' }
  }
  if (clipWorthy < (conciseHook ? 0.25 : 0.32)) {
    return { scores, rejected: true, rejectReason: 'low_clip_worthiness' }
  }
  if (impact < (conciseHook ? 0.26 : 0.38)) {
    return { scores, rejected: true, rejectReason: 'low_standalone_impact' }
  }

  if (setupPenalty >= 0.4 && viralPriority < 0.52 && clip.clipType !== 'DATA') {
    return { scores, rejected: true, rejectReason: 'setup_heavy' }
  }

  const compositeSoft = scroll + emotion + impact * 0.8
  if (feelsLikeSetupWithoutPayoff(text, clip.clipType, compositeSoft)) {
    return { scores, rejected: true, rejectReason: 'setup_without_payoff' }
  }

  if (!conciseHook && isLowEnergy(text, emotion, scroll) && clip.clipType !== 'DATA' && clip.clipType !== 'EXPLAINER') {
    return { scores, rejected: true, rejectReason: 'low_energy' }
  }

  return { scores, rejected: false }
}

function compositeFromScores(s: ClipEditorialScores, mode: StoryMode): number {
  if (mode === 'journalism') {
    return (
      0.18 * s.completeness +
      0.16 * s.standaloneImpact +
      0.1 * s.emotionalIntensity +
      0.16 * s.clarityOfMessage +
      0.12 * s.clipWorthiness +
      0.1 * (s.dataAuthority ?? 0) +
      0.08 * s.scrollStopPotential +
      0.1 * s.viralPriority
    )
  }
  if (mode === 'creator') {
    return (
      0.1 * s.completeness +
      0.14 * s.standaloneImpact +
      0.14 * s.emotionalIntensity +
      0.08 * s.clarityOfMessage +
      0.12 * s.clipWorthiness +
      0.14 * s.scrollStopPotential +
      0.08 * (s.dataAuthority ?? 0) +
      0.2 * s.viralPriority
    )
  }
  return (
    0.13 * s.completeness +
    0.15 * s.standaloneImpact +
    0.14 * s.emotionalIntensity +
    0.1 * s.clarityOfMessage +
    0.12 * s.clipWorthiness +
    0.14 * s.scrollStopPotential +
    0.22 * s.viralPriority
  )
}

/**
 * Stage 2–3: classify, score, filter, assign within-type rank and compositeWithinType.
 */
export function classifyAndRankWithinTypes(
  stitched: SmartStitchedClip[],
  mode: StoryMode
): ScoredClip[] {
  const classified: ClassifiedClip[] = stitched.map((c) => ({
    ...c,
    clipType: classifyClip(c.text)
  }))

  const passed: ScoredClip[] = []
  for (const c of classified) {
    const { scores, rejected } = scoreClipEditorially(c, mode)
    if (rejected) continue
    passed.push({
      ...c,
      scores,
      withinTypeRank: 0,
      compositeWithinType: compositeFromScores(scores, mode)
    })
  }

  const byType = new Map<ClipCandidateType, ScoredClip[]>()
  for (const p of passed) {
    const list = byType.get(p.clipType) ?? []
    list.push(p)
    byType.set(p.clipType, list)
  }

  const out: ScoredClip[] = []
  for (const [, list] of byType) {
    list.sort((a, b) => b.compositeWithinType - a.compositeWithinType)
    list.forEach((row, idx) => {
      out.push({ ...row, withinTypeRank: idx + 1 })
    })
  }
  return out
}

/**
 * Stage 4: pick 6–8 sound bites — priority types first; low-priority only if exceptional.
 */
export function selectSoundBiteClips(scored: ScoredClip[], min = 6, max = 8): ScoredClip[] {
  const sorted = [...scored].sort((a, b) => {
    const diff = (b.scores.viralPriority ?? 0) - (a.scores.viralPriority ?? 0)
    if (Math.abs(diff) > 1e-6) return diff
    return b.compositeWithinType - a.compositeWithinType
  })

  const picked: ScoredClip[] = []
  let strongDataIncluded = false
  let explainers = 0
  let questions = 0

  for (const clip of sorted) {
    if (picked.length >= max) break
    if (picked.some((p) => overlapsTooMuch(p, clip))) continue
    if (!canCompeteAsTopSoundBite(clip)) continue
    if (clip.clipType === 'CTA') {
      continue
    }
    if (clip.clipType === 'QUESTION') {
      if (questions >= 1) continue
      questions += 1
    }
    if (clip.clipType === 'EXPLAINER') {
      if (explainers >= 1) continue
      explainers += 1
    }
    if (clip.clipType === 'DATA' && (clip.scores.dataAuthority ?? 0) >= STRONG_DATA_THRESHOLD) {
      strongDataIncluded = true
    }
    picked.push(clip)
  }

  if (!strongDataIncluded) {
    const strongData = sorted.find(
      (clip) =>
        clip.clipType === 'DATA' &&
        (clip.scores.dataAuthority ?? 0) >= STRONG_DATA_THRESHOLD &&
        !picked.some((p) => p.id === clip.id)
    )
    if (strongData) {
      if (picked.length >= max) picked[picked.length - 1] = strongData
      else picked.push(strongData)
    }
  }

  if (picked.length < min) {
    for (const clip of sorted) {
      if (picked.length >= min) break
      if (picked.some((p) => p.id === clip.id)) continue
      if (picked.some((p) => overlapsTooMuch(p, clip))) continue
      if (clip.clipType === 'CTA') continue
      if (!canCompeteAsTopSoundBite(clip) && clip.scores.viralPriority < EXCEPTIONAL_LOW_PRIORITY) continue
      if (LOW_PRIORITY_SOUND_BITE_TYPES.includes(clip.clipType) && clip.scores.viralPriority < EXCEPTIONAL_LOW_PRIORITY) {
        continue
      }
      picked.push(clip)
    }
  }

  picked.sort((a, b) => {
    const diff = (b.scores.viralPriority ?? 0) - (a.scores.viralPriority ?? 0)
    if (Math.abs(diff) > 1e-6) return diff
    return b.compositeWithinType - a.compositeWithinType
  })
  return picked.slice(0, max)
}

/**
 * Stage 5: short punch lines derived from clip text (4–12 words). Fragments allowed.
 */
export function deriveMicroHooksForClip(text: string, maxHooks = 2): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const hooks: string[] = []

  if (words.length >= 4 && words.length <= 12) {
    hooks.push(normalized.replace(/[.!?…]+$/u, '').trim())
  } else if (words.length > 12) {
    const first = words.slice(0, Math.min(10, words.length)).join(' ')
    hooks.push(first.replace(/[.,;:]$/u, '').trim())
    const tail = words.slice(-Math.min(10, words.length)).join(' ')
    if (tail !== first && tail.split(/\s+/).length >= 4) {
      hooks.push(tail.replace(/^[.,;:]|[.!?…]+$/gu, '').trim())
    }
  } else {
    hooks.push(normalized.replace(/[.!?…]+$/u, '').trim())
  }

  return [...new Set(hooks)]
    .map((h) => h.replace(/\s+/g, ' ').trim())
    .filter((h) => {
      const w = h.split(/\s+/).length
      return w >= 4 && w <= 14 && h.length >= 12
    })
    .slice(0, maxHooks)
}
