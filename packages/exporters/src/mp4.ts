import type { TimelineSequence } from '@storyteller/timeline'

export interface Mp4ExportRequest {
  sequence: TimelineSequence
  outputPath: string
  assetPathsById: Record<string, string>
}

export type CaptionStyle = {
  fontSize?: number
  marginVerticalPx?: number
  primaryColorAbgr?: string
  outlineColorAbgr?: string
  outlinePx?: number
  shadowPx?: number
}

export type Mp4ExportProgress =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'encoding_clip'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'concatenating'; detail?: string }
  | { phase: 'overlaying_broll'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'burning_captions'; detail?: string }
  | { phase: 'complete'; outputPath: string }
  | { phase: 'failed'; error: string }

/**
 * MP4 export is implemented in the Electron main process.
 * Renderer should use IPC via `window.storyteller.exportMp4()` instead.
 *
 * This stub is kept for type definitions and shared interfaces only.
 * Full implementation: apps/desktop/src/main/mp4-export.ts
 */
export async function exportMp4(_req: Mp4ExportRequest): Promise<{ ok: boolean; error?: string }> {
  return {
    ok: false,
    error: 'MP4 export runs in Electron main process only. Use IPC via window.storyteller.exportMp4() from renderer.'
  }
}
