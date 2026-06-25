import type { TimelineSequence } from '@storyteller/timeline'
import type { FcpxmlAssetProbe } from './fcpxml.js'
import { groupAssetsByNleBin } from '../nle/bin-names.js'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Premiere's preferred `pathurl` form (FCP 7 / xmeml variation). */
export function toPremierePathUrl(raw: string): string {
  const trimmed = raw.trim()
  let pathPart = trimmed
  if (/^file:\/\//i.test(trimmed)) {
    pathPart = trimmed.replace(/^file:\/\/localhost/i, '').replace(/^file:\/\//i, '')
    try {
      pathPart = decodeURIComponent(pathPart)
    } catch {
      /* keep encoded */
    }
  }
  const n = pathPart.replace(/\\/g, '/')
  const segments = n.split('/').filter((s) => s.length > 0)
  const encoded = segments.map((seg) => safeEncodePathSegment(seg)).join('/')
  return `file://localhost/${encoded}`
}

function safeEncodePathSegment(seg: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(seg))
  } catch {
    return encodeURIComponent(seg)
  }
}

type XmemlRate = { timebase: number; ntsc: 'TRUE' | 'FALSE' }

function xmemlRateFromFps(fps: number): XmemlRate {
  if (Math.abs(fps - 23.976023976023978) < 0.02 || Math.abs(fps - 23.976) < 0.02) {
    return { timebase: 24, ntsc: 'TRUE' }
  }
  if (Math.abs(fps - 29.97002997002997) < 0.02 || Math.abs(fps - 29.97) < 0.02) {
    return { timebase: 30, ntsc: 'TRUE' }
  }
  if (Math.abs(fps - 59.94005994005994) < 0.02 || Math.abs(fps - 59.94) < 0.02) {
    return { timebase: 60, ntsc: 'TRUE' }
  }
  const rounded = Math.max(1, Math.round(fps))
  return { timebase: rounded, ntsc: 'FALSE' }
}

function secondsToFrames(seconds: number, rate: XmemlRate): number {
  const scale = rate.ntsc === 'TRUE' ? (rate.timebase * 1000) / 1001 : 1
  const effectiveFps = rate.timebase * scale
  return Math.max(0, Math.round(seconds * effectiveFps))
}

function framesToSeconds(frames: number, rate: XmemlRate): number {
  const scale = rate.ntsc === 'TRUE' ? (rate.timebase * 1000) / 1001 : 1
  const effectiveFps = rate.timebase * scale
  return frames / effectiveFps
}

function rateXml(rate: XmemlRate, indent: string): string {
  return `${indent}<rate>
${indent}  <timebase>${rate.timebase}</timebase>
${indent}  <ntsc>${rate.ntsc}</ntsc>
${indent}</rate>`
}

function isRelinkPlaceholderUri(uri: string): boolean {
  return /^file:\/\/\/StorytellerRelink\//i.test(uri)
}

function isExportableAssetPath(path: string | undefined): path is string {
  if (!path || path === 'MISSING_MEDIA') return false
  return !isRelinkPlaceholderUri(path)
}

function resolveSourceSpec(
  assetId: string,
  probe: FcpxmlAssetProbe | undefined,
  seqW: number,
  seqH: number,
  seqFps: number
): { width: number; height: number; fps: number; durationSeconds: number | null } {
  const w = probe?.width != null && probe.width > 0 ? probe.width : seqW
  const h = probe?.height != null && probe.height > 0 ? probe.height : seqH
  const fps = probe?.fps != null && probe.fps > 0 ? probe.fps : seqFps
  return {
    width: w,
    height: h,
    fps,
    durationSeconds: probe?.duration_seconds != null ? probe.duration_seconds : null
  }
}

function fileNameFromPath(raw: string, fallback: string): string {
  const n = raw.replace(/^file:\/\//, '').split('/').filter(Boolean).pop()
  if (!n) return fallback
  try {
    return decodeURIComponent(n)
  } catch {
    return n
  }
}

function buildFileDefinition(params: {
  fileId: string
  displayName: string
  pathUrl: string
  rate: XmemlRate
  durationFrames: number
  width: number
  height: number
  sourceStartSeconds: number
  indent: string
}): string {
  const { fileId, displayName, pathUrl, rate, durationFrames, width, height, sourceStartSeconds, indent } =
    params
  const tcFrame = sourceStartSeconds > 0 ? secondsToFrames(sourceStartSeconds, rate) : 0
  const tcString =
    sourceStartSeconds > 0
      ? formatSmpteFromFrames(tcFrame, rate)
      : '00;00;00;00'

  return `${indent}<file id="${escapeXml(fileId)}">
${indent}  <name>${escapeXml(displayName)}</name>
${indent}  <pathurl>${escapeXml(pathUrl)}</pathurl>
${rateXml(rate, `${indent}  `)}
${indent}  <duration>${durationFrames}</duration>
${indent}  <timecode>
${rateXml(rate, `${indent}    `)}
${indent}    <string>${tcString}</string>
${indent}    <frame>${tcFrame}</frame>
${indent}    <displayformat>NDF</displayformat>
${indent}  </timecode>
${indent}  <media>
${indent}    <video>
${indent}      <samplecharacteristics>
${rateXml(rate, `${indent}        `)}
${indent}        <width>${width}</width>
${indent}        <height>${height}</height>
${indent}        <anamorphic>FALSE</anamorphic>
${indent}        <pixelaspectratio>square</pixelaspectratio>
${indent}        <fielddominance>none</fielddominance>
${indent}      </samplecharacteristics>
${indent}    </video>
${indent}    <audio>
${indent}      <samplecharacteristics>
${indent}        <depth>16</depth>
${indent}        <samplerate>48000</samplerate>
${indent}      </samplecharacteristics>
${indent}      <channelcount>2</channelcount>
${indent}    </audio>
${indent}  </media>
${indent}</file>`
}

export function applyEmbeddedTimecodeToXmeml(
  content: string,
  params: {
    pathUrl: string
    sourceStartSeconds: number
    fps: number
  }
): string {
  const { pathUrl, sourceStartSeconds, fps } = params
  if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds <= 0) return content

  const rate = xmemlRateFromFps(fps)
  const tcFrame = secondsToFrames(sourceStartSeconds, rate)
  const tcString = formatSmpteFromFrames(tcFrame, rate)
  const pathPattern = escapeRegex(pathUrl)

  return content.replace(
    new RegExp(
      `(<pathurl>${pathPattern}</pathurl>[\\s\\S]*?<timecode>[\\s\\S]*?<string>)([^<]*)(</string>[\\s\\S]*?<frame>)(\\d+)(</frame>)`,
      'g'
    ),
    (_m, open: string, _oldTc: string, mid: string, _oldFrame: string, close: string) =>
      `${open}${tcString}${mid}${tcFrame}${close}`
  )
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatSmpteFromFrames(totalFrames: number, rate: XmemlRate): string {
  const fps = rate.timebase
  const frames = totalFrames % fps
  const totalSeconds = Math.floor(totalFrames / fps)
  const s = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const m = totalMinutes % 60
  const h = Math.floor(totalMinutes / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)};${pad(m)};${pad(s)};${pad(frames)}`
}

/**
 * Premiere Pro imports **FCP 7 XMEML** (`.xml`), not FCPXML (`.fcpxml`).
 * This generator follows Premiere's xmeml variation: project wrapper, one master
 * `<file>` per source asset, source-native fps/raster, and `file://localhost` URLs.
 */
export function timelineToXmeml(
  sequence: TimelineSequence,
  assetPathsById: Record<string, string>,
  assets: FcpxmlAssetProbe[] = []
): string {
  let seqFps = sequence.format.fps
  let seqW = sequence.format.exportResolution.width
  let seqH = sequence.format.exportResolution.height

  const probes = new Map<string, FcpxmlAssetProbe>()
  for (const a of assets) probes.set(a.id, a)

  const spine = (sequence.videoTracks[0]?.clips ?? []).filter((c) => {
    if (c.role === 'pause-gap') return true
    return isExportableAssetPath(assetPathsById[c.assetId])
  })

  const exportableAssetIds = [
    ...new Set(spine.filter((c) => c.role !== 'pause-gap').map((c) => c.assetId))
  ]
  if (exportableAssetIds.length === 1) {
    const anchor = resolveSourceSpec(
      exportableAssetIds[0]!,
      probes.get(exportableAssetIds[0]!),
      seqW,
      seqH,
      seqFps
    )
    seqW = anchor.width
    seqH = anchor.height
    seqFps = anchor.fps
  }

  const rate = xmemlRateFromFps(seqFps)

  const fileIdByAssetId = new Map<string, string>()
  let nextFileNum = 1

  for (const assetId of exportableAssetIds) {
    if (!isExportableAssetPath(assetPathsById[assetId])) continue
    fileIdByAssetId.set(assetId, `file-${nextFileNum++}`)
  }

  const clipItems: string[] = []
  let timelineCursor = 0
  const assetsWithEmbeddedFile = new Set<string>()

  for (let i = 0; i < spine.length; i++) {
    const c = spine[i]!
    const clipDurationFrames = Math.max(
      1,
      secondsToFrames(c.timelineOutSeconds - c.timelineInSeconds, rate)
    )
    const start = timelineCursor
    const end = timelineCursor + clipDurationFrames
    timelineCursor = end

    if (c.role === 'pause-gap') {
      clipItems.push(`          <clipitem id="clip-${escapeXml(c.id)}">
            <name>Storyteller pause</name>
            <duration>${clipDurationFrames}</duration>
${rateXml(rate, '            ')}
            <start>${start}</start>
            <end>${end}</end>
            <in>0</in>
            <out>${clipDurationFrames}</out>
          </clipitem>`)
      continue
    }

    const fileId = fileIdByAssetId.get(c.assetId)
    if (!fileId) continue
    const probe = probes.get(c.assetId)
    const displayName =
      probe?.original_filename?.trim() ||
      fileNameFromPath(assetPathsById[c.assetId] ?? '', `clip-${i + 1}`)
    const inFrames = secondsToFrames(c.sourceInSeconds, rate)
    const outFrames = Math.max(inFrames + 1, secondsToFrames(c.sourceOutSeconds, rate))
    const spec = resolveSourceSpec(c.assetId, probe, seqW, seqH, seqFps)
    const probedDur = spec.durationSeconds != null && spec.durationSeconds > 0 ? spec.durationSeconds : 0
    const durationFrames = Math.max(
      1,
      secondsToFrames(Math.max(probedDur, c.sourceOutSeconds + 1 / Math.max(spec.fps, 1)), rate)
    )
    const fileRef = !assetsWithEmbeddedFile.has(c.assetId)
      ? (assetsWithEmbeddedFile.add(c.assetId),
        buildFileDefinition({
          fileId,
          displayName,
          pathUrl: toPremierePathUrl(assetPathsById[c.assetId] ?? ''),
          rate,
          durationFrames,
          width: spec.width,
          height: spec.height,
          sourceStartSeconds: probe?.source_start_seconds ?? 0,
          indent: '            '
        }))
      : `            <file id="${escapeXml(fileId)}"/>`

    clipItems.push(`          <clipitem id="clip-${escapeXml(c.id)}">
            <name>${escapeXml(displayName)}</name>
            <duration>${clipDurationFrames}</duration>
${rateXml(rate, '            ')}
            <start>${start}</start>
            <end>${end}</end>
            <in>${inFrames}</in>
            <out>${outFrames}</out>
${fileRef}
          </clipitem>`)
  }

  const seqFrames = Math.max(timelineCursor, 1, secondsToFrames(sequence.durationSeconds, rate))
  const sequenceName =
    sequence.id.length > 0 ? sequence.id : `Storyteller-${sequence.projectId.slice(0, 8)}`

  const binBlocks: string[] = []
  const bins = groupAssetsByNleBin(
    exportableAssetIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is FcpxmlAssetProbe => !!a),
    sequence.mode
  )
  for (const [binName, binAssets] of bins) {
    const children: string[] = []
    for (const asset of binAssets) {
      const fileId = fileIdByAssetId.get(asset.id)
      if (!fileId) continue
      const displayName =
        asset.original_filename?.trim() ||
        fileNameFromPath(assetPathsById[asset.id] ?? '', asset.id.slice(0, 8))
      children.push(`        <clip id="bin-${escapeXml(asset.id)}">
          <name>${escapeXml(displayName)}</name>
          <media>
            <video>
              <track>
                <clipitem id="bin-item-${escapeXml(asset.id)}">
                  <name>${escapeXml(displayName)}</name>
                  <file id="${escapeXml(fileId)}"/>
                </clipitem>
              </track>
            </video>
          </media>
        </clip>`)
    }
    if (children.length === 0) continue
    binBlocks.push(`      <bin>
        <name>${escapeXml(binName)}</name>
        <children>
${children.join('\n')}
        </children>
      </bin>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <project>
    <name>Storyteller Export</name>
    <children>
${binBlocks.join('\n')}
      <sequence id="${escapeXml(sequence.id)}">
        <name>${escapeXml(sequenceName)}</name>
        <duration>${seqFrames}</duration>
${rateXml(rate, '        ')}
        <timecode>
${rateXml(rate, '          ')}
          <string>00;00;00;00</string>
          <frame>0</frame>
          <displayformat>NDF</displayformat>
        </timecode>
        <media>
          <video>
            <format>
              <samplecharacteristics>
${rateXml(rate, '                ')}
                <width>${seqW}</width>
                <height>${seqH}</height>
                <pixelaspectratio>square</pixelaspectratio>
                <fielddominance>none</fielddominance>
              </samplecharacteristics>
            </format>
            <track>
${clipItems.join('\n') || '              <!-- no clips -->'}
            </track>
          </video>
        </media>
      </sequence>
    </children>
  </project>
</xmeml>
`
}
