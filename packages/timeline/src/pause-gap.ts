/**
 * Pause-gap insertion — the user clicks "Add Pause / Breathing Room" at a
 * playhead position and we (a) splice a silent placeholder clip into V1 + A1,
 * (b) push every clip that starts at or after that point forward by `duration`,
 * (c) shift any overlay events that started after the cut, and (d) bump
 * `sequence.durationSeconds`.
 *
 * Why a real silent clip and not just a gap in the middle of two clips?
 *   - Export pipelines (ffmpeg concat + NLE XML) are easier to reason about
 *     when every second on V1 is covered by an explicit clip — silence-cuts
 *     and pause-gaps are both first-class clips with `role` distinguishing
 *     them. The MP4 exporter renders a `pause-gap` clip as N seconds of
 *     black (or held last frame) + silence; the NLE exporter writes them as
 *     gap clips so the editor can drop their own breathing-room asset in.
 *   - Treating the gap as an editorial clip means it survives reorders,
 *     trims, and the JSON round-trip without special-case branches.
 *
 * If the playhead falls *inside* a clip (the common case — user scrubbed to
 * 12.7s and that's mid-soundbite), we currently insert AT the next clip
 * boundary at-or-after `atSeconds`. Splitting a clip mid-frame would change
 * the source-window math on a real soundbite, which is a separate feature
 * (`splitClipAt(...)`) we'll add when the user asks for it. The toast in the
 * UI calls this out explicitly so the behavior isn't a surprise.
 */
import type {
  TimelineClip,
  TimelineSequence,
  TimelineTrack
} from './model.js'

const MIN_PAUSE_SECONDS = 0.25
const DEFAULT_PAUSE_SECONDS = 1.5

function clampPauseDuration(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_PAUSE_SECONDS
  return Math.max(MIN_PAUSE_SECONDS, requested)
}

function pauseGapId(): string {
  return `pause-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function makePauseClip(timelineInSeconds: number, durationSec: number, note?: string): TimelineClip {
  return {
    id: pauseGapId(),
    role: 'pause-gap',
    /**
     * `assetId === ''` is the marker that this clip has no source media and
     * should be rendered as silent black by the MP4 exporter. The NLE
     * exporter writes these as XML gap clips, no asset reference required.
     */
    assetId: '',
    sourceInSeconds: 0,
    sourceOutSeconds: durationSec,
    timelineInSeconds,
    timelineOutSeconds: timelineInSeconds + durationSec,
    metadata: note ? { note } : undefined
  }
}

/**
 * Snap to the nearest clip boundary at or after `atSeconds` so we never
 * split a real soundbite. If the timeline is empty, we return `atSeconds`
 * unchanged so the gap is the first thing on the timeline.
 */
function snapToNextBoundary(sequence: TimelineSequence, atSeconds: number): number {
  const allStarts = sequence.videoTracks
    .flatMap((t) => t.clips)
    .map((c) => c.timelineInSeconds)
    .filter((t) => t >= atSeconds)
    .sort((a, b) => a - b)
  if (allStarts.length === 0) return atSeconds
  /**
   * If the user clicked very close to a boundary (within 100ms), use it.
   * Otherwise prefer the boundary so we never split mid-clip — but if the
   * nearest boundary is more than 5 seconds away the user almost certainly
   * meant "right here" not "skip 5 seconds forward", so we just clamp to
   * the current playhead and let the gap land mid-clip. The MP4 exporter
   * will treat it as a hard cut at that frame, which is the same behavior
   * you'd get from a manual blade-tool cut in any NLE.
   */
  const next = allStarts[0]!
  const dist = next - atSeconds
  if (dist <= 0.1) return next
  if (dist > 5) return atSeconds
  return next
}

export interface InsertPauseGapInput {
  /** Sequence-time seconds where the user wants the gap. */
  atSeconds: number
  /** Length of the silent gap. Defaults to `DEFAULT_PAUSE_SECONDS`. */
  durationSeconds?: number
  /** Optional editorial note shown in the timeline list ("between hook and tension"). */
  note?: string
}

export interface InsertPauseGapResult {
  sequence: TimelineSequence
  pauseClipId: string
  insertedAtSeconds: number
  durationSeconds: number
  /** True when we snapped from `atSeconds` to the next clip boundary. */
  snapped: boolean
}

/**
 * Splice a `pause-gap` clip into V1 + A1 and push every later clip + overlay
 * forward by `durationSeconds`. Returns the new sequence plus enough info for
 * the UI to show "inserted 1.5s at 14.2s" toasts.
 */
export function insertPauseGap(
  sequence: TimelineSequence,
  input: InsertPauseGapInput
): InsertPauseGapResult {
  const dur = clampPauseDuration(input.durationSeconds ?? DEFAULT_PAUSE_SECONDS)
  const requestedAt = Math.max(0, input.atSeconds)
  const insertAt = snapToNextBoundary(sequence, requestedAt)
  const snapped = Math.abs(insertAt - requestedAt) > 0.05

  const shift = (t: number): number => (t >= insertAt ? t + dur : t)

  const pauseClip = makePauseClip(insertAt, dur, input.note)

  /**
   * Video tracks: shift every clip whose START is at or after the cut.
   * V1 (the first video track) also gets the new pause-gap clip; other
   * video tracks just shift. We only insert the gap clip on V1 because
   * a 1.5-second hold doesn't need to exist on B-roll lanes — those lanes
   * already overlay onto V1 and inherit its timing.
   */
  const videoTracks: TimelineTrack[] = sequence.videoTracks.map((track, idx) => {
    const isPrimary = idx === 0
    const shiftedClips = track.clips.map((c) => ({
      ...c,
      timelineInSeconds: shift(c.timelineInSeconds),
      timelineOutSeconds: shift(c.timelineOutSeconds)
    }))
    if (!isPrimary) return { ...track, clips: shiftedClips.sort((a, b) => a.timelineInSeconds - b.timelineInSeconds) }
    return {
      ...track,
      clips: [...shiftedClips, pauseClip].sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    }
  })

  /**
   * Audio tracks: shift every clip the same way; insert a silent gap on A1
   * so the audio track stays time-aligned with V1. A1 is the dialogue track
   * by convention (matches the NLE exporter and `mp4-export.ts`).
   */
  const audioTracks: TimelineTrack[] = sequence.audioTracks.map((track, idx) => {
    const isPrimary = idx === 0
    const shiftedClips = track.clips.map((c) => ({
      ...c,
      timelineInSeconds: shift(c.timelineInSeconds),
      timelineOutSeconds: shift(c.timelineOutSeconds)
    }))
    if (!isPrimary) return { ...track, clips: shiftedClips.sort((a, b) => a.timelineInSeconds - b.timelineInSeconds) }
    /**
     * The audio gap re-uses the same id+structure as V1 so debugging across
     * tracks is one grep — but with role='pause-gap' the audio track render
     * just outputs silence regardless of how the audio exporter usually
     * resolves an empty `assetId`.
     */
    const audioGap: TimelineClip = { ...pauseClip, id: `${pauseClip.id}-a` }
    return {
      ...track,
      clips: [...shiftedClips, audioGap].sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    }
  })

  /**
   * Overlay events that started after the cut need to shift too. Without
   * this, a hook overlay that landed at 14.0s would appear over the pause
   * (silence + black) instead of the soundbite the user originally aligned
   * it with.
   */
  const overlayEvents = (sequence.overlayEvents ?? []).map((e) =>
    e.timelineInSeconds >= insertAt
      ? {
          ...e,
          timelineInSeconds: e.timelineInSeconds + dur,
          timelineOutSeconds: e.timelineOutSeconds + dur
        }
      : e
  )

  /**
   * Markers shift the same way — section markers ("Hook", "Tension")
   * conceptually point at clip boundaries that just moved.
   */
  const markers = sequence.markers.map((m) =>
    m.timeSeconds >= insertAt ? { ...m, timeSeconds: m.timeSeconds + dur } : m
  )

  /**
   * B-roll slots shift in lock-step with their parent A-roll segments —
   * the slot's timeline window is what the user reasons about.
   */
  const brollSlots = (sequence.brollSlots ?? []).map((s) =>
    s.timelineStart >= insertAt
      ? { ...s, timelineStart: s.timelineStart + dur, timelineEnd: s.timelineEnd + dur }
      : s
  )

  const graphicsSlots = (sequence.graphicsSlots ?? []).map((s) =>
    s.timelineStart >= insertAt
      ? { ...s, timelineStart: s.timelineStart + dur, timelineEnd: s.timelineEnd + dur }
      : s
  )

  const next: TimelineSequence = {
    ...sequence,
    videoTracks,
    audioTracks,
    markers,
    overlayEvents,
    brollSlots,
    graphicsSlots,
    durationSeconds: sequence.durationSeconds + dur
  }

  return {
    sequence: next,
    pauseClipId: pauseClip.id,
    insertedAtSeconds: insertAt,
    durationSeconds: dur,
    snapped
  }
}

/**
 * Remove a pause-gap clip and pull everything after it back by the gap's
 * duration. Mirrors the math in `insertPauseGap` so a remove of a 1.5s gap
 * undoes the insert exactly. Useful for the per-pause "Remove" button in
 * the Enhance list.
 */
export function removePauseGap(sequence: TimelineSequence, pauseClipId: string): TimelineSequence {
  const v1 = sequence.videoTracks[0]
  if (!v1) return sequence
  const target = v1.clips.find((c) => c.id === pauseClipId && c.role === 'pause-gap')
  if (!target) return sequence
  const cutAt = target.timelineInSeconds
  const dur = target.timelineOutSeconds - target.timelineInSeconds

  const unshift = (t: number): number => (t > cutAt ? t - dur : t)

  const videoTracks: TimelineTrack[] = sequence.videoTracks.map((track) => ({
    ...track,
    clips: track.clips
      .filter((c) => c.id !== pauseClipId)
      .map((c) => ({
        ...c,
        timelineInSeconds: unshift(c.timelineInSeconds),
        timelineOutSeconds: unshift(c.timelineOutSeconds)
      }))
      .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
  }))

  const audioTracks: TimelineTrack[] = sequence.audioTracks.map((track) => ({
    ...track,
    clips: track.clips
      .filter((c) => c.id !== `${pauseClipId}-a`)
      .map((c) => ({
        ...c,
        timelineInSeconds: unshift(c.timelineInSeconds),
        timelineOutSeconds: unshift(c.timelineOutSeconds)
      }))
      .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
  }))

  const overlayEvents = (sequence.overlayEvents ?? []).map((e) =>
    e.timelineInSeconds > cutAt
      ? {
          ...e,
          timelineInSeconds: Math.max(0, e.timelineInSeconds - dur),
          timelineOutSeconds: Math.max(0, e.timelineOutSeconds - dur)
        }
      : e
  )

  const markers = sequence.markers.map((m) =>
    m.timeSeconds > cutAt ? { ...m, timeSeconds: Math.max(0, m.timeSeconds - dur) } : m
  )

  const brollSlots = (sequence.brollSlots ?? []).map((s) =>
    s.timelineStart > cutAt
      ? {
          ...s,
          timelineStart: Math.max(0, s.timelineStart - dur),
          timelineEnd: Math.max(0, s.timelineEnd - dur)
        }
      : s
  )

  const graphicsSlots = (sequence.graphicsSlots ?? []).map((s) =>
    s.timelineStart > cutAt
      ? {
          ...s,
          timelineStart: Math.max(0, s.timelineStart - dur),
          timelineEnd: Math.max(0, s.timelineEnd - dur)
        }
      : s
  )

  return {
    ...sequence,
    videoTracks,
    audioTracks,
    markers,
    overlayEvents,
    brollSlots,
    graphicsSlots,
    durationSeconds: Math.max(0, sequence.durationSeconds - dur)
  }
}

/**
 * Convenience: list every pause-gap clip on V1 + the audio mirror id, so the
 * UI can render "1.5s pause at 14.2s · Remove" rows without re-traversing
 * the sequence.
 */
export interface PauseGapListItem {
  videoClipId: string
  audioClipId: string
  timelineInSeconds: number
  durationSeconds: number
  note?: string
}

export function listPauseGaps(sequence: TimelineSequence): PauseGapListItem[] {
  const v1 = sequence.videoTracks[0]
  if (!v1) return []
  return v1.clips
    .filter((c) => c.role === 'pause-gap')
    .map((c) => ({
      videoClipId: c.id,
      audioClipId: `${c.id}-a`,
      timelineInSeconds: c.timelineInSeconds,
      durationSeconds: c.timelineOutSeconds - c.timelineInSeconds,
      note: typeof c.metadata?.note === 'string' ? c.metadata.note : undefined
    }))
    .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
}
