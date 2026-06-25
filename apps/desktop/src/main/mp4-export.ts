import { spawn } from 'node:child_process'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { TranscriptSegment } from '@storyteller/shared'
import {
  framePositionToFfmpegCrop,
  type FramePosition,
  type OverlayEvent,
  type TimelineSequence
} from '@storyteller/timeline'
import type { ProjectOrientation } from '@storyteller/shared'
import ffmpegPath from 'ffmpeg-static'
import { buildSrtFromTimeline } from './captions.js'

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

function resolveLocalPath(uriOrPath: string): string | null {
  if (!uriOrPath) return null
  if (uriOrPath.startsWith('file:///StorytellerRelink')) return null
  if (!uriOrPath.startsWith('file:')) {
    const trimmed = uriOrPath.trim()
    return existsSync(trimmed) ? trimmed : null
  }
  try {
    const p = fileURLToPath(uriOrPath)
    return existsSync(p) ? p : null
  } catch {
    try {
      const body = uriOrPath.replace(/^file:\/\//i, '')
      const fallback = /^\/[A-Za-z]:\//.test(body)
        ? decodeURIComponent(body.slice(1))
        : decodeURIComponent(body)
      return existsSync(fallback) ? fallback : null
    } catch {
      return null
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegPath
  if (!bin) return Promise.reject(new Error('ffmpeg-static binary not found'))
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString().slice(-800)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err || `ffmpeg exited with code ${code}`))
    })
  })
}

/**
 * Encode the SRT path safely for use inside an ffmpeg `subtitles=...` filter.
 * Backslashes, colons (Windows drive letters), and single quotes need escaping
 * because libavfilter parses the filter string before reaching libass.
 */
function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/**
 * Build a libass `force_style=` argument from the optional caption style.
 * Defaults match a clean broadcast look — large readable text, white fill,
 * black outline, near-bottom safe area.
 */
function buildForceStyle(style: CaptionStyle, height: number): string {
  const fontSize = style.fontSize ?? Math.max(22, Math.round(height / 26))
  const marginV = style.marginVerticalPx ?? Math.round(height * 0.07)
  const primary = style.primaryColorAbgr ?? '&H00FFFFFF'
  const outline = style.outlineColorAbgr ?? '&H00000000'
  const outlinePx = style.outlinePx ?? 2
  const shadow = style.shadowPx ?? 0
  const fields: string[] = [
    `Fontname=Helvetica`,
    `Fontsize=${fontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `BorderStyle=1`,
    `Outline=${outlinePx}`,
    `Shadow=${shadow}`,
    `Alignment=2`,
    `MarginV=${marginV}`,
    `Bold=1`
  ]
  return fields.join(',')
}

async function burnCaptionsPass(params: {
  inputPath: string
  outputPath: string
  srtPath: string
  style: CaptionStyle
}): Promise<void> {
  const { inputPath, outputPath, srtPath, style } = params
  /**
   * We don't know the input height here without re-probing, so default to
   * 1080 — `force_style.MarginV` will still scale reasonably for 720p/4K
   * since the encoder applies the style after the subs filter scales to the
   * source dimensions. The vf chain pads to the sequence resolution.
   */
  const force = buildForceStyle(style, 1080)
  const escaped = escapeSubtitlesPath(srtPath)
  const vf = `subtitles=filename='${escaped}':force_style='${force}'`
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath
  ])
}

/**
 * Synthesize a black + silent MP4 segment of length `durationSec` at the
 * given resolution. Used for `pause-gap` clips, which carry no source asset.
 *
 * The audio is generated via `anullsrc` at 48k stereo so the segment matches
 * the rest of the timeline's AAC stream — without that, the concat demuxer
 * either drops the gap's audio (long pause = sync drift) or refuses the file.
 */
async function buildSilentBlackPart(params: {
  outPath: string
  width: number
  height: number
  durationSec: number
  fps: number
}): Promise<void> {
  const { outPath, width, height, durationSec, fps } = params
  const dur = Math.max(0.1, durationSec)
  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-t',
    String(dur),
    '-i',
    `color=c=black:s=${width}x${height}:r=${Math.max(1, Math.round(fps))}`,
    '-f',
    'lavfi',
    '-t',
    String(dur),
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath
  ])
}

/**
 * Escape a string for use inside an ffmpeg `drawtext=text='...'` argument.
 * Single quotes are filter delimiters, colons split key=value pairs, and
 * backslashes need doubling so the filter parser doesn't strip them.
 */
function escapeDrawtext(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
}

/**
 * Build a single `-vf` chain that burns every overlay event into the input.
 * We map each `OverlayEvent` to one `drawtext` (and a translucent rounded
 * `drawbox` for `text` and `stat` kinds, since their on-screen treatment
 * includes a card background). Hooks render as bare large text — no card —
 * matching the live-preview look in OverlayLayer.tsx.
 *
 * Stat overlays burn in as a single drawtext for their primary number+suffix
 * — the animated chart shape (counter / bar / donut) is preview-only for
 * this first cut. We log a clear comment so the user knows the burned-in
 * MP4 won't have the ring/bar visual yet; the NLE manifest still lists the
 * full payload so editors can rebuild charts in post.
 */
function buildOverlayDrawtextChain(events: OverlayEvent[], width: number, height: number): string | null {
  if (events.length === 0) return null
  const filters: string[] = []
  for (const e of events) {
    const startSec = Math.max(0, e.timelineInSeconds)
    const endSec = Math.max(startSec + 0.1, e.timelineOutSeconds)
    const enable = `between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})`

    const isHook = e.kind === 'hook'
    const baseFontSize = isHook ? Math.round(height * 0.06) : Math.round(height * 0.035)
    const subtitleFontSize = Math.max(14, Math.round(baseFontSize * 0.45))

    const xPos = positionX(e.position ?? (isHook ? 'top' : 'bottom'), width)
    const yPos = positionY(e.position ?? (isHook ? 'top' : 'bottom'), height, baseFontSize)

    const primaryText =
      e.kind === 'stat' && e.stat
        ? `${e.stat.prefix ?? ''}${e.stat.value}${e.stat.suffix ?? (e.stat.chart === 'donut' ? '%' : '')}`
        : e.content

    const fontColor = isHook ? 'white' : 'white'
    const boxColor = isHook ? '0x00000000' : '0x141416BF'
    const borderW = isHook ? 0 : 2

    filters.push(
      `drawtext=text='${escapeDrawtext(primaryText)}':fontsize=${baseFontSize}:fontcolor=${fontColor}:` +
        `x=${xPos}:y=${yPos}:` +
        `box=${isHook ? 0 : 1}:boxcolor=${boxColor}:boxborderw=${borderW * 6}:` +
        `borderw=${borderW}:bordercolor=0x000000FF:` +
        `enable='${enable}'`
    )

    if (e.subtitle) {
      const subYPos = `${yPos}+${baseFontSize}+8`
      filters.push(
        `drawtext=text='${escapeDrawtext(e.subtitle)}':fontsize=${subtitleFontSize}:fontcolor=0xD4D4D8FF:` +
          `x=${xPos}:y=${subYPos}:` +
          `box=0:` +
          `borderw=1:bordercolor=0x000000FF:` +
          `enable='${enable}'`
      )
    }

    if (e.kind === 'stat' && e.stat?.label) {
      /**
       * Stat label below the number. Same vertical math as a subtitle but
       * with `+10` extra padding so it doesn't collide with the larger glyphs.
       */
      const labelYPos = `${yPos}+${baseFontSize}+10`
      filters.push(
        `drawtext=text='${escapeDrawtext(e.stat.label)}':fontsize=${subtitleFontSize}:fontcolor=0xD4D4D8FF:` +
          `x=${xPos}:y=${labelYPos}:` +
          `box=0:` +
          `borderw=1:bordercolor=0x000000FF:` +
          `enable='${enable}'`
      )
    }
  }
  return filters.join(',')
}

function positionX(position: NonNullable<OverlayEvent['position']>, width: number): string {
  switch (position) {
    case 'bottom-left':
      return `${Math.round(width * 0.06)}`
    case 'bottom-right':
      return `w-tw-${Math.round(width * 0.06)}`
    case 'middle':
    case 'top':
    case 'bottom':
    default:
      return '(w-tw)/2'
  }
}

function positionY(position: NonNullable<OverlayEvent['position']>, height: number, fontSize: number): string {
  switch (position) {
    case 'top':
      return `${Math.round(height * 0.07)}`
    case 'middle':
      return `(h-${fontSize})/2`
    case 'bottom-left':
    case 'bottom':
    case 'bottom-right':
    default:
      return `h-${fontSize}-${Math.round(height * 0.09)}`
  }
}

function resolveExportOrientation(
  sequence: TimelineSequence,
  width: number,
  height: number
): ProjectOrientation {
  return sequence.format.orientation ?? (height > width ? 'vertical' : 'horizontal')
}

function buildClipVideoFilter(params: {
  w: number
  h: number
  fps: number
  orientation: ProjectOrientation
  framePosition?: FramePosition
}): string {
  const { w, h, fps, orientation, framePosition } = params
  const roundedFps = Math.max(1, Math.round(fps))
  if (orientation === 'vertical') {
    const crop = framePositionToFfmpegCrop(w, h, framePosition)
    return `fps=${roundedFps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:${crop.x}:${crop.y},setsar=1`
  }
  return `fps=${roundedFps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
}

function buildOverlayCoverFilter(w: number, h: number, fps: number): string {
  const roundedFps = Math.max(1, Math.round(fps))
  return `fps=${roundedFps},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2,setsar=1`
}

/** Composite generated B-roll (video only) over the base timeline at a given window. Primary audio stays from base. */
async function overlayBrollClip(params: {
  basePath: string
  brollPath: string
  outPath: string
  w: number
  h: number
  fps: number
  orientation: ProjectOrientation
  timelineStartSec: number
  overlayDurationSec: number
}): Promise<void> {
  const { basePath, brollPath, outPath, w, h, fps, timelineStartSec, overlayDurationSec } = params
  const d = Math.max(0.15, overlayDurationSec)
  const scaleFilter = buildOverlayCoverFilter(w, h, fps)
  const vf = [
    `[1:v]${scaleFilter},trim=start=0:end=${d},setpts=PTS-STARTPTS+${timelineStartSec}/TB[fg]`,
    `[0:v][fg]overlay=0:0:enable='between(t,${timelineStartSec.toFixed(3)},${(timelineStartSec + d).toFixed(3)})':eof_action=pass:repeatlast=0`
  ].join(';')
  await runFfmpeg([
    '-y',
    '-i',
    basePath,
    '-i',
    brollPath,
    '-filter_complex',
    vf,
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-movflags',
    '+faststart',
    outPath
  ])
}

/**
 * Rough-cut MP4 from canonical timeline (local file paths only).
 * Scales/pads to sequence width×height; concatenates clips in order.
 *
 * When `captions.burn === true` and `captions.segmentsByAsset` is provided, an
 * SRT is generated from the timeline-aligned transcript and burned into the
 * final video as a `subtitles=` filter pass.
 */
export async function exportTimelineToMp4(params: {
  sequence: TimelineSequence
  assetPathsById: Record<string, string>
  outputPath: string
  captions?: {
    burn: boolean
    segmentsByAsset?: Record<string, TranscriptSegment[]>
    style?: CaptionStyle
  }
  onProgress?: (p: Mp4ExportProgress) => void
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { sequence, assetPathsById, outputPath, onProgress, captions } = params
  const w = sequence.format.exportResolution.width
  const h = sequence.format.exportResolution.height
  const fps = Math.max(1, Math.round(sequence.format.fps || 30))
  const orientation = resolveExportOrientation(sequence, w, h)

  const track = sequence.videoTracks[0]
  if (!track?.clips?.length) {
    return { ok: false, error: 'No video clips in timeline — build an intro first.' }
  }

  const clips = [...track.clips].filter((c) => !c.disabled).sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
  if (!clips.length) {
    return { ok: false, error: 'No clips to export on the main video track.' }
  }

  const resolved: {
    path: string | null
    start: number
    dur: number
    isPauseGap: boolean
    framePosition?: FramePosition
  }[] = []
  let timelineCursor = 0
  for (const c of clips) {
    if (c.timelineInSeconds > timelineCursor + 1e-4) {
      resolved.push({
        path: null,
        start: 0,
        dur: Math.max(0.1, c.timelineInSeconds - timelineCursor),
        isPauseGap: true
      })
    }
    const isPauseGap = c.role === 'pause-gap'
    if (isPauseGap) {
      /**
       * Pause-gap clips have no source asset. We synthesize a black + silent
       * MP4 segment per gap below, so we just record the duration here.
       */
      resolved.push({
        path: null,
        start: 0,
        dur: Math.max(0.1, c.timelineOutSeconds - c.timelineInSeconds),
        isPauseGap: true
      })
      timelineCursor = Math.max(timelineCursor, c.timelineOutSeconds)
      continue
    }
    const raw = assetPathsById[c.assetId]
    const path = raw ? resolveLocalPath(raw) : null
    if (!path) {
      return {
        ok: false,
        error: `Missing local file for asset ${c.assetId}. MP4 export needs media on disk (not cloud-only placeholders).`
      }
    }
    const dur = Math.max(0.1, c.timelineOutSeconds - c.timelineInSeconds)
    resolved.push({
      path,
      start: c.sourceInSeconds,
      dur,
      isPauseGap: false,
      framePosition: c.framePosition
    })
    timelineCursor = Math.max(timelineCursor, c.timelineOutSeconds)
  }

  onProgress?.({ phase: 'preparing', detail: `Output ${w}×${h}, ${resolved.length} clip(s)` })

  const workDir = join(tmpdir(), `storyteller-mp4-${randomBytes(8).toString('hex')}`)
  await mkdir(workDir, { recursive: true })

  const parts: string[] = []
  try {
    for (let i = 0; i < resolved.length; i++) {
      const { path, start, dur, isPauseGap, framePosition } = resolved[i]!
      const partPath = join(workDir, `part_${String(i).padStart(3, '0')}.mp4`)
      const vf = buildClipVideoFilter({ w, h, fps, orientation, framePosition })
      onProgress?.({
        phase: 'encoding_clip',
        clipIndex: i + 1,
        clipTotal: resolved.length,
        detail: isPauseGap ? `Pause gap ${i + 1}/${resolved.length} (${dur.toFixed(1)}s)` : `Clip ${i + 1}/${resolved.length}`
      })
      if (isPauseGap || !path) {
        await buildSilentBlackPart({ outPath: partPath, width: w, height: h, durationSec: dur, fps })
        parts.push(partPath)
        continue
      }
      await runFfmpeg([
        '-y',
        '-ss',
        String(start),
        '-i',
        path,
        '-t',
        String(dur),
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-pix_fmt',
        'yuv420p',
        partPath
      ])
      parts.push(partPath)
    }

    onProgress?.({ phase: 'concatenating', detail: 'Merging segments…' })
    const concatOut = join(workDir, 'base_a_roll.mp4')
    if (parts.length === 1) {
      await copyFile(parts[0]!, concatOut)
    } else {
      const listPath = join(workDir, 'concat.txt')
      const listBody = parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
      await writeFile(listPath, listBody, 'utf8')
      await runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        concatOut
      ])
    }

    const brollTrack = sequence.videoTracks.find((t) => t.id === 'v-broll')
    const graphicsTrack = sequence.videoTracks.find((t) => t.id === 'v-graphics')
    const brollClips = (brollTrack?.clips ?? [])
      .filter((c) => c.role === 'b-roll' && !c.disabled)
      .slice()
      .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    const graphicsClips = (graphicsTrack?.clips ?? [])
      .filter((c) => (c.role === 'quote-card' || c.role === 'b-roll') && !c.disabled)
      .slice()
      .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    const visualOverlayClips = [...brollClips, ...graphicsClips].sort(
      (a, b) => a.timelineInSeconds - b.timelineInSeconds
    )

    /**
     * If captions are being burned in, the captions pass writes the final
     * `outputPath`. Otherwise the last visual overlay (or the concat copy)
     * is the final write.
     */
    const burnCaptions = Boolean(captions?.burn && captions.segmentsByAsset)
    let currentPath = concatOut

    /**
     * Burn user-authored overlays (text / hook / stat headlines) into the
     * frame using a single ffmpeg drawtext chain. Stat charts (animated
     * counter / bar / donut) only render in the live preview today — the
     * drawtext pass burns the primary number+suffix+label so the data is
     * still on screen, just without the animation. The NLE manifest carries
     * the full payload so editors can rebuild the chart in post if needed.
     *
     * We run this pass BEFORE the visual overlay loop so generated overlays cover
     * overlays that conflict in the same window — matching the natural
     * "overlay wins where it appears" expectation. If no visual overlays and no
     * captions follow, we write straight to `outputPath`.
     */
    const overlayEvents = sequence.overlayEvents ?? []
    if (overlayEvents.length > 0) {
      const drawChain = buildOverlayDrawtextChain(overlayEvents, w, h)
      if (drawChain) {
        const overlayWriteFinal = visualOverlayClips.length === 0 && !burnCaptions
        const overlayOut = overlayWriteFinal
          ? outputPath
          : join(workDir, 'with_overlays.mp4')
        onProgress?.({
          phase: 'concatenating',
          detail: `Burning ${overlayEvents.length} text/hook/stat overlay(s)…`
        })
        await runFfmpeg([
          '-y',
          '-i',
          currentPath,
          '-vf',
          drawChain,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '20',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          overlayOut
        ])
        currentPath = overlayOut
      }
    }
    if (visualOverlayClips.length > 0) {
      onProgress?.({
        phase: 'concatenating',
        detail: `Compositing ${visualOverlayClips.length} visual overlay(s)…`
      })
      for (let i = 0; i < visualOverlayClips.length; i++) {
        const bc = visualOverlayClips[i]!
        const raw = assetPathsById[bc.assetId]
        const bPath = raw ? resolveLocalPath(raw) : null
        if (!bPath) {
          return {
            ok: false,
            error: `Missing local file for visual overlay asset ${bc.assetId}. Save generated clips on disk before export.`
          }
        }
        const overlayDur = Math.max(0.1, bc.sourceOutSeconds - bc.sourceInSeconds)
        const isLastBroll = i === visualOverlayClips.length - 1
        const writeFinal = isLastBroll && !burnCaptions
        const nextPath = writeFinal
          ? outputPath
          : join(workDir, `broll_layer_${String(i).padStart(2, '0')}.mp4`)
        onProgress?.({
          phase: 'overlaying_broll',
          clipIndex: i + 1,
          clipTotal: visualOverlayClips.length,
          detail: `Overlay ${i + 1}/${visualOverlayClips.length}`
        })
        await overlayBrollClip({
          basePath: currentPath,
          brollPath: bPath,
          outPath: nextPath,
          w,
          h,
          fps,
          orientation,
          timelineStartSec: bc.timelineInSeconds,
          overlayDurationSec: overlayDur
        })
        currentPath = nextPath
      }
    } else if (!burnCaptions) {
      /**
       * No visual overlays and no captions to burn — copy whatever the latest pass
       * produced (concat → overlay-burn → here) to outputPath. Without this
       * we'd silently overwrite a successful overlay-burn with the bare
       * concatenated A-roll. We skip the copy if `currentPath` already IS
       * `outputPath` (the overlay pass wrote there directly).
       */
      if (currentPath !== outputPath) {
        await copyFile(currentPath, outputPath)
      }
      currentPath = outputPath
    }

    if (burnCaptions) {
      onProgress?.({ phase: 'burning_captions', detail: 'Rendering captions…' })
      const srt = buildSrtFromTimeline({
        sequence,
        segmentsByAsset: captions!.segmentsByAsset!
      })
      if (!srt.trim()) {
        // Nothing to burn — still copy the current file out so the export completes.
        if (currentPath !== outputPath) await copyFile(currentPath, outputPath)
      } else {
        const srtPath = join(workDir, 'captions.srt')
        await writeFile(srtPath, srt, 'utf8')
        await burnCaptionsPass({
          inputPath: currentPath,
          outputPath,
          srtPath,
          style: captions!.style ?? {}
        })
      }
    }

    onProgress?.({ phase: 'complete', outputPath })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
