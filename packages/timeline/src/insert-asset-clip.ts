import type { TimelineClip, TimelineItemRole, TimelineSequence } from './model.js'
import { ensureBrollVideoTrack } from './broll-slots.js'

export type InsertAssetClipInput = {
  assetId: string
  durationSeconds: number
  atSeconds: number
  role?: TimelineItemRole
  assetType?: 'video' | 'audio' | 'image' | 'photo'
}

/**
 * Insert a library asset at the given timeline position.
 * Video/stills land on `v-broll`; audio lands on the first audio track.
 */
export function insertAssetClipInSequence(
  sequence: TimelineSequence,
  input: InsertAssetClipInput
): TimelineSequence {
  const dur = Math.max(0.25, Math.min(input.durationSeconds, 120))
  const at = Math.max(0, input.atSeconds)

  const clip: TimelineClip = {
    id: `lib-${input.assetId.slice(0, 8)}-${Date.now()}`,
    role: input.role ?? (input.assetType === 'audio' ? 'music' : 'b-roll'),
    assetId: input.assetId,
    sourceInSeconds: 0,
    sourceOutSeconds: dur,
    timelineInSeconds: at,
    timelineOutSeconds: at + dur,
    assetDurationSeconds: input.durationSeconds,
    metadata: { insertedFromLibrary: true }
  }

  if (input.assetType === 'audio') {
    const audioTracks = sequence.audioTracks.length
      ? sequence.audioTracks.map((t) => ({ ...t, clips: [...t.clips] }))
      : [{ id: 'a1', name: 'Audio 1', clips: [] as TimelineClip[] }]
    const track = audioTracks[0]!
    track.clips = [...track.clips, clip].sort(
      (a, b) => a.timelineInSeconds - b.timelineInSeconds
    )
    return {
      ...sequence,
      audioTracks,
      durationSeconds: Math.max(sequence.durationSeconds, clip.timelineOutSeconds)
    }
  }

  const withTrack = ensureBrollVideoTrack(sequence)
  const vix = withTrack.videoTracks.findIndex((t) => t.id === 'v-broll')
  if (vix < 0) return sequence

  const brollTrack = withTrack.videoTracks[vix]!
  const clips = [...brollTrack.clips, clip].sort(
    (a, b) => a.timelineInSeconds - b.timelineInSeconds
  )
  const videoTracks = withTrack.videoTracks.map((t, i) => (i === vix ? { ...t, clips } : t))

  return {
    ...withTrack,
    videoTracks,
    durationSeconds: Math.max(withTrack.durationSeconds, clip.timelineOutSeconds)
  }
}
