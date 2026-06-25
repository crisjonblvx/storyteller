import type { SilencePreset } from '@storyteller/shared'
import type { StoryMode, ProjectFormat } from '@storyteller/shared'
import type { SoundbiteCandidate } from '@storyteller/shared'
import type { SilenceRegion } from '@storyteller/shared'
import type { TimelineClip, TimelineMarker, TimelineSequence, TimelineTrack } from './model.js'
import { silenceThresholdSeconds } from './silence-presets.js'
import { insertPauseGap } from './pause-gap.js'
import { capSourceWindowSeconds, resolveBuilderPacingConfig, type BuilderPacing } from './assembly-pacing.js'

/** Guided intro structure labels (stored on clip metadata + markers). */
export type IntroSlotRole = 'hook' | 'tension' | 'insight' | 'payoff' | 'open_loop' | 'close'

export interface IntroAssemblyInput {
  projectId: string
  mode: StoryMode
  format: ProjectFormat
  primaryAssetId: string
  /** Target total duration after pacing trim (30 / 45 / 60 typical). */
  targetDurationSec: number
  /** Rank order preserved — user selection filtered from ranked list. */
  soundbites: SoundbiteCandidate[]
  silenceRegions: Pick<SilenceRegion, 'start_time' | 'end_time'>[]
  silencePreset?: SilencePreset
  pacingMode?: BuilderPacing
}

/** Collapse long internal silences — same as rough-cut builder. */
function trimmedDurationSeconds(
  start: number,
  end: number,
  regions: Pick<SilenceRegion, 'start_time' | 'end_time'>[],
  threshold: number
): number {
  let trim = 0
  for (const r of regions) {
    const s = Math.max(r.start_time, start)
    const e = Math.min(r.end_time, end)
    if (e <= s) continue
    const len = e - s
    if (len > threshold) trim += len - threshold
  }
  return Math.max(0, end - start - trim)
}

/**
 * Assign section labels for 1..N clips (degrades gracefully for short selections).
 */
export function assignIntroRoles(clipCount: number): IntroSlotRole[] {
  if (clipCount <= 0) return []
  if (clipCount === 1) return ['hook']
  if (clipCount === 2) return ['hook', 'payoff']
  if (clipCount === 3) return ['hook', 'tension', 'insight']
  const out: IntroSlotRole[] = ['hook', 'tension', 'insight', 'payoff']
  for (let i = 4; i < clipCount; i++) {
    out.push(i === 4 ? 'open_loop' : 'close')
  }
  return out
}

function transcriptIdsFromSoundbite(sb: SoundbiteCandidate): string[] | undefined {
  const tags = sb.tags_json as { segment_id?: string } | null | undefined
  if (tags?.segment_id && typeof tags.segment_id === 'string') return [tags.segment_id]
  return undefined
}

function shortenSourceToTargetDuration(
  sb: SoundbiteCandidate,
  targetDur: number,
  silenceRegions: Pick<SilenceRegion, 'start_time' | 'end_time'>[],
  threshold: number
): SoundbiteCandidate | null {
  if (targetDur <= 0.2) return null
  const full = trimmedDurationSeconds(sb.start_time, sb.end_time, silenceRegions, threshold)
  if (full <= targetDur + 1e-6) return sb

  let lo = sb.start_time
  let hi = sb.end_time
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const d = trimmedDurationSeconds(sb.start_time, mid, silenceRegions, threshold)
    if (d <= targetDur) lo = mid
    else hi = mid
  }
  if (lo - sb.start_time < 0.2) return null
  return { ...sb, end_time: lo }
}

/**
 * Fit ordered soundbites to target duration: keep rank order, add full clips while they fit,
 * then shorten the next clip to fill remaining time (pacing trim applied).
 */
export function fitSoundbitesToTarget(
  soundbites: SoundbiteCandidate[],
  targetDurationSec: number,
  silenceRegions: Pick<SilenceRegion, 'start_time' | 'end_time'>[],
  threshold: number
): SoundbiteCandidate[] {
  if (soundbites.length === 0 || targetDurationSec <= 0) return []

  const result: SoundbiteCandidate[] = []
  let used = 0

  for (const sb of soundbites) {
    const fullDur = trimmedDurationSeconds(sb.start_time, sb.end_time, silenceRegions, threshold)
    if (fullDur <= 0) continue

    const remaining = targetDurationSec - used
    if (remaining <= 0.05) break

    if (fullDur <= remaining + 1e-6) {
      result.push(sb)
      used += fullDur
      continue
    }

    const shortened = shortenSourceToTargetDuration(sb, remaining, silenceRegions, threshold)
    if (shortened) result.push(shortened)
    break
  }

  return result
}

/**
 * Build a canonical `TimelineSequence` for an intro rough cut (NLE export compatible).
 */
export function buildIntroSequence(input: IntroAssemblyInput): TimelineSequence {
  const pacing = resolveBuilderPacingConfig(input.mode, input.pacingMode, input.silencePreset)
  const threshold = silenceThresholdSeconds(pacing.silencePreset)
  const pacedCandidates = input.soundbites.map((sb) => ({
    ...sb,
    end_time: capSourceWindowSeconds(sb.start_time, sb.end_time, pacing.maxClipSeconds)
  }))
  let effectiveTarget = input.targetDurationSec

  let fitted = fitSoundbitesToTarget(
    pacedCandidates,
    effectiveTarget,
    input.silenceRegions,
    threshold
  )
  if (pacing.pauseGapSeconds > 0 && fitted.length > 1) {
    const gapBudget = pacing.pauseGapSeconds * Math.max(fitted.length - 1, 0)
    if (effectiveTarget - gapBudget > 0.5) {
      effectiveTarget = input.targetDurationSec - gapBudget
      fitted = fitSoundbitesToTarget(pacedCandidates, effectiveTarget, input.silenceRegions, threshold)
    }
  }

  const roles = assignIntroRoles(fitted.length)

  const videoClips: TimelineClip[] = []
  const audioClips: TimelineClip[] = []
  const markers: TimelineMarker[] = []
  let timelineCursor = 0

  for (let i = 0; i < fitted.length; i++) {
    const sb = fitted[i]!
    const introRole = roles[i] ?? 'close'
    const dur = trimmedDurationSeconds(sb.start_time, sb.end_time, input.silenceRegions, threshold)
    const tIds = transcriptIdsFromSoundbite(sb)

    const meta = {
      introRole,
      introBuilder: 'v1' as const,
      silencePreset: pacing.silencePreset,
      pacingMode: input.pacingMode ?? 'Balanced',
      soundbiteId: sb.id
    }

    const vClip: TimelineClip = {
      id: `intro-clip-${sb.id}`,
      role: 'a-roll',
      assetId: input.primaryAssetId,
      sourceInSeconds: sb.start_time,
      sourceOutSeconds: sb.end_time,
      timelineInSeconds: timelineCursor,
      timelineOutSeconds: timelineCursor + dur,
      soundbiteId: sb.id,
      transcriptSegmentIds: tIds,
      metadata: meta
    }
    const aClip: TimelineClip = {
      ...vClip,
      id: `${vClip.id}-audio`,
      role: 'nat-audio'
    }
    videoClips.push(vClip)
    audioClips.push(aClip)

    markers.push({
      id: `m-intro-${sb.id}`,
      label: `${introRole.replace('_', ' ')} · ${sb.transcript_text.slice(0, 48)}${sb.transcript_text.length > 48 ? '…' : ''}`,
      timeSeconds: timelineCursor,
      metadata: { introRole }
    })

    timelineCursor = vClip.timelineOutSeconds
  }

  const videoTrack: TimelineTrack = { id: 'v-intro', name: 'Intro video', clips: videoClips }
  const audioTrack: TimelineTrack = { id: 'a-intro', name: 'Intro audio', clips: audioClips }

  let sequence: TimelineSequence = {
    id: `seq-intro-${input.projectId}`,
    projectId: input.projectId,
    mode: input.mode,
    format: input.format,
    durationSeconds: timelineCursor,
    videoTracks: [videoTrack],
    audioTracks: [audioTrack],
    textTracks: [{ id: 't-intro', name: 'Titles (placeholder)', clips: [] }],
    markers,
    exportMetadata: {
      xmlNotes: 'Intro rough cut — section markers map to Hook / Tension / Insight / Payoff / Open loop / Close.'
    },
    metadata: {
      builder: 'intro-v1',
      introTargetSec: input.targetDurationSec,
      silencePreset: pacing.silencePreset,
      pacingMode: input.pacingMode ?? 'Balanced'
    }
  }
  if (pacing.pauseGapSeconds > 0 && videoClips.length > 1) {
    for (let i = videoClips.length - 2; i >= 0; i--) {
      const clip = sequence.videoTracks[0]?.clips[i]
      if (!clip) continue
      sequence = insertPauseGap(sequence, {
        atSeconds: clip.timelineOutSeconds,
        durationSeconds: pacing.pauseGapSeconds,
        note: `Auto ${String(input.pacingMode ?? 'Balanced').toLowerCase()} pause`
      }).sequence
    }
    sequence = { ...sequence, metadata: { ...sequence.metadata, pacingMode: input.pacingMode ?? 'Balanced' } }
  }
  return sequence
}
