import type { TimelineTrack } from './model.js'

/** Video tracks that composite over the primary spine (A-roll). */
export const OVERLAY_VIDEO_TRACK_IDS = ['v-broll', 'v-graphics'] as const

export type OverlayVideoTrackId = (typeof OVERLAY_VIDEO_TRACK_IDS)[number]

export function isOverlayVideoTrack(trackId: string): boolean {
  return (OVERLAY_VIDEO_TRACK_IDS as readonly string[]).includes(trackId)
}

export function isSpineVideoTrack(trackId: string): boolean {
  return !isOverlayVideoTrack(trackId)
}

/** Index of the primary A-roll / spine track (`v1` in rough cuts). */
export function spineVideoTrackIndex(tracks: TimelineTrack[]): number {
  const idx = tracks.findIndex((t) => isSpineVideoTrack(t.id))
  return idx >= 0 ? idx : 0
}

/**
 * Overlay tracks render above spine tracks in the timeline UI (standard NLE
 * stacking: higher row = picture on top).
 */
export function videoTracksForTimelineDisplay(
  tracks: TimelineTrack[]
): Array<{ track: TimelineTrack; index: number }> {
  const indexed = tracks.map((track, index) => ({ track, index }))
  const overlays = indexed.filter(({ track }) => isOverlayVideoTrack(track.id))
  const spine = indexed.filter(({ track }) => !isOverlayVideoTrack(track.id))
  return [...overlays, ...spine]
}

export function overlayVideoTrackLabel(trackId: string): string | null {
  if (trackId === 'v-broll') return 'B-ROLL'
  if (trackId === 'v-graphics') return 'GRAPHICS'
  return null
}
