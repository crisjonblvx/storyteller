import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoryMode } from '@storyteller/shared'

/** Ensure a row exists in `projects` for this id (local-first projects created before cloud sync). */
export async function ensureProjectRow(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  payload: { title: string; mode: StoryMode }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error: selErr } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (selErr) return { ok: false, error: selErr.message }
  if (data?.id) return { ok: true }

  const { error } = await supabase.from('projects').insert({
    id: projectId,
    user_id: userId,
    title: payload.title,
    mode: payload.mode,
    status: 'draft'
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
