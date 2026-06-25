import { app, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { AnalyzeGroundedReviewParams } from '@storyteller/ai-gateway'
import type { PromptPackDefinition } from '@storyteller/analysis'
import type { StoryMode, SubjectProfile } from '@storyteller/shared'
import type { TimelineSequence } from '@storyteller/timeline'
import { runFfprobe } from './ffprobe.js'
import type { TranscriptionProgressPayload } from './chunked-transcription.js'
import { exportTimelineToMp4 } from './mp4-export.js'
import { ensurePreviewProxy } from './preview-proxy.js'
import { writeNleExportPackageToDisk, type NleExportPackagePayload } from './nle-export.js'
import { extractAssetThumbnail } from './thumbnail-extract.js'
import { generateRunwayBrollToDisk } from './runway-broll.js'
import { generateKlingBrollToDisk } from './kling-broll.js'
import { generateHiggsfieldBrollToDisk } from './higgsfield-broll.js'
import {
  getHiggsfieldCredentials,
  hasHiggsfieldCredentials,
  saveHiggsfieldCredentials
} from './higgsfield-secrets.js'
import { getStorytellerAiGateway } from './storyteller-ai-gateway.js'
import { analyzeBeat } from './beat-detection.js'
import {
  generateBrollViaHostedGateway,
  generateMediaViaCapability,
  isMediaGatewayEnabled
} from './gateway-media.js'
import {
  generateProductionStill,
  generateProductionVideo,
  productionOutputDir,
  saveUploadedProductionStill
} from './production-pipeline.js'
import { fetchGatewayAccount, fetchGatewayUsage } from './gateway-account.js'
import { getDesktopFeatureFlags } from './gateway-feature-flags.js'
import {
  resolveAiGatewayConfig,
  resolveGatewayUrl,
  type StorytellerMediaCapability
} from '@storyteller/ai-gateway'

const MAX_READ_BYTES = 600 * 1024 * 1024

/**
 * Strip vendor/implementation details from error messages before they reach
 * the renderer. Users must never see API key names, provider names, internal
 * file paths, or developer docs references.
 */
function sanitizeErrorMessage(msg: string): string {
  let s = msg
  // API key not configured
  s = s.replace(/OPENAI_API_KEY[^.]*\./gi, 'Storyteller AI service is not configured. Please contact support.')
  // Strip parenthetical hints like "(add it to your .env — see docs/…)"
  s = s.replace(/\(add it to your \.env[^)]*\)/gi, '')
  s = s.replace(/see docs\/[^\s).]*/gi, '')
  // Strip file-system paths
  s = s.replace(/\/(?:Users|private|home|var|tmp|Applications)\/[^\s,;'"]+/g, '[path]')
  // Replace provider names with the product name
  s = s.replace(/\bWhisper\b/gi, 'Storyteller AI')
  s = s.replace(/\bOpenAI\b/gi, 'Storyteller AI')
  s = s.replace(/\bAnthropic\b/gi, 'Storyteller AI')
  s = s.replace(/\b(?:Claude|GPT-?\d*)\b/g, 'Storyteller AI')
  return s.trim()
}

export function registerIpc(): void {
  ipcMain.removeHandler('app:status')
  ipcMain.removeHandler('media:probe')
  ipcMain.removeHandler('media:verifyLocalPath')
  ipcMain.removeHandler('media:pick')
  ipcMain.removeHandler('media:readFile')
  ipcMain.removeHandler('media:writeTempFile')
  ipcMain.removeHandler('transcription:transcribe')
  ipcMain.removeHandler('shell:revealInFolder')
  ipcMain.removeHandler('shell:openPath')
  ipcMain.removeHandler('dialog:saveVideo')
  ipcMain.removeHandler('export:mp4')
  ipcMain.removeHandler('dialog:pickExportFolder')
  ipcMain.removeHandler('export:nlePackage')
  ipcMain.removeHandler('broll:generate')
  ipcMain.removeHandler('broll:generateFromBeats')
  ipcMain.removeHandler('broll:generateForSoundbite')
  ipcMain.removeHandler('broll:runwayGenerate')
  ipcMain.removeHandler('broll:klingGenerate')
  ipcMain.removeHandler('broll:higgsfieldGenerate')
  ipcMain.removeHandler('media:generate')
  ipcMain.removeHandler('production:generateStill')
  ipcMain.removeHandler('production:generateVideo')
  ipcMain.removeHandler('production:saveUploadedStill')
  ipcMain.removeHandler('gateway:getAccount')
  ipcMain.removeHandler('gateway:getUsage')
  ipcMain.removeHandler('higgsfield:saveCredentials')
  ipcMain.removeHandler('higgsfield:status')
  ipcMain.removeHandler('higgsfield:testCredentials')
  ipcMain.removeHandler('preview:ensureProxy')
  ipcMain.removeHandler('analysis:groundedReview')
  ipcMain.removeHandler('media:analyzeBeat')
  ipcMain.removeHandler('media:extractThumbnail')

  /**
   * Lightweight feature-flag check the renderer can use to render an honest
   * "what's wired" indicator without exposing keys.
   */
  ipcMain.handle('app:status', async () => {
    const flags = getDesktopFeatureFlags()
    const gatewayUrl = resolveGatewayUrl(process.env)
    const mediaGateway = isMediaGatewayEnabled()
    const cfg = resolveAiGatewayConfig(process.env)
    return {
      ok: true as const,
      app: {
        platform: process.platform,
        electron: process.versions.electron,
        node: process.versions.node,
        isPackaged: app.isPackaged
      },
      ai: {
        mode: cfg.mode,
        // Capability-oriented readiness signals — never leak provider names.
        reviewReady: cfg.mode === 'proxy' || Boolean(process.env.OPENAI_API_KEY?.trim()),
        mediaReady: mediaGateway,
        // Legacy fields kept for backwards compatibility with older renderer code.
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        runwayConfigured:
          mediaGateway ||
          Boolean((process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET || '').trim()),
        proxyBaseUrl: gatewayUrl,
        gatewayUrl,
        mediaGatewayEnabled: mediaGateway,
        enableKling: flags.enableKling,
        enableByok: flags.enableByok
      }
    }
  })

  ipcMain.handle('media:probe', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { ok: false as const, error: 'Invalid path' }
    }
    return runFfprobe(filePath)
  })

  ipcMain.handle(
    'media:extractThumbnail',
    async (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false as const, error: 'Invalid payload' }
      }
      const { sourcePath, assetId } = payload as { sourcePath?: unknown; assetId?: unknown }
      if (typeof sourcePath !== 'string' || typeof assetId !== 'string') {
        return { ok: false as const, error: 'sourcePath and assetId required' }
      }
      return extractAssetThumbnail(sourcePath, assetId)
    }
  )

  /**
   * Returns a path the bundled Chromium can decode. If the source is already
   * H.264/VP9/AV1 + supported audio it returns the source unchanged; otherwise
   * it transcodes once into a cached H.264/AAC sidecar in `userData/preview-proxies/`
   * and returns that. Idempotent + concurrent-safe (in-flight requests dedupe).
   */
  ipcMain.handle('preview:ensureProxy', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') {
      return { ok: false as const, error: 'Invalid path', code: 'INVALID_PATH' as const }
    }
    return ensurePreviewProxy(filePath)
  })

  /** Existence check for renderer — avoids running analyze on stale/missing paths. */
  ipcMain.handle('media:verifyLocalPath', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return {
        ok: true as const,
        exists: false as const,
        code: 'INVALID_PATH' as const,
        path: ''
      }
    }
    const p = filePath.trim()
    const exists = existsSync(p)
    return {
      ok: true as const,
      exists,
      path: p,
      code: exists ? ('OK' as const) : ('SOURCE_FILE_MISSING' as const)
    }
  })

  ipcMain.handle('media:pick', async (_event, opts?: { multiple?: boolean }) => {
    const multiple = opts?.multiple !== false
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose media',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg'] },
        { name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled) return { ok: true as const, paths: [] as string[] }
    return { ok: true as const, paths: filePaths }
  })

  /**
   * Persist renderer-side bytes (e.g. a MediaRecorder Blob from the Quick Reel
   * "Record Voice" flow) into the OS temp dir and return the absolute path so
   * downstream IPCs (transcription, ffprobe, MP4 export) can use the same
   * `localPath` contract as files imported from disk.
   */
  ipcMain.handle('media:writeTempFile', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      bytes?: ArrayBuffer | Uint8Array
      filename?: string
      extension?: string
    }
    if (!p.bytes) return { ok: false as const, error: 'Missing bytes' }
    const ext = (p.extension ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
    const safeName = (p.filename ?? `storyteller-${Date.now()}.${ext}`).replace(/[\\/:*?"<>|]+/g, '_')
    const dir = join(tmpdir(), 'storyteller-quickreel')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, `${randomBytes(4).toString('hex')}-${safeName}`)
    const data =
      p.bytes instanceof Uint8Array ? p.bytes : new Uint8Array(p.bytes as ArrayBuffer)
    await writeFile(filePath, data)
    const st = await stat(filePath)
    return { ok: true as const, path: filePath, size: st.size, name: basename(filePath) }
  })

  /** Read a local file into an ArrayBuffer for renderer upload (MVP; large files may use a lot of RAM). */
  ipcMain.handle('media:readFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false as const, error: 'Invalid path' }
    }
    if (!existsSync(filePath)) {
      return { ok: false as const, error: 'File not found' }
    }
    const st = await stat(filePath)
    if (st.size > MAX_READ_BYTES) {
      return {
        ok: false as const,
        error: `File is larger than ${Math.floor(MAX_READ_BYTES / (1024 * 1024))}MB — use drag-and-drop or Select files instead.`
      }
    }
    const buf = await readFile(filePath)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return {
      ok: true as const,
      name: basename(filePath),
      size: st.size,
      bytes: ab
    }
  })

  ipcMain.handle('transcription:transcribe', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as { signedUrl?: string; localPath?: string; filename?: string; assetType?: string }
    const filename = typeof p.filename === 'string' && p.filename.length > 0 ? p.filename : 'media.mp4'
    const onProgress = (msg: TranscriptionProgressPayload) => {
      event.sender.send('transcription:progress', msg)
    }
    try {
      const result = await getStorytellerAiGateway().transcribe({
        signedUrl: typeof p.signedUrl === 'string' ? p.signedUrl : undefined,
        localPath: typeof p.localPath === 'string' ? p.localPath : undefined,
        filename,
        assetType: typeof p.assetType === 'string' ? p.assetType : undefined,
        onProgress
      })
      if (!result.ok) {
        return { ok: false as const, error: sanitizeErrorMessage(result.error) }
      }
      return result
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: sanitizeErrorMessage(raw) }
    }
  })

  ipcMain.handle('analysis:groundedReview', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      candidates?: unknown[]
      segments?: unknown[]
      subjectProfile?: unknown
      promptPack?: PromptPackDefinition
      directionText?: string
      mode?: StoryMode
      targetCount?: number
      shotDurationSeconds?: number
      accessToken?: string
    }
    if (!Array.isArray(p.candidates) || p.candidates.length === 0) {
      return { ok: false as const, error: 'Missing grounded candidates' }
    }
    return getStorytellerAiGateway().analyzeGroundedReview({
      candidates: p.candidates as AnalyzeGroundedReviewParams['candidates'],
      segments: Array.isArray(p.segments) ? (p.segments as AnalyzeGroundedReviewParams['segments']) : undefined,
      subjectProfile: (p.subjectProfile ?? {}) as AnalyzeGroundedReviewParams['subjectProfile'],
      promptPack: p.promptPack as PromptPackDefinition,
      directionText: typeof p.directionText === 'string' ? p.directionText : '',
      mode: (p.mode ?? 'story') as StoryMode,
      targetCount:
        typeof p.targetCount === 'number' && Number.isFinite(p.targetCount) && p.targetCount > 0
          ? p.targetCount
          : undefined,
      shotDurationSeconds:
        typeof p.shotDurationSeconds === 'number' && Number.isFinite(p.shotDurationSeconds)
          ? p.shotDurationSeconds
          : undefined,
      accessToken: typeof p.accessToken === 'string' ? p.accessToken : undefined
    })
  })

  /**
   * Analyze a music/audio file for BPM and beat timestamps.
   * Runs in the main process: ffmpeg decodes to raw PCM, music-tempo detects beats.
   */
  ipcMain.handle('media:analyzeBeat', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { ok: false as const, error: 'Invalid file path' }
    }
    return analyzeBeat(filePath.trim())
  })

  ipcMain.handle('shell:revealInFolder', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { ok: false as const, error: 'Invalid path' }
    }
    if (!existsSync(filePath)) {
      return { ok: false as const, error: 'File not found' }
    }
    shell.showItemInFolder(filePath)
    return { ok: true as const }
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath) {
      return { ok: false as const, error: 'Invalid path' }
    }
    const err = await shell.openPath(targetPath)
    if (err) return { ok: false as const, error: err }
    return { ok: true as const }
  })

  ipcMain.handle('dialog:pickExportFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Choose folder for NLE export package',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths?.[0]) return { ok: false as const, canceled: true as const }
    return { ok: true as const, path: filePaths[0] }
  })

  ipcMain.handle('dialog:saveVideo', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export MP4',
      defaultPath: 'Storyteller-export.mp4',
      filters: [{ name: 'MP4', extensions: ['mp4'] }]
    })
    if (canceled || !filePath) return { ok: false as const, canceled: true as const }
    return { ok: true as const, path: filePath }
  })

  ipcMain.handle('export:mp4', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      outputPath?: string
      sequence?: TimelineSequence
      assetPathsById?: Record<string, string>
      captions?: {
        burn?: boolean
        segmentsByAsset?: Record<string, unknown>
        style?: Record<string, unknown>
      }
    }
    if (typeof p.outputPath !== 'string' || !p.outputPath) {
      return { ok: false as const, error: 'Missing output path' }
    }
    if (!p.sequence || typeof p.sequence !== 'object') {
      return { ok: false as const, error: 'Missing timeline sequence' }
    }
    if (!p.assetPathsById || typeof p.assetPathsById !== 'object') {
      return { ok: false as const, error: 'Missing asset paths' }
    }
    return exportTimelineToMp4({
      sequence: p.sequence,
      assetPathsById: p.assetPathsById,
      outputPath: p.outputPath,
      captions: p.captions?.burn
        ? {
            burn: true,
            segmentsByAsset: (p.captions.segmentsByAsset as Record<string, never> | undefined) ?? {},
            style: p.captions.style as never
          }
        : undefined,
      onProgress: (msg) => {
        event.sender.send('export:progress', msg)
      }
    })
  })

  ipcMain.handle('export:nlePackage', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as { rootPath?: string; packageFolderName?: string; pkg?: NleExportPackagePayload }
    if (typeof p.rootPath !== 'string' || !p.rootPath) {
      return { ok: false as const, error: 'Missing destination folder' }
    }
    if (!p.pkg || typeof p.pkg !== 'object') {
      return { ok: false as const, error: 'Missing package' }
    }
    const folderName =
      typeof p.packageFolderName === 'string' && p.packageFolderName.trim().length > 0
        ? p.packageFolderName.trim()
        : p.pkg.bundleName
    return writeNleExportPackageToDisk({
      rootDir: p.rootPath,
      packageFolderName: folderName,
      pkg: p.pkg,
      onProgress: (msg) => {
        event.sender.send('nleExport:progress', msg)
      }
    })
  })

  ipcMain.handle('broll:runwayGenerate', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      promptText?: string
      ratio?: '1280:720' | '720:1280'
      durationSeconds?: number
      accessToken?: string
      audit?: {
        stylePackId?: string
        promptCategory?: string
      }
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.slotId !== 'string' || !p.slotId) {
      return { ok: false as const, error: 'Missing slot id' }
    }
    if (typeof p.promptText !== 'string' || !p.promptText.trim()) {
      return { ok: false as const, error: 'Missing prompt text' }
    }
    const ratio = p.ratio === '720:1280' ? '720:1280' : '1280:720'
    const durationSeconds =
      typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) ? p.durationSeconds : 5
    const outDir = join(app.getPath('userData'), 'generated-broll', p.projectId)
    if (isMediaGatewayEnabled()) {
      const gw = await generateBrollViaHostedGateway({
        projectId: p.projectId,
        slotId: p.slotId,
        promptText: p.promptText,
        provider: 'runway',
        ratio,
        durationSeconds,
        accessToken: p.accessToken,
        outputDir: outDir,
        audit: {
          stylePackId: p.audit?.stylePackId,
          promptCategory: p.audit?.promptCategory
        },
        onProgress: (msg) => {
          event.sender.send('brollRunway:progress', msg)
        }
      })
      if (!gw.ok) return gw
      return {
        ok: true as const,
        asset: gw.asset,
        taskId: gw.jobId,
        localPath: gw.localPath,
        outputUrls: []
      }
    }
    return generateRunwayBrollToDisk({
      projectId: p.projectId,
      slotId: p.slotId,
      promptText: p.promptText,
      ratio,
      durationSeconds,
      outputDir: outDir,
      audit: {
        provider: 'runway',
        promptUsed: p.promptText,
        slotId: p.slotId,
        stylePackId: p.audit?.stylePackId,
        promptCategory: p.audit?.promptCategory
      },
      onProgress: (msg) => {
        event.sender.send('brollRunway:progress', msg)
      }
    })
  })

  ipcMain.handle('broll:klingGenerate', async (event, payload: unknown) => {
    if (!getDesktopFeatureFlags().enableKling) {
      return {
        ok: false as const,
        error: 'Kling is disabled in this build (ENABLE_KLING=false). Use Runway via the Storyteller AI Gateway.'
      }
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      promptText?: string
      ratio?: '16:9' | '9:16' | '1:1'
      durationSeconds?: number
      negativePrompt?: string
      audit?: {
        stylePackId?: string
        promptCategory?: string
      }
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.slotId !== 'string' || !p.slotId) {
      return { ok: false as const, error: 'Missing slot id' }
    }
    if (typeof p.promptText !== 'string' || !p.promptText.trim()) {
      return { ok: false as const, error: 'Missing prompt text' }
    }
    const ratio = p.ratio === '9:16' ? '9:16' : p.ratio === '1:1' ? '1:1' : '16:9'
    const durationSeconds =
      typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) ? p.durationSeconds : 5
    const outDir = join(app.getPath('userData'), 'generated-broll', p.projectId)
    return generateKlingBrollToDisk({
      projectId: p.projectId,
      slotId: p.slotId,
      promptText: p.promptText,
      ratio,
      durationSeconds,
      negativePrompt: p.negativePrompt,
      outputDir: outDir,
      audit: {
        provider: 'kling',
        promptUsed: p.promptText,
        slotId: p.slotId,
        stylePackId: p.audit?.stylePackId,
        promptCategory: p.audit?.promptCategory
      },
      onProgress: (msg) => {
        event.sender.send('brollKling:progress', msg)
      }
    })
  })

  ipcMain.handle('broll:higgsfieldGenerate', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      promptText?: string
      referenceImageUrl?: string
      modelId?: string
      ratio?: '1280:720' | '720:1280'
      durationSeconds?: number
      accessToken?: string
      audit?: {
        stylePackId?: string
        promptCategory?: string
      }
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.slotId !== 'string' || !p.slotId) {
      return { ok: false as const, error: 'Missing slot id' }
    }
    if (typeof p.promptText !== 'string' || !p.promptText.trim()) {
      return { ok: false as const, error: 'Missing prompt text' }
    }
    /**
     * `referenceImageUrl` is now optional. When omitted, Higgsfield runs in
     * text-to-video mode — the runner will skip the `image_url` field in the
     * submit body. When provided, it must look like a real http(s) URL.
     */
    const refUrl =
      typeof p.referenceImageUrl === 'string' && p.referenceImageUrl.trim()
        ? p.referenceImageUrl.trim()
        : undefined
    if (refUrl && !/^https?:\/\//i.test(refUrl)) {
      return {
        ok: false as const,
        error: 'Reference image URL must be an http(s) URL.'
      }
    }
    if (typeof p.modelId !== 'string' || !p.modelId.trim()) {
      return { ok: false as const, error: 'Missing Higgsfield model id' }
    }
    const ratio = p.ratio === '720:1280' ? '720:1280' : '1280:720'
    const durationSeconds =
      typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) ? p.durationSeconds : 5
    const outDir = join(app.getPath('userData'), 'generated-broll', p.projectId)
    if (isMediaGatewayEnabled()) {
      const gw = await generateBrollViaHostedGateway({
        projectId: p.projectId,
        slotId: p.slotId,
        promptText: p.promptText,
        provider: 'higgsfield',
        ratio,
        durationSeconds,
        referenceImageUrl: refUrl,
        higgsfieldModelId: p.modelId,
        accessToken: p.accessToken,
        outputDir: outDir,
        audit: {
          stylePackId: p.audit?.stylePackId,
          promptCategory: p.audit?.promptCategory
        },
        onProgress: (msg) => {
          event.sender.send('brollHiggsfield:progress', msg)
        }
      })
      if (!gw.ok) return gw
      return {
        ok: true as const,
        asset: gw.asset,
        requestId: gw.jobId,
        localPath: gw.localPath,
        videoUrl: ''
      }
    }
    if (!getDesktopFeatureFlags().enableByok) {
      return {
        ok: false as const,
        error:
          'Higgsfield BYOK is disabled. Set STORYTELLER_GATEWAY_URL for hosted generation or ENABLE_BYOK=true for internal dev.'
      }
    }
    return generateHiggsfieldBrollToDisk({
      projectId: p.projectId,
      slotId: p.slotId,
      promptText: p.promptText,
      referenceImageUrl: refUrl,
      modelId: p.modelId,
      ratio,
      durationSeconds,
      outputDir: outDir,
      audit: {
        promptUsed: p.promptText,
        slotId: p.slotId,
        stylePackId: p.audit?.stylePackId,
        promptCategory: p.audit?.promptCategory
      },
      onProgress: (msg) => {
        event.sender.send('brollHiggsfield:progress', msg)
      }
    })
  })

  /**
   * Capability-first media generation. The renderer describes WHAT it wants
   * (e.g. video clip from text, motion graphic, concept frame) and the gateway
   * picks the best provider/model server-side. Provider details are never
   * exposed back to the renderer.
   *
   * Progress is streamed on the `media:progress` channel.
   */
  ipcMain.handle('media:generate', async (event, payload: unknown) => {
    if (!isMediaGatewayEnabled()) {
      return {
        ok: false as const,
        error: 'Storyteller AI is not configured. Set STORYTELLER_GATEWAY_URL to enable hosted generation.'
      }
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      capability?: string
      creativeMode?: string
      prompt?: string
      negativePrompt?: string
      referenceImageUrl?: string
      durationSeconds?: number
      aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5'
      quality?: 'draft' | 'standard' | 'premium'
      providerPreference?: 'auto' | 'runway' | 'higgsfield' | 'openai' | 'ideogram'
      accessToken?: string
      metadata?: Record<string, unknown>
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
      return { ok: false as const, error: 'Missing prompt text' }
    }
    const allowed: StorytellerMediaCapability[] = [
      'video-clip-from-text',
      'video-clip-from-image',
      'concept-frame',
      'storyboard-frame',
      'motion-graphic',
      'refine-prompt'
    ]
    const capability = p.capability as StorytellerMediaCapability | undefined
    if (!capability || !allowed.includes(capability)) {
      return { ok: false as const, error: 'Unknown capability' }
    }
    if (capability === 'video-clip-from-image') {
      const ref = typeof p.referenceImageUrl === 'string' ? p.referenceImageUrl.trim() : ''
      if (!ref || !/^https?:\/\//i.test(ref)) {
        return {
          ok: false as const,
          error: 'video-clip-from-image requires referenceImageUrl (http(s) URL).'
        }
      }
    }
    const outDir = join(app.getPath('userData'), 'generated-broll', p.projectId)
    return generateMediaViaCapability({
      projectId: p.projectId,
      slotId: p.slotId,
      capability,
      creativeMode: (p.creativeMode as Parameters<typeof generateMediaViaCapability>[0]['creativeMode']) ?? undefined,
      prompt: p.prompt,
      negativePrompt: p.negativePrompt,
      referenceImageUrl: p.referenceImageUrl,
      durationSeconds: p.durationSeconds,
      aspectRatio: p.aspectRatio,
      quality: p.quality,
      providerPreference: p.providerPreference,
      accessToken: p.accessToken,
      outputDir: outDir,
      metadata: p.metadata,
      onProgress: (msg) => {
        event.sender.send('media:progress', msg)
      }
    })
  })

  ipcMain.handle('production:generateStill', async (event, payload: unknown) => {
    if (!isMediaGatewayEnabled()) {
      return {
        ok: false as const,
        error: 'Storyteller AI is not configured. Set STORYTELLER_GATEWAY_URL to enable hosted generation.'
      }
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      productionPackage?: { stillImagePrompt?: string; id?: string; mode?: string }
      aspectRatio?: '16:9' | '9:16' | '1:1'
      accessToken?: string
      courtesyRegen?: boolean
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.slotId !== 'string' || !p.slotId) {
      return { ok: false as const, error: 'Missing slot id' }
    }
    const pkg = p.productionPackage
    if (!pkg || typeof pkg.stillImagePrompt !== 'string' || !pkg.stillImagePrompt.trim()) {
      return { ok: false as const, error: 'Missing production package still prompt' }
    }
    const outDir = productionOutputDir(app.getPath('userData'), p.projectId)
    return generateProductionStill({
      projectId: p.projectId,
      slotId: p.slotId,
      productionPackage: pkg as import('@storyteller/shared').ProductionPackage,
      aspectRatio: p.aspectRatio ?? '16:9',
      accessToken: p.accessToken,
      outputDir: outDir,
      courtesyRegen: p.courtesyRegen,
      onProgress: (msg) => {
        event.sender.send('production:stillProgress', { slotId: p.slotId, ...msg })
      }
    })
  })

  ipcMain.handle('production:saveUploadedStill', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      bytes?: ArrayBuffer | Uint8Array
      filename?: string
      mimeType?: string
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.slotId !== 'string' || !p.slotId) {
      return { ok: false as const, error: 'Missing slot id' }
    }
    if (!p.bytes) {
      return { ok: false as const, error: 'Missing image bytes' }
    }
    const bytes = p.bytes instanceof Uint8Array ? p.bytes : new Uint8Array(p.bytes as ArrayBuffer)
    const outDir = productionOutputDir(app.getPath('userData'), p.projectId)
    return saveUploadedProductionStill({
      projectId: p.projectId,
      slotId: p.slotId,
      outputDir: outDir,
      bytes,
      filename: p.filename,
      mimeType: p.mimeType
    })
  })

  ipcMain.handle('production:generateVideo', async (event, payload: unknown) => {
    if (!isMediaGatewayEnabled()) {
      return {
        ok: false as const,
        error: 'Storyteller AI is not configured. Set STORYTELLER_GATEWAY_URL to enable hosted generation.'
      }
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      slotId?: string
      motionPrompt?: string
      stillLocalPath?: string
      referenceImageUrl?: string
      durationSeconds?: number
      aspectRatio?: '16:9' | '9:16' | '1:1'
      accessToken?: string
      productionPackageId?: string
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.motionPrompt !== 'string' || !p.motionPrompt.trim()) {
      return { ok: false as const, error: 'Missing motion prompt' }
    }
    if (typeof p.stillLocalPath !== 'string' || !p.stillLocalPath.trim()) {
      return { ok: false as const, error: 'Missing approved still path' }
    }
    const outDir = productionOutputDir(app.getPath('userData'), p.projectId)
    return generateProductionVideo({
      projectId: p.projectId,
      slotId: p.slotId,
      motionPrompt: p.motionPrompt,
      stillLocalPath: p.stillLocalPath,
      referenceImageUrl: p.referenceImageUrl ?? '',
      durationSeconds: p.durationSeconds ?? 8,
      aspectRatio: p.aspectRatio ?? '16:9',
      accessToken: p.accessToken,
      outputDir: outDir,
      productionPackageId: p.productionPackageId,
      onProgress: (msg) => {
        event.sender.send('production:videoProgress', { slotId: p.slotId, ...msg })
      }
    })
  })

  ipcMain.handle('gateway:getAccount', async (_event, payload: unknown) => {
    if (!isMediaGatewayEnabled()) {
      return { ok: false as const, error: 'Storyteller AI is not configured on this build.' }
    }
    const accessToken =
      payload && typeof payload === 'object' && typeof (payload as { accessToken?: unknown }).accessToken === 'string'
        ? (payload as { accessToken: string }).accessToken
        : null
    return fetchGatewayAccount(accessToken)
  })

  ipcMain.handle('gateway:getUsage', async (_event, payload: unknown) => {
    if (!isMediaGatewayEnabled()) {
      return { ok: false as const, error: 'Storyteller AI is not configured on this build.' }
    }
    const p =
      payload && typeof payload === 'object'
        ? (payload as { accessToken?: string; limit?: number; offset?: number })
        : {}
    return fetchGatewayUsage(p.accessToken ?? null, { limit: p.limit, offset: p.offset })
  })

  /**
   * Higgsfield BYOK credential management. The renderer NEVER sees the secret
   * itself — only `{ configured: boolean }` from `:status`. Saving the empty
   * string for either field clears the keychain entry.
   */
  ipcMain.handle('higgsfield:saveCredentials', async (_event, payload: unknown) => {
    if (!getDesktopFeatureFlags().enableByok || isMediaGatewayEnabled()) {
      return {
        ok: false as const,
        error: 'BYOK is not available in this build. Media generation uses the Storyteller AI Gateway.'
      }
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as { apiKey?: unknown; apiSecret?: unknown }
    const apiKey = typeof p.apiKey === 'string' ? p.apiKey.trim() : ''
    const apiSecret = typeof p.apiSecret === 'string' ? p.apiSecret.trim() : ''
    if (!apiKey && !apiSecret) {
      return saveHiggsfieldCredentials(null)
    }
    if (!apiKey || !apiSecret) {
      return { ok: false as const, error: 'Both API key and API secret are required.' }
    }
    return saveHiggsfieldCredentials({ apiKey, apiSecret })
  })

  ipcMain.handle('higgsfield:status', async () => {
    if (isMediaGatewayEnabled()) {
      return { configured: true, viaGateway: true as const }
    }
    return { configured: hasHiggsfieldCredentials(), viaGateway: false as const }
  })

  /**
   * One-shot connectivity test against the user's BYOK credentials. We
   * deliberately use `GET /requests/<bogus>/status` because Higgsfield will
   * 401 on bad auth and 404 on bad request id — letting us distinguish
   * "credentials wrong" from "credentials fine, request not found" without
   * spending any credits.
   */
  ipcMain.handle('higgsfield:testCredentials', async () => {
    if (!getDesktopFeatureFlags().enableByok || isMediaGatewayEnabled()) {
      return { ok: false as const, error: 'BYOK is not available in this build.' }
    }
    const creds = getHiggsfieldCredentials(true)
    if (!creds) return { ok: false as const, error: 'No credentials saved.' }
    try {
      const probeRes = await fetch(
        'https://platform.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status',
        { headers: { Authorization: `Key ${creds.apiKey}:${creds.apiSecret}` } }
      )
      if (probeRes.status === 401 || probeRes.status === 403) {
        return { ok: false as const, error: 'Higgsfield rejected the credentials (401/403).' }
      }
      return { ok: true as const }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: `Could not reach Higgsfield: ${msg}` }
    }
  })

  ipcMain.handle('broll:generate', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      segments?: Array<{ id: string; start: number; end: number; text: string }>
      subjectProfile?: SubjectProfile
      promptPack?: PromptPackDefinition
      aiDirection?: string
      mode?: StoryMode
      shotDurationSeconds?: number
      accessToken?: string
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (!Array.isArray(p.segments) || p.segments.length === 0) {
      return { ok: false as const, error: 'No segments' }
    }
    if (!p.promptPack || typeof p.promptPack !== 'object') {
      return { ok: false as const, error: 'Missing prompt pack' }
    }
    return getStorytellerAiGateway().generateBrollPrompts(
      {
        projectId: p.projectId,
        segments: p.segments,
        subjectProfile: (p.subjectProfile ?? {}) as SubjectProfile,
        promptPack: p.promptPack as PromptPackDefinition,
        aiDirection: typeof p.aiDirection === 'string' ? p.aiDirection : '',
        mode: p.mode ?? 'story',
        shotDurationSeconds:
          typeof p.shotDurationSeconds === 'number' ? p.shotDurationSeconds : undefined,
        accessToken: typeof p.accessToken === 'string' ? p.accessToken : undefined
      },
      (msg) => event.sender.send('broll:progress', msg)
    )
  })

  ipcMain.handle('broll:generateFromBeats', async (event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      beats?: Array<{
        id: string
        source_start: number
        source_end: number
        transcript_text: string
        score?: number | null
        origin?: 'intro' | 'saved-timeline' | 'soundbite'
      }>
      subjectProfile?: SubjectProfile
      promptPack?: PromptPackDefinition
      aiDirection?: string
      mode?: StoryMode
      shotDurationSeconds?: number
      accessToken?: string
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (!Array.isArray(p.beats) || p.beats.length === 0) {
      return { ok: false as const, error: 'No beats provided' }
    }
    if (!p.promptPack || typeof p.promptPack !== 'object') {
      return { ok: false as const, error: 'Missing prompt pack' }
    }
    return getStorytellerAiGateway().generateBrollPromptsFromBeats(
      {
        projectId: p.projectId,
        beats: p.beats,
        subjectProfile: (p.subjectProfile ?? {}) as SubjectProfile,
        promptPack: p.promptPack as PromptPackDefinition,
        aiDirection: typeof p.aiDirection === 'string' ? p.aiDirection : '',
        mode: p.mode ?? 'story',
        shotDurationSeconds:
          typeof p.shotDurationSeconds === 'number' ? p.shotDurationSeconds : undefined,
        accessToken: typeof p.accessToken === 'string' ? p.accessToken : undefined
      },
      (msg) => event.sender.send('broll:progress', msg)
    )
  })

  ipcMain.handle('broll:generateForSoundbite', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid payload' }
    }
    const p = payload as {
      projectId?: string
      soundbiteId?: string
      transcriptText?: string
      subjectProfile?: SubjectProfile
      promptPack?: PromptPackDefinition
      aiDirection?: string
      mode?: StoryMode
      shotDurationSeconds?: number
      accessToken?: string
    }
    if (typeof p.projectId !== 'string' || !p.projectId) {
      return { ok: false as const, error: 'Missing project id' }
    }
    if (typeof p.soundbiteId !== 'string' || !p.soundbiteId) {
      return { ok: false as const, error: 'Missing soundbite id' }
    }
    if (typeof p.transcriptText !== 'string' || !p.transcriptText.trim()) {
      return { ok: false as const, error: 'Missing transcript text' }
    }
    if (!p.promptPack || typeof p.promptPack !== 'object') {
      return { ok: false as const, error: 'Missing prompt pack' }
    }
    return getStorytellerAiGateway().generateBrollForSoundbite({
      projectId: p.projectId,
      soundbiteId: p.soundbiteId,
      transcriptText: p.transcriptText,
      subjectProfile: (p.subjectProfile ?? {}) as SubjectProfile,
      promptPack: p.promptPack as PromptPackDefinition,
      aiDirection: typeof p.aiDirection === 'string' ? p.aiDirection : '',
      mode: p.mode ?? 'story',
      shotDurationSeconds:
        typeof p.shotDurationSeconds === 'number' ? p.shotDurationSeconds : undefined,
      accessToken: typeof p.accessToken === 'string' ? p.accessToken : undefined,
      previousIdeas: Array.isArray(p.previousIdeas) ? (p.previousIdeas as string[]) : undefined
    })
  })
}
