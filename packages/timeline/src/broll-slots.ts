import type { BrollSlot, BrollSlotStatus, TimelineClip, TimelineSequence, TimelineTrack } from './model.js'

export type BrollPromptLike = {
  id?: string
  segment_start: number
  segment_end: number
  prompt_type: 'literal' | 'emotional' | 'symbolic'
  metadata_json?: Record<string, unknown> | null
}

/** Map a source-time range on the primary asset to intro/rough-cut timeline seconds using video track 1 clips. */
export function mapSourceRangeToTimeline(
  sequence: TimelineSequence,
  sourceStart: number,
  sourceEnd: number
): {
  timelineStart: number
  timelineEnd: number
  soundbiteId?: string
  introRole?: string
} | null {
  const clips = sequence.videoTracks[0]?.clips ?? []
  let best: { timelineStart: number; timelineEnd: number; soundbiteId?: string; introRole?: string } | null = null
  let bestOverlap = 0
  for (const c of clips) {
    const a = Math.max(sourceStart, c.sourceInSeconds)
    const b = Math.min(sourceEnd, c.sourceOutSeconds)
    const overlap = b - a
    if (overlap > bestOverlap + 0.001) {
      bestOverlap = overlap
      const offsetStart = a - c.sourceInSeconds
      const offsetEnd = b - c.sourceInSeconds
      const tlStart = c.timelineInSeconds + offsetStart
      const tlEnd = c.timelineInSeconds + offsetEnd
      const meta = (c.metadata ?? {}) as { introRole?: string }
      best = {
        timelineStart: tlStart,
        timelineEnd: tlEnd,
        soundbiteId: c.soundbiteId,
        introRole: typeof meta.introRole === 'string' ? meta.introRole : undefined
      }
    }
  }
  return best
}

function clampSlotDuration(tlStart: number, tlEnd: number): { timelineStart: number; timelineEnd: number } {
  const span = tlEnd - tlStart
  const target = Math.min(8, Math.max(3, Math.min(span, 6)))
  if (span <= target) return { timelineStart: tlStart, timelineEnd: tlEnd }
  const center = (tlStart + tlEnd) / 2
  let s = Math.max(tlStart, center - target / 2)
  let e = Math.min(tlEnd, s + target)
  s = Math.max(tlStart, e - target)
  return { timelineStart: s, timelineEnd: e }
}

function stableSlotId(projectId: string, p: BrollPromptLike, index: number): string {
  const key = `${p.segment_start}-${p.segment_end}-${p.prompt_type}-${p.id ?? index}`
  const h = key.replace(/[^a-zA-Z0-9.-]+/g, '-').slice(0, 120)
  return `brs-${projectId.slice(0, 8)}-${h}-${index}`
}

/**
 * Locate the V1 A-roll clip whose *source-time* sits closest to the prompt's
 * source range. Used as a fallback when the prompt and the edit timeline don't
 * overlap (the dominant case for beat prompts: a prompt for soundbite at
 * source 487s, vs an intro that only includes source 30-90s).
 *
 * We anchor to the nearest A-roll moment by source-time so the cover at least
 * lands somewhere editorially related. The user can always drag it later.
 */
function nearestSourceTimelineAnchor(
  sequence: TimelineSequence,
  sourceStart: number,
  sourceEnd: number
): { timelineAnchor: number; soundbiteId?: string; introRole?: string } | null {
  const clips = sequence.videoTracks[0]?.clips ?? []
  if (clips.length === 0) return null
  const target = (sourceStart + sourceEnd) / 2

  let best: { timelineAnchor: number; distance: number; soundbiteId?: string; introRole?: string } | null = null
  for (const c of clips) {
    const cMid = (c.sourceInSeconds + c.sourceOutSeconds) / 2
    const distance = Math.abs(cMid - target)
    if (best && distance >= best.distance) continue
    const meta = (c.metadata ?? {}) as { introRole?: string }
    best = {
      timelineAnchor: c.timelineInSeconds + (c.sourceOutSeconds - c.sourceInSeconds) / 2,
      distance,
      soundbiteId: c.soundbiteId,
      introRole: typeof meta.introRole === 'string' ? meta.introRole : undefined
    }
  }
  return best ? { timelineAnchor: best.timelineAnchor, soundbiteId: best.soundbiteId, introRole: best.introRole } : null
}

/** Last edit-time second touched by any V1 clip — used to queue overflow slots. */
function timelineEndSeconds(sequence: TimelineSequence): number {
  const clips = sequence.videoTracks[0]?.clips ?? []
  if (clips.length === 0) return 0
  return clips.reduce((m, c) => Math.max(m, c.timelineOutSeconds), 0)
}

/**
 * Build B-roll slots from prompt rows + current sequence geometry.
 *
 * Layering model:
 *   - A-roll continues underneath on `v-1` (face-cam, the speaker, audio).
 *   - Each B-roll slot lives on the `v-broll` overlay track and covers the
 *     picture for ~5-8s while A-roll keeps running. This is standard NLE
 *     cover-shot semantics — the user wanted B-roll *over* existing clips.
 *
 * Placement priority:
 *   1. **Exact overlap**: prompt's source range overlaps a V1 clip → place the
 *      slot directly over that clip's segment of the edit timeline (best
 *      editorial fit).
 *   2. **Source-time proximity**: no overlap, but A-roll exists → anchor the
 *      slot at the nearest A-roll moment by source-time so the cover lands on
 *      something thematically adjacent.
 *   3. **End-of-timeline pickup**: no A-roll at all (or all anchors taken) →
 *      queue the slot at the end of the timeline as a pickup the user can
 *      drag wherever they want.
 *
 * Every prompt always gets a slot; the renderer's "Generate with Runway"
 * button is therefore always actionable. Slots created via fallback (2 / 3)
 * are flagged in `metadata.placement` so the UI can show "draggable pickup"
 * vs "anchored to source overlap".
 */
export function buildBrollSlotsFromPrompts(
  sequence: TimelineSequence,
  prompts: BrollPromptLike[],
  projectId: string,
  /**
   * Offset applied to the per-prompt index used for `metadata.promptIndex`
   * and the stable slot id. Lets the renderer build slots for a single
   * prompt at its real index in the visible list (so per-card "map this
   * one" flows produce a slot that the same card can find via
   * `promptIndex === i` matching).
   */
  indexOffset = 0
): BrollSlot[] {
  const out: BrollSlot[] = []
  let pickupCursor = timelineEndSeconds(sequence)
  const PICKUP_GAP = 0.25 // small visual gap between stacked pickups

  prompts.forEach((p, localIndex) => {
    const index = localIndex + indexOffset
    const segIds = (p.metadata_json as { sourceSegmentId?: string } | undefined)?.sourceSegmentId
      ? [(p.metadata_json as { sourceSegmentId: string }).sourceSegmentId]
      : undefined

    const mapped = mapSourceRangeToTimeline(sequence, p.segment_start, p.segment_end)
    if (mapped) {
      const { timelineStart: t0, timelineEnd: t1 } = clampSlotDuration(mapped.timelineStart, mapped.timelineEnd)
      out.push({
        id: stableSlotId(projectId, p, index),
        projectId,
        sourcePromptId: typeof p.id === 'string' ? p.id : undefined,
        sourceSegmentId: segIds?.[0],
        timelineStart: t0,
        timelineEnd: t1,
        suggestedDurationSeconds: Math.round((t1 - t0) * 10) / 10,
        introRole: mapped.introRole,
        context: p.prompt_type,
        linkedSoundbiteId: mapped.soundbiteId,
        linkedTranscriptSegmentIds: segIds,
        providerTarget: 'runway',
        status: 'empty' as BrollSlotStatus,
        metadata: {
          segmentWindow: { start: p.segment_start, end: p.segment_end },
          promptType: p.prompt_type,
          promptIndex: index,
          placement: 'overlap'
        }
      })
      return
    }

    // Fallback A: anchor near the closest A-roll moment by source-time.
    const anchor = nearestSourceTimelineAnchor(sequence, p.segment_start, p.segment_end)
    const slotDur = 5
    if (anchor) {
      const half = slotDur / 2
      const t0 = Math.max(0, anchor.timelineAnchor - half)
      const t1 = t0 + slotDur
      out.push({
        id: stableSlotId(projectId, p, index),
        projectId,
        sourcePromptId: typeof p.id === 'string' ? p.id : undefined,
        sourceSegmentId: segIds?.[0],
        timelineStart: t0,
        timelineEnd: t1,
        suggestedDurationSeconds: slotDur,
        introRole: anchor.introRole,
        context: p.prompt_type,
        linkedSoundbiteId: anchor.soundbiteId,
        linkedTranscriptSegmentIds: segIds,
        providerTarget: 'runway',
        status: 'empty' as BrollSlotStatus,
        metadata: {
          segmentWindow: { start: p.segment_start, end: p.segment_end },
          promptType: p.prompt_type,
          promptIndex: index,
          placement: 'nearest-source'
        }
      })
      return
    }

    // Fallback B: pickup queued past the end of the timeline. User drags it
    // wherever they want; a synthesized slot is still better than no button.
    const t0 = pickupCursor
    const t1 = t0 + slotDur
    pickupCursor = t1 + PICKUP_GAP
    out.push({
      id: stableSlotId(projectId, p, index),
      projectId,
      sourcePromptId: typeof p.id === 'string' ? p.id : undefined,
      sourceSegmentId: segIds?.[0],
      timelineStart: t0,
      timelineEnd: t1,
      suggestedDurationSeconds: slotDur,
      context: p.prompt_type,
      linkedTranscriptSegmentIds: segIds,
      providerTarget: 'runway',
      status: 'empty' as BrollSlotStatus,
      metadata: {
        segmentWindow: { start: p.segment_start, end: p.segment_end },
        promptType: p.prompt_type,
        promptIndex: index,
        placement: 'pickup-queue'
      }
    })
  })
  return out
}

export function ensureBrollVideoTrack(sequence: TimelineSequence): TimelineSequence {
  if (sequence.videoTracks.some((t) => t.id === 'v-broll')) return sequence
  return {
    ...sequence,
    videoTracks: [...sequence.videoTracks, { id: 'v-broll', name: 'B-roll', clips: [] }]
  }
}

/** Attach or replace a generated Runway clip on `v-broll` and mark the slot ready. */
export function attachGeneratedBrollClip(
  sequence: TimelineSequence,
  slotId: string,
  assetId: string,
  sourceFileDurationSeconds: number
): TimelineSequence {
  const slots = sequence.brollSlots ?? []
  const slot = slots.find((s) => s.id === slotId)
  if (!slot) return sequence

  const windowDur = Math.max(0.25, slot.timelineEnd - slot.timelineStart)
  const srcDur = Math.max(0.1, sourceFileDurationSeconds)
  const useDur = Math.min(windowDur, srcDur)

  const clip: TimelineClip = {
    id: `broll-clip-${slotId}`,
    role: 'b-roll',
    assetId,
    sourceInSeconds: 0,
    sourceOutSeconds: useDur,
    timelineInSeconds: slot.timelineStart,
    timelineOutSeconds: slot.timelineStart + useDur,
    assetDurationSeconds: srcDur,
    brollPromptId: slot.sourcePromptId,
    metadata: {
      brollSlotId: slotId,
      provider: 'runway',
      muteOverlayAudio: true
    }
  }

  const withTrack = ensureBrollVideoTrack(sequence)
  const nextSlots: BrollSlot[] = slots.map((s) =>
    s.id === slotId
      ? {
          ...s,
          status: 'ready' as const,
          generatedAssetId: assetId,
          errorMessage: undefined,
          runwayTaskId: s.runwayTaskId
        }
      : s
  )

  const vix = withTrack.videoTracks.findIndex((t) => t.id === 'v-broll')
  const brollTrack: TimelineTrack = withTrack.videoTracks[vix]!
  const clips = brollTrack.clips.filter((c) => (c.metadata as { brollSlotId?: string } | undefined)?.brollSlotId !== slotId)
  clips.push(clip)

  const videoTracks = withTrack.videoTracks.map((t, i) => (i === vix ? { ...t, clips } : t))
  return { ...withTrack, brollSlots: nextSlots, videoTracks }
}

export function setSlotStatus(
  sequence: TimelineSequence,
  slotId: string,
  patch: Partial<
    Pick<
      BrollSlot,
      | 'status'
      | 'errorMessage'
      | 'runwayTaskId'
      | 'higgsfieldRequestId'
      | 'referenceImageAssetId'
      | 'providerTarget'
      | 'metadata'
    >
  >
): TimelineSequence {
  const slots = (sequence.brollSlots ?? []).map((s) => (s.id === slotId ? { ...s, ...patch } : s))
  return { ...sequence, brollSlots: slots }
}

export function formatSlotWindowLabel(slot: BrollSlot): string {
  const a = formatClock(slot.timelineStart)
  const b = formatClock(slot.timelineEnd)
  const role = slot.introRole ? ` · ${slot.introRole}` : ''
  return `Slot: ${a}–${b}${role}`
}

/**
 * Move a B-roll slot (and its attached generated clip, if any) to a new
 * absolute start position. The slot keeps its duration. Returns the original
 * sequence unchanged if `slotId` is not found or the delta is negligible.
 */
export function moveBrollSlotInSequence(
  sequence: TimelineSequence,
  slotId: string,
  newStart: number
): TimelineSequence {
  const slots = sequence.brollSlots ?? []
  const slot = slots.find((s) => s.id === slotId)
  if (!slot) return sequence

  const duration = Math.max(0, slot.timelineEnd - slot.timelineStart)
  const desiredStart = Math.max(0, newStart)
  const delta = desiredStart - slot.timelineStart
  if (Math.abs(delta) < 1e-4) return sequence

  const nextSlots: BrollSlot[] = slots.map((s) =>
    s.id === slotId
      ? { ...s, timelineStart: s.timelineStart + delta, timelineEnd: s.timelineStart + delta + duration }
      : s
  )

  // Also shift the attached clip on v-broll (if any)
  const videoTracks = (sequence.videoTracks ?? []).map((track) => {
    if (track.id !== 'v-broll') return track
    return {
      ...track,
      clips: track.clips.map((c) => {
        const meta = (c.metadata ?? {}) as { brollSlotId?: string }
        if (meta.brollSlotId !== slotId) return c
        return {
          ...c,
          timelineInSeconds: c.timelineInSeconds + delta,
          timelineOutSeconds: c.timelineOutSeconds + delta
        }
      })
    }
  })

  return { ...sequence, brollSlots: nextSlots, videoTracks }
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
