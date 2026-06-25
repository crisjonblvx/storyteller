import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TimelineSequence } from '@storyteller/timeline'
import {
  deleteAllProjectTimelines,
  fetchLatestProjectTimeline,
  saveProjectTimeline
} from '@renderer/lib/timelines-api'
import { useLocalTimelineStore } from '@renderer/stores/local-timeline'

export function useProjectTimeline(projectId: string, supabase: SupabaseClient | null) {
  const localTimeline = useLocalTimelineStore((s) => (projectId ? s.byProject[projectId] ?? null : null))
  const setLocalTimeline = useLocalTimelineStore((s) => s.setTimeline)
  const clearLocalTimeline = useLocalTimelineStore((s) => s.clearProject)
  const [remoteTimeline, setRemoteTimeline] = useState<TimelineSequence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRemoteTimeline(null)
      setLoading(false)
      setError(null)
      return
    }
    if (!supabase) {
      setRemoteTimeline(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    const { data, error: e } = await fetchLatestProjectTimeline(supabase, projectId)
    setRemoteTimeline(data)
    setError(e)
    setLoading(false)
  }, [projectId, supabase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const timeline = supabase ? remoteTimeline : localTimeline

  const save = useCallback(
    async (sequence: TimelineSequence) => {
      if (!projectId) return { ok: false as const, error: 'No project' }
      if (supabase) {
        const res = await saveProjectTimeline(supabase, projectId, sequence)
        if (res.ok) await refresh()
        return res
      }
      setLocalTimeline(projectId, sequence)
      return { ok: true as const }
    },
    [projectId, supabase, refresh, setLocalTimeline]
  )

  /**
   * Wipe all persisted timelines for the project, both cloud and local.
   * Always clears local store too — even when signed in — so a stale offline
   * snapshot doesn't reappear if the network call fails or the user signs
   * out. Renderer should call this from the "Clear timeline" button.
   */
  const clear = useCallback(async () => {
    if (!projectId) return { ok: false as const, error: 'No project' }
    clearLocalTimeline(projectId)
    if (supabase) {
      const res = await deleteAllProjectTimelines(supabase, projectId)
      if (res.ok) {
        setRemoteTimeline(null)
        return { ok: true as const }
      }
      // Local was already cleared; surface the cloud error so the user knows
      // their next signed-in session might still see the old timeline.
      return res
    }
    return { ok: true as const }
  }, [projectId, supabase, clearLocalTimeline])

  return { timeline, loading, error, refresh, save, clear }
}
