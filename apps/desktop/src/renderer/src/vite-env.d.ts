/// <reference types="vite/client" />

import type { StorytellerAiMode } from '@storyteller/ai-gateway'
import type {
  StorytellerAccountSummaryWire,
  StorytellerUsageHistory
} from '@storyteller/ai-gateway'

export type ProbeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

export type EnsurePreviewProxyResult =
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

export type ReadLocalFileResult =
  | { ok: true; name: string; size: number; bytes: ArrayBuffer }
  | { ok: false; error: string }

type TranscribeMediaResult =
  | {
      ok: true
      segments: Array<{ start: number; end: number; text: string }>
      duration?: number
      language?: string
    }
  | { ok: false; error: string }

export type TranscriptionProgressPayload = {
  phase: 'preparing' | 'chunking' | 'transcribing_chunk' | 'merging' | 'done'
  detail?: string
  chunkIndex?: number
  chunkTotal?: number
  chunksCompleted?: number
  estimatedSecondsRemaining?: number
}

export type ExportProgressPayload =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'encoding_clip'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'concatenating'; detail?: string }
  | { phase: 'overlaying_broll'; clipIndex: number; clipTotal: number; detail?: string }
  | { phase: 'burning_captions'; detail?: string }
  | { phase: 'complete'; outputPath: string }
  | { phase: 'failed'; error: string }

export type NleExportProgressPayload =
  | { phase: 'preparing'; detail?: string }
  | { phase: 'writing_timeline'; detail?: string }
  | { phase: 'writing_additional'; detail?: string }
  | { phase: 'writing_manifest'; detail?: string }
  | { phase: 'writing_readme'; detail?: string }
  | { phase: 'complete'; folderPath: string }
  | { phase: 'failed'; error: string }

export type AppStatus = {
  ok: true
  app: { platform: string; electron: string; node: string; isPackaged: boolean }
  ai: {
    /** Capability-routing mode. `unconfigured` means the gateway URL is missing. */
    mode: StorytellerAiMode
    /** Capability-oriented readiness signals. Prefer these in new UI. */
    reviewReady?: boolean
    mediaReady?: boolean
    /** @deprecated provider-specific signals; use `reviewReady` / `mediaReady`. */
    openaiConfigured: boolean
    /** @deprecated provider-specific signals; use `reviewReady` / `mediaReady`. */
    runwayConfigured: boolean
    proxyBaseUrl: string | null
    gatewayUrl?: string | null
    mediaGatewayEnabled?: boolean
    gatewayReachable?: boolean
    gatewayHealth?: object
    enableKling?: boolean
    enableByok?: boolean
  }
}

interface StorytellerBridge {
  platform: string
  versions: NodeJS.ProcessVersions
  /** Resolve absolute path for a File (drag-and-drop or input). Empty string when unsupported. */
  getPathForFile?: (file: File) => string
  /** Returns env-derived feature flags (no key values). */
  getAppStatus?: () => Promise<AppStatus>
  pickMediaFiles?: (opts?: { multiple?: boolean }) => Promise<{ ok?: boolean; paths?: string[] }>
  probeMedia?: (filePath: string) => Promise<ProbeResult>
  extractAssetThumbnail?: (payload: {
    sourcePath: string
    assetId: string
  }) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  /** Transcodes unsupported sources to a Chromium-friendly H.264 proxy on demand. */
  ensurePreviewProxy?: (filePath: string) => Promise<EnsurePreviewProxyResult>
  verifyLocalMediaPath?: (filePath: string) => Promise<{
    ok: true
    exists: boolean
    path: string
    code: 'OK' | 'SOURCE_FILE_MISSING' | 'INVALID_PATH'
  }>
  readLocalFile?: (filePath: string) => Promise<ReadLocalFileResult>
  /** Build a `storyteller-media://` URL for use as `<video>` / `<audio>` / `<img>` src. */
  toMediaUrl?: (filePath: string) => string
  /** Write renderer bytes to OS temp dir; returns the absolute file path. */
  writeTempMedia?: (payload: {
    bytes: ArrayBuffer
    filename?: string
    extension?: string
  }) => Promise<{ ok: true; path: string; size: number; name: string } | { ok: false; error: string }>
  transcribeMedia?: (payload: {
    signedUrl?: string
    localPath?: string
    filename: string
    assetType?: string
  }) => Promise<TranscribeMediaResult>
  analyzeGroundedReview?: (payload: {
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
    segments?: Array<{
      id: string
      start: number
      end: number
      text: string
      speaker_label?: string | null
    }>
    subjectProfile: unknown
    promptPack: unknown
    directionText: string
    mode: string
    targetCount?: number
    shotDurationSeconds?: number
  }) => Promise<
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
        candidates?: Array<{
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
        source: 'ai' | 'fallback'
        reason?: string
      }
    | { ok: false; error: string }
  >
  onTranscriptionProgress?: (handler: (p: TranscriptionProgressPayload) => void) => () => void
  revealInFolder?: (filePath: string) => Promise<void>
  openPath?: (targetPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  saveVideoDialog?: () => Promise<{ ok: true; path: string } | { ok: false; canceled: boolean }>
  exportMp4?: (payload: {
    outputPath: string
    sequence: unknown
    assetPathsById: Record<string, string>
    captions?: {
      burn?: boolean
      segmentsByAsset?: Record<string, unknown>
      style?: { fontSize?: number; marginVerticalPx?: number }
    }
    soundDesign?: {
      slots: unknown[]
      resolutions: unknown[]
      audioDna: unknown
    }
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  onExportProgress?: (handler: (p: ExportProgressPayload) => void) => () => void
  pickExportFolder?: () => Promise<{ ok: true; path: string } | { ok: false; canceled: boolean }>
  exportNlePackage?: (payload: {
    rootPath: string
    packageFolderName?: string
    pkg: {
      bundleName: string
      primaryTimeline: { filename: string; content: string; format?: 'fcpxml' | 'otio' }
      additionalFiles?: Array<{
        filename: string
        content: string
        format?: 'xmeml' | 'md' | 'json' | 'fcpxml'
      }>
      manifest: unknown
      readme: string
      exportSummaryText?: string
      mediaUrisByAssetId?: Record<string, string>
    }
  }) => Promise<{ ok: true; folderPath: string } | { ok: false; error: string }>
  onNleExportProgress?: (handler: (p: NleExportProgressPayload) => void) => () => void
  generateBrollPrompts?: (payload: {
    projectId: string
    segments: Array<{ id: string; start: number; end: number; text: string }>
    subjectProfile: unknown
    promptPack: unknown
    aiDirection: string
    mode: string
    shotDurationSeconds?: number
    accessToken?: string
  }) => Promise<{ ok: true; prompts: unknown[]; creativePackage?: unknown } | { ok: false; error: string }>
  /** Beat-anchored writer: one prompt per intro clip / saved soundbite. Always returns ok:true (deterministic fallback). */
  generateBrollPromptsFromBeats?: (payload: {
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
  }) => Promise<
    | { ok: true; prompts: unknown[]; source: 'ai' | 'deterministic'; reason?: string }
    | { ok: false; error: string }
  >
  generateBrollForSoundbite?: (payload: {
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
  }) => Promise<
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
  >
  onBrollProgress?: (handler: (p: { phase: string; detail?: string; chunk?: number; chunkTotal?: number }) => void) => () => void
  generateRunwayBroll?: (payload: {
    projectId: string
    slotId: string
    promptText: string
    ratio?: '1280:720' | '720:1280'
    durationSeconds?: number
    audit?: { stylePackId?: string; promptCategory?: string }
  }) => Promise<
    | { ok: true; asset: unknown; taskId: string; localPath: string; outputUrls: string[] }
    | { ok: false; error: string }
  >
  onRunwayBrollProgress?: (
    handler: (p: {
      phase: 'queued' | 'generating' | 'downloading' | 'probing' | 'complete' | 'failed'
      detail?: string
      localPath?: string
      taskId?: string
      error?: string
    }) => void
  ) => () => void

  generateKlingBroll?: (payload: {
    projectId: string
    slotId: string
    promptText: string
    ratio?: '16:9' | '9:16' | '1:1'
    durationSeconds?: number
    negativePrompt?: string
    audit?: { stylePackId?: string; promptCategory?: string }
  }) => Promise<
    | { ok: true; asset: unknown; taskId: string; localPath: string; outputUrls: string[] }
    | { ok: false; error: string }
  >
  onKlingBrollProgress?: (
    handler: (p: {
      phase: 'queued' | 'generating' | 'downloading' | 'probing' | 'complete' | 'failed'
      detail?: string
      localPath?: string
      taskId?: string
      error?: string
    }) => void
  ) => () => void

  generateHiggsfieldBroll?: (payload: {
    projectId: string
    slotId: string
    promptText: string
    /** Optional — omit/empty to run as text-to-video. */
    referenceImageUrl?: string
    modelId: string
    ratio?: '1280:720' | '720:1280'
    durationSeconds?: number
    audit?: { stylePackId?: string; promptCategory?: string }
  }) => Promise<
    | { ok: true; asset: unknown; requestId: string; localPath: string; videoUrl: string }
    | { ok: false; error: string }
  >
  onHiggsfieldBrollProgress?: (
    handler: (p: {
      phase: 'queued' | 'generating' | 'downloading' | 'probing' | 'complete' | 'failed'
      detail?: string
      localPath?: string
      requestId?: string
      error?: string
    }) => void
  ) => () => void

  saveHiggsfieldCredentials?: (payload: { apiKey: string; apiSecret: string }) => Promise<
    { ok: true } | { ok: false; error: string }
  >
  clearHiggsfieldCredentials?: () => Promise<{ ok: true } | { ok: false; error: string }>
  getHiggsfieldStatus?: () => Promise<{ configured: boolean }>
  testHiggsfieldCredentials?: () => Promise<{ ok: true } | { ok: false; error: string }>

  /**
   * Capability-first media generation. The renderer describes WHAT it wants
   * (clip from text, motion graphic, etc.) and the gateway picks the best
   * provider/model server-side.
   */
  generateMedia?: (payload: {
    projectId: string
    slotId?: string
    capability:
      | 'video-clip-from-text'
      | 'video-clip-from-image'
      | 'concept-frame'
      | 'storyboard-frame'
      | 'motion-graphic'
      | 'refine-prompt'
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
    providerPreference?: 'auto' | 'runway' | 'higgsfield' | 'openai' | 'ideogram'
    accessToken?: string
    metadata?: Record<string, unknown>
  }) => Promise<
    | { ok: true; asset: unknown; jobId: string; localPath: string }
    | { ok: false; error: string }
  >
  onMediaProgress?: (
    handler: (p:
      | { phase: 'queued'; detail?: string }
      | { phase: 'generating'; detail?: string; progress?: number }
      | { phase: 'downloading'; detail?: string }
      | { phase: 'probing'; detail?: string }
      | { phase: 'complete'; localPath: string; jobId: string }
      | { phase: 'failed'; error: string }
    ) => void
  ) => () => void

  generateProductionStill?: (payload: {
    projectId: string
    slotId: string
    productionPackage: unknown
    aspectRatio?: '16:9' | '9:16' | '1:1'
    accessToken?: string
    courtesyRegen?: boolean
  }) => Promise<
    | { ok: true; asset: unknown; jobId: string; localPath: string }
    | { ok: false; error: string }
  >
  saveProductionUploadedStill?: (payload: {
    projectId: string
    slotId: string
    bytes: ArrayBuffer | Uint8Array
    filename?: string
    mimeType?: string
  }) => Promise<
    | { ok: true; asset: unknown; localPath: string }
    | { ok: false; error: string }
  >
  generateProductionVideo?: (payload: {
    projectId: string
    slotId?: string
    motionPrompt: string
    stillLocalPath: string
    referenceImageUrl: string
    durationSeconds?: number
    aspectRatio?: '16:9' | '9:16' | '1:1'
    accessToken?: string
    productionPackageId?: string
  }) => Promise<
    | { ok: true; asset: unknown; jobId: string; localPath: string }
    | { ok: false; error: string }
  >
  onProductionStillProgress?: (
    handler: (p: { slotId?: string; phase: string; detail?: string; progress?: number; error?: string }) => void
  ) => () => void
  onProductionVideoProgress?: (
    handler: (p: { slotId?: string; phase: string; detail?: string; progress?: number; error?: string }) => void
  ) => () => void

  getGatewayAccount?: (payload: { accessToken?: string }) => Promise<
    | { ok: true; account: StorytellerAccountSummaryWire }
    | { ok: false; error: string }
  >
  getGatewayUsage?: (payload: {
    accessToken?: string
    limit?: number
    offset?: number
  }) => Promise<
    | { ok: true; usage: StorytellerUsageHistory }
    | { ok: false; error: string }
  >
  /** Detect BPM and beat timestamps from a local audio/music file. */
  analyzeBeat?: (filePath: string) => Promise<
    | { ok: true; bpm: number; beats: number[]; durationSeconds: number }
    | { ok: false; error: string }
  >
}

declare global {
  interface Window {
    storyteller?: StorytellerBridge
  }
}

export {}
