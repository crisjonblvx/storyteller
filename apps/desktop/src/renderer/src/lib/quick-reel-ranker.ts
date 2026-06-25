import type { SoundbiteCandidate } from '@storyteller/shared'

/**
 * A moment is the minimal unit the Quick Reel UI cares about — either derived
 * from a transcript segment (with real timing) or from a sentence in pasted /
 * typed text (synthetic timing for preview only).
 */
export interface QuickMoment {
  id: string
  text: string
  /** Seconds into the source media (0 for synthetic moments). */
  startSec: number
  /** Seconds into the source media. */
  endSec: number
  score: number
  /** True when timings are synthesized from text length, not real audio. */
  synthetic: boolean
}

const HOOK_PATTERNS = [
  /\bbut\b/i,
  /\bsuddenly\b/i,
  /\bnever\b/i,
  /\balways\b/i,
  /\bnobody\b/i,
  /\beveryone\b/i,
  /\bsecret\b/i,
  /\bwhy\b/i,
  /\bhow\b/i,
  /\bbecause\b/i,
  /\bthe truth\b/i,
  /\b(here'?s|listen)\b/i
]

const STRONG_VERBS =
  /\b(love|hate|fight|crash|broke|lost|saved|won|failed|cried|laughed|burned|killed|risked|believed|changed|chose|fired|hired)\b/i

const QUESTION = /\?\s*$/
const EXCLAIM = /[!]\s*$/

function lengthSweetSpot(words: number): number {
  /**
   * Reels feel best when a hook is 6–18 words (roughly 2–6 seconds of speech).
   * Score peaks at 12, drops gently outside the window so we still surface
   * usable lines when the source is short.
   */
  if (words <= 0) return 0
  const peak = 12
  const spread = 8
  const d = Math.abs(words - peak)
  return Math.max(0, 1 - d / spread)
}

function patternBoost(text: string): number {
  let boost = 0
  for (const re of HOOK_PATTERNS) if (re.test(text)) boost += 0.06
  if (STRONG_VERBS.test(text)) boost += 0.12
  if (QUESTION.test(text)) boost += 0.1
  if (EXCLAIM.test(text)) boost += 0.05
  return Math.min(0.4, boost)
}

function clarityScore(text: string): number {
  /**
   * Penalize transcript fragments dominated by filler words — typically a
   * sign the line will sound rambly when extracted out of context.
   */
  const filler = /\b(um|uh|like|you know|sort of|kind of)\b/gi
  const matches = text.match(filler)?.length ?? 0
  const words = text.trim().split(/\s+/).filter(Boolean).length || 1
  const ratio = matches / words
  return Math.max(0, 1 - ratio * 4)
}

export function scoreMomentText(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const length = lengthSweetSpot(words)
  const clarity = clarityScore(text)
  const boost = patternBoost(text)
  /**
   * Weighted blend — length & clarity dominate so we don't over-index on
   * surface-level keyword matching, while pattern boost still rewards
   * genuinely hook-y phrasing.
   */
  return Math.min(1, 0.45 * length + 0.35 * clarity + 0.5 * boost)
}

/**
 * Rank moments derived from real Whisper-style segments. Preserves the input
 * order in `id` so the consumer can re-sort by time after the user picks.
 */
export function rankSegmentsAsMoments(
  segments: Array<{ id?: string; start: number; end: number; text: string }>
): QuickMoment[] {
  return segments
    .map((s, i) => {
      const text = (s.text || '').trim()
      const dur = Math.max(0, s.end - s.start)
      if (!text || dur < 0.2) return null
      return {
        id: s.id ?? `seg-${i}`,
        text,
        startSec: s.start,
        endSec: s.end,
        score: scoreMomentText(text),
        synthetic: false
      }
    })
    .filter((m): m is QuickMoment => m != null)
}

/**
 * Synthesize moments from a chunk of typed / pasted text by splitting on
 * sentence boundaries. Timings are estimated at ~165 wpm (typical
 * conversational delivery) so the preview duration math still works.
 */
export function rankTextAsMoments(text: string): QuickMoment[] {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return []
  const parts = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const wordsPerSec = 165 / 60
  let cursor = 0
  return parts.map((p, i) => {
    const wordCount = p.split(/\s+/).filter(Boolean).length || 1
    const dur = Math.max(1.5, wordCount / wordsPerSec)
    const m: QuickMoment = {
      id: `sent-${i}`,
      text: p,
      startSec: cursor,
      endSec: cursor + dur,
      score: scoreMomentText(p),
      synthetic: true
    }
    cursor += dur
    return m
  })
}

/**
 * Adapt picked moments to the existing `SoundbiteCandidate` shape so we can
 * reuse `buildIntroSequence` from `@storyteller/timeline` without divergence.
 */
export function momentsToSoundbites(params: {
  projectId: string
  moments: QuickMoment[]
}): SoundbiteCandidate[] {
  const now = new Date().toISOString()
  return params.moments
    .slice()
    .sort((a, b) => a.startSec - b.startSec)
    .map((m, i) => ({
      id: `qr-soundbite-${m.id}-${i}`,
      project_id: params.projectId,
      start_time: m.startSec,
      end_time: m.endSec,
      transcript_text: m.text,
      score_social: m.score,
      score_emotional: null,
      score_clarity: null,
      tags_json: { source: 'quick_reel', synthetic: m.synthetic },
      created_at: now
    }))
}
