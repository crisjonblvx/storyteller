/** Minimum delivery resolution for generated B-roll stills and clips. */
export const DELIVERY_1080P = {
  horizontal: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 }
} as const

export type DeliveryAspectRatio = '16:9' | '9:16' | '1:1'

export function deliveryDimensionsFromAspect(
  aspectRatio?: DeliveryAspectRatio | null
): { width: number; height: number } {
  if (aspectRatio === '9:16') return DELIVERY_1080P.vertical
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 }
  return DELIVERY_1080P.horizontal
}

/** ffmpeg scale+center-crop to fill the delivery frame with no letterboxing. */
export function ffmpegCoverCropFilter(width: number, height: number, fps?: number | null): string {
  const roundedFps = fps != null && Number.isFinite(fps) ? Math.max(1, Math.round(fps)) : null
  const fpsPrefix = roundedFps ? `fps=${roundedFps},` : ''
  return `${fpsPrefix}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,setsar=1`
}

export const BROLL_FULL_FRAME_SUFFIX =
  'Full-bleed composition filling the entire frame edge-to-edge — no letterboxing, pillarboxing, or empty margins.'

export function appendBrollFullFrameSuffix(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return BROLL_FULL_FRAME_SUFFIX
  if (/full-bleed|edge-to-edge|no letterbox/i.test(trimmed)) return trimmed
  const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`
  return `${base} ${BROLL_FULL_FRAME_SUFFIX}`
}
