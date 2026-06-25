import type {
  GraphicsSlot,
  GraphicsSlotKind,
  GraphicsSlotStatus,
  TimelineClip,
  TimelineSequence
} from './model.js'
import { mapSourceRangeToTimeline } from './broll-slots.js'

export type GraphicsPromptLike = {
  id?: string
  segment_start: number
  segment_end: number
  kind: GraphicsSlotKind
  promptText?: string
  metadata_json?: Record<string, unknown> | null
}

function stableGraphicsSlotId(projectId: string, p: GraphicsPromptLike, index: number): string {
  const key = `${p.segment_start}-${p.segment_end}-${p.kind}-${p.id ?? index}`
  const h = key.replace(/[^a-zA-Z0-9.-]+/g, '-').slice(0, 120)
  return `grs-${projectId.slice(0, 8)}-${h}-${index}`
}

function timelineEndSeconds(sequence: TimelineSequence): number {
  const clips = sequence.videoTracks[0]?.clips ?? []
  if (clips.length === 0) return 0
  return clips.reduce((m, c) => Math.max(m, c.timelineOutSeconds), 0)
}

export function buildGraphicsSlotsFromPrompts(
  sequence: TimelineSequence,
  prompts: GraphicsPromptLike[],
  projectId: string,
  indexOffset = 0
): GraphicsSlot[] {
  const out: GraphicsSlot[] = []
  let pickupCursor = timelineEndSeconds(sequence)
  const PICKUP_GAP = 0.2
  const DEFAULT_DUR = 4

  prompts.forEach((p, localIndex) => {
    const index = localIndex + indexOffset
    const segId = (p.metadata_json as { sourceSegmentId?: string } | undefined)?.sourceSegmentId
    const linkedSoundbiteId = (p.metadata_json as { soundbiteId?: string } | undefined)?.soundbiteId
    const mapped = mapSourceRangeToTimeline(sequence, p.segment_start, p.segment_end)
    if (mapped) {
      const dur = Math.max(2, Math.min(6, mapped.timelineEnd - mapped.timelineStart || DEFAULT_DUR))
      const timelineStart = mapped.timelineStart
      const timelineEnd = timelineStart + dur
      out.push({
        id: stableGraphicsSlotId(projectId, p, index),
        projectId,
        kind: p.kind,
        timelineStart,
        timelineEnd,
        suggestedDurationSeconds: dur,
        linkedSoundbiteId: linkedSoundbiteId ?? mapped.soundbiteId,
        sourceSegmentId: segId,
        linkedTranscriptSegmentIds: segId ? [segId] : undefined,
        sourcePromptId: p.id,
        promptText: p.promptText,
        status: 'empty',
        metadata: {
          segmentWindow: { start: p.segment_start, end: p.segment_end },
          promptIndex: index,
          placement: 'overlap',
          ...(p.metadata_json ?? {})
        }
      })
      return
    }

    const timelineStart = pickupCursor
    const timelineEnd = timelineStart + DEFAULT_DUR
    pickupCursor = timelineEnd + PICKUP_GAP
    out.push({
      id: stableGraphicsSlotId(projectId, p, index),
      projectId,
      kind: p.kind,
      timelineStart,
      timelineEnd,
      suggestedDurationSeconds: DEFAULT_DUR,
      sourceSegmentId: segId,
      linkedTranscriptSegmentIds: segId ? [segId] : undefined,
      ...(linkedSoundbiteId ? { linkedSoundbiteId } : {}),
      sourcePromptId: p.id,
      promptText: p.promptText,
      status: 'empty',
      metadata: {
        segmentWindow: { start: p.segment_start, end: p.segment_end },
        promptIndex: index,
        placement: 'pickup-queue',
        ...(p.metadata_json ?? {})
      }
    })
  })

  return out
}

export function ensureGraphicsVideoTrack(sequence: TimelineSequence): TimelineSequence {
  if (sequence.videoTracks.some((track) => track.id === 'v-graphics')) return sequence
  return {
    ...sequence,
    videoTracks: [...sequence.videoTracks, { id: 'v-graphics', name: 'Graphics', clips: [] }]
  }
}

export function setGraphicsSlotStatus(
  sequence: TimelineSequence,
  slotId: string,
  patch: Partial<GraphicsSlot>
): TimelineSequence {
  const slots = (sequence.graphicsSlots ?? []).map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot))
  return { ...sequence, graphicsSlots: slots }
}

export function attachGeneratedGraphicsClip(
  sequence: TimelineSequence,
  slotId: string,
  assetId: string,
  sourceFileDurationSeconds: number
): TimelineSequence {
  const slots = sequence.graphicsSlots ?? []
  const slot = slots.find((s) => s.id === slotId)
  if (!slot) return sequence

  const windowDur = Math.max(0.25, slot.timelineEnd - slot.timelineStart)
  const srcDur = Math.max(0.1, sourceFileDurationSeconds)
  const useDur = Math.min(windowDur, srcDur)
  const timelineInSeconds = slot.timelineStart
  const timelineOutSeconds = timelineInSeconds + useDur

  const withTrack = ensureGraphicsVideoTrack(sequence)
  const videoTracks = withTrack.videoTracks.map((track) => {
    if (track.id !== 'v-graphics') return track
    const remaining = track.clips.filter((clip) => (clip.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId !== slotId)
    const clip: TimelineClip = {
      id: `gfx-${slotId}`,
      role: 'quote-card',
      assetId,
      sourceInSeconds: 0,
      sourceOutSeconds: useDur,
      timelineInSeconds,
      timelineOutSeconds,
      metadata: {
        graphicsSlotId: slotId,
        graphicsKind: slot.kind
      }
    }
    return {
      ...track,
      clips: [...remaining, clip].sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    }
  })

  const nextSlots = slots.map((s) =>
    s.id === slotId
      ? ({
          ...s,
          generatedAssetId: assetId,
          status: 'ready' as GraphicsSlotStatus,
          errorMessage: undefined,
          timelineStart: timelineInSeconds,
          timelineEnd: timelineOutSeconds
        })
      : s
  )

  return {
    ...withTrack,
    graphicsSlots: nextSlots,
    videoTracks,
    durationSeconds: Math.max(withTrack.durationSeconds, timelineOutSeconds)
  }
}
