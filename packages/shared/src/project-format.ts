export type ProjectOrientation = 'horizontal' | 'vertical'
export type ProjectQualityPreset = 'standard' | 'high'
export type AspectRatio = '16:9' | '9:16' | '1:1'

export interface ProjectFormat {
  orientation: ProjectOrientation
  width: number
  height: number
  aspectRatio: AspectRatio
  fps: number
  qualityPreset: ProjectQualityPreset
  exportResolution: {
    width: number
    height: number
  }
  previewScale: number
  safeMargins: {
    titleSafe: number
    captionSafe: number
  }
}

export function getProjectFormat(
  orientation: ProjectOrientation,
  qualityPreset: ProjectQualityPreset = 'standard',
  fps: number = 30
): ProjectFormat {
  const isHorizontal = orientation === 'horizontal'
  const isHighQuality = qualityPreset === 'high'

  const exportWidth = isHorizontal ? (isHighQuality ? 3840 : 1920) : (isHighQuality ? 2160 : 1080)
  const exportHeight = isHorizontal ? (isHighQuality ? 2160 : 1080) : (isHighQuality ? 3840 : 1920)

  // Preview is usually scaled down for performance (e.g., 720p or 1080p equivalent)
  const previewWidth = isHorizontal ? 1280 : 720
  const previewHeight = isHorizontal ? 720 : 1280
  
  const previewScale = previewWidth / exportWidth

  return {
    orientation,
    width: previewWidth,
    height: previewHeight,
    aspectRatio: isHorizontal ? '16:9' : '9:16',
    fps,
    qualityPreset,
    exportResolution: {
      width: exportWidth,
      height: exportHeight
    },
    previewScale,
    safeMargins: {
      titleSafe: 0.1, // 10% margin
      captionSafe: 0.15 // 15% margin for captions (usually lower third)
    }
  }
}
