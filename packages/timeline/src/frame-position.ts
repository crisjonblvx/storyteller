import type { FramePosition, TimelineSequence } from './model.js'

export const DEFAULT_FRAME_POSITION: FramePosition = { x: 50, y: 50 }

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, n))
}

export function normalizeFramePosition(pos?: FramePosition): FramePosition {
  if (!pos) return { ...DEFAULT_FRAME_POSITION }
  return { x: clampPercent(pos.x), y: clampPercent(pos.y) }
}

export function framePositionToCss(pos?: FramePosition): string {
  const { x, y } = normalizeFramePosition(pos)
  return `${x}% ${y}%`
}

/** Crop offset after scale-increase to match CSS object-position cover behavior. */
export function framePositionToFfmpegCrop(
  width: number,
  height: number,
  pos?: FramePosition
): { x: string; y: string } {
  const { x, y } = normalizeFramePosition(pos)
  return {
    x: `(iw-${width})*${x}/100`,
    y: `(ih-${height})*${y}/100`
  }
}

export function updateClipFramePositionInSequence(
  sequence: TimelineSequence,
  trackIndex: number,
  clipId: string,
  position: FramePosition
): TimelineSequence {
  const track = sequence.videoTracks?.[trackIndex]
  if (!track) return sequence
  const idx = track.clips.findIndex((c) => c.id === clipId)
  if (idx < 0) return sequence

  const normalized = normalizeFramePosition(position)
  const clips = [...track.clips]
  clips[idx] = { ...clips[idx]!, framePosition: normalized }

  const videoTracks = [...sequence.videoTracks]
  videoTracks[trackIndex] = { ...track, clips }

  return { ...sequence, videoTracks }
}
