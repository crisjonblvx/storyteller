import { create } from 'zustand'
import type { PromptPackId } from '@storyteller/analysis'
import type { SilencePreset, StoryMode, StoryIntent, PrimaryGoal } from '@storyteller/shared'
import { SILENCE_PRESETS, defaultSilencePresetForMode, STORY_MODES, intentToMode } from '@storyteller/shared'
import { defaultSubjectProfile, normalizeSubjectProfile, type SubjectProfile } from '@storyteller/shared'
import { getProjectFormat, type ProjectFormat } from '@storyteller/shared'
import {
  clampBrollShotDurationSeconds,
  DEFAULT_BROLL_SHOT_DURATION_SECONDS
} from '@storyteller/shared'

export type PromptPackSelection = PromptPackId | 'auto'

const STORAGE_KEY = 'storyteller-local-projects-v1'

const PROMPT_PACK_IDS: PromptPackId[] = [
  'cinematic_documentary',
  'viral_social',
  'podcast_premium',
  'journalism',
  'motivational',
  'music_video'
]

function normalizePromptPackId(raw: unknown): PromptPackSelection {
  if (raw === 'auto') return 'auto'
  if (typeof raw === 'string' && (PROMPT_PACK_IDS as readonly string[]).includes(raw)) {
    return raw as PromptPackId
  }
  return 'auto'
}

function normalizeLocalProject(raw: unknown): LocalProject | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  if (!id) return null
  const intent = typeof r.intent === 'string' ? (r.intent as StoryIntent) : undefined
  const mode = (intent
    ? intentToMode(intent)
    : typeof r.mode === 'string' && (STORY_MODES as readonly string[]).includes(r.mode)
      ? r.mode
      : 'story') as StoryMode
  const format = r.format ? (r.format as ProjectFormat) : getProjectFormat(r.editFormat === 'vertical' ? 'vertical' : 'horizontal')
  const updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  return {
    id,
    title: typeof r.title === 'string' && r.title.length ? r.title : 'Untitled story',
    mode,
    status: typeof r.status === 'string' ? r.status : 'draft_ready',
    silencePreset: (typeof r.silencePreset === 'string' &&
    (SILENCE_PRESETS as readonly string[]).includes(r.silencePreset)
      ? r.silencePreset
      : defaultSilencePresetForMode(mode)) as SilencePreset,
    format,
    aiDirection: typeof r.aiDirection === 'string' ? r.aiDirection : undefined,
    subjectProfile: normalizeSubjectProfile(r.subjectProfile),
    promptPackId: normalizePromptPackId(r.promptPackId),
    brollShotDurationSeconds:
      typeof r.brollShotDurationSeconds === 'number'
        ? clampBrollShotDurationSeconds(r.brollShotDurationSeconds)
        : DEFAULT_BROLL_SHOT_DURATION_SECONDS,
    updatedAt,
    lastOpenedAt: typeof r.lastOpenedAt === 'string' ? r.lastOpenedAt : updatedAt,
    intent,
    primaryGoal: typeof r.primaryGoal === 'string' ? (r.primaryGoal as PrimaryGoal) : undefined,
    aspectRatio: (r.aspectRatio === '16:9' || r.aspectRatio === '9:16' || r.aspectRatio === '1:1') ? r.aspectRatio : undefined,
    vibeVision: typeof r.vibeVision === 'string' ? r.vibeVision : undefined,
    beatsPerCut: (r.beatsPerCut === 1 || r.beatsPerCut === 2 || r.beatsPerCut === 4 || r.beatsPerCut === 8)
      ? r.beatsPerCut
      : undefined,
    musicLocalPath: typeof r.musicLocalPath === 'string' ? r.musicLocalPath : undefined,
    brollTransitionsEnabled: typeof r.brollTransitionsEnabled === 'boolean' ? r.brollTransitionsEnabled : undefined,
  }
}

function loadProjects(): LocalProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeLocalProject).filter((p): p is LocalProject => p != null)
  } catch {
    return []
  }
}

function persistProjects(projects: LocalProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch {
    /* ignore quota */
  }
}

export interface LocalProject {
  id: string
  title: string
  mode: StoryMode
  status: string
  silencePreset: SilencePreset
  /** Working frame for preview, timeline, and export defaults */
  format: ProjectFormat
  /** User creative intent — drives keyword boosts for soundbites, B-roll tone, text suggestions */
  aiDirection?: string
  /** Defaults for on-screen subject description in B-roll / video-gen prompts */
  subjectProfile: SubjectProfile
  /** Style pack for AI B-roll; `auto` follows AI Direction keywords */
  promptPackId: PromptPackSelection
  /**
   * Per-shot length the B-roll writer composes for. Defaults to 8s (matches VEO 3 / Runway gen4.5).
   * Threaded into the AI gateway so every emitted `primary` / `runway` / `kling` ends with this value.
   */
  brollShotDurationSeconds: number
  updatedAt: string
  /** Set whenever the workspace opens this project — used for "Recent" sort. */
  lastOpenedAt: string
  /** User-selected story intent from the intent picker. */
  intent?: StoryIntent
  /** Primary production goal selected during project setup. */
  primaryGoal?: PrimaryGoal
  /** Output aspect ratio selected during project setup. */
  aspectRatio?: '16:9' | '9:16' | '1:1'
  // --- Music Video specific ---
  /** Free-form creative brief: mood, energy, visual style for music video mode. */
  vibeVision?: string
  /** How many musical beats between each video cut. Default: 4. */
  beatsPerCut?: 1 | 2 | 4 | 8
  /** Absolute local path to the music/audio track uploaded for music video mode. */
  musicLocalPath?: string
  /**
   * When false, transition-role B-roll clips are excluded from the creator cut builder.
   * Defaults to true (undefined = true) for backward compatibility.
   */
  brollTransitionsEnabled?: boolean
}

interface WorkflowState {
  projects: LocalProject[]
  createLocalProject: (title: string, mode: StoryMode) => string
  updateProject: (id: string, patch: Partial<LocalProject>) => void
  deleteProject: (id: string) => void
  touchProject: (id: string) => void
}

export const useProjectWorkflow = create<WorkflowState>((set, get) => ({
  projects: typeof localStorage !== 'undefined' ? loadProjects() : [],
  createLocalProject: (title, mode) => {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const p: LocalProject = {
      id,
      title,
      mode,
      status: 'draft_ready',
      silencePreset: defaultSilencePresetForMode(mode),
      format: getProjectFormat('horizontal'),
      aiDirection: undefined,
      subjectProfile: defaultSubjectProfile(),
      promptPackId: 'auto',
      brollShotDurationSeconds: DEFAULT_BROLL_SHOT_DURATION_SECONDS,
      updatedAt: now,
      lastOpenedAt: now
    }
    const projects = [p, ...get().projects]
    persistProjects(projects)
    set({ projects })
    return id
  },
  updateProject: (id, patch) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
    )
    persistProjects(projects)
    set({ projects })
  },
  deleteProject: (id) => {
    const projects = get().projects.filter((p) => p.id !== id)
    persistProjects(projects)
    set({ projects })
  },
  touchProject: (id) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, lastOpenedAt: new Date().toISOString() } : p
    )
    persistProjects(projects)
    set({ projects })
  }
}))
