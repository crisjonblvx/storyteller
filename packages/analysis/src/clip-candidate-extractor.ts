import type { StoryMode } from '@storyteller/shared'
import { classifyAndRankWithinTypes } from './clip-pipeline.js'
import type { ClipCandidateType } from './clip-model.js'
import { extractSmartStitchedClips, type SegmentForStitch } from './extractor.js'

/** Plan-style cold opens must survive top-N trimming on long episodes. */
export function isMustKeepPlanColdOpenText(text: string): boolean {
  const lower = text.trim().toLowerCase().replace(/^(rewind|again|like i said|in other words),?\s*/i, '')
  return /\b(i'?m gonna give you|three[- ]level plan|get positioned|when the door opens)\b/i.test(lower)
}

/** Late mission-close hooks must survive top-N trimming (e.g. "you're late" near end of long episodes). */
export function isMustKeepLateBookendText(text: string): boolean {
  const lower = text.trim().toLowerCase().replace(/^(rewind|again|like i said|in other words),?\s*/i, '')
  return (
    /\b(you'?re late|it'?s already here|wealth transfer is not coming|ai wealth transfer)\b/i.test(lower) ||
    (/\bpositioned to participate\b/i.test(lower) && /\bquestion is\b/i.test(lower)) ||
    (/\bnot coming\b/i.test(lower) && /\b(i'?m sorry|already here)\b/i.test(lower))
  )
}

function isMustKeepArcBookendText(text: string): boolean {
  return isMustKeepPlanColdOpenText(text) || isMustKeepLateBookendText(text)
}

function mergeMustKeepBookendClips<T extends { text: string; compositeWithinType: number }>(
  sorted: T[],
  maxCandidates: number
): T[] {
  const out = sorted.slice(0, maxCandidates)
  for (const candidate of sorted) {
    if (!isMustKeepArcBookendText(candidate.text)) continue
    if (out.some((row) => row.text === candidate.text)) continue
    if (out.length < maxCandidates) {
      out.push(candidate)
      continue
    }
    let dropIndex = -1
    let lowestComposite = Number.POSITIVE_INFINITY
    for (let index = 0; index < out.length; index++) {
      const row = out[index]!
      if (isMustKeepArcBookendText(row.text)) continue
      if (row.compositeWithinType < lowestComposite) {
        lowestComposite = row.compositeWithinType
        dropIndex = index
      }
    }
    if (dropIndex >= 0) out[dropIndex] = candidate
  }
  return out
}

function newCandidateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `cand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

export type WireTranscriptSegment = {
  id: string
  start: number
  end: number
  text: string
  speaker_label?: string | null
}

/** Classified clip row passed to the Director (LLM) — no raw transcript re-parse. */
export type ExtractedClipCandidate = {
  id: string
  text: string
  start: number
  end: number
  duration: number
  completenessScore: number
  sourceSegmentIds: string[]
  clipType: ClipCandidateType
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

export type ClipExtractionPipelineOptions = {
  maxCandidates?: number
  /** Project mode affects within-type composite weighting */
  mode?: StoryMode
  onProgress?: (p: { completedShards: number; totalShards: number }) => void
}

/**
 * Build Director input: smart-stitched clips → classify → editorial score → top N by strength.
 */
export async function extractClipCandidatesPipeline(
  segments: WireTranscriptSegment[],
  options?: ClipExtractionPipelineOptions
): Promise<ExtractedClipCandidate[]> {
  const maxCandidates = options?.maxCandidates ?? 96
  const mode = options?.mode ?? 'story'
  const onProgress = options?.onProgress

  if (segments.length === 0) return []

  onProgress?.({ completedShards: 0, totalShards: 1 })

  const mapped: SegmentForStitch[] = segments.map((s) => ({
    id: s.id,
    start_time: s.start,
    end_time: s.end,
    text: s.text,
    speaker_label: s.speaker_label ?? null
  }))

  const stitched = extractSmartStitchedClips(mapped)
  const scored = classifyAndRankWithinTypes(stitched, mode)

  onProgress?.({ completedShards: 1, totalShards: 1 })

  const sorted = scored.sort((a, b) => b.compositeWithinType - a.compositeWithinType)
  const selected = mergeMustKeepBookendClips(sorted, maxCandidates)

  return selected.map((c) => ({
      id: newCandidateId(),
      text: c.text,
      start: c.start,
      end: c.end,
      duration: c.duration,
      completenessScore: c.completenessScore,
      sourceSegmentIds: c.sourceSegmentIds,
      clipType: c.clipType,
      heuristicComposite: c.compositeWithinType,
      heuristicWithinTypeRank: c.withinTypeRank,
      heuristicScores: { ...c.scores }
    }))
}
