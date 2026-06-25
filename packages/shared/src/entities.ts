import type { AssetProbeStatus, AssetUploadStatus } from './asset-status.js'
import type { StorageMode } from './storage-mode.js'
import type { StoryMode } from './modes.js'
import type { SilencePreset } from './pacing.js'

export type ProjectStatus =
  | 'draft'
  | 'ingesting'
  | 'analyzing'
  | 'draft_ready'
  | 'exporting'
  | 'complete'
  | 'error'

/**
 * Journalism clip role — assigned during field footage ingest to drive
 * news-package auto-assembly in `buildJournalismPackage()`.
 *
 * - sot       : Sound on Tape — interview subject speaking on camera
 * - standup   : Reporter on camera in the field (open or close)
 * - broll     : Supplemental coverage footage (no primary audio needed)
 * - voiceover : Reporter narration track (audio-only or separated)
 * - nat-sound : Natural / ambient sound from the scene
 * - anchor    : Anchor intro or outro (studio footage)
 * - unassigned: Not yet categorized
 */
export type JournalismClipRole =
  | 'sot'
  | 'standup'
  | 'broll'
  | 'voiceover'
  | 'nat-sound'
  | 'anchor'
  | 'unassigned'

export const JOURNALISM_CLIP_ROLES: { id: JournalismClipRole; label: string; description: string }[] = [
  { id: 'sot',       label: 'SOT',       description: 'Sound on Tape — interview subject on camera' },
  { id: 'standup',   label: 'Standup',   description: 'Reporter on camera (open or close)' },
  { id: 'broll',     label: 'B-Roll',    description: 'Supplemental coverage footage' },
  { id: 'voiceover', label: 'Voiceover', description: 'Reporter narration (audio track)' },
  { id: 'nat-sound', label: 'Nat Sound', description: 'Natural / ambient sound from the scene' },
  { id: 'anchor',    label: 'Anchor',    description: 'Anchor intro or outro' },
  { id: 'unassigned',label: 'Unassigned',description: 'Not yet categorized' }
]

/**
 * Auto-suggest a clip role from filename and asset characteristics.
 * Returns `unassigned` when no strong signal is found.
 */
export function suggestJournalismClipRole(
  filename: string | null | undefined,
  assetType: 'video' | 'audio' | 'image' | 'photo',
  durationSeconds: number | null | undefined
): JournalismClipRole {
  if (assetType === 'audio') return 'voiceover'
  if (assetType === 'image' || assetType === 'photo') return 'broll'

  const name = (filename ?? '').toLowerCase()
  if (/\b(standup|stand[_-]up|reporter|tag|open|close)\b/.test(name)) return 'standup'
  if (/\b(sot|interview|subject|talent)\b/.test(name)) return 'sot'
  if (/\b(broll|b[_-]roll|brl|coverage|b-roll)\b/.test(name)) return 'broll'
  if (/\b(vo|voiceover|voice[_-]over|narr|narration)\b/.test(name)) return 'voiceover'
  if (/\b(nat|natsound|nat[_-]sound|ambient|wildtrack|atmos)\b/.test(name)) return 'nat-sound'
  if (/\b(anchor|desk|studio|throw)\b/.test(name)) return 'anchor'

  // Duration heuristic: short clips are likely B-roll or standup fragments
  if (typeof durationSeconds === 'number' && durationSeconds < 8) return 'broll'

  return 'unassigned'
}

/**
 * Creator clip role — assigned during footage ingest to drive
 * creator-cut auto-assembly in `buildCreatorCut()`.
 *
 * - hook       : Attention-grabbing opening moment (first 2–5 s)
 * - hero       : Primary on-camera delivery / main talking-head footage
 * - broll      : Supplemental coverage, cutaways, environment
 * - testimonial: Another person reacting or speaking on camera
 * - recap      : Summary, outro, or call-to-action segment
 * - transition : Short bridge clips placed between segments
 * - unassigned : Not yet categorized
 */
export type CreatorClipRole =
  | 'hook'
  | 'hero'
  | 'broll'
  | 'testimonial'
  | 'recap'
  | 'transition'
  | 'unassigned'

export const CREATOR_CLIP_ROLES: { id: CreatorClipRole; label: string; description: string }[] = [
  { id: 'hook',        label: 'Hook',        description: 'Attention-grabbing opening moment' },
  { id: 'hero',        label: 'Hero',        description: 'Primary on-camera delivery / talking head' },
  { id: 'broll',       label: 'B-Roll',      description: 'Supplemental coverage and cutaways' },
  { id: 'testimonial', label: 'Testimonial', description: 'Another person reacting or speaking on camera' },
  { id: 'recap',       label: 'Recap / CTA', description: 'Summary, outro, or call to action' },
  { id: 'transition',  label: 'Transition',  description: 'Short bridge clip between segments' },
  { id: 'unassigned',  label: 'Unassigned',  description: 'Not yet categorized' }
]

/**
 * Highlight clip role — assigned during footage ingest to drive
 * sports-highlight auto-assembly in `buildHighlightReel()`.
 *
 * - hype       : Opening energy: crowd, warm-up, entrance
 * - play       : Game action: the key moments and plays
 * - reaction   : Celebration, sideline, emotion
 * - commentary : Coach, analyst, or athlete talking head
 * - crowd      : Atmosphere and context B-roll
 * - recap      : End card, stat graphic, or CTA
 * - unassigned : Not yet categorized
 */
export type HighlightClipRole =
  | 'hype'
  | 'play'
  | 'reaction'
  | 'commentary'
  | 'crowd'
  | 'recap'
  | 'unassigned'

export const HIGHLIGHT_CLIP_ROLES: { id: HighlightClipRole; label: string; description: string }[] = [
  { id: 'hype',        label: 'Hype',        description: 'Opening energy: crowd, warm-up, entrance' },
  { id: 'play',        label: 'Play',        description: 'Game action: the key moments and plays' },
  { id: 'reaction',   label: 'Reaction',    description: 'Celebration, sideline, emotion' },
  { id: 'commentary', label: 'Commentary',  description: 'Coach, analyst, or athlete talking head' },
  { id: 'crowd',      label: 'Crowd',       description: 'Atmosphere and context B-roll' },
  { id: 'recap',      label: 'Recap',       description: 'End card, stat graphic, or CTA' },
  { id: 'unassigned', label: 'Unassigned',  description: 'Not yet categorized' },
]

/**
 * Auto-suggest a creator clip role from filename and asset characteristics.
 * Returns `unassigned` when no strong signal is found.
 */
export function suggestCreatorClipRole(
  filename: string | null | undefined,
  assetType: 'video' | 'audio' | 'image' | 'photo',
  durationSeconds: number | null | undefined
): CreatorClipRole {
  if (assetType === 'image' || assetType === 'photo') return 'broll'

  const name = (filename ?? '').toLowerCase()
  if (/\b(hook|open|cold[_-]?open|tease|teaser|intro)\b/.test(name)) return 'hook'
  if (/\b(hero|main|primary|cam[_-]?a|talent|host)\b/.test(name)) return 'hero'
  if (/\b(broll|b[_-]roll|brl|coverage|cutaway|insert)\b/.test(name)) return 'broll'
  if (/\b(testimonial|testim|reaction|react|endorse)\b/.test(name)) return 'testimonial'
  if (/\b(recap|outro|cta|call[_-]?to[_-]?action|close|end)\b/.test(name)) return 'recap'
  if (/\b(transition|trans|bridge|bumper)\b/.test(name)) return 'transition'

  // Audio-only → likely a hero voiceover
  if (assetType === 'audio') return 'hero'

  // Very short clips are probably B-roll or transitions
  if (typeof durationSeconds === 'number' && durationSeconds < 6) return 'broll'

  return 'unassigned'
}

/**
 * Game phase for sports highlight timelines — orders clips chronologically
 * by moment within the game. Used in `TimelineSegment.phase`.
 */
export type GamePhase =
  | 'pregame'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'final_moments'
  | 'postgame'

export const GAME_PHASES: { id: GamePhase; label: string; short: string }[] = [
  { id: 'pregame',       label: 'Pregame',       short: 'Pre'   },
  { id: 'first_half',    label: 'First Half',    short: '1H'    },
  { id: 'halftime',      label: 'Halftime',      short: 'HT'    },
  { id: 'second_half',   label: 'Second Half',   short: '2H'    },
  { id: 'final_moments', label: 'Final Moments', short: 'Final' },
  { id: 'postgame',      label: 'Postgame',      short: 'Post'  },
]

/**
 * Structured settings for sports highlight projects.
 * Replaces the brittle free-form `aiDirection` string approach.
 * Stored on `LocalProject.highlightSettings`; can be serialised to
 * `Project.settings_json` when syncing to Supabase.
 */
export interface HighlightSettings {
  /** e.g. "Basketball", "Soccer" */
  sport: string
  /** Template ID from the setup flow, e.g. "espn" | "nba_social" | "nike" | "recruiting" | "raw_energy" */
  reelStyle: string
  musicTrackName?: string
  beatSyncEnabled: boolean
  /** e.g. "NCAA", "NBA", "High School" */
  league?: string
  /** e.g. "men", "women" */
  gender?: string
  team?: string
  /** Clip-to-phase timeline assignments, persisted alongside highlight settings in Supabase. */
  timelineSegments?: TimelineSegment[]
}

/**
 * A single clip assigned to the highlight timeline, with phase placement
 * and highlight scoring. Stored on `LocalProject.timelineSegments`.
 */
export interface TimelineSegment {
  id: string
  assetId: string
  role: HighlightClipRole
  phase: GamePhase
  /** 0–100 highlight importance score */
  highlightScore: number
  /** Sort order within the phase lane */
  orderInPhase: number
  /** 0–1 AI confidence in the phase assignment (set by auto-assign) */
  confidence?: number
  durationSeconds?: number
  notes?: string
}

/** `image` kept for legacy rows; new uploads use `photo` for stills */
export type AssetType = 'video' | 'audio' | 'image' | 'photo'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string | null
  organization: string | null
  created_at: string
}

export interface ProjectSettings {
  silence_preset?: SilencePreset
  sync_master_audio_asset_id?: string | null
  sync_manual_offset_ms?: number
  waveform_sync_enabled?: boolean
  timecode_sync_enabled?: boolean
  /**
   * Per-project shot duration the B-roll writer composes prompts for.
   * Defaults to {@link DEFAULT_BROLL_SHOT_DURATION_SECONDS} (8s — VEO 3 / Runway gen4.5
   * native shot length). Stored on the project so regenerating prompts is
   * stable across sessions; callers should clamp to the provider's allowed
   * range when they actually queue a job.
   */
  broll_shot_duration_seconds?: number
  /**
   * When false, transition-role B-roll clips are excluded from the creator cut
   * builder. Defaults to true for backward compatibility.
   */
  broll_transitions_enabled?: boolean
  /**
   * Filename of the music track uploaded for beat-synced highlight reel cuts.
   * Stored here so the assembly AI knows a track was provided.
   */
  music_track_name?: string
  /**
   * When true, the assembly AI will align cuts to detected beat markers in the
   * music track. Only meaningful when `music_track_name` is set.
   */
  beat_sync_enabled?: boolean
}

/** Default cinematic B-roll shot length when the project hasn't set one. */
export const DEFAULT_BROLL_SHOT_DURATION_SECONDS = 8

/**
 * Clamp any incoming duration to the range supported across our current
 * providers (Runway gen4.5 = 5/10s, VEO 3 = ~8s). We keep the writer flexible
 * (5–12s) and let the provider runner snap to its own legal value.
 */
export function clampBrollShotDurationSeconds(
  raw: number | null | undefined
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_BROLL_SHOT_DURATION_SECONDS
  }
  if (raw < 5) return 5
  if (raw > 12) return 12
  return Math.round(raw)
}

export interface Project {
  id: string
  user_id: string
  title: string
  mode: StoryMode
  description: string | null
  status: ProjectStatus
  settings_json: ProjectSettings | null
  highlight_settings?: HighlightSettings | null
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  project_id: string
  asset_type: AssetType
  /** Primary storage routing for desktop workflows */
  storage_mode: StorageMode
  /** Absolute path on disk when imported locally (Electron) */
  local_path: string | null
  /** Object key in Storage bucket `project-media` when synced to cloud */
  storage_path: string | null
  /** Optional generated proxy for preview (future) */
  proxy_path: string | null
  /** Optional dedupe / sync fingerprint */
  media_hash: string | null
  /** True when media bytes exist in Supabase Storage */
  is_uploaded: boolean
  original_filename: string | null
  mime_type: string | null
  upload_status: AssetUploadStatus
  probe_status: AssetProbeStatus
  duration_seconds: number | null
  width: number | null
  height: number | null
  fps: number | null
  metadata_json: Record<string, unknown> | null
  sort_order: number
  /** Journalism role assigned at ingest — drives news-package assembly. */
  clip_role: JournalismClipRole | null
  /** Creator role assigned at ingest — drives creator-cut assembly. */
  creator_clip_role: CreatorClipRole | null
  /** Highlight role assigned at ingest — drives sports highlight-reel assembly. */
  highlight_clip_role: HighlightClipRole | null
  /** Game phase this clip belongs to (highlight mode). Set via HighlightTimeline. */
  game_phase?: GamePhase
  /** 0–100 highlight importance score. Higher = more likely to be featured. */
  highlight_score?: number
  created_at: string
}

export interface TranscriptSegment {
  id: string
  project_id: string
  asset_id: string
  speaker_label: string | null
  start_time: number
  end_time: number
  text: string
  confidence: number | null
  created_at: string
}

export interface SilenceRegion {
  id: string
  project_id: string
  asset_id: string
  start_time: number
  end_time: number
  severity: number | null
  created_at: string
}

export interface SoundbiteCandidate {
  id: string
  project_id: string
  start_time: number
  end_time: number
  transcript_text: string
  score_social: number | null
  score_emotional: number | null
  score_clarity: number | null
  tags_json: Record<string, unknown> | null
  created_at: string
}

export interface StoryPlan {
  id: string
  project_id: string
  mode: StoryMode
  user_prompt: string | null
  plan_json: Record<string, unknown>
  created_at: string
}

export interface BrollPrompt {
  id: string
  project_id: string
  segment_start: number
  segment_end: number
  prompt_type: 'literal' | 'emotional' | 'symbolic'
  prompt_text: string
  priority_score: number | null
  created_at: string
  /** Rich payload: provider-ready strings, tone tags, source summary (UI + future API). */
  metadata_json?: Record<string, unknown> | null
}

export type TextRenderMode = 'burnin' | 'alpha' | 'separate'

export interface TextEvent {
  id: string
  project_id: string
  preset_id: string
  start_time: number
  end_time: number
  content: string
  styling_json: Record<string, unknown> | null
  render_mode: TextRenderMode
  created_at: string
}

export interface TimelineRow {
  id: string
  project_id: string
  version: number
  timeline_json: Record<string, unknown>
  created_at: string
}

export type ExportType = 'mp4' | 'xml_package' | 'alpha_overlay'

export type ExportJobStatus = 'queued' | 'running' | 'complete' | 'failed'

export interface ExportJob {
  id: string
  project_id: string
  export_type: ExportType
  status: ExportJobStatus
  output_path: string | null
  metadata_json: Record<string, unknown> | null
  created_at: string
}
