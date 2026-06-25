import type { SoundbiteCandidate, StoryMode, TranscriptSegment } from '@storyteller/shared'
import { applyDirectionToRanked } from './ai-direction.js'
import {
  classifyAndRankWithinTypes,
  deriveMicroHooksForClip,
  selectSoundBiteClips
} from './clip-pipeline.js'
import { extractSmartStitchedClips, type SegmentForStitch } from './extractor.js'
import type { ScoredClip } from './clip-model.js'

export interface ScoreWeights {
  completeness: number
  standaloneImpact: number
  emotionalIntensity: number
  informationalValue: number
  scrollStopPotential: number
  narrativeTension: number
  modeFit: number
}

/** @deprecated Kept for API compatibility; ranking is now within-type + editorial scores */
export function modeWeights(mode: StoryMode): ScoreWeights {
  switch (mode) {
    case 'journalism':
      return {
        completeness: 0.25,
        standaloneImpact: 0.15,
        emotionalIntensity: 0.1,
        informationalValue: 0.3,
        scrollStopPotential: 0.05,
        narrativeTension: 0.05,
        modeFit: 0.1
      }
    case 'creator':
      return {
        completeness: 0.15,
        standaloneImpact: 0.2,
        emotionalIntensity: 0.2,
        informationalValue: 0.05,
        scrollStopPotential: 0.25,
        narrativeTension: 0.1,
        modeFit: 0.05
      }
    default:
      return {
        completeness: 0.2,
        standaloneImpact: 0.2,
        emotionalIntensity: 0.15,
        informationalValue: 0.15,
        scrollStopPotential: 0.15,
        narrativeTension: 0.1,
        modeFit: 0.05
      }
  }
}

export type RankedSoundbite = Pick<
  SoundbiteCandidate,
  | 'start_time'
  | 'end_time'
  | 'transcript_text'
  | 'score_social'
  | 'score_emotional'
  | 'score_clarity'
  | 'tags_json'
> & { segment_id: string; composite: number }

function deriveSecondaryTags(clip: ScoredClip): string[] {
  const tags = new Set<string>()
  const text = clip.text.toLowerCase()
  const scores = clip.scores

  if (scores.viralPriority >= 0.68) tags.add('viral')
  if (scores.emotionalIntensity >= 0.34) tags.add('emotional')
  if (scores.narrativeTension >= 0.34) tags.add('tension')
  if (scores.quotability >= 0.34) tags.add('quotable')
  if ((scores.dataAuthority ?? 0) >= 0.5 || clip.clipType === 'DATA') tags.add('data')
  if (clip.clipType === 'CTA') tags.add('promo')

  if (/\b(family|kids|generations|legacy|team)\b/.test(text)) tags.add('legacy')
  if (/\b(change your life|you can do that|future|hope is not a strategy|tell your money where to go)\b/.test(text)) {
    tags.add('motivational')
  }
  if (/\b(book|app|show description|plan|subscribe|follow me|buy now)\b/.test(text)) tags.add('offer')
  if (/\b(money|income|debt|consumer debt|paycheck|budget)\b/.test(text)) tags.add('money')

  return [...tags]
}

/**
 * Pipeline: smart stitch → classify → score & rank within type → filter → pick 6–8 sound bites → micro-hooks.
 */
export function rankSoundbiteCandidates(
  mode: StoryMode,
  segments: Pick<TranscriptSegment, 'id' | 'start_time' | 'end_time' | 'text' | 'speaker_label'>[],
  options?: { directionText?: string; minSoundBites?: number; maxSoundBites?: number }
): RankedSoundbite[] {
  const normalized: SegmentForStitch[] = segments.map((s) => ({
    id: s.id,
    start_time: s.start_time,
    end_time: s.end_time,
    text: s.text,
    speaker_label: s.speaker_label ?? null
  }))

  const stitched = extractSmartStitchedClips(normalized)
  const scored = classifyAndRankWithinTypes(stitched, mode)
  const minSb = options?.minSoundBites ?? 6
  const maxSb = options?.maxSoundBites ?? 8
  let selected = selectSoundBiteClips(scored, minSb, maxSb)
  if (selected.length === 0 && scored.length > 0) {
    selected = [...scored].sort((a, b) => b.compositeWithinType - a.compositeWithinType).slice(0, Math.min(maxSb, scored.length))
  }

  const rows: RankedSoundbite[] = selected.map((c) => {
    const microHooks = deriveMicroHooksForClip(c.text)
    const secondaryTags = deriveSecondaryTags(c)
    return {
      segment_id: c.sourceSegmentIds[0] ?? '',
      start_time: c.start,
      end_time: c.end,
      transcript_text: c.text,
      score_social: c.scores.viralPriority,
      score_emotional: c.scores.emotionalIntensity,
      score_clarity: c.scores.clarityOfMessage,
      tags_json: {
        clipType: c.clipType,
        secondaryTags,
        completenessScore: c.completenessScore,
        duration: c.duration,
        withinTypeRank: c.withinTypeRank,
        compositeWithinType: c.compositeWithinType,
        viralPriority: c.scores.viralPriority,
        viral: c.scores.viralPriority >= 0.68,
        editorialScores: c.scores,
        microHooks,
        sourceSegmentIds: c.sourceSegmentIds,
        pipelineVersion: 'smart_stitch_v3_viral'
      },
      composite: c.scores.viralPriority
    }
  })

  let sorted = rows.sort((a, b) => b.composite - a.composite)
  if (options?.directionText?.trim()) {
    sorted = applyDirectionToRanked(sorted, options.directionText)
  }
  return sorted
}
