import type { GroundedReviewGraphIdea, GroundedReviewGraphicsPackage } from './openai-grounded-review.js'

export type GroundedGraphicsMode = 'empire' | 'stat' | 'typography' | '3d-text'

export type TopLayerRecommendation = {
  mode: GroundedGraphicsMode
  treatmentLabel: string
  primaryKind: 'graph-image' | 'text-image'
  stillPrompt: string
  motionPrompt?: string
  styleTags?: string[]
  style?: GroundedReviewGraphicsPackage['style']
}

/**
 * Detect whether a soundbite matches the person + multiple companies/ventures
 * pattern that warrants the biographical empire-map infographic (MODE A).
 */
export function isEmpireMapCandidate(text: string): boolean {
  const hasPerson = /\b[A-Z][a-z]{1,14}(?:\s+[A-Z][a-z]{1,14}){1,3}\b/.test(text)
  if (!hasPerson) return false
  const capRuns = text.match(/\b(?:[A-Z][A-Za-z0-9&.'-]{1,}(?:\s+[A-Z][A-Za-z0-9&.'-]{1,})*)\b/g) ?? []
  const NOT_COMPANIES = new Set([
    'He',
    'She',
    'They',
    'We',
    'His',
    'Her',
    'Their',
    'Our',
    'The',
    'A',
    'An',
    'And',
    'But',
    'Or',
    'I',
    'It',
    'Its',
    'In',
    'On',
    'At',
    'To',
    'For',
    'Of',
    'From',
    'With',
    'By'
  ])
  const entityLike = capRuns.filter((token) => !NOT_COMPANIES.has(token.split(' ')[0] ?? ''))
  return entityLike.length >= 3
}

/** High-impact motivational / authority phrases that benefit from 3D letterform treatment. */
export function has3DTextSignal(text: string): boolean {
  return /\b(?:invest|build|success|freedom|power|wealth|never|always|change|empire|legacy|win|hustle|rise|grind|unstoppable|dominate|mindset|discipline|commit|execute|focus|decide|control|create)\b/i.test(
    text
  )
}

function hasStatSignal(text: string, graphIdea?: GroundedReviewGraphIdea): boolean {
  if (graphIdea) return true
  return /\$[\d,.]+[BbMmKkTt]?|\b\d[\d,.]*\s*(?:percent|%|billion|million|trillion|thousand|x\b)|\b(?:double|triple|quadruple|10x|100x)\b/i.test(
    text
  )
}

export function inferGroundedGraphicsMode(
  text: string,
  graphIdea?: GroundedReviewGraphIdea
): GroundedGraphicsMode {
  if (isEmpireMapCandidate(text)) return 'empire'
  if (hasStatSignal(text, graphIdea)) return 'stat'
  return 'typography'
}

const TREATMENT_LABELS: Record<GroundedGraphicsMode, string> = {
  empire: 'Empire map',
  stat: 'Stat infographic',
  typography: 'Typography',
  '3d-text': '3D Text'
}

/**
 * Pick one primary Top Layer treatment per soundbite using MODE A/B/C routing.
 */
export function resolveTopLayerRecommendation(
  text: string,
  graphicsPackage: GroundedReviewGraphicsPackage,
  graphIdea?: GroundedReviewGraphIdea
): TopLayerRecommendation | null {
  const mode = inferGroundedGraphicsMode(text, graphIdea)
  const motionPrompt = graphicsPackage.motionPromptFromImage?.trim() || undefined
  const styleTags = graphicsPackage.styleTags
  const style = graphicsPackage.style

  if (mode === 'empire' || mode === 'stat') {
    const stillPrompt = graphicsPackage.graphImagePrompt?.trim()
    if (!stillPrompt) return null
    return {
      mode,
      treatmentLabel: TREATMENT_LABELS[mode],
      primaryKind: 'graph-image',
      stillPrompt,
      motionPrompt,
      styleTags,
      style
    }
  }

  // '3d-text' and 'typography' both use the overlay/graph image prompts from the AI review.
  const overlayStill = graphicsPackage.overlayTextImagePrompt?.trim()
  const graphStill = graphicsPackage.graphImagePrompt?.trim()
  const stillPrompt = graphStill || overlayStill
  if (!stillPrompt) return null

  const resolvedMode = mode === '3d-text' ? '3d-text' : 'typography'
  return {
    mode: resolvedMode,
    treatmentLabel: TREATMENT_LABELS[resolvedMode],
    primaryKind: overlayStill ? 'text-image' : 'graph-image',
    stillPrompt,
    motionPrompt,
    styleTags,
    style
  }
}

export function topLayerStillPromptKey(soundbiteId: string): string {
  return `${soundbiteId}:top-still`
}

export function topLayerMotionPromptKey(soundbiteId: string): string {
  return `${soundbiteId}:motion-overlay`
}
