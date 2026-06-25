import { create } from 'zustand'
import type { Asset, JournalismClipRole, CreatorClipRole } from '@storyteller/shared'

const STORAGE_KEY = 'storyteller-local-assets-v1'

/** Stable empty list — never use inline `[]` in Zustand selectors (new ref each snapshot → infinite loop). */
export const EMPTY_ASSET_LIST: Asset[] = []

function loadFromDisk(): Record<string, Asset[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, Asset[]>
  } catch {
    return {}
  }
}

function persist(byProject: Record<string, Asset[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject))
  } catch {
    /* ignore quota */
  }
}

interface LocalAssetsState {
  byProject: Record<string, Asset[]>
  addAssets: (projectId: string, assets: Asset[]) => void
  /** Replace all local-only assets for a project (e.g. after sync — optional) */
  setProjectAssets: (projectId: string, assets: Asset[]) => void
  /** Patch the clip_role on a single asset without re-fetching everything. */
  updateAssetClipRole: (projectId: string, assetId: string, role: JournalismClipRole) => void
  /** Patch the creator_clip_role on a single asset without re-fetching everything. */
  updateAssetCreatorClipRole: (projectId: string, assetId: string, role: CreatorClipRole) => void
  /** Patch thumbnail/proxy path after ffmpeg extract. */
  updateAssetProxyPath: (projectId: string, assetId: string, proxyPath: string) => void
}

export const useLocalAssetsStore = create<LocalAssetsState>((set, get) => ({
  byProject: typeof localStorage !== 'undefined' ? loadFromDisk() : {},
  addAssets: (projectId, assets) => {
    const cur = get().byProject[projectId] ?? EMPTY_ASSET_LIST
    const byId = new Map(cur.map((a) => [a.id, a]))
    for (const a of assets) byId.set(a.id, a)
    const next = { ...get().byProject, [projectId]: Array.from(byId.values()) }
    persist(next)
    set({ byProject: next })
  },
  setProjectAssets: (projectId, assets) => {
    const next = { ...get().byProject, [projectId]: assets }
    persist(next)
    set({ byProject: next })
  },
  updateAssetClipRole: (projectId, assetId, role) => {
    const cur = get().byProject[projectId] ?? EMPTY_ASSET_LIST
    const updated = cur.map((a) => (a.id === assetId ? { ...a, clip_role: role } : a))
    const next = { ...get().byProject, [projectId]: updated }
    persist(next)
    set({ byProject: next })
  },
  updateAssetCreatorClipRole: (projectId, assetId, role) => {
    const cur = get().byProject[projectId] ?? EMPTY_ASSET_LIST
    const updated = cur.map((a) => (a.id === assetId ? { ...a, creator_clip_role: role } : a))
    const next = { ...get().byProject, [projectId]: updated }
    persist(next)
    set({ byProject: next })
  },
  updateAssetProxyPath: (projectId, assetId, proxyPath) => {
    const cur = get().byProject[projectId] ?? EMPTY_ASSET_LIST
    const updated = cur.map((a) => (a.id === assetId ? { ...a, proxy_path: proxyPath } : a))
    const next = { ...get().byProject, [projectId]: updated }
    persist(next)
    set({ byProject: next })
  }
}))

export function getLocalAssetsSnapshot(projectId: string): Asset[] {
  return useLocalAssetsStore.getState().byProject[projectId] ?? EMPTY_ASSET_LIST
}
