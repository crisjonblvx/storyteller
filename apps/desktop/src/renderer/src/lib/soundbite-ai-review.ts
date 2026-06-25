import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductionPackage, SoundbiteCandidate } from '@storyteller/shared'
import { buildProductionOffersFromAiReview } from '@storyteller/shared'
import { useLocalAnalysisStore } from '@renderer/stores/local-analysis'

export type SoundbiteBrollIdea = {
  style: 'literal' | 'emotional' | 'symbolic'
  prompt: string
  stillImagePrompt?: string
  motionPrompt?: string
  why?: string
}

export async function persistSoundbiteBrollIdeas(params: {
  supabase: SupabaseClient | null
  projectId: string
  soundbiteId: string
  brollIdeas: SoundbiteBrollIdea[]
  existingTags: Record<string, unknown> | null
  graphScore?: number
  hasGraphIdea?: boolean
  graphicsPackage?: Record<string, unknown> | null
}): Promise<{ ok: true; productionOffers: ProductionPackage[] } | { ok: false; error: string }> {
  const productionOffers = buildProductionOffersFromAiReview({
    soundbiteId: params.soundbiteId,
    brollIdeas: params.brollIdeas,
    graphicsPackage: params.graphicsPackage ?? undefined,
    graphScore: params.graphScore ?? 0,
    hasGraphIdea: params.hasGraphIdea ?? false
  })

  const prevReview =
    params.existingTags?.aiReview && typeof params.existingTags.aiReview === 'object'
      ? (params.existingTags.aiReview as Record<string, unknown>)
      : {}
  const nextTags = {
    ...(params.existingTags ?? {}),
    aiReview: {
      ...prevReview,
      brollIdeas: params.brollIdeas,
      productionOffers
    }
  }

  if (params.supabase) {
    const { error } = await params.supabase
      .from('soundbite_candidates')
      .update({ tags_json: nextTags })
      .eq('id', params.soundbiteId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, productionOffers }
  }

  const store = useLocalAnalysisStore.getState()
  const rows = store.soundbitesByProject[params.projectId] ?? []
  const idx = rows.findIndex((row) => row.id === params.soundbiteId)
  if (idx < 0) return { ok: false, error: 'Soundbite not found in local analysis store.' }
  const updated: SoundbiteCandidate = {
    ...rows[idx]!,
    tags_json: nextTags
  }
  const nextRows = [...rows]
  nextRows[idx] = updated
  store.setProjectData(params.projectId, store.segmentsByProject[params.projectId] ?? [], nextRows)
  return { ok: true, productionOffers }
}
