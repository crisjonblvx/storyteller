import type { TimelineSequence } from './model.js'

/** Clone sequence with new output dimensions (same edits; used for 4K / NLE / MP4 delivery). */
export function sequenceForExportDimensions(
  sequence: TimelineSequence,
  width: number,
  height: number
): TimelineSequence {
  const aspectRatio: '16:9' | '9:16' | '1:1' =
    width === height ? '1:1' : width > height ? '16:9' : '9:16'
  return {
    ...sequence,
    format: {
      ...sequence.format,
      exportResolution: {
        width,
        height
      },
      aspectRatio
    },
    exportMetadata: {
      ...sequence.exportMetadata,
      aspectRatio
    }
  }
}
