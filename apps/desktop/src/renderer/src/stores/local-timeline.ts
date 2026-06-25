import { create } from 'zustand'
import type { TimelineSequence } from '@storyteller/timeline'

const STORAGE_KEY = 'storyteller-local-timelines-v1'

function load(): Record<string, TimelineSequence> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw) as Record<string, TimelineSequence>
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

function persist(byProject: Record<string, TimelineSequence>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject))
  } catch {
    /* quota */
  }
}

interface LocalTimelineState {
  byProject: Record<string, TimelineSequence>
  setTimeline: (projectId: string, sequence: TimelineSequence) => void
  clearProject: (projectId: string) => void
}

export const useLocalTimelineStore = create<LocalTimelineState>((set, get) => ({
  byProject: typeof localStorage !== 'undefined' ? load() : {},
  setTimeline: (projectId, sequence) => {
    const byProject = { ...get().byProject, [projectId]: sequence }
    persist(byProject)
    set({ byProject })
  },
  clearProject: (projectId) => {
    const byProject = { ...get().byProject }
    delete byProject[projectId]
    persist(byProject)
    set({ byProject })
  }
}))
