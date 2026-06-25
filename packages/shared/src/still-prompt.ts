import { appendBrollFullFrameSuffix } from './delivery-dimensions.js'
import { buildCinematicPrompt } from './cinematicPromptDirector.js'
import { buildTopLayerPrompt } from './topLayerPromptDirector.js'

/** Category for still-image generation — drives suffixes and cinematography enrichment. */
export type StillPromptCategory =
  | 'broll-still'
  | 'typography-still'
  | 'stat-still'
  | 'empire-still'
  | 'graphics-still'

export type StillStyleCue = {
  referenceStyle?: string
  palette?: string[]
  typography?: string
  layout?: string
  tone?: string
  styleTags?: string[]
}

const CINEMATOGRAPHY_SIGNAL =
  /\b(?:\d{2,3}\s?mm|\d{2,3}mm|lens|depth of field|shallow dof|dof|framing|doorway|chiaroscuro|color grade|graded|anamorphic|voyeur|foreground|bokeh|film grain|roger deakins|antoine fuqua|full-bleed)\b/i

const TYPOGRAPHY_DIRECTOR_SIGNAL =
  /\b(?:hero line|typographic hierarchy|brushed gold|3d (?:gold|metallic)|title card|exact (?:words|quote)|metallic (?:gold|serif))\b/i

const SCREEN_PROP_SIGNAL =
  /\b(?:television|tv monitor|computer monitor|laptop screen|phone screen|tablet screen|news chyron)\b/i

const DOCUMENT_PROP_SIGNAL =
  /\b(?:document|paperwork|legal pad|notepad|invoice|bill|statement|receipt|contract|envelope|budget|letter|form|clipboard|newspaper|magazine)\b/i

export function inferStillPromptCategory(opts: {
  promptCategory?: string
  topLayerMode?: string
  productionMode?: string
}): StillPromptCategory {
  const cat = (opts.promptCategory ?? '').trim().toLowerCase()
  if (cat === 'broll-still' || cat === 'broll') return 'broll-still'
  if (cat === 'typography-still' || cat === 'text-image') return 'typography-still'
  if (cat === 'stat-still' || cat === 'graph-image') return 'stat-still'
  if (cat === 'empire-still') return 'empire-still'

  const mode = (opts.topLayerMode ?? '').trim().toLowerCase()
  if (mode === 'typography') return 'typography-still'
  if (mode === 'stat') return 'stat-still'
  if (mode === 'empire') return 'empire-still'

  const prod = (opts.productionMode ?? '').trim().toLowerCase()
  if (prod === 'motion-graphics' || prod === 'broll-with-graphics') return 'graphics-still'

  return 'broll-still'
}

export function appendStyleCueBlock(prompt: string, style?: StillStyleCue | null): string {
  const trimmed = prompt.trim()
  if (!style) return trimmed

  const parts: string[] = []
  if (style.referenceStyle?.trim()) parts.push(`Reference style: ${style.referenceStyle.trim()}`)
  if (style.palette?.length) parts.push(`Palette: ${style.palette.map((c) => c.trim()).filter(Boolean).join(', ')}`)
  if (style.typography?.trim()) parts.push(`Typography: ${style.typography.trim()}`)
  if (style.layout?.trim()) parts.push(`Layout: ${style.layout.trim()}`)
  if (style.tone?.trim()) parts.push(`Tone: ${style.tone.trim()}`)
  if (style.styleTags?.length) {
    parts.push(`Style tags: ${style.styleTags.map((t) => t.trim()).filter(Boolean).join(', ')}`)
  }
  if (parts.length === 0) return trimmed

  const block = parts.join('. ')
  if (/reference style:|palette:|typography:/i.test(trimmed)) return trimmed
  const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`
  return `${base} ${block}.`
}

/** B-roll stills: screen safety without flattening composition or banning scene documents. */
export function appendBrollStillSafetySuffix(
  stillPrompt: string,
  category: StillPromptCategory = 'broll-still'
): string {
  const trimmed = stillPrompt.trim()
  if (!trimmed) return trimmed

  if (category === 'typography-still' || category === 'stat-still' || category === 'empire-still') {
    return trimmed
  }

  const hasScreenSafety = /blurred abstract footage|no legible news chyrons/i.test(trimmed)
  const hasDocument = DOCUMENT_PROP_SIGNAL.test(trimmed)

  const clauses: string[] = []
  if (SCREEN_PROP_SIGNAL.test(trimmed) && !hasScreenSafety) {
    clauses.push(
      'Any television, phone, or computer screens show blurred abstract footage only — no legible news chyrons, headlines, or readable UI text'
    )
  } else if (!hasScreenSafety && !hasDocument) {
    clauses.push(
      'No hallucinated news chyrons, broadcast tickers, or readable background signage unless explicitly described in the scene'
    )
  }
  if (hasDocument && !/document.*blur|illegible|no readable text on the/i.test(trimmed)) {
    clauses.push(
      'Documents and papers may appear as props but any text on them stays soft or illegible unless the prompt names exact wording'
    )
  }

  if (clauses.length === 0) return trimmed
  const base = trimmed.replace(/\.\s*$/, '')
  return `${base}. ${clauses.join('; ')}.`
}

/** Add cinematography block when the prompt lacks lens/framing/grade cues. */
export function appendBrollCinematographyTail(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed || CINEMATOGRAPHY_SIGNAL.test(trimmed)) return trimmed

  const tail =
    'Cinematography: motivated practical light with deep shadow falloff, 35mm lens, shallow depth of field, warm documentary color grade, premium Antoine Fuqua-inspired photoreal realism, 16:9 full-bleed composition.'
  const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`
  return `${base} ${tail}`
}

/** Typography stills: require legible hero type and rich materials. */
export function appendTypographyStillTail(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed || TYPOGRAPHY_DIRECTOR_SIGNAL.test(trimmed)) return trimmed

  const tail =
    'Typographic treatment: spell out exact quoted hero line in large 3D brushed-gold serif, clear hierarchy with smaller supporting lines, dark cinematic environment with volumetric light, legible at half-screen size, premium documentary title-card polish, 16:9 full-bleed.'
  const base = trimmed.endsWith('.') ? trimmed : `${trimmed}.`
  return `${base} ${tail}`
}

export function shouldRefineStillPrompt(prompt: string, category: StillPromptCategory): boolean {
  const trimmed = prompt.trim()
  if (!trimmed) return false
  if (trimmed.length >= 900 && CINEMATOGRAPHY_SIGNAL.test(trimmed) && category !== 'typography-still') {
    return false
  }
  if (category === 'typography-still') {
    return trimmed.length < 420 || !TYPOGRAPHY_DIRECTOR_SIGNAL.test(trimmed)
  }
  if (category === 'stat-still' || category === 'empire-still') {
    return trimmed.length < 380
  }
  if (CINEMATOGRAPHY_SIGNAL.test(trimmed) && trimmed.length >= 180) {
    return false
  }
  return trimmed.length < 320
}

export function stillRefineInstruction(category: StillPromptCategory): string {
  switch (category) {
    case 'typography-still':
      return [
        'Expand into ONE detailed image-generation prompt for a premium cinematic typography title card.',
        'You are an Emmy-winning broadcast art director. This is not a graphic design exercise — it is a cinematic hero frame.',
        'The text must feel physically manufactured, dimensional, and present in space.',
        'Specify: exact quoted text, physical material properties (machined metal, engraved stone, brushed titanium, etc.),',
        'cinematic motivated lighting, depth and surface contact, dark environment, and typographic hierarchy.',
        'Do not invent wording beyond what the source prompt allows. Return only the final prompt.'
      ].join(' ')
    case 'stat-still':
    case 'empire-still':
      return [
        'Expand into ONE detailed image-generation prompt for a premium cinematic documentary graphic frame.',
        'You are an Emmy-winning broadcast art director. This is not an infographic — it is a cinematic hero frame.',
        'The hero number, phrase, or graphic element must dominate the composition and feel physically manufactured.',
        'Specify: hero element treatment, physical material properties, cinematic motivated lighting, depth and atmosphere,',
        'color palette, and any secondary elements from the source only.',
        'Use compositional intent, not pixel measurements.',
        '16:9 full-bleed photoreal render. Return only the final prompt.'
      ].join(' ')
    default:
      return [
        'Expand into ONE detailed photoreal cinematic still frame for documentary B-roll.',
        'Specify: subject, environment, visible prop, motivated practical light, composition/framing, lens and depth of field,',
        'color grade, and premium film reference (e.g. Antoine Fuqua / Roger Deakins realism).',
        'Static opening frame only — no camera move language. Do not invent story facts. Return only the final prompt.'
      ].join(' ')
  }
}

export function parseStillStyleFromMetadata(
  metadata?: Record<string, unknown> | null
): StillStyleCue | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined
  const styleRaw = metadata.style
  const tagsRaw = metadata.styleTags
  const style: StillStyleCue = {}

  if (styleRaw && typeof styleRaw === 'object') {
    const s = styleRaw as Record<string, unknown>
    if (typeof s.referenceStyle === 'string' && s.referenceStyle.trim()) {
      style.referenceStyle = s.referenceStyle.trim()
    }
    if (Array.isArray(s.palette)) {
      style.palette = s.palette.map((c) => String(c ?? '').trim()).filter(Boolean)
    }
    if (typeof s.typography === 'string' && s.typography.trim()) style.typography = s.typography.trim()
    if (typeof s.layout === 'string' && s.layout.trim()) style.layout = s.layout.trim()
    if (typeof s.tone === 'string' && s.tone.trim()) style.tone = s.tone.trim()
  }
  if (Array.isArray(tagsRaw)) {
    style.styleTags = tagsRaw.map((t) => String(t ?? '').trim()).filter(Boolean)
  }
  const hasSignal =
    style.referenceStyle ||
    (style.palette?.length ?? 0) > 0 ||
    style.typography ||
    style.layout ||
    style.tone ||
    (style.styleTags?.length ?? 0) > 0
  return hasSignal ? style : undefined
}

/**
 * Build the final director prompt sent to the image model.
 * Merges style cues, category-specific enrichment, and safety suffixes.
 */
export function buildDirectorStillPrompt(params: {
  basePrompt: string
  category?: StillPromptCategory
  style?: StillStyleCue | null
  includeFullBleed?: boolean
}): string {
  const category = params.category ?? 'broll-still'
  let prompt = params.basePrompt.trim()
  if (!prompt) return prompt

  prompt = appendStyleCueBlock(prompt, params.style)

  if (category === 'typography-still' || category === 'stat-still' || category === 'empire-still') {
    prompt = buildTopLayerPrompt(prompt)
  } else if (category === 'broll-still') {
    // Apply scene-level safety constraints before the director wraps the prompt.
    // Running signal detection on the raw scene avoids false positives from
    // "television glow" appearing in the director's lighting doctrine.
    prompt = appendBrollStillSafetySuffix(prompt, category)
    prompt = buildCinematicPrompt(prompt)
  } else {
    prompt = appendBrollStillSafetySuffix(prompt, category)
  }

  if (params.includeFullBleed !== false) {
    prompt = appendBrollFullFrameSuffix(prompt)
  }

  return prompt.trim()
}
