import type { Asset } from '@storyteller/shared'
import type { TimelineSequence } from '@storyteller/timeline'
import type { XmlExportTrack } from './types.js'
import type { SfxNleTrackGroup } from '../nle/audio-director-nle.js'
import { groupAssetsByNleBin } from '../nle/bin-names.js'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

/**
 * Final Cut Pro 12.0 rejects FCPXML imports outright when a `name=` attribute
 * on an event, project, sequence, clip, or asset contains `/`, `\\`, `\r`, or
 * `\n` ("You may not use '/' or the return key in names."). FCP turns events
 * into folders and projects into files on disk, so these characters are not
 * legal filesystem-name characters.
 *
 * This helper rewrites the offending characters so the *XML* attribute is
 * accepted while leaving the original Storyteller bin/asset/project labels
 * untouched in the source data. Apply BEFORE `escapeXml`.
 */
export function sanitizeFcpName(name: string | null | undefined): string {
  if (name == null) return 'Untitled'
  const cleaned = String(name)
    .replace(/[/\\]/g, '-')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : 'Untitled'
}

/**
 * Final Cut expects `file:` URIs with path segments percent-encoded (spaces, etc.).
 */
export function toEncodedFileUri(raw: string): string {
  const trimmed = raw.trim()
  if (/^file:\/\//i.test(trimmed)) {
    const afterScheme = trimmed.slice(7).replace(/^\/+/, '')
    const segments = afterScheme.split('/').filter((s) => s.length > 0)
    const encoded = segments.map((seg) => safeEncodePathSegment(seg)).join('/')
    return `file:///${encoded}`
  }
  const n = trimmed.replace(/\\/g, '/')
  const isWin = /^[A-Za-z]:\//.test(n)
  if (isWin) {
    const pathPart = n.replace(/^\/+/, '')
    const segments = pathPart.split('/').filter((s) => s.length > 0)
    const encoded = segments.map((seg) => safeEncodePathSegment(seg)).join('/')
    return `file:///${encoded}`
  }
  const pathPart = n.startsWith('/') ? n.slice(1) : n
  const segments = pathPart.split('/').filter((s) => s.length > 0)
  const encoded = segments.map((seg) => safeEncodePathSegment(seg)).join('/')
  return `file:///${encoded}`
}

function safeEncodePathSegment(seg: string): string {
  try {
    const decoded = decodeURIComponent(seg)
    return encodeURIComponent(decoded)
  } catch {
    return encodeURIComponent(seg)
  }
}

/** FCP timebase: frame duration = `num/den` seconds; clip rationals use `(frames*num)/den s`. */
type FcpTimebase = { num: number; den: number; frameDuration: string }

function inferFcpTimebase(fps: number): FcpTimebase {
  if (Math.abs(fps - 23.976023976023978) < 0.02 || Math.abs(fps - 23.976) < 0.02) {
    return { num: 1001, den: 24000, frameDuration: '1001/24000s' }
  }
  if (Math.abs(fps - 29.97002997002997) < 0.02 || Math.abs(fps - 29.97) < 0.02) {
    return { num: 1001, den: 30000, frameDuration: '1001/30000s' }
  }
  if (Math.abs(fps - 59.94005994005994) < 0.02 || Math.abs(fps - 59.94) < 0.02) {
    return { num: 1001, den: 60000, frameDuration: '1001/60000s' }
  }
  const rounded = Math.max(1, Math.round(fps))
  if (Number.isFinite(fps) && fps > 0 && Math.abs(fps - rounded) < 0.05) {
    return { num: 1, den: rounded, frameDuration: `1/${rounded}s` }
  }
  const den = Math.max(1, Math.round(fps))
  return { num: 1, den, frameDuration: `1/${den}s` }
}

/** Convert a time in seconds to FCPXML rational `…s` using the given timebase. */
function secondsToFcpRational(seconds: number, tb: FcpTimebase): string {
  const frames = Math.round((seconds * tb.den) / tb.num)
  const numer = frames * tb.num
  return `${numer}/${tb.den}s`
}

/**
 * Like `secondsToFcpRational` but always rounds **up** to the next frame.
 * Use when emitting `<asset>` durations so floating-point rounding of the
 * individual clip `start`/`duration` values can never cumulatively exceed
 * the declared asset duration — Final Cut Pro rejects those clips with
 * "Invalid edit with no respective media".
 */
function secondsToFcpRationalCeil(seconds: number, tb: FcpTimebase): string {
  const frames = Math.ceil((seconds * tb.den) / tb.num)
  const numer = frames * tb.num
  return `${numer}/${tb.den}s`
}

/** Round **down** to the previous frame — keeps clip `start` inside the asset window. */
function secondsToFcpRationalFloor(seconds: number, tb: FcpTimebase): string {
  const frames = Math.floor((seconds * tb.den) / tb.num)
  const numer = frames * tb.num
  return `${numer}/${tb.den}s`
}

function fileNameFromPathOrUri(raw: string): string {
  const uri = raw.startsWith('file://') ? raw : toEncodedFileUri(raw)
  const pathPart = uri.replace(/^file:\/\//, '').split('/').filter(Boolean).pop()
  return pathPart && pathPart.length > 0 ? decodeURIComponent(pathPart) : 'clip'
}

/**
 * Still-image media (PNG, JPG, HEIC, …) carries no audio. Emitting
 * `hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"` on a
 * still asset produces FCP import warnings about missing/muted audio and can
 * also confuse the audio preflight pass. Detect by file extension on the
 * asset's local path or URI — Storyteller does not currently probe still
 * images so we have no audio metadata to consult either way.
 */
function isStillImagePath(rawPath: string | undefined): boolean {
  if (!rawPath) return false
  const cleaned = rawPath.split('?')[0]?.split('#')[0] ?? ''
  const name = cleaned.toLowerCase()
  return /\.(png|jpe?g|heic|heif|webp|gif|tiff?|bmp)$/.test(name)
}

function maxSourceOutByAssetId(
  clips: Array<{ assetId: string; sourceOutSeconds: number }>
): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of clips) {
    const v = m.get(c.assetId) ?? 0
    m.set(c.assetId, Math.max(v, c.sourceOutSeconds))
  }
  return m
}

function secondsNearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1 / 120
}

/**
 * Apple-recognized FCPXML format `name` (e.g. `FFVideoFormat1080p30`).
 *
 * Final Cut is picky: for **UHD** it round-trips `FFVideoFormat3840x2160p24`-style tokens.
 * Emitting `FFVideoFormat2160p24` for the same 3840×2160 raster has been observed to produce
 * import failures ("Invalid edit with no respective media") even when width/height/frameDuration
 * match — stick to the same naming shape as FCP's own exports / legacy Storyteller packages.
 *
 * For portrait and uncommon rasters we still use the **short height token**
 * (`FFVideoFormat1080p…`) based on `min(width,height)` so 1080×1920 stays in the 1080p family.
 */
function appleFormatDisplayName(width: number, height: number, fps: number): string {
  const rate = fpsLabelForFormatId(fps)

  // Ultra HD landscape — must match FCP's WxH token (see legacy working interchange files).
  if (width >= 3840 && height >= 2160) {
    return `FFVideoFormat3840x2160p${rate}`
  }

  // Common HD landscape (explicit raster → avoids ambiguous tokens).
  if (width === 1920 && height === 1080) {
    return `FFVideoFormat1080p${rate}`
  }
  if (width === 1280 && height === 720) {
    return `FFVideoFormat1280x720p${rate}`
  }

  const canonicalLines = Math.min(width, height)
  return `FFVideoFormat${canonicalLines}p${rate}`
}

function fpsLabelForFormatId(fps: number): string {
  if (Math.abs(fps - 23.976023976023978) < 0.02 || Math.abs(fps - 23.976) < 0.02) return '2398'
  if (Math.abs(fps - 29.97002997002997) < 0.02 || Math.abs(fps - 29.97) < 0.02) return '2997'
  if (Math.abs(fps - 59.94005994005994) < 0.02 || Math.abs(fps - 59.94) < 0.02) return '5994'
  return String(Math.round(fps))
}

function formatSpecKey(width: number, height: number, fps: number): string {
  const tb = inferFcpTimebase(fps)
  return `${width}x${height}:${tb.num}/${tb.den}`
}

/** Spatial raster mismatch only — frame-rate differences use separate format resources. */
function needsSpatialConform(
  spec: { width: number; height: number },
  seqW: number,
  seqH: number
): boolean {
  return spec.width !== seqW || spec.height !== seqH
}

/**
 * `file:///StorytellerRelink/<projectId>/<assetId>/<filename>` is the placeholder URI we emit
 * for cloud-only assets so editors can relink. Final Cut rejects these as "Invalid edit with
 * no respective media", so we filter them out before they ever reach the spine.
 */
function isRelinkPlaceholderUri(uri: string): boolean {
  return /^file:\/\/\/StorytellerRelink\//i.test(uri)
}

function isExportableAssetPath(path: string | undefined): path is string {
  if (!path || path === 'MISSING_MEDIA') return false
  return !isRelinkPlaceholderUri(path)
}

/** Max source time (seconds) any clip on this asset may read through. */
function maxSourceExtentSeconds(
  clips: Array<{
    assetId: string
    sourceInSeconds: number
    sourceOutSeconds: number
    timelineInSeconds: number
    timelineOutSeconds: number
  }>,
  assetId: string
): number {
  let max = 0
  for (const c of clips) {
    if (c.assetId !== assetId) continue
    const timelineDur = Math.max(0, c.timelineOutSeconds - c.timelineInSeconds)
    max = Math.max(max, c.sourceOutSeconds, c.sourceInSeconds + timelineDur)
  }
  return max
}

/**
 * Storyteller mirrors the primary video's embedded audio on A1. Export that
 * audio through the spine `<asset-clip hasAudio="1">` only — nesting a second
 * connected `<asset-clip lane="-1">` with a mismatched `start` invalidates the
 * parent in Final Cut ("Invalid edit with no respective media").
 */
function mirrorsSpineEmbeddedAudio(
  audioClip: SpineClip,
  spineClips: SpineClip[]
): boolean {
  return spineClips.some(
    (v) =>
      v.role !== 'pause-gap' &&
      v.assetId === audioClip.assetId &&
      secondsNearlyEqual(v.timelineInSeconds, audioClip.timelineInSeconds) &&
      secondsNearlyEqual(v.timelineOutSeconds, audioClip.timelineOutSeconds)
  )
}

function shouldLogFcpxmlDebug(): boolean {
  try {
    return (
      typeof process !== 'undefined' &&
      process.env &&
      process.env.STORYTELLER_FCPXML_DEBUG === '1'
    )
  } catch {
    return false
  }
}

function logFcpxmlValidation(msg: string, detail?: Record<string, unknown>): void {
  if (!shouldLogFcpxmlDebug()) return
  if (detail) console.warn(`[Storyteller FCPXML] ${msg}`, detail)
  else console.warn(`[Storyteller FCPXML] ${msg}`)
}

export type FcpxmlAssetProbe = Pick<
  Asset,
  | 'id'
  | 'width'
  | 'height'
  | 'fps'
  | 'duration_seconds'
  | 'original_filename'
  | 'asset_type'
  | 'clip_role'
  | 'creator_clip_role'
  | 'metadata_json'
> & {
  /** Embedded SMPTE origin (seconds from 00:00:00:00) — required for FCP import when source has TC. */
  source_start_seconds?: number | null
}

function assetSourceStartFrames(
  probe: FcpxmlAssetProbe | undefined,
  srcTb: FcpTimebase
): number {
  const sec = probe?.source_start_seconds
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return 0
  return Math.floor((sec * srcTb.den) / srcTb.num)
}

function framesToFcpRational(frames: number, tb: FcpTimebase): string {
  return `${frames * tb.num}/${tb.den}s`
}

function rationalToFrames(rational: string, tb: FcpTimebase): number | null {
  const m = rational.match(/^(\d+)\/(\d+)s$/)
  if (!m) return null
  const numer = Number(m[1])
  const den = Number(m[2])
  if (!Number.isFinite(numer) || !Number.isFinite(den) || den === 0) return null
  return Math.round((numer * tb.den) / (den * tb.num))
}

function offsetRationalByFrames(rational: string, frameOffset: number, tb: FcpTimebase): string {
  const base = rationalToFrames(rational, tb)
  if (base == null) return rational
  return framesToFcpRational(base + frameOffset, tb)
}

function clipSourceStartRational(
  sourceInSeconds: number,
  assetSourceStartFrames: number,
  srcTb: FcpTimebase
): string {
  const sourceInFrames = Math.floor((sourceInSeconds * srcTb.den) / srcTb.num)
  return framesToFcpRational(assetSourceStartFrames + sourceInFrames, srcTb)
}

/**
 * Final Cut Pro validates spine `asset-clip` elements against embedded source
 * timecode. When a file's first frame is e.g. `11:04:57:22`, both `<asset
 * start="…">` and each `<asset-clip start="…">` must use absolute TC values
 * (not file-relative 0s), or every clip fails with "Invalid edit with no
 * respective media".
 */
export function applyEmbeddedTimecodeToFcpxml(
  content: string,
  params: {
    assetUid: string
    sourceStartSeconds: number
    fps: number
  }
): string {
  const { assetUid, sourceStartSeconds, fps } = params
  if (!Number.isFinite(sourceStartSeconds) || sourceStartSeconds <= 0) return content

  const srcTb = inferFcpTimebase(fps)
  const tcFrames = Math.floor((sourceStartSeconds * srcTb.den) / srcTb.num)
  if (tcFrames <= 0) return content

  const uid = escapeRegex(assetUid)
  const assetMatch = content.match(
    new RegExp(`<asset\\b[^>]*\\buid="${uid}"[^>]*>`, 'i')
  )
  if (!assetMatch) return content
  const assetOpen = assetMatch[0]
  const resourceIdMatch = assetOpen.match(/\bid="([^"]+)"/)
  const resourceId = resourceIdMatch?.[1]
  if (!resourceId) return content

  const assetStartR = framesToFcpRational(tcFrames, srcTb)
  let out = content.replace(
    new RegExp(`(<asset\\b[^>]*\\buid="${uid}"[^>]*\\bstart=")([^"]*)(")`, 'i'),
    `$1${assetStartR}$3`
  )

  const clipRef = escapeRegex(resourceId)
  out = out.replace(
    new RegExp(`(<(?:asset-clip|clip|audio)\\b[^>]*\\bref="${clipRef}"[^>]*\\bstart=")([^"]*)(")`, 'g'),
    (_m, open: string, startR: string, close: string) =>
      `${open}${offsetRationalByFrames(startR, tcFrames, srcTb)}${close}`
  )

  out = out.replace(
    new RegExp(
      `(<(?:asset-clip|clip)\\b[^>]*\\bref="${clipRef}"[^>]*>[\\s\\S]*?<marker\\b[^>]*\\bstart=")([^"]*)(")`,
      'g'
    ),
    (_m, open: string, startR: string, close: string) =>
      `${open}${offsetRationalByFrames(startR, tcFrames, srcTb)}${close}`
  )

  return out
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assetProbeById(assets: FcpxmlAssetProbe[]): Map<string, FcpxmlAssetProbe> {
  const m = new Map<string, FcpxmlAssetProbe>()
  for (const a of assets) m.set(a.id, a)
  return m
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

function formatXmlLine(id: string, width: number, height: number, fps: number): string {
  const name = appleFormatDisplayName(width, height, fps)
  const tb = inferFcpTimebase(fps)
  return `    <format id="${escapeXml(id)}" name="${escapeXml(
    name
  )}" frameDuration="${tb.frameDuration}" width="${width}" height="${height}" />`
}

/**
 * Internal shape of a spine clip we render. Mirrors XmlExportTrack['clips'][n]
 * but local so we can keep buildSpineXml self-contained.
 */
type SpineClip = XmlExportTrack['clips'][number]

/**
 * Connected clip — a clip that lives on a non-primary track (V2+, A1+) and is
 * attached to a parent spine element by lane number. Positive lanes stack
 * above the primary spine (V2 = lane 1, V3 = lane 2, …); negative lanes sit
 * below the spine (A1 = lane −1, A2 = lane −2, …).
 *
 * In FCPXML 1.9, connected clips are nested **inside** the spine element
 * whose timeline range contains them. Their `offset` is measured in the
 * parent's local time frame, **not** the sequence frame:
 *   childOffsetSec = (childSeqIn − parentSeqIn) + parentSourceIn
 */
interface ConnectedClip {
  clip: SpineClip
  lane: number
}

/**
 * Render a single FCPXML asset-clip element (with optional markers,
 * adjust-conform child for off-format media, and any connected children).
 */
function renderSpineAssetClip(
  clip: SpineClip,
  assetPathsById: Record<string, string>,
  seqW: number,
  seqH: number,
  seqFps: number,
  seqFormatKey: string,
  seqTb: FcpTimebase,
  storytellerIdToResourceId: Map<string, string>,
  probes: Map<string, FcpxmlAssetProbe>,
  childMarkersXml: string,
  connectedChildrenXml: string,
  indent: string,
  spineTiming?: { offsetR: string; durationR: string }
): string | null {
  const rid = storytellerIdToResourceId.get(clip.assetId)
  if (!rid) return null
  if (!isExportableAssetPath(assetPathsById[clip.assetId])) return null

  const probe = probes.get(clip.assetId)
  const spec = resolveSourceSpec(clip.assetId, probe, seqW, seqH, seqFps)
  const srcTb = inferFcpTimebase(spec.fps)
  const assetTcFrames = assetSourceStartFrames(probe, srcTb)
  const displayNameRaw =
    probe?.original_filename && probe.original_filename.trim().length > 0
      ? probe.original_filename.trim()
      : fileNameFromPathOrUri(assetPathsById[clip.assetId] ?? '')
  const displayName = escapeXml(sanitizeFcpName(displayNameRaw))
  const dur = clip.timelineOutSeconds - clip.timelineInSeconds
  // `offset`/`duration` live on the spine (sequence timebase). `start` is
  // an offset into the source media (source timebase). Mixing these caused
  // FCP to round source-in into a different frame grid than the asset's
  // declared duration → "Invalid edit with no respective media".
  const offsetR = spineTiming?.offsetR ?? secondsToFcpRational(clip.timelineInSeconds, seqTb)
  const durationR = spineTiming?.durationR ?? secondsToFcpRationalCeil(dur, seqTb)
  const startR = clipSourceStartRational(clip.sourceInSeconds, assetTcFrames, srcTb)
  const needsConform = needsSpatialConform(spec, seqW, seqH)

  const inner: string[] = []
  if (needsConform) inner.push(`${indent}  <adjust-conform type="fit"/>`)
  if (childMarkersXml) inner.push(childMarkersXml)
  if (connectedChildrenXml) inner.push(connectedChildrenXml)

  if (inner.length === 0) {
    return `${indent}<asset-clip name="${displayName}" ref="${escapeXml(rid)}" offset="${offsetR}" duration="${durationR}" start="${startR}" enabled="1" tcFormat="NDF"/>`
  }

  return `${indent}<asset-clip name="${displayName}" ref="${escapeXml(rid)}" offset="${offsetR}" duration="${durationR}" start="${startR}" enabled="1" tcFormat="NDF">
${inner.join('\n')}
${indent}</asset-clip>`
}

/**
 * Render a connected child clip nested inside a parent spine element.
 *
 * IMPORTANT: a nested connected clip's `offset` must land inside the parent
 * spine item's local timeline window. We therefore use only
 * `(childSeqIn - parentSeqIn)`. Adding the parent's source-in pushes children
 * hundreds of seconds outside short soundbite parents and Final Cut rejects
 * the parent as "Invalid edit with no respective media."
 */
function renderConnectedClip(
  child: ConnectedClip,
  parentSeqIn: number,
  _parentSourceIn: number,
  assetPathsById: Record<string, string>,
  seqW: number,
  seqH: number,
  seqFps: number,
  seqFormatKey: string,
  seqTb: FcpTimebase,
  storytellerIdToResourceId: Map<string, string>,
  probes: Map<string, FcpxmlAssetProbe>,
  indent: string
): string | null {
  const { clip, lane } = child

  if (clip.role === 'pause-gap') {
    // A pause on a non-primary track is a connected gap with a lane.
    const dur = clip.timelineOutSeconds - clip.timelineInSeconds
    const offsetSec = clip.timelineInSeconds - parentSeqIn
    const offsetR = secondsToFcpRational(offsetSec, seqTb)
    const durationR = secondsToFcpRational(dur, seqTb)
    return `${indent}<gap name="Storyteller pause" lane="${lane}" offset="${offsetR}" duration="${durationR}" start="0s"/>`
  }

  const rid = storytellerIdToResourceId.get(clip.assetId)
  if (!rid) return null
  if (!isExportableAssetPath(assetPathsById[clip.assetId])) return null

  const probe = probes.get(clip.assetId)
  const spec = resolveSourceSpec(clip.assetId, probe, seqW, seqH, seqFps)
  const srcTb = inferFcpTimebase(spec.fps)
  const assetTcFrames = assetSourceStartFrames(probe, srcTb)
  const displayNameRaw =
    probe?.original_filename && probe.original_filename.trim().length > 0
      ? probe.original_filename.trim()
      : fileNameFromPathOrUri(assetPathsById[clip.assetId] ?? '')
  const displayName = escapeXml(sanitizeFcpName(displayNameRaw))
  const dur = clip.timelineOutSeconds - clip.timelineInSeconds
  const offsetSec = clip.timelineInSeconds - parentSeqIn
  // Connected-clip offset: render in the parent's timebase. Using srcTb here
  // would drift when the parent and child have different rates because the
  // resulting rational would be quantized to the child's frame grid, not the
  // parent's. We use seqTb for offset (parent's spine grid) and srcTb only
  // for the child's own internal start/duration.
  const offsetR = secondsToFcpRational(offsetSec, seqTb)
  const durationR = secondsToFcpRationalCeil(dur, seqTb)
  const startR = clipSourceStartRational(clip.sourceInSeconds, assetTcFrames, srcTb)
  const needsConform = needsSpatialConform(spec, seqW, seqH)

  if (lane < 0) {
    // FCP 12.0 aborts during audio preflight when it encounters a connected
    // <asset-clip> with a negative lane nested inside a spine asset-clip.
    // FCPXML 1.9 has a dedicated <audio> element for this case which FCP's
    // audio wrapping code handles correctly.  Do not include enabled,
    // tcFormat, or <adjust-conform> — those are video-clip-only attributes.
    return `${indent}<audio name="${displayName}" lane="${lane}" ref="${escapeXml(rid)}" offset="${offsetR}" duration="${durationR}" start="${startR}" srcCh="1, 2" outCh="L, R"/>`
  }
  // lane > 0: secondary storyline — FCP 12.0 crashes on a bare nested
  // <asset-clip lane="N"> inside a spine asset-clip (addAssetClip path).
  // FCPXML 1.9 requires wrapping connected video clips in a <spine lane="N">;
  // the inner clip's offset is 0s (relative to the spine's own origin).
  const innerIndent = `${indent}  `
  const innerClipAttrs = `name="${displayName}" ref="${escapeXml(rid)}" offset="0s" duration="${durationR}" start="${startR}" enabled="1" tcFormat="NDF"`
  const innerClipXml = needsConform
    ? `${innerIndent}<asset-clip ${innerClipAttrs}>
${innerIndent}  <adjust-conform type="fit"/>
${innerIndent}</asset-clip>`
    : `${innerIndent}<asset-clip ${innerClipAttrs}/>`
  return `${indent}<spine lane="${lane}" offset="${offsetR}">
${innerClipXml}
${indent}</spine>`
}

function buildFcpxmlBinEvents(params: {
  assets: FcpxmlAssetProbe[]
  uniqueAssetIds: string[]
  assetPathsById: Record<string, string>
  storytellerIdToResourceId: Map<string, string>
  assetIdToSourceFormatId: Map<string, string>
  probes: Map<string, FcpxmlAssetProbe>
  seqW: number
  seqH: number
  seqFps: number
  mode?: TimelineSequence['mode']
}): string {
  const {
    assets,
    uniqueAssetIds,
    assetPathsById,
    storytellerIdToResourceId,
    assetIdToSourceFormatId,
    probes,
    seqW,
    seqH,
    seqFps,
    mode
  } = params

  const exportable = uniqueAssetIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is FcpxmlAssetProbe => !!a && isExportableAssetPath(assetPathsById[a.id]))

  const bins = groupAssetsByNleBin(exportable, mode)
  const eventLines: string[] = []

  for (const [binName, binAssets] of bins) {
    const clipLines: string[] = []
    for (const asset of binAssets) {
      const resourceId = storytellerIdToResourceId.get(asset.id)
      if (!resourceId) continue
      const formatId = assetIdToSourceFormatId.get(asset.id)
      if (!formatId) continue
      const displayNameRaw =
        asset.original_filename?.trim() ||
        fileNameFromPathOrUri(assetPathsById[asset.id] ?? '')
      const displayName = escapeXml(sanitizeFcpName(displayNameRaw))
      const spec = resolveSourceSpec(asset.id, probes.get(asset.id), seqW, seqH, seqFps)
      const srcTb = inferFcpTimebase(spec.fps)
      const probedDur = spec.durationSeconds != null && spec.durationSeconds > 0 ? spec.durationSeconds : 1
      const assetDuration = secondsToFcpRationalCeil(probedDur, srcTb)
      // FCPXML 1.9 DTD: <clip> requires duration; <video> requires ref/duration
      // and is a leaf (cannot contain <asset-clip>). The canonical FCP-emitted
      // shape for an event browser entry is a bare <asset-clip> directly under
      // <event>. The old <clip><video><asset-clip/></video></clip> wrapping
      // failed DTD validation on Final Cut Pro 12.0 import.
      //
      // FCP 12.0 crash note: do NOT emit `tcFormat` on a bin browser
      // <asset-clip>. Unlike a spine clip (which inherits a `tcStart` from
      // its parent <sequence tcStart="0s" tcFormat="NDF">), an event-level
      // asset-clip is parsed standalone via `newAssetClipOwnedClipsItem:` /
      // `addClipFormtWithID:timecodeFormat:timecodeStart:`. With `tcFormat`
      // present and no matching `tcStart`, FCP's
      // `-[FFAnchoredObject setTimecodeDisplayDropFrame:]` asserts and
      // aborts the import. The asset's own `<format>` (referenced via
      // `format=`) already determines the frame rate / NDF nature, so the
      // `tcFormat` attribute is redundant on browser entries.
      clipLines.push(
        `      <asset-clip name="${displayName}" ref="${escapeXml(resourceId)}" duration="${assetDuration}" format="${escapeXml(formatId)}"/>`
      )
    }
    if (clipLines.length === 0) continue
    eventLines.push(`    <event name="${escapeXml(sanitizeFcpName(binName))}">
${clipLines.join('\n')}
    </event>`)
  }

  return eventLines.join('\n')
}

/**
 * FCPXML 1.9 — Final Cut Pro import with multi-track support.
 *
 * - **Sequence** uses its own `<format>` (timeline / project rate) — always `r1`.
 * - **Each asset** references a `<format>` that matches probed (ffprobe) width, height, and fps when available.
 * - When source and sequence rates match, the same format id may be referenced from both (one `<format>` element).
 * - Resource ids follow Apple's convention: `r1` (sequence format) → `r2..rN` (source formats) → `rN+1..` (assets).
 *   `asset-clip/@ref` matches `<asset id>`; the Storyteller UUID lives in `<asset>/@uid` for relink fidelity.
 * - The `<format>` `name` follows Final Cut's own interchange tokens (e.g. `FFVideoFormat1080p30`,
 *   `FFVideoFormat3840x2160p24`, `FFVideoFormat1280x720p24`). **Do not** emit `FFVideoFormat2160p24`
 *   for 3840×2160 — FCP has rejected imports with that mismatch even when width/height match.
 * - Asset **duration** uses the source timebase and max(source-out) **plus one frame**, or probed duration when longer.
 * - Cloud-only assets (whose paths come back as `file:///StorytellerRelink/...` placeholders) are dropped from
 *   the spine. FCP rejects those edits with "Invalid edit with no respective media", so it's better to skip
 *   the clip than to leave a hard error in the import warnings dialog.
 * - **Multi-track support**: All video tracks are exported as secondary storylines, all audio tracks as <audio> elements.
 *
 * @see https://developer.apple.com/documentation/professional_video_applications/fcpxml_reference
 */
export function timelineToFcpxml(
  sequence: TimelineSequence,
  assetPathsById: Record<string, string>,
  assets: FcpxmlAssetProbe[] = [],
  sfxGroups?: SfxNleTrackGroup[]
): string {
  let seqFps = sequence.format.fps
  let seqW = sequence.format.exportResolution.width
  let seqH = sequence.format.exportResolution.height

  /**
   * Final Cut writes resource ids as plain `r1`, `r2`, … and is fussy when the sequence's
   * `format=` attribute references a non-standard id like `fmt_seq_1920x1080p30`. We follow
   * Apple's convention: `r1` is reserved for the sequence format, then source formats and
   * assets get the next sequential ids.
   */
  let nextResourceId = 1
  const allocResourceId = (): string => `r${nextResourceId++}`

  const probes = assetProbeById(assets)

  // Convert all video tracks
  const videoTracks: XmlExportTrack[] = sequence.videoTracks.map((t) => ({
    id: t.id,
    kind: 'video' as const,
    clips: t.clips.map((c) => ({
      id: c.id,
      role: c.role,
      assetId: c.assetId,
      sourceInSeconds: c.sourceInSeconds,
      sourceOutSeconds: c.sourceOutSeconds,
      timelineInSeconds: c.timelineInSeconds,
      timelineOutSeconds: c.timelineOutSeconds
    }))
  }))

  // Convert all audio tracks
  const audioTracks: XmlExportTrack[] = sequence.audioTracks.map((t) => ({
    id: t.id,
    kind: 'audio' as const,
    clips: t.clips.map((c) => ({
      id: c.id,
      role: c.role,
      assetId: c.assetId,
      sourceInSeconds: c.sourceInSeconds,
      sourceOutSeconds: c.sourceOutSeconds,
      timelineInSeconds: c.timelineInSeconds,
      timelineOutSeconds: c.timelineOutSeconds
    }))
  }))

  // Collect all clips from all tracks for resource building
  const allClips = [...videoTracks.flatMap(t => t.clips), ...audioTracks.flatMap(t => t.clips)]
  const spineClips = videoTracks[0]?.clips ?? []

  // Filter spine clips for cloud-only assets
  const filteredSpineClips = spineClips.filter((clip) => {
    if (clip.role === 'pause-gap') return true
    const path = assetPathsById[clip.assetId]
    if (!path || path === 'MISSING_MEDIA') {
      console.warn(
        `[Storyteller FCPXML] Skipping spine clip — no local path for asset ${clip.assetId}. Import media or fix relink.`
      )
      return false
    }
    if (isRelinkPlaceholderUri(path)) {
      console.warn(
        `[Storyteller FCPXML] Skipping spine clip — asset ${clip.assetId} is cloud-only (relink placeholder). Download the file locally before exporting.`
      )
      return false
    }
    return true
  })

  /**
   * Single-source timelines (typical intro / rough-cut on one camera file) import cleanly
   * only when the sequence `<format>` matches the probed source raster **and** frame rate.
   * Export delivery dimensions (e.g. vertical 1080×1920) stay in Storyteller metadata; the
   * FCPXML sequence uses native source format so every spine clip avoids retime/conform
   * ambiguity that triggers "Invalid edit with no respective media".
   */
  const exportableSpineAssetIds = [
    ...new Set(
      filteredSpineClips
        .filter((c) => c.role !== 'pause-gap' && isExportableAssetPath(assetPathsById[c.assetId]))
        .map((c) => c.assetId)
    )
  ]
  if (exportableSpineAssetIds.length === 1) {
    const anchorId = exportableSpineAssetIds[0]!
    const anchorSpec = resolveSourceSpec(anchorId, probes.get(anchorId), seqW, seqH, seqFps)
    seqW = anchorSpec.width
    seqH = anchorSpec.height
    seqFps = anchorSpec.fps
  }

  const seqTb = inferFcpTimebase(seqFps)
  const seqFormatKey = formatSpecKey(seqW, seqH, seqFps)
  const seqFormatId = allocResourceId()

  // Get unique asset IDs from all clips that have exportable local media.
  const uniqueAssetIds = [
    ...new Set(
      allClips
        .filter((c) => c.role !== 'pause-gap' && c.assetId)
        .map((c) => c.assetId)
    )
  ].filter((id) => isExportableAssetPath(assetPathsById[id]))

  /** formatSpecKey → xml id (sequence format is registered first as `r1`). */
  const formatKeyToId = new Map<string, string>()
  const formatLines: string[] = []

  formatKeyToId.set(seqFormatKey, seqFormatId)
  formatLines.push(formatXmlLine(seqFormatId, seqW, seqH, seqFps))

  const assetIdToSourceFormatId = new Map<string, string>()

  for (const assetId of uniqueAssetIds) {
    const spec = resolveSourceSpec(assetId, probes.get(assetId), seqW, seqH, seqFps)
    const srcKey = formatSpecKey(spec.width, spec.height, spec.fps)
    let fid = formatKeyToId.get(srcKey)
    if (!fid) {
      fid = allocResourceId()
      formatKeyToId.set(srcKey, fid)
      formatLines.push(formatXmlLine(fid, spec.width, spec.height, spec.fps))
    }
    assetIdToSourceFormatId.set(assetId, fid)
  }

  /**
   * Asset resource ids are allocated AFTER all formats so the sequence is
   * `r1` (sequence format) → `r2..rN` (source formats) → `rN+1..` (assets).
   * Final Cut accepts arbitrary id strings, but matching its own export
   * convention avoids triggering its "unexpected value" warnings.
   */
  const storytellerIdToResourceId = new Map<string, string>()
  for (const sid of uniqueAssetIds) {
    storytellerIdToResourceId.set(sid, allocResourceId())
  }

  logFcpxmlValidation('Format resources', {
    sequenceFormatId: seqFormatId,
    sequenceProbedFps: seqFps,
    sourceFormatIds: Object.fromEntries(assetIdToSourceFormatId),
    perAssetSource: Object.fromEntries(
      uniqueAssetIds.map((id) => {
        const spec = resolveSourceSpec(id, probes.get(id), seqW, seqH, seqFps)
        return [
          id,
          { width: spec.width, height: spec.height, fps: spec.fps, durationSeconds: spec.durationSeconds }
        ]
      })
    )
  })

  logFcpxmlValidation('Resource linkage', {
    assetRefMap: Object.fromEntries(storytellerIdToResourceId),
    totalClipCount: allClips.length,
    spineClipCount: spineClips.length
  })

  const assetBlocks: string[] = []
  for (const assetId of uniqueAssetIds) {
    const rawPath = assetPathsById[assetId]
    if (!isExportableAssetPath(rawPath)) continue
    const resourceId = storytellerIdToResourceId.get(assetId)!
    const uri = toEncodedFileUri(rawPath)
    const probe = probes.get(assetId)
    const spec = resolveSourceSpec(assetId, probe, seqW, seqH, seqFps)
    const srcTb = inferFcpTimebase(spec.fps)
    const displayNameRaw =
      probe?.original_filename && probe.original_filename.trim().length > 0
        ? probe.original_filename.trim()
        : fileNameFromPathOrUri(rawPath)
    const displayName = escapeXml(sanitizeFcpName(displayNameRaw))
    const assetClips = allClips.filter((c) => c.assetId === assetId)
    const maxOut = maxSourceExtentSeconds(assetClips, assetId)
    const oneFrameSec = srcTb.num / srcTb.den
    /**
     * Asset duration must never be exceeded by a clip's `start + duration`.
     * Each clip's `start` and `duration` round **independently** to the
     * source frame grid, so their sum can drift up to a full frame past the
     * raw `sourceOut`. Add a 4-frame cushion AND ceil-round to absolutely
     * guarantee the asset is at least as long as anything that references
     * it. This is what kills the "Invalid edit with no respective media"
     * warning that ate every clip in the previous attempt.
     */
    const probedDur = spec.durationSeconds != null && spec.durationSeconds > 0 ? spec.durationSeconds : 0
    const cushionedMin = maxOut + 4 * oneFrameSec
    const assetDurSec = Math.max(cushionedMin, probedDur, 2 * oneFrameSec)
    const assetDuration = secondsToFcpRationalCeil(assetDurSec, srcTb)
    const sourceFormatId = assetIdToSourceFormatId.get(assetId)!
    const uid = escapeXml(assetId)
    const assetTcFrames = assetSourceStartFrames(probe, srcTb)
    const assetStartR = assetTcFrames > 0 ? framesToFcpRational(assetTcFrames, srcTb) : '0s'

    /**
     * Probe-aware media flags. We can confidently mark an asset audio-only
     * ONLY when the probe explicitly tells us there's no video (zero/null
     * width/height). When the probe is missing or ambiguous we default to
     * `hasVideo="1"` because Storyteller is video-first and a wrong
     * "audio-only" claim is what causes FCP to refuse asset-clip refs.
     * `hasAudio="1"` stays — almost every clip we ever import carries an
     * audio track and FCP is permissive about a missing-audio claim.
     */
    const probeKnowsNoVideo =
      probe != null &&
      typeof probe.width === 'number' && probe.width <= 0 &&
      typeof probe.height === 'number' && probe.height <= 0
    const hasVideoAttr = probeKnowsNoVideo ? '0' : '1'
    // Still images (PNG/JPG/HEIC/…) carry no audio. Advertising hasAudio="1"
    // on them triggers FCP audio-preflight warnings and can leave silent
    // tracks attached to graphics. Default to hasAudio="1" for everything
    // else because Storyteller's video assets nearly always have audio.
    const isStill = isStillImagePath(rawPath)
    const hasAudioAttr = isStill ? '0' : '1'
    const videoSourcesAttr = hasVideoAttr === '1' ? ' videoSources="1"' : ''
    const audioAttrs =
      hasAudioAttr === '1' ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ''

    assetBlocks.push(`    <asset id="${escapeXml(resourceId)}" uid="${uid}" name="${displayName}" start="${assetStartR}" duration="${assetDuration}" hasVideo="${hasVideoAttr}" hasAudio="${hasAudioAttr}"${videoSourcesAttr}${audioAttrs} format="${escapeXml(sourceFormatId)}">
      <media-rep kind="original-media" src="${escapeXml(uri)}" />
    </asset>`)

    logFcpxmlValidation('Asset media', {
      assetId,
      resourceId,
      sourceFps: spec.fps,
      sourceFormatId,
      sequenceFormatId: seqFormatId,
      assetDuration
    })
  }

  // Register SFX audio assets in resources so they are available for relink
  // and will render as connected <audio> lanes once the FCP 12.0 crash is resolved
  // (see connectedClips.length = 0 gate below — it suppresses all connected clips).
  const sfxAssetIdToResourceId = new Map<string, string>()
  const sfxLocalPathById: Record<string, string> = {}
  if (sfxGroups && sfxGroups.length > 0) {
    const seenSfxAssets = new Set<string>()
    for (const group of sfxGroups) {
      for (const clip of group.clips) {
        sfxLocalPathById[clip.assetId] = clip.localPath
        if (seenSfxAssets.has(clip.assetId)) continue
        seenSfxAssets.add(clip.assetId)
        const sfxRid = allocResourceId()
        sfxAssetIdToResourceId.set(clip.assetId, sfxRid)
        storytellerIdToResourceId.set(clip.assetId, sfxRid)
        const sfxUri = toEncodedFileUri(clip.localPath)
        const sfxFileName = escapeXml(sanitizeFcpName(clip.localPath.split('/').pop() ?? 'sfx'))
        const sfxDurSec = Math.max(clip.sourceOutSeconds, 0.1) + 4 * (seqTb.num / seqTb.den)
        const sfxDuration = secondsToFcpRationalCeil(sfxDurSec, seqTb)
        assetBlocks.push(`    <asset id="${sfxRid}" uid="${escapeXml(clip.assetId)}" name="${sfxFileName}" start="0s" duration="${sfxDuration}" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000" format="${escapeXml(seqFormatId)}">
      <media-rep kind="original-media" src="${escapeXml(sfxUri)}" />
    </asset>`)
      }
    }
  }

  const resourcesInner = [...formatLines, ...assetBlocks].join('\n')

  /**
   * FCPXML rejects `<marker>` as a direct child of `<spine>` — markers are
   * only valid inside a clip-like element (`asset-clip`, `clip`, etc.) with
   * a `start` value relative to the *clip's source media*, not the sequence.
   *
   * We bucket every sequence marker into the asset-clip whose timeline range
   * contains it, then emit it as a child of that clip. Markers that fall
   * outside any clip (e.g. in a gap) are skipped with a debug log because
   * there's no valid place in FCPXML 1.9 to attach a "free-floating"
   * timeline marker.
   */
  const markersByClipId = new Map<string, typeof sequence.markers>()
  const orphanMarkers: typeof sequence.markers = []
  for (const marker of sequence.markers) {
    const host = filteredSpineClips.find(
      (c) => marker.timeSeconds >= c.timelineInSeconds && marker.timeSeconds <= c.timelineOutSeconds
    )
    if (!host) {
      orphanMarkers.push(marker)
      continue
    }
    const list = markersByClipId.get(host.id) ?? []
    list.push(marker)
    markersByClipId.set(host.id, list)
  }
  if (orphanMarkers.length > 0) {
    logFcpxmlValidation('Markers without host clip — skipped (FCPXML disallows spine-level markers)', {
      orphanCount: orphanMarkers.length,
      orphanLabels: orphanMarkers.map((m) => m.label)
    })
  }

  /**
   * Collect every clip on a non-primary track as a `ConnectedClip`. Negative
   * lanes for audio (A1=−1, A2=−2, …), positive for additional video
   * (V2=+1, V3=+2, …). Cloud-only/missing assets are skipped with a warning.
   */
  const connectedClips: ConnectedClip[] = []
  for (let i = 1; i < videoTracks.length; i++) {
    const t = videoTracks[i]!
    for (const c of t.clips) {
      if (c.role !== 'pause-gap') {
        const path = assetPathsById[c.assetId]
        if (!path || path === 'MISSING_MEDIA' || isRelinkPlaceholderUri(path)) {
          console.warn(`[Storyteller FCPXML] Skipping V${i + 1} clip — no usable local path for asset ${c.assetId}`)
          continue
        }
      }
      connectedClips.push({ clip: c, lane: i })
    }
  }
  for (let i = 0; i < audioTracks.length; i++) {
    const t = audioTracks[i]!
    for (const c of t.clips) {
      if (mirrorsSpineEmbeddedAudio(c, filteredSpineClips)) {
        continue
      }
      if (c.role !== 'pause-gap') {
        const path = assetPathsById[c.assetId]
        if (!path || path === 'MISSING_MEDIA' || isRelinkPlaceholderUri(path)) {
          console.warn(`[Storyteller FCPXML] Skipping A${i + 1} clip — no usable local path for asset ${c.assetId}`)
          continue
        }
      }
      connectedClips.push({ clip: c, lane: -(i + 1) })
    }
  }

  // Queue SFX clips as connected audio lanes (negative lanes after existing audio tracks).
  // These are suppressed by the gate below due to the FCP 12.0 crash; they will become
  // active once Apple documents a working multi-track format.
  if (sfxGroups && sfxGroups.length > 0) {
    const sfxLaneBase = audioTracks.length + 1
    for (let gi = 0; gi < sfxGroups.length; gi++) {
      const group = sfxGroups[gi]!
      const lane = -(sfxLaneBase + gi)
      for (const clip of group.clips) {
        const sfxRid = sfxAssetIdToResourceId.get(clip.assetId)
        if (!sfxRid) continue
        connectedClips.push({
          clip: {
            id: clip.id,
            role: `sfx-${clip.category}`,
            assetId: clip.assetId,
            sourceInSeconds: clip.sourceInSeconds,
            sourceOutSeconds: clip.sourceOutSeconds,
            timelineInSeconds: clip.timelineInSeconds,
            timelineOutSeconds: clip.timelineOutSeconds,
          },
          lane,
        })
      }
    }
  }

  // ── FCP 12.0 crash gate ─────────────────────────────────────────────────────
  // WHAT: This suppresses all connected audio clips, including the SFX lanes
  //   generated by the Audio Director (negative-lane `<audio>` elements that
  //   would carry ambient, impact, movement, transition, and silence tracks).
  //
  // WHY: FCP 12.0 (macOS 26.2) aborts during audio preflight on ANY connected
  //   clip nested inside a spine element — regardless of element type
  //   (<audio>, <asset-clip>, or <spine lane>). The crash is Apple-side and
  //   not reproducible with any compliant FCPXML 1.9 authoring workaround.
  //
  // WHAT IS STILL EXPORTED: SFX audio assets ARE registered in <resources>
  //   (see the sfxAssetIdToResourceId loop above). They appear in FCP's media
  //   browser and can be manually placed by editors. Only the automatic lane
  //   injection (<audio lane="-N" …/> inside each spine clip) is suppressed.
  //
  // HOW TO RE-ENABLE: When Apple resolves the crash, remove the single line
  //   `connectedClips.length = 0` below. The connected clip objects are fully
  //   built and bucketed — they will inject correctly once the gate is lifted.
  // ────────────────────────────────────────────────────────────────────────────
  connectedClips.length = 0

  /**
   * The primary spine of a FCPXML sequence is a flat list of asset-clip /
   * gap elements that cover the full duration of the project. We must make
   * the spine continuous: any gap between V1 clips becomes an explicit
   * `<gap>` element. FCP rejects spines that "skip" time, and
   * connected children depend on having a parent at every sequence moment.
   */
  type SpineEntry =
    | { kind: 'asset-clip'; clip: SpineClip; seqIn: number; seqOut: number; sourceIn: number }
    | { kind: 'gap'; seqIn: number; seqOut: number }

  const orderedSpineClips = [...filteredSpineClips].sort(
    (a, b) => a.timelineInSeconds - b.timelineInSeconds
  )

  const spineEntries: SpineEntry[] = []
  let cursor = 0
  for (const c of orderedSpineClips) {
    if (c.timelineInSeconds > cursor + 1e-6) {
      spineEntries.push({ kind: 'gap', seqIn: cursor, seqOut: c.timelineInSeconds })
    }
    if (c.role === 'pause-gap') {
      spineEntries.push({ kind: 'gap', seqIn: c.timelineInSeconds, seqOut: c.timelineOutSeconds })
    } else {
      spineEntries.push({
        kind: 'asset-clip',
        clip: c,
        seqIn: c.timelineInSeconds,
        seqOut: c.timelineOutSeconds,
        sourceIn: c.sourceInSeconds
      })
    }
    cursor = c.timelineOutSeconds
  }
  if (sequence.durationSeconds > cursor + 1e-6) {
    spineEntries.push({ kind: 'gap', seqIn: cursor, seqOut: sequence.durationSeconds })
  }
  // If there are no V1 clips at all but there ARE connected clips, we still
  // need a base gap covering the full sequence so the connected media has
  // something to attach to.
  if (spineEntries.length === 0 && connectedClips.length > 0) {
    spineEntries.push({ kind: 'gap', seqIn: 0, seqOut: sequence.durationSeconds })
  }

  /**
   * Bucket each connected clip into the spine entry that fully contains it.
   * Final Cut reports the parent as "Invalid edit with no respective media"
   * when a nested child extends outside the parent's local timing window, so
   * long audio beds or cross-boundary overlays are skipped rather than making
   * the whole sequence fail to import.
   */
  const childrenByEntryIndex = new Map<number, ConnectedClip[]>()
  for (const child of connectedClips) {
    const idx = spineEntries.findIndex(
      (e) =>
        child.clip.timelineInSeconds + 1e-6 >= e.seqIn &&
        child.clip.timelineOutSeconds <= e.seqOut + 1e-6
    )
    if (idx === -1) {
      console.warn(
        `[Storyteller FCPXML] Skipping connected clip that crosses parent boundaries (seqIn=${child.clip.timelineInSeconds.toFixed(3)}s, seqOut=${child.clip.timelineOutSeconds.toFixed(3)}s, lane=${child.lane}).`
      )
      continue
    }
    const list = childrenByEntryIndex.get(idx) ?? []
    list.push(child)
    childrenByEntryIndex.set(idx, list)
  }

  const spineIndent = '          '
  const childIndent = '            '

  const spineLines: string[] = []
  /** Frame cursor on the sequence grid — keeps spine clips contiguous after rounding. */
  let spineFrameCursor = 0
  for (let entryIdx = 0; entryIdx < spineEntries.length; entryIdx++) {
    const entry = spineEntries[entryIdx]!
    const children = childrenByEntryIndex.get(entryIdx) ?? []
    const entryDurSec = Math.max(0, entry.seqOut - entry.seqIn)
    const entryDurFrames = Math.max(
      1,
      Math.ceil((entryDurSec * seqTb.den) / seqTb.num)
    )
    const entryOffsetR = `${spineFrameCursor * seqTb.num}/${seqTb.den}s`
    const entryDurationR = `${entryDurFrames * seqTb.num}/${seqTb.den}s`
    spineFrameCursor += entryDurFrames

    // For asset-clip parents, parent.start (source-in) is the clip's source;
    // for gap parents, source-in is always 0.
    const parentSeqIn = entry.seqIn
    const parentSourceIn = entry.kind === 'asset-clip' ? entry.sourceIn : 0

    const childrenXml = children
      .map((ch) =>
        renderConnectedClip(
          ch,
          parentSeqIn,
          parentSourceIn,
          sfxLocalPathById[ch.clip.assetId] != null
            ? { ...assetPathsById, ...sfxLocalPathById }
            : assetPathsById,
          seqW,
          seqH,
          seqFps,
          seqFormatKey,
          seqTb,
          storytellerIdToResourceId,
          probes,
          childIndent
        )
      )
      .filter((s): s is string => Boolean(s))
      .join('\n')

    if (entry.kind === 'gap') {
      if (childrenXml) {
        spineLines.push(`${spineIndent}<gap offset="${entryOffsetR}" duration="${entryDurationR}" start="0s">
${childrenXml}
${spineIndent}</gap>`)
      } else {
        spineLines.push(`${spineIndent}<gap offset="${entryOffsetR}" duration="${entryDurationR}" start="0s"/>`)
      }
      continue
    }

    // entry.kind === 'asset-clip'
    const clipMarkers = markersByClipId.get(entry.clip.id) ?? []
    const probe = probes.get(entry.clip.assetId)
    const spec = resolveSourceSpec(entry.clip.assetId, probe, seqW, seqH, seqFps)
    const srcTb = inferFcpTimebase(spec.fps)
    const childMarkersXml = clipMarkers
      .map((m) => {
        const sourceTimeSec = entry.clip.sourceInSeconds + (m.timeSeconds - entry.clip.timelineInSeconds)
        const assetTcFrames = assetSourceStartFrames(probe, srcTb)
        const markerFrames =
          assetTcFrames + Math.floor((sourceTimeSec * srcTb.den) / srcTb.num)
        return `${childIndent}<marker start="${framesToFcpRational(markerFrames, srcTb)}" duration="${srcTb.frameDuration}" value="${escapeXml(m.label)}"/>`
      })
      .join('\n')

    const rendered = renderSpineAssetClip(
      entry.clip,
      assetPathsById,
      seqW,
      seqH,
      seqFps,
      seqFormatKey,
      seqTb,
      storytellerIdToResourceId,
      probes,
      childMarkersXml,
      childrenXml,
      spineIndent,
      { offsetR: entryOffsetR, durationR: entryDurationR }
    )
    if (rendered) spineLines.push(rendered)

    logFcpxmlValidation('Asset-clip', {
      clipId: entry.clip.id,
      assetId: entry.clip.assetId,
      sourceFormatId: assetIdToSourceFormatId.get(entry.clip.assetId),
      markerCount: clipMarkers.length,
      connectedChildCount: children.length
    })
  }

  const spineBody = spineLines.length
    ? spineLines.join('\n')
    : `${spineIndent}<gap offset="0s" duration="${secondsToFcpRational(Math.max(sequence.durationSeconds, 1), seqTb)}" start="0s"/>`

  const sequenceDurationR =
    spineFrameCursor > 0
      ? `${spineFrameCursor * seqTb.num}/${seqTb.den}s`
      : secondsToFcpRational(sequence.durationSeconds, seqTb)

  logFcpxmlValidation('Sequence', {
    sequenceFormatId: seqFormatId,
    sequenceDuration: sequenceDurationR,
    markerHostingClips: markersByClipId.size,
    orphanMarkers: orphanMarkers.length,
    spineEntryCount: spineEntries.length,
    connectedClipCount: connectedClips.length,
    videoTrackCount: videoTracks.length,
    audioTrackCount: audioTracks.length
  })

  /**
   * FCPXML 1.9 sequence content is `(note?, spine, metadata?)`. There is **no**
   * `<media><video><format><samplecharacteristics>…</track>` wrapping like
   * XMEML — that pattern is from Final Cut 7's xmeml.dtd, not fcpxml.dtd.
   * The previous implementation mixed the two and Final Cut Pro X rejected
   * the import with a DTD validation error.
   */
  const binEventsXml = buildFcpxmlBinEvents({
    assets,
    uniqueAssetIds,
    assetPathsById,
    storytellerIdToResourceId,
    assetIdToSourceFormatId,
    probes,
    seqW,
    seqH,
    seqFps,
    mode: sequence.mode
  })

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
${resourcesInner}
  </resources>
  <library>
${binEventsXml ? `${binEventsXml}\n` : ''}    <event name="Storyteller Export">
      <project name="${escapeXml(sanitizeFcpName(sequence.id))}">
        <sequence duration="${sequenceDurationR}" format="${escapeXml(seqFormatId)}" tcStart="0s" tcFormat="NDF">
          <spine>
${spineBody}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`

  const resourceAssetIds = new Set(
    [...xml.matchAll(/<asset id="([^"]+)"/g)].map((m) => m[1]).filter((id): id is string => Boolean(id))
  )
  for (const match of xml.matchAll(/<(?:asset-clip|audio)[^>]*\bref="([^"]+)"/g)) {
    const ref = match[1]
    if (ref && !resourceAssetIds.has(ref)) {
      console.warn(
        `[Storyteller FCPXML] clip/audio ref="${ref}" has no matching <asset> in <resources> — Final Cut will reject this edit.`
      )
    }
  }

  return xml
}
