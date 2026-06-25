import type { ProductionMode, ProductionOfferRole, ProductionPackage } from './production.js'

type BrollIdeaLike = {
  style: 'literal' | 'emotional' | 'symbolic'
  prompt: string
  stillImagePrompt?: string
  motionPrompt?: string
  why?: string
}

/** Boilerplate from on-device fallback — not a scene-specific director prompt. */
const TEMPLATE_BROLL_MARKERS = [
  'Build a cinematic human moment around the feeling',
  'Premium emotional B-roll grounded in this exact soundbite',
  'Premium cinematic literal B-roll grounded in this exact soundbite',
  'Premium cinematic B-roll grounded in this exact soundbite',
  'Premium symbolic B-roll grounded in this exact soundbite',
  'Show the real-world subject or visible stakes implied by the line through environment',
  'naturalistic coverage that supports the spoken line without overpowering it',
  'Premium cinematic B-roll, high-end documentary/commercial polish'
]

export function isTemplateBrollPrompt(text: string | undefined | null): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return TEMPLATE_BROLL_MARKERS.some((marker) => t.includes(marker))
}

function hasExplicitBrollFields(idea: BrollIdeaLike): boolean {
  return Boolean(idea.stillImagePrompt?.trim() && idea.motionPrompt?.trim())
}

function brollIdeaQualityScore(idea: BrollIdeaLike): number {
  let score = 0
  if (hasExplicitBrollFields(idea)) score += 10
  const prompt = idea.prompt?.trim() ?? ''
  const still = idea.stillImagePrompt?.trim() ?? ''
  const motion = idea.motionPrompt?.trim() ?? ''
  if (prompt && !isTemplateBrollPrompt(prompt)) score += 5
  if (still && !isTemplateBrollPrompt(still)) score += 4
  if (motion && !isTemplateBrollPrompt(motion)) score += 4
  if (motion && motion.length < 220 && !isTemplateBrollPrompt(motion)) score += 2
  return score
}

export function isTemplateBrollIdea(idea: BrollIdeaLike): boolean {
  if (hasExplicitBrollFields(idea)) {
    return (
      isTemplateBrollPrompt(idea.stillImagePrompt) && isTemplateBrollPrompt(idea.motionPrompt)
    )
  }
  return isTemplateBrollPrompt(idea.prompt)
}

type GraphicsPackageLike = {
  graphImagePrompt?: string
  overlayTextImagePrompt?: string
  motionPromptFromImage?: string
  styleTags?: string[]
}

export function inferProductionMode(input: {
  graphScore?: number
  hasGraphIdea?: boolean
  hasGraphicsPackage?: boolean
}): ProductionMode {
  if (input.hasGraphIdea || (input.graphScore ?? 0) >= 0.55) {
    return input.hasGraphicsPackage ? 'broll-with-graphics' : 'motion-graphics'
  }
  if (input.hasGraphicsPackage) return 'broll-with-graphics'
  return 'broll'
}

function splitPromptHeuristic(full: string): { still: string; motion: string } {
  const trimmed = full.trim()
  if (!trimmed) {
    return { still: '', motion: '' }
  }

  const motionLead =
    /\.\s+(?:The camera|Camera|Slow|A slow|Handheld|Dolly|Crane|Push-in|Push in|Rack focus|Tracking|Over \d+ seconds)/i
  const motionSplit = trimmed.match(motionLead)
  if (motionSplit?.index != null && motionSplit.index > 40) {
    const still = trimmed.slice(0, motionSplit.index + 1).trim()
    const motion = trimmed.slice(motionSplit.index + 1).trim()
    if (still && motion) {
      return { still, motion }
    }
  }

  const parts = trimmed.split(/\.\s+(?=[A-Z0-9])/)
  if (parts.length >= 2) {
    const still = parts.slice(0, Math.ceil(parts.length / 2)).join('. ').trim()
    const motion = parts.slice(Math.ceil(parts.length / 2)).join('. ').trim()
    return { still, motion: motion || 'Slow cinematic camera move, natural motion, photoreal.' }
  }

  const stillOnly = trimmed
    .replace(
      /\.\s*(?:subtle|slow|handheld|dolly|push-in|crane|tracking|rack focus)[^.]*\.?\s*$/i,
      ''
    )
    .replace(/\b\d+\s*seconds[^.]*\.?\s*$/i, '')
    .trim()

  return {
    still: stillOnly || trimmed,
    motion: 'Slow motivated camera move with subtle environmental motion, photoreal, single continuous take.'
  }
}

function ideaToPackage(
  idea: BrollIdeaLike,
  role: ProductionOfferRole,
  mode: ProductionMode,
  sourceSoundbiteId: string | undefined,
  id: string
): ProductionPackage {
  const hasExplicitStill = Boolean(idea.stillImagePrompt?.trim())
  const hasExplicitMotion = Boolean(idea.motionPrompt?.trim())
  const split = hasExplicitStill && hasExplicitMotion ? { still: '', motion: '' } : splitPromptHeuristic(idea.prompt)
  const still = idea.stillImagePrompt?.trim() || split.still || idea.prompt
  const motion =
    idea.motionPrompt?.trim() ||
    split.motion ||
    (hasExplicitStill ? 'Slow motivated camera move with subtle environmental motion, photoreal, single continuous take.' : idea.prompt)
  const summary = still.slice(0, 120) + (still.length > 120 ? '…' : '')
  return {
    id,
    offerRole: role,
    sourceSoundbiteId,
    mode,
    conceptSummary: summary,
    stillImagePrompt: still,
    motionPrompt: motion,
    style: idea.style,
    why: idea.why
  }
}

export function buildProductionOffersFromAiReview(input: {
  soundbiteId?: string
  brollIdeas?: BrollIdeaLike[]
  graphicsPackage?: GraphicsPackageLike | null
  graphScore?: number
  hasGraphIdea?: boolean
  suggestedMode?: ProductionMode
  idFactory?: () => string
}): ProductionPackage[] {
  const nextId =
    input.idFactory ??
    (() => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
      }
      return `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    })
  const mode =
    input.suggestedMode ??
    inferProductionMode({
      graphScore: input.graphScore,
      hasGraphIdea: input.hasGraphIdea,
      hasGraphicsPackage: Boolean(input.graphicsPackage)
    })

  const ideas = (input.brollIdeas ?? []).filter(
    (i) =>
      i?.prompt?.trim() ||
      (i?.stillImagePrompt?.trim() && i?.motionPrompt?.trim())
  )
  const offers: ProductionPackage[] = []

  if (ideas.length > 0) {
    const scored = ideas.map((idea, index) => ({
      idea,
      index,
      score: brollIdeaQualityScore(idea)
    }))
    let bestIndex = 0
    let bestScore = scored[0]?.score ?? -1
    for (const row of scored) {
      if (row.score > bestScore) {
        bestScore = row.score
        bestIndex = row.index
      }
    }
    ideas.forEach((idea, index) => {
      offers.push(
        ideaToPackage(
          idea,
          index === bestIndex ? 'recommended' : 'alternate',
          mode,
          input.soundbiteId,
          nextId()
        )
      )
    })
    return offers.slice(0, 3)
  }

  const gp = input.graphicsPackage
  if (gp?.graphImagePrompt || gp?.overlayTextImagePrompt) {
    const still =
      gp.graphImagePrompt?.trim() ||
      gp.overlayTextImagePrompt?.trim() ||
      'Premium documentary graphic frame grounded in the soundbite.'
    const motion =
      gp.motionPromptFromImage?.trim() ||
      'Animate typography and chart elements with subtle camera push-in, particles, and cinematic light.'
    offers.push({
      id: nextId(),
      offerRole: 'recommended',
      sourceSoundbiteId: input.soundbiteId,
      mode: mode === 'broll' ? 'motion-graphics' : mode,
      conceptSummary: still.slice(0, 120) + (still.length > 120 ? '…' : ''),
      stillImagePrompt: still,
      motionPrompt: motion,
      style: 'literal',
      why: 'Derived from grounded graphics package.'
    })
    return offers
  }

  return offers
}

export function pickRecommendedOffer(offers: ProductionPackage[]): ProductionPackage | null {
  const tagged = offers.find((o) => o.offerRole === 'recommended')
  if (tagged) return tagged
  const concrete = offers.find(
    (o) =>
      o.stillImagePrompt?.trim() &&
      o.motionPrompt?.trim() &&
      !isTemplateBrollPrompt(o.stillImagePrompt) &&
      !isTemplateBrollPrompt(o.motionPrompt)
  )
  return concrete ?? offers[0] ?? null
}

export function isTemplateProductionPackage(pkg: ProductionPackage): boolean {
  const still = pkg.stillImagePrompt?.trim() ?? ''
  const motion = pkg.motionPrompt?.trim() ?? ''
  if (!still && !motion) return true
  const stillTemplate = isTemplateBrollPrompt(still)
  const motionTemplate =
    isTemplateBrollPrompt(motion) ||
    /^Slow motivated camera move with subtle environmental motion/i.test(motion) ||
    /^Show the real-world subject or visible stakes implied by the line/i.test(motion)
  return stillTemplate && motionTemplate
}
