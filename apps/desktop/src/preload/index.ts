import { contextBridge, ipcRenderer, webUtils } from 'electron'

type TranscriptionProgressPayload = {
  phase: 'preparing' | 'chunking' | 'transcribing_chunk' | 'merging' | 'done'
  detail?: string
  chunkIndex?: number
  chunkTotal?: number
  chunksCompleted?: number
  estimatedSecondsRemaining?: number
}

type ExportProgressPayload =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'encoding_clip'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'concatenating'; detail?: string }
  | { phase: 'overlaying_broll'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'complete'; outputPath: string }
  | { phase: 'failed'; error: string }

type NleExportProgressPayload =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'writing_timeline'; detail?: string }
  | { phase: 'writing_additional'; detail?: string }
  | { phase: 'writing_manifest'; detail?: string }
  | { phase: 'writing_readme'; detail?: string }
  | { phase: 'complete'; folderPath: string }
  | { phase: 'failed'; error: string }

type NleExportPackagePayload = {
  bundleName: string
  primaryTimeline: { filename: string; content: string; format?: 'fcpxml' | 'otio' }
  additionalFiles?: Array<{
    filename: string
    content: string
    format?: 'xmeml' | 'md' | 'json' | 'fcpxml'
  }>
  manifest: unknown
  readme: string
  mediaUrisByAssetId?: Record<string, string>
}

type BrollProgressPayload = {
  phase: string
  detail?: string
  chunk?: number
  chunkTotal?: number
}

type RunwayBrollProgressPayload =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; taskId: string }
  | { phase: 'failed'; error: string }

type KlingBrollProgressPayload =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; taskId: string }
  | { phase: 'failed'; error: string }

type HiggsfieldBrollProgressPayload =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; requestId: string }
  | { phase: 'failed'; error: string }

type MediaCapabilityProgressPayload =
  | { phase: 'queued'; detail?: string }
  | { phase: 'generating'; detail?: string; progress?: number }
  | { phase: 'downloading'; detail?: string }
  | { phase: 'probing'; detail?: string }
  | { phase: 'complete'; localPath: string; jobId: string }
  | { phase: 'failed'; error: string }

type StorytellerMediaCapabilityName =
  | 'video-clip-from-text'
  | 'video-clip-from-image'
  | 'concept-frame'
  | 'storyboard-frame'
  | 'motion-graphic'
  | 'refine-prompt'

type AppStatus = {
  ok: true
  app: { platform: string; electron: string; node: string; isPackaged: boolean }
  ai: {
    mode: string
    openaiConfigured: boolean
    runwayConfigured: boolean
    proxyBaseUrl: string | null
  }
}

contextBridge.exposeInMainWorld('storyteller', {
  platform: process.platform,
  versions: process.versions,
  /**
   * Resolve an absolute filesystem path for a `File` from drag-and-drop or
   * `<input type=file>` in the renderer. Required since Electron 32 stopped
   * exposing `File.path`. Returns an empty string for unsupported sources.
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  getAppStatus: () => ipcRenderer.invoke('app:status') as Promise<AppStatus>,
  pickMediaFiles: (opts?: { multiple?: boolean }) =>
    ipcRenderer.invoke('media:pick', opts) as Promise<{ ok: boolean; paths: string[] }>,
  probeMedia: (filePath: string) => ipcRenderer.invoke('media:probe', filePath),
  extractAssetThumbnail: (payload: { sourcePath: string; assetId: string }) =>
    ipcRenderer.invoke('media:extractThumbnail', payload) as Promise<
      { ok: true; path: string } | { ok: false; error: string }
    >,
  /**
   * Returns a path the bundled Chromium can decode. Unsupported codecs
   * (HEVC, ProRes, DNxHR…) get transcoded once into a cached H.264 sidecar.
   */
  ensurePreviewProxy: (filePath: string) =>
    ipcRenderer.invoke('preview:ensureProxy', filePath) as Promise<
      | {
          ok: true
          playablePath: string
          usedSource: boolean
          proxyPath: string | null
          durationMs: number
          outcome: 'cache' | 'transcoded' | 'skipped'
          source: { codecVideo: string | null; codecAudio: string | null }
        }
      | {
          ok: false
          error: string
          code:
            | 'INVALID_PATH'
            | 'SOURCE_MISSING'
            | 'PROBE_FAILED'
            | 'FFMPEG_FAILED'
            | 'PROXY_DIR_FAILED'
        }
    >,
  verifyLocalMediaPath: (filePath: string) =>
    ipcRenderer.invoke('media:verifyLocalPath', filePath) as Promise<{
      ok: true
      exists: boolean
      path: string
      code: 'OK' | 'SOURCE_FILE_MISSING' | 'INVALID_PATH'
    }>,
  readLocalFile: (filePath: string) => ipcRenderer.invoke('media:readFile', filePath),
  /**
   * Build a `storyteller-media://` URL the renderer can drop straight into
   * a `<video>` / `<audio>` / `<img>` `src`. The main process handles the
   * scheme via `protocol.handle` and streams the file with HTTP-style
   * Range support so seeking works.
   */
  toMediaUrl: (filePath: string): string => {
    if (!filePath) return ''
    const normalized = filePath.replace(/\\/g, '/')
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
    return `storyteller-media://media${withLeadingSlash
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')}`
  },
  /**
   * Persist a renderer-side Blob (e.g. a MediaRecorder capture) to the OS temp
   * directory. Returns the absolute path so it can be passed to transcribe /
   * probe / export the same way as a disk-imported file.
   */
  writeTempMedia: (payload: { bytes: ArrayBuffer; filename?: string; extension?: string }) =>
    ipcRenderer.invoke('media:writeTempFile', payload) as Promise<
      { ok: true; path: string; size: number; name: string } | { ok: false; error: string }
    >,
  transcribeMedia: (payload: {
    signedUrl?: string
    localPath?: string
    filename: string
    assetType?: string
  }) => ipcRenderer.invoke('transcription:transcribe', payload),
  analyzeGroundedReview: (payload: {
    candidates: Array<{
      id: string
      text: string
      start: number
      end: number
      duration: number
      completenessScore: number
      sourceSegmentIds: string[]
      clipType: string
      heuristicComposite: number
      heuristicWithinTypeRank: number
      heuristicScores: {
        completeness: number
        standaloneImpact: number
        emotionalIntensity: number
        clarityOfMessage: number
        clipWorthiness: number
        scrollStopPotential: number
        narrativeTension: number
        quotability: number
        contrarianEdge: number
        consequence: number
        setupPenalty: number
        viralPriority: number
        dataAuthority?: number
      }
    }>
    subjectProfile: unknown
    promptPack: unknown
    directionText: string
    mode: string
    shotDurationSeconds?: number
  }) =>
    ipcRenderer.invoke('analysis:groundedReview', payload) as Promise<
      | {
          ok: true
          review: {
            rankedIds: string[]
            viralIds: string[]
            introIds: string[]
            graphIds: string[]
            trailerArc: string[]
            items: Array<{
              candidateId: string
              narrativeRole?:
                | 'cold-open'
                | 'transformation'
                | 'teaser'
                | 'emotional-low'
                | 'gut-punch'
                | 'viral-hook'
                | 'quotable-shift'
                | 'tension-setup'
                | 'payoff'
                | 'mission-close'
                | 'context'
              purpose?: string
              overallScore: number
              viralScore: number
              emotionalScore: number
              introScore: number
              graphScore: number
              labels: string[]
              rationale?: string
            whyBullets: string[]
            sectionReasons?: {
              viral?: string
              intro?: string
              graph?: string
            }
              graphicsPackage?: {
                graphImagePrompt?: string
                overlayTextImagePrompt?: string
                motionPromptFromImage?: string
                styleTags?: string[]
                style?: {
                  referenceStyle?: string
                  palette?: string[]
                  typography?: string
                  layout?: string
                  tone?: string
                  durationSeconds?: number
                }
              }
              brollIdeas: Array<{
                style: 'literal' | 'emotional' | 'symbolic'
                prompt: string
                why?: string
              }>
              graphIdea?: {
                chartType: 'bar' | 'line' | 'counter' | 'comparison' | 'text'
                title: string
                why?: string
                dataText?: string
                visualTreatment?: string
              }
            }>
          }
          source: 'ai' | 'fallback'
          reason?: string
        }
      | { ok: false; error: string }
    >,
  onTranscriptionProgress: (handler: (p: TranscriptionProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: TranscriptionProgressPayload) => handler(p)
    ipcRenderer.on('transcription:progress', wrapped)
    return () => ipcRenderer.removeListener('transcription:progress', wrapped)
  },
  revealInFolder: (filePath: string) => ipcRenderer.invoke('shell:revealInFolder', filePath),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath) as Promise<{ ok: true } | { ok: false; error: string }>,
  saveVideoDialog: () =>
    ipcRenderer.invoke('dialog:saveVideo') as Promise<
      { ok: true; path: string } | { ok: false; canceled: boolean }
    >,
  exportMp4: (payload: {
    outputPath: string
    sequence: unknown
    assetPathsById: Record<string, string>
    captions?: {
      burn?: boolean
      segmentsByAsset?: Record<string, unknown>
      style?: { fontSize?: number; marginVerticalPx?: number }
    }
  }) => ipcRenderer.invoke('export:mp4', payload) as Promise<{ ok: true } | { ok: false; error: string }>,
  onExportProgress: (handler: (p: ExportProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: ExportProgressPayload) => handler(p)
    ipcRenderer.on('export:progress', wrapped)
    return () => ipcRenderer.removeListener('export:progress', wrapped)
  },
  pickExportFolder: () =>
    ipcRenderer.invoke('dialog:pickExportFolder') as Promise<
      { ok: true; path: string } | { ok: false; canceled: boolean }
    >,
  exportNlePackage: (payload: { rootPath: string; packageFolderName?: string; pkg: NleExportPackagePayload }) =>
    ipcRenderer.invoke('export:nlePackage', payload) as Promise<
      { ok: true; folderPath: string } | { ok: false; error: string }
    >,
  onNleExportProgress: (handler: (p: NleExportProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: NleExportProgressPayload) => handler(p)
    ipcRenderer.on('nleExport:progress', wrapped)
    return () => ipcRenderer.removeListener('nleExport:progress', wrapped)
  },
  generateBrollPrompts: (payload: {
    projectId: string
    segments: Array<{ id: string; start: number; end: number; text: string }>
    subjectProfile: unknown
    promptPack: unknown
    aiDirection: string
    mode: string
    shotDurationSeconds?: number
    accessToken?: string
  }) =>
    ipcRenderer.invoke('broll:generate', payload) as Promise<
      { ok: true; prompts: unknown[]; creativePackage?: unknown } | { ok: false; error: string }
    >,
  /**
   * Beat-anchored writer: ONE B-roll prompt per beat (intro clip / saved soundbite),
   * with the style picked to match what's actually being said. Always succeeds —
   * falls back to a deterministic single-line writer if AI isn't configured.
   */
  generateBrollPromptsFromBeats: (payload: {
    projectId: string
    beats: Array<{
      id: string
      source_start: number
      source_end: number
      transcript_text: string
      score?: number | null
      origin?: 'intro' | 'saved-timeline' | 'soundbite'
    }>
    subjectProfile: unknown
    promptPack: unknown
    aiDirection: string
    mode: string
    shotDurationSeconds?: number
    accessToken?: string
  }) =>
    ipcRenderer.invoke('broll:generateFromBeats', payload) as Promise<
      | { ok: true; prompts: unknown[]; source: 'ai' | 'deterministic'; reason?: string }
      | { ok: false; error: string }
    >,
  generateBrollForSoundbite: (payload: {
    projectId: string
    soundbiteId: string
    transcriptText: string
    subjectProfile: unknown
    promptPack: unknown
    aiDirection: string
    mode: string
    shotDurationSeconds?: number
    accessToken?: string
    previousIdeas?: string[]
  }) =>
    ipcRenderer.invoke('broll:generateForSoundbite', payload) as Promise<
      | {
          ok: true
          brollIdeas: Array<{
            style: 'literal' | 'emotional' | 'symbolic'
            prompt: string
            stillImagePrompt?: string
            motionPrompt?: string
            why?: string
          }>
        }
      | { ok: false; error: string }
    >,
  onBrollProgress: (handler: (p: BrollProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: BrollProgressPayload) => handler(p)
    ipcRenderer.on('broll:progress', wrapped)
    return () => ipcRenderer.removeListener('broll:progress', wrapped)
  },
  generateRunwayBroll: (payload: {
    projectId: string
    slotId: string
    promptText: string
    ratio?: '1280:720' | '720:1280'
    durationSeconds?: number
    accessToken?: string
    audit?: { stylePackId?: string; promptCategory?: string }
  }) =>
    ipcRenderer.invoke('broll:runwayGenerate', payload) as Promise<
      | { ok: true; asset: unknown; taskId: string; localPath: string; outputUrls: string[] }
      | { ok: false; error: string }
    >,
  onRunwayBrollProgress: (handler: (p: RunwayBrollProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: RunwayBrollProgressPayload) => handler(p)
    ipcRenderer.on('brollRunway:progress', wrapped)
    return () => ipcRenderer.removeListener('brollRunway:progress', wrapped)
  },

  generateKlingBroll: (payload: {
    projectId: string
    slotId: string
    promptText: string
    ratio?: '16:9' | '9:16' | '1:1'
    durationSeconds?: number
    negativePrompt?: string
    accessToken?: string
    audit?: { stylePackId?: string; promptCategory?: string }
  }) =>
    ipcRenderer.invoke('broll:klingGenerate', payload) as Promise<
      | { ok: true; asset: unknown; taskId: string; localPath: string; outputUrls: string[] }
      | { ok: false; error: string }
    >,
  onKlingBrollProgress: (handler: (p: KlingBrollProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: KlingBrollProgressPayload) => handler(p)
    ipcRenderer.on('brollKling:progress', wrapped)
    return () => ipcRenderer.removeListener('brollKling:progress', wrapped)
  },

  generateHiggsfieldBroll: (payload: {
    projectId: string
    slotId: string
    promptText: string
    /**
     * Optional. When omitted (or empty), Higgsfield runs in text-to-video mode
     * — make sure `modelId` points at a model that supports T2V (e.g. one of
     * the `text-to-video` SKUs). When provided, the model is treated as image-
     * to-video (the previous default flow).
     */
    referenceImageUrl?: string
    modelId: string
    ratio?: '1280:720' | '720:1280'
    durationSeconds?: number
    accessToken?: string
    audit?: { stylePackId?: string; promptCategory?: string }
  }) =>
    ipcRenderer.invoke('broll:higgsfieldGenerate', payload) as Promise<
      | { ok: true; asset: unknown; requestId: string; localPath: string; videoUrl: string }
      | { ok: false; error: string }
    >,
  onHiggsfieldBrollProgress: (handler: (p: HiggsfieldBrollProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: HiggsfieldBrollProgressPayload) => handler(p)
    ipcRenderer.on('brollHiggsfield:progress', wrapped)
    return () => ipcRenderer.removeListener('brollHiggsfield:progress', wrapped)
  },

  /**
   * Capability-first media generation. Provider/model selection lives on the
   * gateway — the renderer just describes what it wants. Listen on
   * `onMediaProgress` for progress updates.
   */
  generateMedia: (payload: {
    projectId: string
    slotId?: string
    capability: StorytellerMediaCapabilityName
    creativeMode?:
      | 'cinematic_documentary'
      | 'viral_social'
      | 'podcast_premium'
      | 'journalism'
      | 'motivational'
      | 'financial_explainer'
    prompt: string
    negativePrompt?: string
    referenceImageUrl?: string
    durationSeconds?: number
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5'
    quality?: 'draft' | 'standard' | 'premium'
    accessToken?: string
    metadata?: Record<string, unknown>
  }) =>
    ipcRenderer.invoke('media:generate', payload) as Promise<
      | { ok: true; asset: unknown; jobId: string; localPath: string }
      | { ok: false; error: string }
    >,
  onMediaProgress: (handler: (p: MediaCapabilityProgressPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: MediaCapabilityProgressPayload) =>
      handler(p)
    ipcRenderer.on('media:progress', wrapped)
    return () => ipcRenderer.removeListener('media:progress', wrapped)
  },

  generateProductionStill: (payload: {
    projectId: string
    slotId: string
    productionPackage: unknown
    aspectRatio?: '16:9' | '9:16' | '1:1'
    accessToken?: string
    courtesyRegen?: boolean
  }) =>
    ipcRenderer.invoke('production:generateStill', payload) as Promise<
      | { ok: true; asset: unknown; jobId: string; localPath: string }
      | { ok: false; error: string }
    >,
  saveProductionUploadedStill: (payload: {
    projectId: string
    slotId: string
    bytes: ArrayBuffer | Uint8Array
    filename?: string
    mimeType?: string
  }) =>
    ipcRenderer.invoke('production:saveUploadedStill', payload) as Promise<
      | { ok: true; asset: unknown; localPath: string }
      | { ok: false; error: string }
    >,
  generateProductionVideo: (payload: {
    projectId: string
    slotId?: string
    motionPrompt: string
    stillLocalPath: string
    referenceImageUrl: string
    durationSeconds?: number
    aspectRatio?: '16:9' | '9:16' | '1:1'
    accessToken?: string
    productionPackageId?: string
  }) =>
    ipcRenderer.invoke('production:generateVideo', payload) as Promise<
      | { ok: true; asset: unknown; jobId: string; localPath: string }
      | { ok: false; error: string }
    >,
  onProductionStillProgress: (
    handler: (p: { slotId?: string; phase: string; detail?: string; progress?: number; error?: string }) => void
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: unknown) => handler(p as Parameters<typeof handler>[0])
    ipcRenderer.on('production:stillProgress', wrapped)
    return () => ipcRenderer.removeListener('production:stillProgress', wrapped)
  },
  onProductionVideoProgress: (
    handler: (p: { slotId?: string; phase: string; detail?: string; progress?: number; error?: string }) => void
  ) => {
    const wrapped = (_event: Electron.IpcRendererEvent, p: unknown) => handler(p as Parameters<typeof handler>[0])
    ipcRenderer.on('production:videoProgress', wrapped)
    return () => ipcRenderer.removeListener('production:videoProgress', wrapped)
  },

  getGatewayAccount: (payload: { accessToken?: string }) =>
    ipcRenderer.invoke('gateway:getAccount', payload) as Promise<
      | { ok: true; account: import('@storyteller/ai-gateway').StorytellerAccountSummaryWire }
      | { ok: false; error: string }
    >,
  getGatewayUsage: (payload: { accessToken?: string; limit?: number; offset?: number }) =>
    ipcRenderer.invoke('gateway:getUsage', payload) as Promise<
      | { ok: true; usage: import('@storyteller/ai-gateway').StorytellerUsageHistory }
      | { ok: false; error: string }
    >,

  /**
   * Higgsfield BYOK credential management. The renderer never sees the secret —
   * `getHiggsfieldStatus` just tells you whether anything is saved.
   */
  saveHiggsfieldCredentials: (payload: { apiKey: string; apiSecret: string }) =>
    ipcRenderer.invoke('higgsfield:saveCredentials', payload) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  clearHiggsfieldCredentials: () =>
    ipcRenderer.invoke('higgsfield:saveCredentials', { apiKey: '', apiSecret: '' }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  getHiggsfieldStatus: () =>
    ipcRenderer.invoke('higgsfield:status') as Promise<{ configured: boolean }>,
  testHiggsfieldCredentials: () =>
    ipcRenderer.invoke('higgsfield:testCredentials') as Promise<
      { ok: true } | { ok: false; error: string }
    >,

  /**
   * Decode an audio/music file and detect BPM + beat timestamps.
   * Returns beat timestamps in seconds and the detected tempo.
   */
  analyzeBeat: (filePath: string) =>
    ipcRenderer.invoke('media:analyzeBeat', filePath) as Promise<
      | { ok: true; bpm: number; beats: number[]; durationSeconds: number }
      | { ok: false; error: string }
    >
})
