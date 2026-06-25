import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SoundbiteCandidate, TranscriptSegment } from '@storyteller/shared'
import { EMPTY_SEGMENTS, EMPTY_SOUNDBITES, useLocalAnalysisStore } from '@renderer/stores/local-analysis'

export function useTranscriptSegments(projectId: string | undefined, supabase: SupabaseClient | null) {
  const localSegs = useLocalAnalysisStore((s) => {
    if (!projectId) return EMPTY_SEGMENTS
    return s.segmentsByProject[projectId] ?? EMPTY_SEGMENTS
  })
  const [remoteSegs, setRemoteSegs] = useState<TranscriptSegment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRemoteSegs([])
      setLoading(false)
      setError(null)
      return
    }
    if (!supabase) {
      setRemoteSegs([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error: e } = await supabase
      .from('transcript_segments')
      .select('*')
      .eq('project_id', projectId)
      .order('start_time', { ascending: true })
    if (e) {
      setError(e.message)
      setRemoteSegs([])
    } else {
      setError(null)
      setRemoteSegs((data ?? []) as TranscriptSegment[])
    }
    setLoading(false)
  }, [projectId, supabase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const segments = useMemo(() => {
    if (!projectId) return []
    if (supabase) return remoteSegs
    return localSegs
  }, [projectId, supabase, remoteSegs, localSegs])

  return { segments, loading, error, refresh }
}

export function useSoundbiteCandidates(projectId: string | undefined, supabase: SupabaseClient | null) {
  const localSb = useLocalAnalysisStore((s) => {
    if (!projectId) return EMPTY_SOUNDBITES
    return s.soundbitesByProject[projectId] ?? EMPTY_SOUNDBITES
  })
  const [remoteRows, setRemoteRows] = useState<SoundbiteCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) {
      setRemoteRows([])
      setLoading(false)
      setError(null)
      return
    }
    if (!supabase) {
      setRemoteRows([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    const { data, error: e } = await supabase
      .from('soundbite_candidates')
      .select('*')
      .eq('project_id', projectId)
      .order('score_clarity', { ascending: false })
    if (e) {
      setError(e.message)
      setRemoteRows([])
    } else {
      setError(null)
      const rows = (data ?? []) as SoundbiteCandidate[]
      rows.sort((a, b) => {
        const ac = (a.tags_json as { composite?: number })?.composite ?? 0
        const bc = (b.tags_json as { composite?: number })?.composite ?? 0
        return bc - ac
      })
      setRemoteRows(rows)
    }
    setLoading(false)
  }, [projectId, supabase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const candidates = useMemo(() => {
    if (!projectId) return []
    if (supabase) return remoteRows
    const rows = [...localSb]
    rows.sort((a, b) => {
      const ac = (a.tags_json as { composite?: number })?.composite ?? 0
      const bc = (b.tags_json as { composite?: number })?.composite ?? 0
      return bc - ac
    })
    return rows
  }, [projectId, supabase, remoteRows, localSb])

  return { candidates, loading, error, refresh }
}
