import type { ProductionPackage } from '@storyteller/shared'
import { tryConcreteFallbackScene } from '@storyteller/analysis'
import {
  buildProductionOffersFromAiReview,
  defaultProductionRegenBudget,
  isTemplateBrollIdea,
  isTemplateProductionPackage,
  type ProductionSlotMetadata
} from '@storyteller/shared'
import {
  attachGeneratedBrollClip,
  buildBrollSlotsFromPrompts,
  ensureBrollVideoTrack,
  setSlotStatus,
  type TimelineSequence
} from '@storyteller/timeline'
import type { BrollSlot } from '@storyteller/timeline'

export function productionOffersForSoundbite(input: {
  soundbiteId: string
  transcriptText?: string | null
  storedOffers?: ProductionPackage[] | null
  brollIdeas?: Array<{ style: string; prompt: string; stillImagePrompt?: string; motionPrompt?: string; why?: string }>
  graphicsPackage?: {
    graphImagePrompt?: string
    overlayTextImagePrompt?: string
    motionPromptFromImage?: string
    styleTags?: string[]
  } | null
  graphScore?: number
  hasGraphIdea?: boolean
  shotDurationSeconds?: number
}): ProductionPackage[] {
  let ideas = input.brollIdeas ?? []
  let usedFallback = false
  const ideasAreTemplate =
    ideas.length === 0 || ideas.every((idea) => isTemplateBrollIdea(idea as Parameters<typeof isTemplateBrollIdea>[0]))
  if (ideasAreTemplate && input.transcriptText?.trim()) {
    const concrete = tryConcreteFallbackScene(input.transcriptText, input.shotDurationSeconds)
    if (concrete) {
      usedFallback = true
      ideas = [
        {
          style: concrete.style,
          prompt: `${concrete.stillImagePrompt} ${concrete.motionPrompt}`,
          stillImagePrompt: concrete.stillImagePrompt,
          motionPrompt: concrete.motionPrompt,
          why: concrete.why
        }
      ]
    }
  }

  const fromIdeas = buildProductionOffersFromAiReview({
    soundbiteId: input.soundbiteId,
    brollIdeas: ideas as Parameters<typeof buildProductionOffersFromAiReview>[0]['brollIdeas'],
    graphicsPackage: input.graphicsPackage ?? undefined,
    graphScore: input.graphScore,
    hasGraphIdea: input.hasGraphIdea
  }).map((offer) => (usedFallback ? { ...offer, isStarterIdea: true } : offer))

  const concreteFromIdeas = fromIdeas.filter((o) => !isTemplateProductionPackage(o))
  if (input.storedOffers && input.storedOffers.length > 0) {
    const storedConcrete = input.storedOffers.filter((o) => !isTemplateProductionPackage(o))
    // When we only have a deterministic starter (no real AI ideas), prefer the freshly
    // computed, diversified fallback over any previously stored starter scene.
    if (usedFallback && concreteFromIdeas.length > 0) return concreteFromIdeas
    if (storedConcrete.length > 0) return storedConcrete
    if (concreteFromIdeas.length > 0) return concreteFromIdeas
    return []
  }

  return concreteFromIdeas
}

export function readProductionSlotMetadata(
  slot: BrollSlot | null | undefined
): ProductionSlotMetadata | null {
  const raw = slot?.metadata?.production
  if (!raw || typeof raw !== 'object') return null
  return raw as ProductionSlotMetadata
}

export function findBrollSlotForSoundbite(
  sequence: TimelineSequence,
  soundbiteId: string
): BrollSlot | undefined {
  return sequence.brollSlots?.find(
    (s) =>
      s.linkedSoundbiteId === soundbiteId ||
      (s.metadata as { soundbiteId?: string } | undefined)?.soundbiteId === soundbiteId
  )
}

export function mapSoundbiteProductionToTimeline(params: {
  sequence: TimelineSequence
  projectId: string
  soundbiteId: string
  sourceStart: number
  sourceEnd: number
  pkg: ProductionPackage
  promptType: 'literal' | 'emotional' | 'symbolic'
}): { slot: BrollSlot; sequence: TimelineSequence } | null {
  const row = {
    segment_start: params.sourceStart,
    segment_end: params.sourceEnd,
    prompt_type: params.promptType,
    metadata_json: {
      soundbiteId: params.soundbiteId,
      productionPackageId: params.pkg.id,
      productionMode: params.pkg.mode
    }
  }
  const built = buildBrollSlotsFromPrompts(params.sequence, [row], params.projectId, 0)
  if (built.length === 0) return null
  const newSlot = built[0]!
  const productionMeta: ProductionSlotMetadata = {
    activePackageId: params.pkg.id,
    package: params.pkg,
    regens: defaultProductionRegenBudget(),
    pipelinePhase: 'concept'
  }
  const withProduction: BrollSlot = {
    ...newSlot,
    linkedSoundbiteId: params.soundbiteId,
    metadata: {
      ...(newSlot.metadata ?? {}),
      soundbiteId: params.soundbiteId,
      production: productionMeta
    }
  }
  const existing = params.sequence.brollSlots ?? []
  const merged = [...existing.filter((s) => s.id !== withProduction.id), withProduction]
  const withTrack = ensureBrollVideoTrack(params.sequence)
  const nextSequence: TimelineSequence = { ...withTrack, brollSlots: merged }
  return { slot: withProduction, sequence: nextSequence }
}

export function patchProductionSlotMetadata(
  sequence: TimelineSequence,
  slotId: string,
  patch: Partial<ProductionSlotMetadata> & {
    status?: BrollSlot['status']
    errorMessage?: string
    generatedAssetId?: string
    referenceImageAssetId?: string
  }
): TimelineSequence {
  const { status, errorMessage, generatedAssetId, referenceImageAssetId, ...productionPatch } = patch
  const slot = sequence.brollSlots?.find((s) => s.id === slotId)
  const prev = readProductionSlotMetadata(slot) ?? {
    activePackageId: '',
    package: {} as ProductionPackage,
    regens: defaultProductionRegenBudget(),
    pipelinePhase: 'concept' as const
  }
  const nextProduction: ProductionSlotMetadata = {
    ...prev,
    ...productionPatch,
    regens: { ...prev.regens, ...(productionPatch.regens ?? {}) }
  }
  return setSlotStatus(sequence, slotId, {
    ...(status ? { status } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(generatedAssetId ? { generatedAssetId } : {}),
    ...(referenceImageAssetId ? { referenceImageAssetId } : {}),
    metadata: {
      ...(slot?.metadata ?? {}),
      production: nextProduction
    }
  })
}

export function attachProductionVideo(
  sequence: TimelineSequence,
  slotId: string,
  assetId: string,
  durationSeconds: number
): TimelineSequence {
  const withClip = attachGeneratedBrollClip(sequence, slotId, assetId, durationSeconds)
  return patchProductionSlotMetadata(withClip, slotId, { pipelinePhase: 'ready', status: 'ready' })
}
