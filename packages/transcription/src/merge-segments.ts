import type { ChunkTranscriptionResult, RelativeTranscriptSegment } from './types.js'

function trimText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Apply chunk offsets and merge into a single timeline sorted by start time.
 * With non-overlapping chunks, segments are already disjoint; with overlap, optional dedupe trims overlap window.
 */
export function mergeChunkTranscripts(
  results: ChunkTranscriptionResult[],
  options?: { overlapSec?: number }
): Array<{ start: number; end: number; text: string }> {
  const overlapSec = options?.overlapSec ?? 0
  const merged: Array<{ start: number; end: number; text: string }> = []

  for (const cr of results) {
    const offset = cr.offsetSec
    for (const s of cr.segments) {
      const start = offset + s.start
      const end = offset + s.end
      const text = trimText(s.text)
      if (text.length === 0 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      merged.push({ start, end, text })
    }
  }

  merged.sort((a, b) => a.start - b.start)

  if (overlapSec <= 0 || merged.length === 0) {
    return merged
  }

  return dedupeOverlapWindow(merged, overlapSec)
}

/**
 * Drop segments that fall entirely before the previous segment's end minus overlap (rough boundary dedupe).
 */
function dedupeOverlapWindow(
  sorted: Array<{ start: number; end: number; text: string }>,
  overlapSec: number
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  let lastEnd = 0

  for (const seg of sorted) {
    if (seg.end <= lastEnd - overlapSec + 1e-6) {
      continue
    }
    if (seg.start < lastEnd - overlapSec + 1e-6 && seg.end <= lastEnd + 1e-6) {
      continue
    }
    out.push(seg)
    lastEnd = Math.max(lastEnd, seg.end)
  }

  return out
}

/** Normalize a single chunk's verbose_json segments (already 0-based within chunk). */
export function normalizeRelativeSegments(
  raw: RelativeTranscriptSegment[]
): RelativeTranscriptSegment[] {
  return raw
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: trimText(s.text)
    }))
    .filter((s) => s.text.length > 0 && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
}
