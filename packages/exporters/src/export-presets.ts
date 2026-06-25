/** Delivery resolution for MP4 + NLE interchange (working timeline stays 1080p-class in the editor). */
export type ExportQualityPreset = '1080p' | '4k'

export type WorkingFormat = 'horizontal' | 'vertical'

export interface ExportDimensionPreset {
  width: number
  height: number
  aspectRatio: '16:9' | '9:16'
  /** Short label for UI */
  label: string
}

/**
 * Maps project working format + export quality to output frame size.
 * Horizontal: 1920×1080 / 3840×2160 — Vertical: 1080×1920 / 2160×3840
 */
export function getExportDimensions(
  workingFormat: WorkingFormat,
  quality: ExportQualityPreset
): ExportDimensionPreset {
  if (workingFormat === 'vertical') {
    return quality === '4k'
      ? {
          width: 2160,
          height: 3840,
          aspectRatio: '9:16',
          label: '4K vertical (2160×3840)'
        }
      : {
          width: 1080,
          height: 1920,
          aspectRatio: '9:16',
          label: '1080p vertical (1080×1920)'
        }
  }
  return quality === '4k'
    ? {
        width: 3840,
        height: 2160,
        aspectRatio: '16:9',
        label: '4K horizontal (3840×2160)'
      }
    : {
        width: 1920,
        height: 1080,
        aspectRatio: '16:9',
        label: '1080p horizontal (1920×1080)'
      }
}
