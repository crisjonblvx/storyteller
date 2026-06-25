import type { SupabaseClient } from '@supabase/supabase-js'
import type { TimelineSequence } from '@storyteller/timeline'

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function isTimelineSequenceLike(x: unknown): x is TimelineSequence {
  if (!isRecord(x)) return false
  return (
    typeof x.id === 'string' &&
    typeof x.projectId === 'string' &&
    Array.isArray(x.videoTracks) &&
    Array.isArray(x.audioTracks)
  )
}

export async function fetchLatestProjectTimeline(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ data: TimelineSequence | null; error: string | null }> {
  const { data, error } = await supabase
    .from('timelines')
    .select('timeline_json')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  const raw = data?.timeline_json
  if (raw == null) return { data: null, error: null }
  if (!isTimelineSequenceLike(raw)) {
    return { data: null, error: 'Stored timeline JSON is not a valid sequence' }
  }
  return { data: raw as TimelineSequence, error: null }
}

export async function saveProjectTimeline(
  supabase: SupabaseClient,
  projectId: string,
  sequence: TimelineSequence
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: rows, error: verErr } = await supabase
    .from('timelines')
    .select('version')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (verErr) return { ok: false, error: verErr.message }
  const nextVersion = (rows?.[0]?.version != null ? Number(rows[0].version) : 0) + 1

  const { error } = await supabase.from('timelines').insert({
    project_id: projectId,
    version: nextVersion,
    timeline_json: sequence as unknown as Record<string, unknown>
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Hard-delete every persisted timeline row for a project. The renderer's
 * "Clear timeline" button calls this so the next session doesn't silently
 * re-load the previously-saved intro from Supabase. We delete instead of
 * inserting an empty version because (a) rough-cuts are deterministic from
 * the source soundbites and (b) keeping empty rows would make
 * `fetchLatestProjectTimeline` keep returning a phantom timeline.
 */
export async function deleteAllProjectTimelines(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('timelines').delete().eq('project_id', projectId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
