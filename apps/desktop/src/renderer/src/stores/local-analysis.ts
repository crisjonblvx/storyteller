import { create } from 'zustand'
import type { SoundbiteCandidate, TranscriptSegment } from '@storyteller/shared'

const STORAGE_KEY = 'storyteller-local-analysis-v1'

/** Stable refs — never use inline [] in Zustand selectors. */
export const EMPTY_SEGMENTS: TranscriptSegment[] = []
export const EMPTY_SOUNDBITES: SoundbiteCandidate[] = []

function load(): { segments: Record<string, TranscriptSegment[]>; soundbites: Record<string, SoundbiteCandidate[]> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { segments: {}, soundbites: {} }
    const p = JSON.parse(raw) as {
      segments?: Record<string, TranscriptSegment[]>
      soundbites?: Record<string, SoundbiteCandidate[]>
    }
    return {
      segments: p.segments && typeof p.segments === 'object' ? p.segments : {},
      soundbites: p.soundbites && typeof p.soundbites === 'object' ? p.soundbites : {}
    }
  } catch {
    return { segments: {}, soundbites: {} }
  }
}

function persist(state: { segmentsByProject: Record<string, TranscriptSegment[]>; soundbitesByProject: Record<string, SoundbiteCandidate[]> }) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ segments: state.segmentsByProject, soundbites: state.soundbitesByProject })
    )
  } catch {
    /* quota */
  }
}

interface LocalAnalysisState {
  segmentsByProject: Record<string, TranscriptSegment[]>
  soundbitesByProject: Record<string, SoundbiteCandidate[]>
  clearProject: (projectId: string) => void
  setProjectData: (projectId: string, segments: TranscriptSegment[], soundbites: SoundbiteCandidate[]) => void
}

const initial = typeof localStorage !== 'undefined' ? load() : { segments: {}, soundbites: {} }

export const useLocalAnalysisStore = create<LocalAnalysisState>((set, get) => ({
  segmentsByProject: initial.segments,
  soundbitesByProject: initial.soundbites,
  clearProject: (projectId) => {
    const { segmentsByProject, soundbitesByProject } = get()
    const nextSeg = { ...segmentsByProject }
    const nextSb = { ...soundbitesByProject }
    delete nextSeg[projectId]
    delete nextSb[projectId]
    persist({ segmentsByProject: nextSeg, soundbitesByProject: nextSb })
    set({ segmentsByProject: nextSeg, soundbitesByProject: nextSb })
  },
  setProjectData: (projectId, segments, soundbites) => {
    const segmentsByProject = { ...get().segmentsByProject, [projectId]: segments }
    const soundbitesByProject = { ...get().soundbitesByProject, [projectId]: soundbites }
    persist({ segmentsByProject, soundbitesByProject })
    set({ segmentsByProject, soundbitesByProject })
  }
}))
