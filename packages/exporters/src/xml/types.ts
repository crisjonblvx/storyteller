/** Supported professional NLE interchange targets (one canonical timeline → per-target packages). */
export type NleTarget = 'final-cut-pro' | 'premiere-pro' | 'davinci-resolve' | 'otio'

/** FCPXML-friendly subset for interchange — extend as needed */
export interface XmlExportClip {
  id: string
  role: string
  assetId: string
  sourceInSeconds: number
  sourceOutSeconds: number
  timelineInSeconds: number
  timelineOutSeconds: number
}

export interface XmlExportTrack {
  id: string
  kind: 'video' | 'audio' | 'text'
  clips: XmlExportClip[]
}

/** Clip summary for manifests / relink — derived from canonical timeline JSON */
export interface XmlManifestClipRef {
  id: string
  trackId: string
  trackKind: 'video' | 'audio' | 'text'
  role: string
  assetId: string
  sourceInSeconds: number
  sourceOutSeconds: number
  timelineInSeconds: number
  timelineOutSeconds: number
  transcriptSegmentIds?: string[]
  soundbiteId?: string
  /** Intro builder section label when present */
  introRole?: string
  textEventId?: string
}

export interface XmlPackageManifest {
  version: 1
  /** Which NLE this package was generated for (README + filenames differ; timeline is still canonical). */
  targetNle: NleTarget
  /** Bumped when manifest schema or canonical mapping changes */
  manifestSchemaVersion: 1
  projectId: string
  sequenceId: string
  generatedAt: string
  assets: Array<{
    id: string
    /** Supabase Storage object key when synced */
    storagePath: string | null
    /** Absolute local path on disk when working local-first */
    localPath: string | null
    kind: 'video' | 'audio' | 'image'
  }>
  /** Ordered tracks + clips from canonical `TimelineSequence` (editor-agnostic source of truth). */
  tracks: Array<{
    id: string
    name: string
    kind: 'video' | 'audio' | 'text'
    clipCount: number
  }>
  clips: XmlManifestClipRef[]
  textOverlayRefs: Array<{
    textEventId: string
    presetId: string
    startSeconds: number
    endSeconds: number
    renderMode: string
    /**
     * The fields below are optional so older manifest readers continue
     * round-tripping cleanly. New ones (the in-app NLE-handoff readme + any
     * future "rebuild graphics from manifest" automation) can use them to
     * reconstruct the actual headline text in the editor's title generator.
     */
    kind?: 'text' | 'hook' | 'stat' | 'graphic'
    content?: string
    subtitle?: string
    graphicsSlotId?: string
    graphicsKind?: 'graph-image' | 'text-image' | 'motion-overlay'
    generatedAssetId?: string
    stat?: {
      chart: 'counter' | 'bar' | 'donut'
      value: number
      target?: number
      prefix?: string
      suffix?: string
      label?: string
    }
  }>
  markers: Array<{ id: string; label: string; timeSeconds: number; color?: string }>
}
