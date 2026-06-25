import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  applyEmbeddedTimecodeToFcpxml,
  applyEmbeddedTimecodeToXmeml,
  toPremierePathUrl
} from '@storyteller/exporters'
import { runFfprobe } from './ffprobe.js'

export type NleExportPackagePayload = {
  bundleName: string
  primaryTimeline: { filename: string; content: string; format?: 'fcpxml' | 'otio' }
  additionalFiles?: Array<{ filename: string; content: string; format?: 'xmeml' | 'md' | 'json' | 'fcpxml' }>
  manifest: unknown
  readme: string
  exportSummaryText?: string
  /** Exact `file:` URIs embedded in the interchange XML, keyed by Storyteller asset id. */
  mediaUrisByAssetId?: Record<string, string>
}

export type NleExportProgress =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'writing_timeline'; detail?: string }
  | { phase: 'writing_additional'; detail?: string }
  | { phase: 'writing_manifest'; detail?: string }
  | { phase: 'writing_readme'; detail?: string }
  | { phase: 'complete'; folderPath: string }
  | { phase: 'failed'; error: string }

function safeSegment(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '')
  return s.slice(0, 200) || 'storyteller-nle-export'
}

function readmeWithDiskFileList(
  originalReadme: string,
  hasXmeml: boolean,
  primaryTimelineFilename: string,
  copiedMediaCount: number,
  hasExportSummary: boolean
): string {
  const lines = [
    'Storyteller NLE handoff package',
    '',
    'Files in this folder:',
    ...(hasExportSummary ? ['- export-summary.txt — what was exported vs manifest-only (read this first).'] : []),
    `- ${primaryTimelineFilename} — main timeline interchange file.`,
    ...(hasXmeml
      ? [
          '- timeline.xml — Premiere-oriented XMEML interchange (optional; some Premiere workflows prefer this).',
        ]
      : []),
    ...(copiedMediaCount > 0
      ? [`- media/ — copied source media referenced by the interchange file (${copiedMediaCount} file${copiedMediaCount === 1 ? '' : 's'}).`]
      : []),
    '- manifest.json — asset manifest (local paths, clips, markers, text overlay refs).',
    '- README.txt — relink and finishing notes (below).',
    '',
    '---',
    '',
    originalReadme
  ]
  return lines.join('\n')
}

type ManifestAsset = {
  id?: string
  localPath?: string
  storagePath?: string
  kind?: string
}

type ManifestClip = {
  assetId?: string
}

function manifestClips(manifest: unknown): ManifestClip[] {
  if (!manifest || typeof manifest !== 'object') return []
  const clips = (manifest as { clips?: unknown }).clips
  return Array.isArray(clips) ? (clips as ManifestClip[]) : []
}

function referencedAssetIds(manifest: unknown, timelineUris: Record<string, string>): Set<string> {
  const ids = new Set<string>()
  for (const clip of manifestClips(manifest)) {
    if (typeof clip.assetId === 'string' && clip.assetId) ids.add(clip.assetId)
  }
  for (const id of Object.keys(timelineUris)) ids.add(id)
  return ids
}

function decodeFileUri(uri: string): string | null {
  if (!/^file:\/\//i.test(uri)) return null
  try {
    const body = uri.replace(/^file:\/\//i, '')
    if (/^\/[A-Za-z]:\//.test(body)) return decodeURIComponent(body.slice(1))
    return decodeURIComponent(body)
  } catch {
    return null
  }
}

function relativeMediaRef(mediaBasename: string): string {
  return `./media/${mediaBasename}`
}

function mediaRefForFormat(
  mediaBasename: string,
  format?: 'fcpxml' | 'xmeml' | 'otio'
): string {
  const rel = relativeMediaRef(mediaBasename)
  if (format === 'xmeml') return toPremierePathUrl(rel)
  return rel
}

function manifestAssets(manifest: unknown): ManifestAsset[] {
  if (!manifest || typeof manifest !== 'object') return []
  const assets = (manifest as { assets?: unknown }).assets
  return Array.isArray(assets) ? (assets as ManifestAsset[]) : []
}

function safeMediaFilename(asset: ManifestAsset, index: number): string {
  const sourceName =
    (typeof asset.localPath === 'string' && basename(asset.localPath)) ||
    (typeof asset.storagePath === 'string' && basename(asset.storagePath)) ||
    `asset-${index + 1}`
  const ext = extname(sourceName)
  const stem = sourceName.slice(0, sourceName.length - ext.length)
  const assetTag = typeof asset.id === 'string' && asset.id ? `-${asset.id.slice(0, 8)}` : `-${index + 1}`
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]+/g, '').toLowerCase()
  return `${safeSegment(stem).slice(0, 120)}${assetTag}${cleanExt}`
}

function encodeFileUri(absPath: string): string {
  const n = absPath.replace(/\\/g, '/')
  const body = n.startsWith('/') ? n.slice(1) : n
  return `file:///${body
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`
}

function fileUriCandidates(localPath: string): string[] {
  const n = localPath.replace(/\\/g, '/')
  const legacy = legacyFileUri(localPath)
  const segmentEncoded = encodeFileUri(localPath)
  const raw =
    n.startsWith('file:')
      ? n
      : /^[A-Za-z]:\//.test(n)
        ? `file:///${n}`
        : n.startsWith('/')
          ? `file://${n}`
          : `file:///${n}`
  const encodeUriStyle = encodeURI(raw)
  const out = new Set<string>([segmentEncoded, encodeUriStyle, legacy, n, raw])
  return [...out]
}

function legacyFileUri(absPath: string): string {
  const n = absPath.replace(/\\/g, '/')
  if (n.startsWith('file:')) return n
  if (/^[A-Za-z]:\//.test(n)) return `file:///${n}`
  if (n.startsWith('/')) return `file://${n}`
  return `file:///${n}`
}

function replaceAllLiteral(input: string, from: string, to: string): string {
  if (!from) return input
  return input.split(from).join(to)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Rewrite `<media-rep src>` inside the `<asset uid="…">` block for one Storyteller asset id. */
function rewriteMediaRepForAssetUid(content: string, assetUid: string, newSrc: string): string {
  const uid = escapeRegex(assetUid)
  const pattern = new RegExp(
    `(<asset\\b[^>]*\\buid="${uid}"[^>]*>[\\s\\S]*?<media-rep\\b[^>]*\\bsrc=")([^"]*)(")`,
    'g'
  )
  return content.replace(pattern, (_match, open: string, _old: string, close: string) => {
    return `${open}${escapeXmlAttr(newSrc)}${close}`
  })
}

function rewriteTimelineContent(
  content: string,
  from: string,
  to: string
): string {
  if (!from || from === to) return content
  return replaceAllLiteral(content, from, to)
}

async function copyMediaAndRewriteReferences(params: {
  outDir: string
  pkg: NleExportPackagePayload
}): Promise<{
  primaryContent: string
  additionalFiles: NleExportPackagePayload['additionalFiles']
  copiedCount: number
}> {
  const { outDir, pkg } = params
  let primaryContent = pkg.primaryTimeline.content
  const additionalFiles = pkg.additionalFiles?.map((f) => ({ ...f }))
  let copiedCount = 0

  const mediaDir = join(outDir, 'media')
  const assets = manifestAssets(pkg.manifest)
  const timelineUris = pkg.mediaUrisByAssetId ?? {}
  const referencedIds = referencedAssetIds(pkg.manifest, timelineUris)

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]!
    const assetId = typeof asset.id === 'string' ? asset.id : ''
    if (assetId && referencedIds.size > 0 && !referencedIds.has(assetId)) continue

    let localPath = typeof asset.localPath === 'string' ? asset.localPath.trim() : ''
    if (!localPath && assetId && timelineUris[assetId]) {
      localPath = decodeFileUri(timelineUris[assetId]) ?? ''
    }
    if (!localPath) continue

    try {
      const st = await stat(localPath)
      if (!st.isFile()) continue
    } catch {
      continue
    }

    if (copiedCount === 0) {
      await mkdir(mediaDir, { recursive: true })
    }

    const packagedPath = join(mediaDir, safeMediaFilename(asset, i))
    await copyFile(localPath, packagedPath)
    copiedCount += 1

    const mediaBasename = basename(packagedPath)
    const primaryFormat =
      pkg.primaryTimeline.format === 'otio'
        ? 'otio'
        : pkg.primaryTimeline.format === 'xmeml'
          ? 'xmeml'
          : 'fcpxml'
    const primaryRel = mediaRefForFormat(mediaBasename, primaryFormat)
    const fcpxRel = mediaRefForFormat(mediaBasename, 'fcpxml')
    const xmemlRel = mediaRefForFormat(mediaBasename, 'xmeml')
    const otioRel = mediaRefForFormat(mediaBasename, 'otio')
    const packagedUri = encodeFileUri(packagedPath)
    const candidates = new Set<string>(fileUriCandidates(localPath))
    if (assetId && timelineUris[assetId]) {
      candidates.add(timelineUris[assetId])
    }

    for (const candidate of candidates) {
      primaryContent = rewriteTimelineContent(primaryContent, candidate, primaryRel)
      if (additionalFiles) {
        for (const file of additionalFiles) {
          const targetUri =
            file.format === 'xmeml' ? xmemlRel : file.format === 'otio' ? otioRel : fcpxRel
          file.content = rewriteTimelineContent(file.content, candidate, targetUri)
        }
      }
    }

    if (assetId) {
      primaryContent = rewriteMediaRepForAssetUid(
        primaryContent,
        assetId,
        primaryFormat === 'xmeml' ? xmemlRel : primaryFormat === 'otio' ? otioRel : fcpxRel
      )
      if (additionalFiles) {
        for (const file of additionalFiles) {
          const targetUri =
            file.format === 'xmeml' ? xmemlRel : file.format === 'otio' ? otioRel : fcpxRel
          file.content = rewriteMediaRepForAssetUid(file.content, assetId, targetUri)
        }
      }
    }

    // Catch any prior partial rewrites (absolute URIs or bare `media/...` paths).
    primaryContent = rewriteTimelineContent(primaryContent, `media/${mediaBasename}`, primaryRel)
    primaryContent = rewriteTimelineContent(primaryContent, packagedUri, primaryRel)
    if (assetId) {
      primaryContent = rewriteMediaRepForAssetUid(
        primaryContent,
        assetId,
        primaryFormat === 'xmeml' ? xmemlRel : primaryFormat === 'otio' ? otioRel : fcpxRel
      )
    }

    const probed = await runFfprobe(packagedPath)

    if (
      assetId &&
      probed.ok &&
      probed.data.startTimecodeSeconds != null &&
      probed.data.startTimecodeSeconds > 0 &&
      probed.data.fps != null &&
      probed.data.fps > 0
    ) {
      const tcSec = probed.data.startTimecodeSeconds
      const fps = probed.data.fps

      if (pkg.primaryTimeline.format === 'fcpxml' && primaryContent.includes('<fcpxml')) {
        primaryContent = applyEmbeddedTimecodeToFcpxml(primaryContent, {
          assetUid: assetId,
          sourceStartSeconds: tcSec,
          fps
        })
      }

      if (pkg.primaryTimeline.format === 'xmeml' && primaryContent.includes('<xmeml')) {
        primaryContent = applyEmbeddedTimecodeToXmeml(primaryContent, {
          pathUrl: xmemlRel,
          sourceStartSeconds: tcSec,
          fps
        })
      }

      if (additionalFiles) {
        for (const file of additionalFiles) {
          if (file.format === 'fcpxml') {
            file.content = applyEmbeddedTimecodeToFcpxml(file.content, {
              assetUid: assetId,
              sourceStartSeconds: tcSec,
              fps
            })
          }
          if (file.format === 'xmeml') {
            file.content = applyEmbeddedTimecodeToXmeml(file.content, {
              pathUrl: xmemlRel,
              sourceStartSeconds: tcSec,
              fps
            })
          }
        }
      }
    }
  }

  return { primaryContent, additionalFiles, copiedCount }
}

/**
 * Writes a handoff folder under `rootDir` using stable, editor-friendly filenames.
 * Folder name should be supplied by the renderer (e.g. `{slug}-{nle}-{timestamp}`).
 */
export async function writeNleExportPackageToDisk(params: {
  rootDir: string
  /** Subfolder name inside rootDir (e.g. my-story-fcpx-2025-03-22T12-30-45) */
  packageFolderName: string
  pkg: NleExportPackagePayload
  onProgress?: (p: NleExportProgress) => void
}): Promise<{ ok: true; folderPath: string } | { ok: false; error: string }> {
  const { rootDir, packageFolderName, pkg, onProgress } = params
  const sub = safeSegment(packageFolderName)
  const outDir = join(rootDir, sub)

  const hasXmeml = pkg.additionalFiles?.some((f) => f.format === 'xmeml') ?? false

  try {
    onProgress?.({ phase: 'preparing', detail: `Creating ${sub}…` })
    await mkdir(outDir, { recursive: true })

    const { primaryContent, additionalFiles, copiedCount } = await copyMediaAndRewriteReferences({
      outDir,
      pkg
    })

    const fallbackTimelineName =
      pkg.primaryTimeline.format === 'otio'
        ? 'timeline.otio'
        : pkg.primaryTimeline.format === 'xmeml'
          ? 'timeline.xml'
          : 'timeline.fcpxml'
    const timelineName = safeSegment(pkg.primaryTimeline.filename || fallbackTimelineName)
    if (!primaryContent.trim()) {
      return { ok: false, error: `${timelineName} was empty; export was cancelled.` }
    }

    onProgress?.({
      phase: 'writing_timeline',
      detail: copiedCount > 0 ? `${timelineName} + ${copiedCount} media file(s)` : timelineName
    })
    await writeFile(join(outDir, timelineName), primaryContent, 'utf8')

    if (additionalFiles?.length) {
      let xmemlWritten = false
      for (const f of additionalFiles) {
        const diskName =
          f.format === 'xmeml' && !xmemlWritten ? 'timeline.xml' : safeSegment(f.filename)
        if (f.format === 'xmeml') xmemlWritten = true
        onProgress?.({ phase: 'writing_additional', detail: diskName })
        await writeFile(join(outDir, diskName), f.content, 'utf8')
      }
    }

    onProgress?.({ phase: 'writing_manifest', detail: 'manifest.json' })
    await writeFile(join(outDir, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2), 'utf8')

    if (pkg.exportSummaryText?.trim()) {
      onProgress?.({ phase: 'writing_readme', detail: 'export-summary.txt' })
      await writeFile(join(outDir, 'export-summary.txt'), pkg.exportSummaryText, 'utf8')
    }

    onProgress?.({ phase: 'writing_readme', detail: 'README.txt' })
    await writeFile(
      join(outDir, 'README.txt'),
      readmeWithDiskFileList(
        pkg.readme,
        hasXmeml,
        timelineName,
        copiedCount,
        Boolean(pkg.exportSummaryText?.trim())
      ),
      'utf8'
    )

    onProgress?.({ phase: 'complete', folderPath: outDir })
    return { ok: true, folderPath: outDir }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    onProgress?.({ phase: 'failed', error: msg })
    return { ok: false, error: msg }
  }
}
