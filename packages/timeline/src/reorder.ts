import type { TimelineClip, TimelineSequence, TimelineTrack } from './model.js'

/**
 * Re-order the clips on a single video track and the matching audio track,
 * then re-flow `timelineInSeconds` / `timelineOutSeconds` so they stay
 * butt-spliced (no gaps, no overlaps).
 *
 * Caller passes the `id`s of the video clips in the new visual order.
 * Audio clips are re-ordered by matching their `soundbiteId` to the video
 * clip's `soundbiteId` (or, for older rough-cuts that don't carry that
 * field, by the `${videoClipId}-audio` naming convention used by
 * `buildRoughCutSequence`).
 *
 * Markers and B-roll slots are re-anchored by matching their original
 * timestamp to the clip that previously contained it, then translating to
 * the new clip position. Markers/slots that don't fall inside any clip
 * are dropped (logged) — there's no canonical place to put them in the
 * reflowed timeline.
 *
 * The returned sequence is a brand-new object — safe to feed straight
 * into a Zustand setter without aliasing.
 */
export function reorderClipsInSequence(
  sequence: TimelineSequence,
  trackIndex: number,
  newClipIdOrder: string[]
): TimelineSequence {
  const sourceTrack = sequence.videoTracks?.[trackIndex]
  if (!sourceTrack) return sequence

  const idToOriginal = new Map(sourceTrack.clips.map((c) => [c.id, c] as const))
  const reorderedSet = new Set(newClipIdOrder)

  const reorderedVideo: TimelineClip[] = []
  for (const id of newClipIdOrder) {
    const clip = idToOriginal.get(id)
    if (clip) reorderedVideo.push(clip)
  }
  // Append clips the caller forgot about (defensive — should be a no-op).
  for (const clip of sourceTrack.clips) {
    if (!reorderedSet.has(clip.id)) reorderedVideo.push(clip)
  }

  // Build the original-position map BEFORE reflowing so we can re-anchor markers.
  const originalSpanByVideoId = new Map<string, { start: number; end: number }>()
  for (const c of sourceTrack.clips) {
    originalSpanByVideoId.set(c.id, {
      start: c.timelineInSeconds,
      end: c.timelineOutSeconds
    })
  }

  // Reflow video clips and remember the new spans, keyed by clip id.
  const newSpanByVideoId = new Map<string, { start: number; end: number }>()
  let cursor = 0
  const reflowedVideo: TimelineClip[] = reorderedVideo.map((c) => {
    const dur = Math.max(0, c.timelineOutSeconds - c.timelineInSeconds)
    const start = cursor
    const end = cursor + dur
    cursor = end
    newSpanByVideoId.set(c.id, { start, end })
    return { ...c, timelineInSeconds: start, timelineOutSeconds: end }
  })

  // Reflow audio: match each audio clip to a video clip and copy that
  // clip's new span. Audio clips are duration-locked to their video pair
  // (1:1 from `buildRoughCutSequence`), so we don't recompute durations.
  const reflowedAudioTracks: TimelineTrack[] = (sequence.audioTracks ?? []).map((track) => {
    const audioClips = track.clips
    const reorderedAudio: TimelineClip[] = []
    const usedAudioIds = new Set<string>()

    for (const v of reflowedVideo) {
      const matchingAudio = findAudioPairForVideoClip(v, audioClips)
      if (matchingAudio && !usedAudioIds.has(matchingAudio.id)) {
        usedAudioIds.add(matchingAudio.id)
        reorderedAudio.push({
          ...matchingAudio,
          timelineInSeconds: v.timelineInSeconds,
          timelineOutSeconds: v.timelineOutSeconds
        })
      }
    }
    // Append any audio clips we couldn't pair (different track shape, etc.)
    // at the tail in their original order so we don't silently drop content.
    for (const a of audioClips) {
      if (!usedAudioIds.has(a.id)) reorderedAudio.push(a)
    }
    return { ...track, clips: reorderedAudio }
  })

  // Re-anchor markers: find which clip each marker used to live inside, then
  // translate the offset into the clip's new span. Markers outside any clip
  // are dropped — they're orphaned anyway after a reorder.
  const reflowedMarkers = (sequence.markers ?? [])
    .map((m) => {
      const host = sourceTrack.clips.find(
        (c) => m.timeSeconds >= c.timelineInSeconds && m.timeSeconds <= c.timelineOutSeconds
      )
      if (!host) return null
      const newSpan = newSpanByVideoId.get(host.id)
      if (!newSpan) return null
      const offset = m.timeSeconds - host.timelineInSeconds
      return { ...m, timeSeconds: newSpan.start + offset }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  const reflowedBrollSlots = (sequence.brollSlots ?? [])
    .map((s) => {
      const host = sourceTrack.clips.find(
        (c) => s.timelineStart >= c.timelineInSeconds && s.timelineEnd <= c.timelineOutSeconds
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
      const host = sourceTrack.clips.find(
        (c) => s.timelineStart >= c.timelineInSeconds && s.timelineEnd <= c.timelineOutSeconds
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
 * Close empty spaces on the target video track while preserving the clips'
 * current left-to-right order on the timeline.
 */
export function closeTimelineGapsInSequence(
  sequence: TimelineSequence,
  trackIndex: number
): TimelineSequence {
  const sourceTrack = sequence.videoTracks?.[trackIndex]
  if (!sourceTrack) return sequence
  const orderedIds = [...sourceTrack.clips]
    .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    .map((clip) => clip.id)
  return reorderClipsInSequence(sequence, trackIndex, orderedIds)
}

/**
 * Move a V1 clip to a new absolute timeline position without butt-splicing the
 * rest of the track. The moved clip keeps its duration/source window and drags
 * along any linked nat-audio, markers, overlays, and B-roll slots that lived
 * inside the clip. Other clips stay where they are.
 *
 * To keep a single-lane timeline valid, we only allow destinations where the
 * moved clip fits fully inside an available gap (including the gap created by
 * removing the clip from its original location). If there is no valid gap, the
 * original sequence is returned unchanged.
 */
export function moveClipFreelyInSequence(
  sequence: TimelineSequence,
  trackIndex: number,
  clipId: string,
  targetTimelineInSeconds: number
): TimelineSequence {
  const sourceTrack = sequence.videoTracks?.[trackIndex]
  if (!sourceTrack) return sequence
  const clip = sourceTrack.clips.find((c) => c.id === clipId)
  if (!clip) return sequence

  const duration = Math.max(0, clip.timelineOutSeconds - clip.timelineInSeconds)
  const desiredStart = Math.max(0, targetTimelineInSeconds)
  const desiredEnd = desiredStart + duration
  const remainingVideo = sourceTrack.clips
    .filter((c) => c.id !== clipId)
    .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)

  const slots: Array<{ start: number; end: number }> = []
  let cursor = 0
  for (const existing of remainingVideo) {
    if (existing.timelineInSeconds > cursor) {
      slots.push({ start: cursor, end: existing.timelineInSeconds })
    }
    cursor = Math.max(cursor, existing.timelineOutSeconds)
  }
  slots.push({ start: cursor, end: Number.POSITIVE_INFINITY })

  let chosenStart: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const slot of slots) {
    const minStart = slot.start
    const maxStart = Number.isFinite(slot.end)
      ? Math.max(slot.start, slot.end - duration)
      : Number.POSITIVE_INFINITY
    if (Number.isFinite(slot.end) && slot.end - slot.start < duration - 1e-6) continue
    const candidate = Number.isFinite(maxStart)
      ? Math.min(Math.max(desiredStart, minStart), maxStart)
      : Math.max(desiredStart, minStart)
    const distance = Math.abs(candidate - desiredStart)
    if (distance < bestDistance) {
      chosenStart = candidate
      bestDistance = distance
    }
  }
  if (chosenStart == null) return sequence
  const delta = chosenStart - clip.timelineInSeconds
  if (Math.abs(delta) < 1e-4) return sequence

  const movedClip: TimelineClip = {
    ...clip,
    timelineInSeconds: clip.timelineInSeconds + delta,
    timelineOutSeconds: clip.timelineOutSeconds + delta
  }

  const originalStart = clip.timelineInSeconds
  const originalEnd = clip.timelineOutSeconds
  const movedVideo = [...remainingVideo, movedClip].sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)

  const movedAudioTracks: TimelineTrack[] = (sequence.audioTracks ?? []).map((track) => {
    const pair = findAudioPairForVideoClip(clip, track.clips)
    return {
      ...track,
      clips: track.clips.map((audioClip) =>
        pair && audioClip.id === pair.id
          ? {
              ...audioClip,
              timelineInSeconds: audioClip.timelineInSeconds + delta,
              timelineOutSeconds: audioClip.timelineOutSeconds + delta
            }
          : audioClip
      )
    }
  })

  const movedMarkers = (sequence.markers ?? []).map((marker) =>
    marker.timeSeconds >= originalStart && marker.timeSeconds <= originalEnd
      ? { ...marker, timeSeconds: marker.timeSeconds + delta }
      : marker
  )

  const movedBrollSlots = sequence.brollSlots?.map((slot) =>
    slot.timelineStart >= originalStart && slot.timelineEnd <= originalEnd
      ? {
          ...slot,
          timelineStart: slot.timelineStart + delta,
          timelineEnd: slot.timelineEnd + delta
        }
      : slot
  )

  const movedOverlayEvents = sequence.overlayEvents?.map((event) =>
    event.timelineInSeconds >= originalStart && event.timelineOutSeconds <= originalEnd
      ? {
          ...event,
          timelineInSeconds: event.timelineInSeconds + delta,
          timelineOutSeconds: event.timelineOutSeconds + delta
        }
      : event
  )

  const movedGraphicsSlots = sequence.graphicsSlots?.map((slot) =>
    slot.timelineStart >= originalStart && slot.timelineEnd <= originalEnd
      ? {
          ...slot,
          timelineStart: slot.timelineStart + delta,
          timelineEnd: slot.timelineEnd + delta
        }
      : slot
  )

  const newVideoTracks = sequence.videoTracks.map((track, index) =>
    index === trackIndex ? { ...track, clips: movedVideo } : track
  )

  const durationSeconds = Math.max(
    sequence.durationSeconds,
    ...newVideoTracks.flatMap((track) => track.clips.map((c) => c.timelineOutSeconds)),
    ...movedAudioTracks.flatMap((track) => track.clips.map((c) => c.timelineOutSeconds)),
    ...(movedBrollSlots ?? []).map((slot) => slot.timelineEnd),
    ...(movedGraphicsSlots ?? []).map((slot) => slot.timelineEnd)
  )

  return {
    ...sequence,
    durationSeconds,
    videoTracks: newVideoTracks,
    audioTracks: movedAudioTracks,
    markers: movedMarkers,
    ...(movedBrollSlots ? { brollSlots: movedBrollSlots } : {}),
    ...(movedOverlayEvents ? { overlayEvents: movedOverlayEvents } : {}),
    ...(movedGraphicsSlots ? { graphicsSlots: movedGraphicsSlots } : {})
  }
}

/**
 * Find the audio clip that pairs with a given video clip in the same
 * sequence. The pairing priority mirrors how `buildRoughCutSequence`
 * lays things out:
 *   1. explicit `soundbiteId` linkage (preferred — survives renames),
 *   2. `${videoClipId}-audio` naming convention,
 *   3. same source asset + identical source window.
 *
 * Exported so reorder + delete + trim helpers can all stay in sync.
 */
export function findAudioPairForVideoClip(
  videoClip: TimelineClip,
  audioClips: TimelineClip[]
): TimelineClip | null {
  if (videoClip.soundbiteId) {
    const bySoundbite = audioClips.find((a) => a.soundbiteId === videoClip.soundbiteId)
    if (bySoundbite) return bySoundbite
  }
  const conventional = audioClips.find((a) => a.id === `${videoClip.id}-audio`)
  if (conventional) return conventional
  return (
    audioClips.find(
      (a) =>
        a.assetId === videoClip.assetId &&
        Math.abs(a.sourceInSeconds - videoClip.sourceInSeconds) < 0.001 &&
        Math.abs(a.sourceOutSeconds - videoClip.sourceOutSeconds) < 0.001
    ) ?? null
  )
}
