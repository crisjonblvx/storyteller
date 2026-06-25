import type { TimelineSequence } from '@storyteller/timeline'
import type { TranscriptSegment } from '@storyteller/shared'

/**
 * Format a number of seconds as an SRT timestamp (HH:MM:SS,mmm).
 */
function fmtSrt(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  return (
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:` +
    `${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
  )
}

/**
 * For each timeline clip, intersect transcript segments with the clip's
 * source window and re-time them into the final timeline. Used for caption
 * burn-in on MP4 export.
 */
export function buildSrtFromTimeline(params: {
  sequence: TimelineSequence
  segmentsByAsset: Record<string, TranscriptSegment[]>
}): string {
  const { sequence, segmentsByAsset } = params
  const aRoll = sequence.videoTracks[0]
  if (!aRoll) return ''

  type Cue = { start: number; end: number; text: string }
  const cues: Cue[] = []

  for (const clip of aRoll.clips) {
    const segs = segmentsByAsset[clip.assetId]
    if (!segs?.length) continue
    const inSec = clip.sourceInSeconds
    const outSec = clip.sourceOutSeconds
    const tlStart = clip.timelineInSeconds
    for (const seg of segs) {
      const overlapStart = Math.max(seg.start_time, inSec)
      const overlapEnd = Math.min(seg.end_time, outSec)
      if (overlapEnd - overlapStart < 0.05) continue
      const tStart = overlapStart - inSec + tlStart
      const tEnd = overlapEnd - inSec + tlStart
      const text = (seg.text || '').trim()
      if (!text) continue
      cues.push({ start: tStart, end: tEnd, text })
    }
  }

  cues.sort((a, b) => a.start - b.start)

  const lines: string[] = []
  cues.forEach((cue, idx) => {
    lines.push(String(idx + 1))
    lines.push(`${fmtSrt(cue.start)} --> ${fmtSrt(cue.end)}`)
    /**
     * Soft-wrap roughly 42 chars per line for readability — typical
     * broadcast guideline; ffmpeg/libass will respect explicit `\n`.
     */
    lines.push(softWrap(cue.text, 42))
    lines.push('')
  })
  return lines.join('\n')
}

function softWrap(text: string, maxChars: number): string {
  const words = text.split(/\s+/)
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) {
      cur = w
      continue
    }
    if ((cur + ' ' + w).length > maxChars) {
      out.push(cur)
      cur = w
    } else {
      cur += ' ' + w
    }
  }
  if (cur) out.push(cur)
  return out.slice(0, 2).join('\n')
}
