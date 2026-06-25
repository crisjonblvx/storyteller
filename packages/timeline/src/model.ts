import type { StoryMode, ProjectFormat } from '@storyteller/shared'
import type { SoundDesignSlot, SoundMotivatedTimingNote } from './audio-director.js'

/** Roles for clips and generated items — drives export + UI */
export type TimelineItemRole =
  | 'a-roll'
  | 'b-roll'
  | 'nat-audio'
  | 'music'
  | 'lower-third'
  | 'caption'
  | 'quote-card'
  | 'placeholder-broll'
  | 'silence-cut'
  /**
   * Deliberate breathing-room gap inserted by the user from the Enhance step.
   * Distinct from `silence-cut` (which represents an automatic dead-air trim)
   * — `pause-gap` clips have no asset and no source window; they exist only
   * to push subsequent clips forward and to render as black/silent in export.
   */
  | 'pause-gap'
  | 'sfx-ambient'
  | 'sfx-movement'
  | 'sfx-impact'
  | 'sfx-transition'

export interface TimelineMarker {
  id: string
  label: string
  timeSeconds: number
  color?: string
  metadata?: Record<string, unknown>
}

/** 0–100 anchor for vertical cover crop (CSS object-position semantics). */
export type FramePosition = { x: number; y: number }

export interface TimelineClip {
  id: string
  role: TimelineItemRole
  /** Source asset in storage */
  assetId: string
  sourceInSeconds: number
  sourceOutSeconds: number
  timelineInSeconds: number
  timelineOutSeconds: number
  /** Linked transcript segment ids */
  transcriptSegmentIds?: string[]
  /** Linked soundbite candidate id (rough cut / export to NLE) */
  soundbiteId?: string
  /** Reserved B-roll slot metadata */
  brollPromptId?: string
  /** Vertical cover crop anchor. Ignored when project is horizontal or fit is contain. */
  framePosition?: FramePosition
  /** When true, the clip is excluded from export but remains visible in the timeline at reduced opacity. */
  disabled?: boolean
  /** Actual duration of the source asset file. When set, trim is clamped to this. */
  assetDurationSeconds?: number
  metadata?: Record<string, unknown>
}

export interface TimelineTrack {
  id: string
  name: string
  clips: TimelineClip[]
}

export interface TextTrackEventRef {
  id: string
  textEventId: string
  timelineInSeconds: number
  timelineOutSeconds: number
}

/**
 * Inline overlay events authored from the `5. Enhance` step. We deliberately
 * persist these on the sequence JSON (not the legacy `text_events` table) so
 * the canonical timeline file remains the single source of truth for an
 * edit revision — same pattern as `brollSlots`. If we later need a sharable
 * library of presets, we can introduce a `text_events` cross-project table
 * and migrate; the renderer just promotes inline → reference in that case.
 */
export type OverlayKind = 'text' | 'hook' | 'stat'

export type OverlayChartKind = 'counter' | 'bar' | 'donut'

/**
 * Stat / chart payload. The renderer + exporter pick which fields to read
 * based on `chart`:
 *   - counter : animates `value` from 0 → value, optionally with `prefix`
 *               (e.g. "$") and `suffix` (e.g. "M").
 *   - bar     : draws a single horizontal bar that fills 0 → `value` /
 *               `target`. `value` and `target` are both required.
 *   - donut   : draws a single ring that fills 0 → `value` (interpreted
 *               as a percentage 0-100).
 */
export interface OverlayStatPayload {
  chart: OverlayChartKind
  /** Primary number — counter target / bar value / donut percentage. */
  value: number
  /** Used by `bar` only — the 100% point on the bar. */
  target?: number
  prefix?: string
  suffix?: string
  /** Bottom-of-card supporting label, e.g. "monthly recurring revenue". */
  label?: string
}

export interface OverlayEvent {
  id: string
  kind: OverlayKind
  /** Seconds on the SEQUENCE timeline (not source-time). */
  timelineInSeconds: number
  timelineOutSeconds: number
  /** What the user actually wrote — the headline text for `text` and `hook`,
   *  or the supporting copy for `stat`. */
  content: string
  /** Optional second line. Used by `hook` for the small subtitle under the headline. */
  subtitle?: string
  /** Required when `kind === 'stat'`. */
  stat?: OverlayStatPayload
  /**
   * Visual position on the frame. We keep this small and declarative so the
   * preview overlay layer + the ffmpeg export filter graph can stay in sync.
   */
  position?: 'top' | 'middle' | 'bottom-left' | 'bottom' | 'bottom-right'
  /**
   * Author audit. Lets us show "added at 2026-04-19" in the list and lets
   * the export pipeline tell apart ones the user explicitly placed vs
   * ones an upstream tool authored automatically.
   */
  createdAt?: string
  metadata?: Record<string, unknown>
}

/** Editorial placeholder for AI B-roll — lives on the canonical timeline JSON. */
export type BrollSlotStatus = 'empty' | 'queued' | 'generating' | 'ready' | 'failed'

/**
 * Video-gen providers Storyteller can route a B-roll slot to.
 * - `runway`     : Runway gen4.5 text-to-video (uses Storyteller's own API key today)
 * - `kling`      : reserved for direct Kling integration (not implemented yet — prompts only)
 * - `higgsfield` : Higgsfield image-to-video (BYOK; needs a per-slot reference image)
 */
export type BrollProvider = 'runway' | 'kling' | 'higgsfield'

export interface BrollSlot {
  id: string
  projectId: string
  /** DB `broll_prompts.id` when present */
  sourcePromptId?: string
  sourceSegmentId?: string
  timelineStart: number
  timelineEnd: number
  suggestedDurationSeconds: number
  /** Intro section label when mapped from intro builder (e.g. hook, tension) */
  introRole?: string
  context?: 'literal' | 'emotional' | 'symbolic'
  linkedSoundbiteId?: string
  linkedTranscriptSegmentIds?: string[]
  providerTarget?: BrollProvider
  generatedAssetId?: string
  status: BrollSlotStatus
  errorMessage?: string
  runwayTaskId?: string
  /** Higgsfield request id, surfaced for cancel / retry. */
  higgsfieldRequestId?: string
  /**
   * Asset id of the reference IMAGE the user attached to this slot for
   * image-to-video providers (Higgsfield). Required for `higgsfield` runs;
   * unused for Runway. Mirrors `generatedAssetId` so the renderer can
   * preview it the same way as the result.
   */
  referenceImageAssetId?: string
  /** Audit: prompt sent, provider, timestamps (filled on generation) */
  metadata?: Record<string, unknown>
}

export type GraphicsSlotKind = 'graph-image' | 'text-image' | 'motion-overlay'
export type GraphicsSlotStatus = 'empty' | 'queued' | 'generating' | 'ready' | 'failed'

/**
 * Editorial graphics slot placed on a top visual layer.
 * - graph-image: static chart/stat graphic
 * - text-image: typographic overlay image
 * - motion-overlay: animated overlay video (often image-to-video)
 */
export interface GraphicsSlot {
  id: string
  projectId: string
  kind: GraphicsSlotKind
  timelineStart: number
  timelineEnd: number
  suggestedDurationSeconds: number
  linkedSoundbiteId?: string
  linkedTranscriptSegmentIds?: string[]
  sourceSegmentId?: string
  sourcePromptId?: string
  promptText?: string
  generatedAssetId?: string
  /**
   * Optional source image to animate when `kind === 'motion-overlay'`.
   */
  referenceImageAssetId?: string
  status: GraphicsSlotStatus
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export interface TimelineSequence {
  id: string
  projectId: string
  mode: StoryMode
  format: ProjectFormat
  durationSeconds: number
  videoTracks: TimelineTrack[]
  audioTracks: TimelineTrack[]
  /** Text as references to `text_events` + placement */
  textTracks: TimelineTrack[]
  markers: TimelineMarker[]
  /** B-roll editorial slots (prompt → Runway → asset). Optional; omit in older saves. */
  brollSlots?: BrollSlot[]
  /** Graphics/editorial image+motion slots rendered on a top layer. */
  graphicsSlots?: GraphicsSlot[]
  /**
   * Inline overlay events authored from `5. Enhance`. Optional so older saves
   * round-trip cleanly. The preview layer reads these for live rendering, the
   * MP4 exporter burns them in via ffmpeg drawtext / canvas overlays, and the
   * NLE exporter writes them as `textOverlayRefs` on the manifest.
   */
  overlayEvents?: OverlayEvent[]
  /** Sound design slots (SFX suggestions placed on the timeline). Optional; omit in older saves. */
  soundDesignSlots?: SoundDesignSlot[]
  /** Timing notes where sound motivates an edit trim or extension. */
  soundTimingNotes?: SoundMotivatedTimingNote[]
  exportMetadata?: {
    aspectRatio?: '16:9' | '9:16' | '1:1'
    burnInCaptions?: boolean
    xmlNotes?: string
  }
  metadata?: Record<string, unknown>
}
