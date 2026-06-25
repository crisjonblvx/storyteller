import type { TranscriptSegment } from '@storyteller/shared'
import type { SmartStitchedClip } from './clip-model.js'

export type SegmentForStitch = Pick<
  TranscriptSegment,
  'id' | 'start_time' | 'end_time' | 'text' | 'speaker_label'
>

/** @deprecated Use SmartStitchedClip; kept for incremental refactors */
export type ExtractedCandidate = SmartStitchedClip & { completeness: number }

const MAX_GAP_SEC = 2.25
// Allow short, punchy aphorisms (a 3s "income reveals character, it doesn't create it"
// is a real bite). Sub-5s clips still must clear a high completeness gate below, so
// this does not open the door to fragments.
const MIN_DURATION_SEC = 3
const MAX_DURATION_SEC = 110
const TARGET_SOFT_MIN_SEC = 5
const TARGET_SOFT_MAX_SEC = 22

const WEAK_FRAGMENTS = [
  "that's a good question",
  "i'll get to that in a second",
  "you know what i mean",
  "right",
  "okay",
  "yeah",
  "um",
  "uh",
  "like",
  "so basically",
  "and then"
]

function isWeakFragment(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return WEAK_FRAGMENTS.some((f) => lower === f || lower === f + '.' || lower === f + '?')
}

function speakerKey(label: string | null | undefined): string {
  const t = (label ?? '').trim()
  return t.length > 0 ? t : '__UNK__'
}

function sameSpeaker(a: string | null | undefined, b: string | null | undefined): boolean {
  return speakerKey(a) === speakerKey(b)
}

function adjacent(a: SegmentForStitch, b: SegmentForStitch): boolean {
  const gap = b.start_time - a.end_time
  return gap <= MAX_GAP_SEC && gap >= -0.15
}

function hasCleanStart(text: string): boolean {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  // Genuine mid-thought starts are signalled by a leading conjunction/preposition.
  // We do NOT reject purely because the first letter is lowercase: Whisper casing is
  // unreliable and many of the strongest standalone lines ("income doesn't fix piss
  // poor behavior", "households making over $150k...") are transcribed lowercase
  // mid-stream. Rejecting on case alone silently drops the best truth-bombs.
  if (/^(and|but|so|because|or|nor|yet)\b/.test(lower)) return false
  if (/^(of|to|for|with|from|into|like|than|that|which)\b/.test(lower)) return false
  return true
}

/** Capitalize the first alphabetic character for clean on-screen display (Whisper casing fix). */
function capitalizeLead(text: string): string {
  return text.replace(/^([\s"'(\[]*)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
}

function hasCleanEnd(text: string): boolean {
  const t = text.trim()
  if (/\b(because|but|and|so|like|um|uh|if|when|or)\s*[,…]?\s*$/i.test(t)) return false
  return /[.!?…]["')\]]*\s*$/u.test(t)
}

export function scoreCompleteness(text: string): number {
  let score = 1
  if (!hasCleanStart(text)) score -= 0.2
  if (!hasCleanEnd(text)) score -= 0.22
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words < 6) score -= 0.28
  else if (words > 85) score -= 0.08
  return Math.max(0, score)
}

function trimLeadingDiscourse(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^(?:and|but|so|now|well)\b[\s,.:;-]*/i, '')
    .replace(/^(?:listen|look)\b[\s,.:;-]*/i, '')
    .trim()
  return trimmed.replace(/^[a-z]/, (m) => m.toUpperCase())
}

function sentenceSlices(text: string): Array<{ text: string; startOffset: number }> {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  const slices: Array<{ text: string; startOffset: number }> = []
  const regex = /[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/gu
  let match: RegExpExecArray | null
  while ((match = regex.exec(normalized)) !== null) {
    const raw = match[0]?.trim()
    if (!raw) continue
    slices.push({ text: raw, startOffset: match.index })
  }
  return slices
}

function joinRange(segments: SegmentForStitch[], s: number, e: number): string {
  return segments
    .slice(s, e + 1)
    .map((x) => x.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function verifyContiguousChain(segments: SegmentForStitch[], s: number, e: number): boolean {
  for (let k = s; k < e; k++) {
    if (!adjacent(segments[k]!, segments[k + 1]!)) return false
    if (!sameSpeaker(segments[k]!.speaker_label, segments[k + 1]!.speaker_label)) return false
  }
  return true
}

function buildValidatedClip(
  segments: SegmentForStitch[],
  s: number,
  e: number
): SmartStitchedClip | null {
  const text = joinRange(segments, s, e)
  if (!hasCleanStart(text) || !hasCleanEnd(text)) return null
  if (!verifyContiguousChain(segments, s, e)) return null

  const duration = segments[e]!.end_time - segments[s]!.start_time
  if (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC) return null
  if (isWeakFragment(text)) return null

  const completenessScore = scoreCompleteness(text)
  if (completenessScore < 0.7) return null
  if (duration < TARGET_SOFT_MIN_SEC && completenessScore < 0.82) return null
  if (duration > TARGET_SOFT_MAX_SEC && completenessScore < 0.74) return null

  const id = `stitch_${segments[s]!.start_time.toFixed(2)}_${segments[e]!.end_time.toFixed(2)}`
  return {
    id,
    text: capitalizeLead(text),
    start: segments[s]!.start_time,
    end: segments[e]!.end_time,
    duration,
    completenessScore,
    sourceSegmentIds: segments.slice(s, e + 1).map((x) => x.id)
  }
}

function buildSentenceTailVariant(
  base: SmartStitchedClip,
  variantText: string,
  startOffset: number
): SmartStitchedClip | null {
  const trimmed = trimLeadingDiscourse(variantText)
  if (!trimmed || !hasCleanStart(trimmed) || !hasCleanEnd(trimmed) || isWeakFragment(trimmed)) return null

  const totalChars = Math.max(base.text.length, 1)
  const ratio = Math.min(Math.max(startOffset / totalChars, 0), 0.92)
  const start = base.start + base.duration * ratio
  const end = base.end
  const duration = end - start
  if (duration < MIN_DURATION_SEC || duration > MAX_DURATION_SEC) return null

  const completenessScore = scoreCompleteness(trimmed)
  if (completenessScore < 0.78) return null

  return {
    id: `${base.id}_tail_${Math.round(startOffset)}`,
    text: trimmed,
    start,
    end,
    duration,
    completenessScore,
    sourceSegmentIds: base.sourceSegmentIds
  }
}

/**
 * Expand only along contiguous same-speaker segments (no skipping).
 */
type ClipRange = { startIdx: number; endIdx: number; clip: SmartStitchedClip }

function stitchClipFromAnchor(segments: SegmentForStitch[], anchorIdx: number): ClipRange | null {
  const n = segments.length
  if (anchorIdx < 0 || anchorIdx >= n) return null

  let s = anchorIdx
  let e = anchorIdx

  while (e < n - 1 && !hasCleanEnd(joinRange(segments, s, e))) {
    if (!adjacent(segments[e]!, segments[e + 1]!)) break
    if (!sameSpeaker(segments[e]!.speaker_label, segments[e + 1]!.speaker_label)) break
    e++
  }

  let text = joinRange(segments, s, e)
  if (!hasCleanEnd(text)) return null

  while (s > 0 && !hasCleanStart(text)) {
    if (!adjacent(segments[s - 1]!, segments[s]!)) break
    if (!sameSpeaker(segments[s - 1]!.speaker_label, segments[s]!.speaker_label)) break
    s--
    text = joinRange(segments, s, e)
  }

  const clip = buildValidatedClip(segments, s, e)
  if (!clip) return null
  return { startIdx: s, endIdx: e, clip }
}

/**
 * Stage 1 — Smart stitching: contiguous same-speaker runs only; expand until thought resolves.
 */
export function extractSmartStitchedClips(segments: SegmentForStitch[]): SmartStitchedClip[] {
  if (segments.length === 0) return []

  const ordered = [...segments].sort((a, b) => a.start_time - b.start_time)
  const n = ordered.length
  const unique = new Map<string, SmartStitchedClip>()

  for (let i = 0; i < n; i++) {
    const stitched = stitchClipFromAnchor(ordered, i)
    const variants: SmartStitchedClip[] = []

    if (stitched) {
      variants.push(stitched.clip)

      // Generate suffix variants so strong quotes at the tail of a stitched
      // thought can outrank their weaker preamble-heavy parent clip.
      for (let s = stitched.startIdx + 1; s <= stitched.endIdx; s++) {
        const suffix = buildValidatedClip(ordered, s, stitched.endIdx)
        if (suffix) variants.push(suffix)
      }

      const sentenceParts = sentenceSlices(stitched.clip.text)
      if (sentenceParts.length > 1) {
        for (let s = 1; s < sentenceParts.length; s++) {
          const tailText = sentenceParts.slice(s).map((part) => part.text).join(' ').trim()
          const tail = buildSentenceTailVariant(stitched.clip, tailText, sentenceParts[s]!.startOffset)
          if (tail) variants.push(tail)
        }
      }
    }

    const single = buildValidatedClip(ordered, i, i)
    if (single) variants.push(single)

    for (const clip of variants) {
      const key = `${clip.start.toFixed(2)}:${clip.end.toFixed(2)}:${clip.text}`
      unique.set(key, clip)
    }
  }

  const clips = [...unique.values()]
  clips.sort((a, b) => a.start - b.start)
  return clips
}

/** Back-compat name — `speaker_label` optional when diarization is absent */
export function extractCandidateClips(
  segments: Array<
    Pick<TranscriptSegment, 'id' | 'start_time' | 'end_time' | 'text'> & {
      speaker_label?: string | null
    }
  >
): ExtractedCandidate[] {
  const normalized: SegmentForStitch[] = segments.map((s) => ({
    id: s.id,
    start_time: s.start_time,
    end_time: s.end_time,
    text: s.text,
    speaker_label: s.speaker_label ?? null
  }))
  return extractSmartStitchedClips(normalized).map((c) => ({
    ...c,
    completeness: c.completenessScore
  }))
}
