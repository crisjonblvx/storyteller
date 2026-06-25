import type { TimelineClip, TimelineSequence, TimelineTrack } from './model.js'
import { findAudioPairForVideoClip } from './reorder.js'

/** Edge of a clip being trimmed. */
export type ClipTrimEdge = 'in' | 'out'

/** Minimum duration (seconds) we'll allow a clip to be trimmed down to. */
export const MIN_CLIP_DURATION_SEC = 0.05

/**
 * Ripple-delete a video clip on the given track. Removes:
 *   - the clip itself,
 *   - its paired audio clip (if any),
 *   - any markers / B-roll slots that lived inside it.
 *
 * Then re-flows every later clip on V1 + matching audio on A1 so the
 * timeline stays butt-spliced (no gap where the clip used to be).
 *
 * Returns a brand-new `TimelineSequence` — safe to feed into a state
 * setter without aliasing.
 */
export function removeClipFromSequence(
  sequence: TimelineSequence,
  trackIndex: number,
  clipId: string
): TimelineSequence {
  const sourceTrack = sequence.videoTracks?.[trackIndex]
  if (!sourceTrack) return sequence
  const target = sourceTrack.clips.find((c) => c.id === clipId)
  if (!target) return sequence

  // Remember the original time range so we can drop orphaned markers / b-roll.
  const removedStart = target.timelineInSeconds
  const removedEnd = target.timelineOutSeconds

  // 1. Drop the video clip and reflow.
  const remainingVideo = sourceTrack.clips.filter((c) => c.id !== clipId)
  const newSpanByVideoId = new Map<string, { start: number; end: number }>()
  let cursor = 0
  const reflowedVideo: TimelineClip[] = remainingVideo.map((c) => {
    const dur = Math.max(0, c.timelineOutSeconds - c.timelineInSeconds)
    const start = cursor
    const end = cursor + dur
    cursor = end
    newSpanByVideoId.set(c.id, { start, end })
    return { ...c, timelineInSeconds: start, timelineOutSeconds: end }
  })

  // 2. Drop the paired audio clip from each audio track and reflow what's left.
  const reflowedAudioTracks: TimelineTrack[] = (sequence.audioTracks ?? []).map((track) => {
    const pair = findAudioPairForVideoClip(target, track.clips)
    const remainingAudio = pair ? track.clips.filter((a) => a.id !== pair.id) : track.clips

    const reorderedAudio: TimelineClip[] = []
    const usedAudioIds = new Set<string>()
    for (const v of reflowedVideo) {
      const matchingAudio = findAudioPairForVideoClip(v, remainingAudio)
      if (matchingAudio && !usedAudioIds.has(matchingAudio.id)) {
        usedAudioIds.add(matchingAudio.id)
        reorderedAudio.push({
          ...matchingAudio,
          timelineInSeconds: v.timelineInSeconds,
          timelineOutSeconds: v.timelineOutSeconds
        })
      }
    }
    // Anything we couldn't pair (different track shape) keeps its original
    // time so we don't silently relocate user-added audio.
    for (const a of remainingAudio) {
      if (!usedAudioIds.has(a.id)) reorderedAudio.push(a)
    }
    return { ...track, clips: reorderedAudio }
  })

  // 3. Re-anchor markers: drop ones that lived inside the removed clip,
  //    translate the rest into their host clip's new span.
  const reflowedMarkers = (sequence.markers ?? [])
    .map((m) => {
      if (m.timeSeconds >= removedStart && m.timeSeconds <= removedEnd) return null
      const host = sourceTrack.clips.find(
        (c) =>
          c.id !== clipId &&
          m.timeSeconds >= c.timelineInSeconds &&
          m.timeSeconds <= c.timelineOutSeconds
      )
      if (!host) return null
      const newSpan = newSpanByVideoId.get(host.id)
      if (!newSpan) return null
      const offset = m.timeSeconds - host.timelineInSeconds
      return { ...m, timeSeconds: newSpan.start + offset }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  // 4. Same treatment for B-roll slots.
  const reflowedBrollSlots = (sequence.brollSlots ?? [])
    .map((s) => {
      if (s.timelineStart >= removedStart && s.timelineEnd <= removedEnd) return null
      const host = sourceTrack.clips.find(
        (c) =>
          c.id !== clipId &&
          s.timelineStart >= c.timelineInSeconds &&
          s.timelineEnd <= c.timelineOutSeconds
      )
      if (!host) return null
      const newSpan = newSpanByVideoId.get(host.id)
      if (!newSpan) return null
      const startOffset = s.timelineStart - host.timelineInSeconds
      const endOffset = s.timelineEnd - host.timelineInSeconds
      return {
        ...s,
        timelineStart: newSpan.start + startOffset,
        timelineEnd: newSpan.start + endOffset
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  const reflowedGraphicsSlots = (sequence.graphicsSlots ?? [])
    .map((s) => {
      if (s.timelineStart >= removedStart && s.timelineEnd <= removedEnd) return null
      const host = sourceTrack.clips.find(
        (c) =>
          c.id !== clipId &&
          s.timelineStart >= c.timelineInSeconds &&
          s.timelineEnd <= c.timelineOutSeconds
      )
      if (!host) return null
      const newSpan = newSpanByVideoId.get(host.id)
      if (!newSpan) return null
      const startOffset = s.timelineStart - host.timelineInSeconds
      const endOffset = s.timelineEnd - host.timelineInSeconds
      return {
        ...s,
        timelineStart: newSpan.start + startOffset,
        timelineEnd: newSpan.start + endOffset
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  const newVideoTracks = sequence.videoTracks.map((t, i) =>
    i === trackIndex ? { ...t, clips: reflowedVideo } : t
  )

  return {
    ...sequence,
    durationSeconds: cursor,
    videoTracks: newVideoTracks,
    audioTracks: reflowedAudioTracks,
    markers: reflowedMarkers,
    ...(sequence.brollSlots ? { brollSlots: reflowedBrollSlots } : {}),
    ...(sequence.graphicsSlots ? { graphicsSlots: reflowedGraphicsSlots } : {})
  }
}

/**
 * Trim a clip's IN or OUT edge. **Fixed mode** — only the trimmed clip
 * changes; downstream clips stay where they are. The paired audio clip
 * mirrors the new in/out so video + nat-audio remain in sync.
 *
 * Clamping rules (edge-aware):
 *   - IN edge:   can't cross the OUT edge minus `MIN_CLIP_DURATION_SEC`,
 *                can't go before the source asset start (`sourceInSeconds = 0`),
 *                and normally can't go before the previous clip's OUT.
 *                Special-case: the first clip can reveal earlier source by
 *                lengthening to the right and rippling everything after it.
 *   - OUT edge:  can't cross the IN edge plus `MIN_CLIP_DURATION_SEC`.
 *                Pulling the OUT later ripples following timeline items right
 *                instead of stopping at the next edit.
 *
 * Source-range clamping: we shift `sourceInSeconds` / `sourceOutSeconds`
 * by the same delta so the visible content stays anchored to the clip's
 * source frames. Pulling the IN earlier reveals more head room from the
 * source asset; we cap at `sourceInSeconds = 0` (we don't know the asset
 * duration here, so the OUT-cap at the next clip is the only stop on
 * that side — a higher-level UI can also pass `maxSourceSeconds` if we
 * ever need a hard ceiling).
 *
 * `deltaSec` is signed: positive = pull edge to the right (clip starts
 * later for IN, ends later for OUT), negative = left.
 *
 * Returns a brand-new sequence (or the same reference if the trim was a
 * no-op after clamping).
 */
export function trimClipInSequence(
  sequence: TimelineSequence,
  trackIndex: number,
  clipId: string,
  edge: ClipTrimEdge,
  deltaSec: number
): TimelineSequence {
  if (deltaSec === 0) return sequence
  const sourceTrack = sequence.videoTracks?.[trackIndex]
  if (!sourceTrack) return sequence
  const idx = sourceTrack.clips.findIndex((c) => c.id === clipId)
  if (idx < 0) return sequence
  const clip = sourceTrack.clips[idx]!
  const originalOut = clip.timelineOutSeconds

  const prev = sourceTrack.clips[idx - 1] ?? null
  const next = sourceTrack.clips[idx + 1] ?? null

  let nextIn = clip.timelineInSeconds
  let nextOut = clip.timelineOutSeconds
  let nextSrcIn = clip.sourceInSeconds
  let nextSrcOut = clip.sourceOutSeconds
  let extensionDelta = 0

  if (edge === 'in') {
    const minIn = prev ? prev.timelineOutSeconds : 0
    const maxIn = clip.timelineOutSeconds - MIN_CLIP_DURATION_SEC
    if (deltaSec < 0) {
      /**
       * Pulling the IN edge earlier should reveal earlier source while
       * following the cursor inside any available gap on the timeline.
       *
       * The previous implementation snapped straight to `prev.timelineOut`
       * and then lengthened the OUT edge, which made left-edge drags feel
       * jumpy and inconsistent whenever the clip wasn't already butt-spliced.
       */
      const timelineHeadroom = Math.max(0, clip.timelineInSeconds - minIn)
      const revealEarlierBy = Math.min(-deltaSec, clip.sourceInSeconds, timelineHeadroom)
      if (revealEarlierBy > 0) {
        nextIn = clip.timelineInSeconds - revealEarlierBy
        nextSrcIn = clip.sourceInSeconds - revealEarlierBy
      } else if (!prev) {
        /**
         * Special-case the first clip: if it's already pinned at 0 on the
         * timeline but still has earlier source available, allow the user to
         * "lengthen from the left" by growing the clip to the right and
         * rippling everything after it.
         */
        const extendBy = Math.min(-deltaSec, clip.sourceInSeconds)
        if (extendBy <= 0) return sequence
        nextIn = 0
        nextOut = clip.timelineOutSeconds + extendBy
        nextSrcIn = clip.sourceInSeconds - extendBy
        extensionDelta = extendBy
      }
    } else {
      let candidate = clip.timelineInSeconds + deltaSec
      if (candidate < minIn) candidate = minIn
      if (candidate > maxIn) candidate = maxIn
      nextSrcIn = clip.sourceInSeconds + (candidate - clip.timelineInSeconds)
      nextIn = candidate
    }
  } else {
    const minOut = clip.timelineInSeconds + MIN_CLIP_DURATION_SEC
    let candidate = clip.timelineOutSeconds + deltaSec
    if (candidate < minOut) candidate = minOut
    const appliedDelta = candidate - clip.timelineOutSeconds
    nextSrcOut = clip.sourceOutSeconds + appliedDelta
    nextOut = candidate
    // Clamp to the actual asset duration when available so we don't reference
    // frames beyond the end of the source file.
    if (clip.assetDurationSeconds != null && nextSrcOut > clip.assetDurationSeconds) {
      nextSrcOut = clip.assetDurationSeconds
      nextOut = clip.timelineInSeconds + (nextSrcOut - nextSrcIn)
    }
    extensionDelta = Math.max(0, nextOut - clip.timelineOutSeconds)
  }

  if (nextIn === clip.timelineInSeconds && nextOut === clip.timelineOutSeconds) {
    return sequence
  }

  const updatedVideoClip: TimelineClip = {
    ...clip,
    timelineInSeconds: nextIn,
    timelineOutSeconds: nextOut,
    sourceInSeconds: nextSrcIn,
    sourceOutSeconds: nextSrcOut
  }

  const rippleAfter = (t: number): number => (extensionDelta > 0 && t >= originalOut ? t + extensionDelta : t)

  const updatedVideoClips = sourceTrack.clips.map((existing, existingIdx) => {
    if (existingIdx === idx) return updatedVideoClip
    if (extensionDelta <= 0) return existing
    return {
      ...existing,
      timelineInSeconds: rippleAfter(existing.timelineInSeconds),
      timelineOutSeconds: rippleAfter(existing.timelineOutSeconds)
    }
  })

  // Mirror the new in/out + source onto the paired audio clip so they
  // stay frame-locked with the video.
  const updatedAudioTracks: TimelineTrack[] = (sequence.audioTracks ?? []).map((track) => {
    const pair = findAudioPairForVideoClip(clip, track.clips)
    return {
      ...track,
      clips: track.clips.map((a) => {
        if (pair && a.id === pair.id) {
          return {
            ...a,
            timelineInSeconds: nextIn,
            timelineOutSeconds: nextOut,
            sourceInSeconds: nextSrcIn,
            sourceOutSeconds: nextSrcOut
          }
        }
        if (extensionDelta <= 0) return a
        return {
          ...a,
          timelineInSeconds: rippleAfter(a.timelineInSeconds),
          timelineOutSeconds: rippleAfter(a.timelineOutSeconds)
        }
      })
    }
  })

  const updatedMarkers =
    extensionDelta > 0
      ? (sequence.markers ?? []).map((m) =>
          m.timeSeconds >= originalOut ? { ...m, timeSeconds: rippleAfter(m.timeSeconds) } : m
        )
      : sequence.markers

  const updatedBrollSlots =
    extensionDelta > 0 && sequence.brollSlots
      ? sequence.brollSlots.map((slot) =>
          slot.timelineStart >= originalOut
            ? {
                ...slot,
                timelineStart: rippleAfter(slot.timelineStart),
                timelineEnd: rippleAfter(slot.timelineEnd)
              }
            : slot
        )
      : sequence.brollSlots

  const updatedOverlayEvents =
    extensionDelta > 0 && sequence.overlayEvents
      ? sequence.overlayEvents.map((event) =>
          event.timelineInSeconds >= originalOut
            ? {
                ...event,
                timelineInSeconds: rippleAfter(event.timelineInSeconds),
                timelineOutSeconds: rippleAfter(event.timelineOutSeconds)
              }
            : event
        )
      : sequence.overlayEvents

  const updatedGraphicsSlots =
    extensionDelta > 0 && sequence.graphicsSlots
      ? sequence.graphicsSlots.map((slot) =>
          slot.timelineStart >= originalOut
            ? {
                ...slot,
                timelineStart: rippleAfter(slot.timelineStart),
                timelineEnd: rippleAfter(slot.timelineEnd)
              }
            : slot
        )
      : sequence.graphicsSlots

  // Total duration is the max OUT across V1.
  let totalDuration = sequence.durationSeconds
  for (const c of updatedVideoClips) {
    if (c.timelineOutSeconds > totalDuration) totalDuration = c.timelineOutSeconds
  }

  const newVideoTracks = sequence.videoTracks.map((t, i) => {
    if (i === trackIndex) return { ...t, clips: updatedVideoClips }
    if (extensionDelta <= 0) return t
    return {
      ...t,
      clips: t.clips.map((c) => ({
        ...c,
        timelineInSeconds: rippleAfter(c.timelineInSeconds),
        timelineOutSeconds: rippleAfter(c.timelineOutSeconds)
      }))
    }
  })

  return {
    ...sequence,
    durationSeconds: totalDuration,
    videoTracks: newVideoTracks,
    audioTracks: updatedAudioTracks,
    markers: updatedMarkers ?? [],
    ...(updatedBrollSlots ? { brollSlots: updatedBrollSlots } : {}),
    ...(updatedOverlayEvents ? { overlayEvents: updatedOverlayEvents } : {}),
    ...(updatedGraphicsSlots ? { graphicsSlots: updatedGraphicsSlots } : {})
  }
}
