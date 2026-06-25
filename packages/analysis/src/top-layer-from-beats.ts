import type { StoryMode, SubjectProfile } from '@storyteller/shared'
import type { BrollBeat } from './broll-from-beats.js'
import { inferGroundedGraphicsMode, type GroundedGraphicsMode } from './graphics-mode.js'

/**
 * Visual style preset controlling background, type treatment, color, and
 * atmosphere across all generated Top Layer prompts.
 */
export type GraphicsStylePreset =
  | 'premium'
  | 'dynamic'
  | 'modern'
  | 'traditional'
  | 'cinematic'
  | 'social'
  | 'street'
  | 'luxury'
  | 'tech'
  | 'noir'
  | 'pop'

/**
 * One Top Layer treatment produced per beat by the deterministic local writer.
 * Parallel in shape to `TopLayerRecommendation` from grounded review, but
 * derived purely from transcript analysis — no API call required.
 */
export type TopLayerBeatPrompt = {
  /** Matches BrollBeat.id — stable cache / de-dup key. */
  beatId: string
  mode: GroundedGraphicsMode
  treatmentLabel: string
  /** Kind to pass as `kind` when calling the graphics image generator. */
  primaryKind: 'graph-image' | 'text-image'
  stillPrompt: string
  motionPrompt: string
  /** Original transcript text for display. */
  transcript: string
}

export interface GenerateTopLayerPromptsFromBeatsOptions {
  subjectProfile?: SubjectProfile
  mode?: StoryMode
  stylePreset?: GraphicsStylePreset
}

/* -------------------------------------------------------------------------- */
/*  Treatment labels                                                           */
/* -------------------------------------------------------------------------- */

const TREATMENT_LABELS: Record<GroundedGraphicsMode, string> = {
  empire: 'Empire map',
  stat: 'Stat infographic',
  typography: 'Typography',
  '3d-text': '3D Text'
}

/* -------------------------------------------------------------------------- */
/*  Hook extraction                                                            */
/* -------------------------------------------------------------------------- */

const STOP_WORDS = new Set([
  'i',
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'so',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'from',
  'with',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'it',
  'its',
  'that',
  'this',
  'these',
  'those',
  'my',
  'your',
  'our',
  'their',
  'his',
  'her',
  'we',
  'you',
  'they',
  'he',
  'she',
  'just',
  'then',
  'than',
  'not',
  'no',
  'yes',
  'up',
  'out',
  'what',
  'when',
  'where',
  'who',
  'how',
  'all',
  'can',
  'will',
  'if',
  'as',
  'about',
  'into',
  'like',
  'also'
])

/**
 * Extract a 4–7 word hook phrase: prefers content words in order,
 * keeps original casing, strips trailing punctuation.
 */
function extractHook(text: string, targetWords = 6): string {
  const raw = text.trim().replace(/['"]/g, '').split(/\s+/)
  const content: string[] = []
  for (const w of raw) {
    const key = w.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    if (key.length > 2 && !STOP_WORDS.has(key)) {
      content.push(w.replace(/[.,;:!?]+$/, ''))
      if (content.length >= targetWords) break
    }
  }
  if (content.length >= 3) return content.join(' ')
  // Fallback: first N words stripped of trailing punctuation
  return raw
    .slice(0, targetWords)
    .map((w) => w.replace(/[.,;:!?]+$/, ''))
    .join(' ')
}

/** Pull the first obvious numeric stat from the transcript (dollar, %, multiplier). */
function extractStatFigure(text: string): string {
  const m = text.match(
    /\$[\d,.]+[BMKTbmkt]?(?:\s*(?:billion|million|trillion|thousand))?|\b\d[\d,.]*\s*(?:%|percent|billion|million|trillion|x)\b/i
  )
  return m ? m[0] : ''
}

/* -------------------------------------------------------------------------- */
/*  Preset-specific style descriptors                                          */
/* -------------------------------------------------------------------------- */

interface PresetStyle {
  background: string
  typeStyle: string
  material: string
  colorDirection: string
  atmosphere: string
  motionAtmosphere: string
}

function getPresetStyle(preset: GraphicsStylePreset): PresetStyle {
  switch (preset) {
    case 'dynamic':
      return {
        background: 'high-contrast charcoal with aggressive vignette',
        typeStyle: 'ultra-bold white condensed sans-serif, tight tracking, text block occupies center 60% of frame width maximum',
        material: 'forged matte steel with aggressive chamfered edges, hard machining lines, and high-contrast shadow relief',
        colorDirection: 'neon electric cyan accent with white',
        atmosphere: 'punchy, kinetic, high-energy',
        motionAtmosphere: 'aggressive motion blur, fast cut energy'
      }
    case 'modern':
      return {
        background: 'clean off-white light gray minimal background',
        typeStyle: 'geometric clean sans-serif, precise weight',
        material: 'precision-milled brushed aluminum with clean edge bevels and a satin matte finish',
        colorDirection: 'charcoal text with single vibrant accent color',
        atmosphere: 'minimal, editorial, sophisticated',
        motionAtmosphere: 'precise ease-in-out, subtle fade, clean transitions'
      }
    case 'traditional':
      return {
        background: 'warm cream or rich dark wood texture',
        typeStyle: 'serif headline with ornamental rule divider',
        material: 'engraved brass with deep-cut letterforms, gold leaf fill, and warm patina on recessed surfaces',
        colorDirection: 'gold and warm amber palette',
        atmosphere: 'print journalism gravitas, authoritative',
        motionAtmosphere: 'stately reveal, dignified cross-dissolve, warm glow'
      }
    case 'cinematic':
      return {
        background: 'near-black with visible film grain, anamorphic letterbox bars top and bottom',
        typeStyle: 'large italic serif, wide tracking',
        material: 'cast iron with film-noir surface texture, subtle rust bloom at edges, and moody specular highlights',
        colorDirection: 'desaturated palette with warm highlight accent',
        atmosphere: 'movie title card, epic scale',
        motionAtmosphere: 'slow cinematic push, anamorphic lens flare, film-speed ease'
      }
    case 'social':
      return {
        background: 'pure white or vivid bold color background',
        typeStyle: 'rounded bold sans-serif, very large display weight',
        material: 'high-gloss lacquered resin with bold color fill and sharp clean edges',
        colorDirection: 'vibrant pop color accent, high-saturation',
        atmosphere: 'Instagram/YouTube energy, bold and immediate',
        motionAtmosphere: 'snappy spring animation, emoji-friendly, high contrast pop'
      }
    case 'street':
      return {
        background: 'warehouse brick or concrete wall with graffiti texture',
        typeStyle: 'spray-painted stencil letterforms, rough ink edges',
        material: 'spray-painted stencil on raw concrete, rough ink bleed at edges, weathered surface underneath',
        colorDirection: 'black with bold primary color tag accent',
        atmosphere: 'raw urban energy, documentary grit',
        motionAtmosphere: 'handheld camera shake, fast spray-reveal, gritty grain pulse'
      }
    case 'luxury':
      return {
        background: 'polished Carrara marble slab, warm key light from above',
        typeStyle: 'embossed serif letterforms, gold foil treatment',
        material: 'hand-engraved Carrara marble inlay with 24k gold leaf fill, polished face, and deep-cut bevels',
        colorDirection: 'ivory and 24k gold with deep shadow',
        atmosphere: 'haute couture editorial, aspirational',
        motionAtmosphere: 'slow gilded shimmer reveal, soft lens bloom, elegant ease'
      }
    case 'tech':
      return {
        background: 'pure white or light gray field with clean negative space',
        typeStyle: 'black Helvetica/geometric sans, ultra-precise kerning',
        material: 'CNC-machined anodized aluminum, ultra-precise edges, matte black with clean specular line highlights',
        colorDirection: 'monochrome with single electric blue accent',
        atmosphere: 'product-launch precision, Dieter Rams minimal',
        motionAtmosphere: 'mechanical snap-to-grid, clean fade, precise timing'
      }
    case 'noir':
      return {
        background: 'near-black with venetian blind shadow pattern, film grain overlay',
        typeStyle: 'white high-contrast sans or italic serif, harsh single-source lamp lighting',
        material: 'tarnished silver foil letterforms, slight oxidation at edges, harsh single-source cast shadow',
        colorDirection: 'black and white with one amber practical accent',
        atmosphere: '1940s detective film, moral weight',
        motionAtmosphere: 'slow venetian blind shadow sweep, low-key lighting shift, mist drift'
      }
    case 'pop':
      return {
        background: 'oversaturated solid color background — coral, electric yellow, or cyan',
        typeStyle: 'ultra-rounded bold display sans, thick black outline',
        material: 'high-gloss enamel with thick black outline, bold fill color, and slightly inflated letterform depth',
        colorDirection: 'high-saturation complementary contrast',
        atmosphere: 'Instagram editorial, Gen Z energy',
        motionAtmosphere: 'bouncy spring keyframe, color-pop flash, high-contrast snap'
      }
    case 'premium':
    default:
      return {
        background: 'deep obsidian with documentary film grain texture',
        typeStyle: 'metallic silver condensed sans-serif',
        material: 'brushed titanium letterforms with machined bevels, micro scratches, subtle edge oxidation, and realistic weight',
        colorDirection: 'silver and white with subtle warm bloom',
        atmosphere: 'cinematic documentary, premium editorial',
        motionAtmosphere: 'ambient silver particle drift, smooth lens bloom'
      }
  }
}

/* -------------------------------------------------------------------------- */
/*  Per-mode prompt builders                                                   */
/* -------------------------------------------------------------------------- */

function buildTypographyPrompts(
  text: string,
  preset: GraphicsStylePreset
): { stillPrompt: string; motionPrompt: string } {
  const hook = extractHook(text, 5)
  const s = getPresetStyle(preset)
  return {
    stillPrompt:
      `Premium documentary title frame — not a thumbnail. The phrase "${hook}" is physically manufactured in the scene: ` +
      `${s.typeStyle} letterforms treated as a real object under cinematic lighting, not a graphic layered on a background. ` +
      `The typography is the subject, photographed like a tangible thing — ${s.material ?? s.background}, ` +
      `${s.colorDirection}, ${s.atmosphere} — ` +
      `${s.background} environment, dramatic single-source practical light raking across the letterform surface, ` +
      `casting hard shadows that reveal material texture. ` +
      `${s.atmosphere} polish — Netflix documentary title-card restraint, Bloomberg Originals precision. ` +
      `16:9, photoreal render, no faces, ` +
      `only the exact phrase on screen — no captions, labels, subtitles, logos, or extra words, ` +
      `maximum 3–5 words, no letterform taller than 25% of frame height, ` +
      `text centered with equal margin on all four sides, nothing within 15% of any frame edge`,
    motionPrompt:
      `Kinetic text slam — the exact phrase "${hook}" drives in with elastic ease, ` +
      `hold for 2 seconds, slow camera push-in into the letterform surface, ${s.motionAtmosphere}, ` +
      `8 seconds, no voice, no faces, ` +
      `only the exact phrase on screen — no additional text, no captions, no labels, no subtitles, no logos, ` +
      `camera stays on subject, no element exits or enters from outside the frame edge, ` +
      `all animated elements stay within frame bounds at all times`
  }
}

function buildStatPrompts(
  text: string,
  preset: GraphicsStylePreset
): { stillPrompt: string; motionPrompt: string } {
  const stat = extractStatFigure(text)
  const hook = extractHook(text, 4)
  const figure = stat ? `"${stat}"` : `"${hook}"`
  const s = getPresetStyle(preset)
  return {
    stillPrompt:
      `Cinematic stat title card — the figure ${figure} is the hero object and dominates the frame, ` +
      `occupying roughly one-third of the vertical image height, with confident negative space around it. ` +
      `${s.background}. ${s.material} letterforms with ${s.colorDirection}. ` +
      `Any secondary annotation is understated, small, widely tracked, and clearly subordinate to the hero figure. ` +
      `${s.atmosphere}. Use only the essential words needed to communicate the idea instantly. ` +
      `Documentary film grain, 16:9, photoreal render, no faces.`,
    motionPrompt:
      `Data reveal animation — figure counts up from zero with ease-out, ` +
      `accent rule draws in left-to-right, ${s.motionAtmosphere}, ` +
      `cool-toned ambient light flare on the figure, 8 seconds, no voice, ` +
      `camera stays on subject, no element exits or enters from outside the frame edge, ` +
      `all animated elements stay within frame bounds at all times`
  }
}

function buildEmpirePrompts(
  text: string,
  preset: GraphicsStylePreset,
  subjectProfile?: SubjectProfile
): { stillPrompt: string; motionPrompt: string } {
  const appearanceClause = subjectProfile?.ethnicityOrAppearance?.trim()
    ? `${subjectProfile.ethnicityOrAppearance} ` : ''
  const hookWords = extractHook(text, 4)
  const s = getPresetStyle(preset)
  return {
    stillPrompt:
      `Biographical empire network diagram — ${appearanceClause}subject node at center ` +
      `labeled in ${s.colorDirection} (theme: "${hookWords}"), satellite company and venture nodes ` +
      `connected by glowing thread lines, ${s.background}, ` +
      `${s.typeStyle} label typography, ${s.atmosphere}, warm rim light on center node, ` +
      `16:9, photoreal render, no faces, ` +
      `maximum 3–5 words on screen at once, no letterform taller than 25% of frame height, ` +
      `text centered with equal margin on all four sides, nothing within 15% of any frame edge`,
    motionPrompt:
      `Node expansion animation — central node pulses outward, satellite nodes ` +
      `materialize sequentially, connecting lines draw in with golden glow, ` +
      `${s.motionAtmosphere}, slow pan across the network, 8 seconds, no voice, ` +
      `camera stays on subject, no element exits or enters from outside the frame edge, ` +
      `all animated elements stay within frame bounds at all times`
  }
}

/** Map each preset to its 3D material for the letterform render. */
function get3DTextMaterial(preset: GraphicsStylePreset): string {
  switch (preset) {
    case 'dynamic': return 'neon-lit acrylic with electric glow'
    case 'modern': return 'brushed steel with cool reflection'
    case 'traditional': return 'hammered gold with warm patina'
    case 'cinematic': return 'tungsten with dramatic raking shadows'
    case 'social': return 'neon gloss plastic with candy shine'
    case 'street': return 'rust-weathered iron with chipped paint'
    case 'luxury': return '24k polished gold with soft specular'
    case 'tech': return 'anodized black aluminum with CNC-etched surface'
    case 'noir': return 'cast iron with oxidized patina and single-source lamp'
    case 'pop': return 'gloss enamel candy color with thick outline'
    case 'premium':
    default: return 'chrome with physically-based reflections'
  }
}

export function buildThreeDTextPrompts(
  text: string,
  preset: GraphicsStylePreset
): { stillPrompt: string; motionPrompt: string } {
  const hook = extractHook(text, 4)
  const material = get3DTextMaterial(preset)
  const s = getPresetStyle(preset)
  return {
    stillPrompt:
      `3D extruded letterforms — "${hook}" — ${material}, ` +
      `physically-based render, dramatic raking side-light casting hard shadows across letterform faces, ` +
      `letters floating in dark void, camera angle slightly low for authority, ` +
      `depth of field blur on background, ${s.atmosphere} mood, ` +
      `16:9, photoreal, no faces, no background clutter, ` +
      `text within center 70% of frame, equal margin all sides, ` +
      `maximum 3–5 words on screen at once, no letterform taller than 25% of frame height, ` +
      `nothing within 15% of any frame edge`,
    motionPrompt:
      `Slow cinematic drift around 3D letterforms — depth of field shifts from background to foreground, ` +
      `subtle ambient occlusion pulsing, letters hold position, ${s.motionAtmosphere}, ` +
      `8 seconds, no voice, no faces, ` +
      `camera stays on subject, no element exits or enters from outside the frame edge, ` +
      `all elements stay within frame`
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Return `{ stillPrompt, motionPrompt }` for any mode override.
 * Useful in the UI when the user switches a beat card to a different treatment.
 */
export function getPromptsForMode(
  tlp: TopLayerBeatPrompt,
  mode: GroundedGraphicsMode,
  preset: GraphicsStylePreset = 'premium',
  subjectProfile?: SubjectProfile
): { stillPrompt: string; motionPrompt: string } {
  switch (mode) {
    case 'empire':
      return buildEmpirePrompts(tlp.transcript, preset, subjectProfile)
    case 'stat':
      return buildStatPrompts(tlp.transcript, preset)
    case '3d-text':
      return buildThreeDTextPrompts(tlp.transcript, preset)
    default:
      return buildTypographyPrompts(tlp.transcript, preset)
  }
}

export { buildTypographyPrompts, buildStatPrompts, buildEmpirePrompts }

/**
 * Deterministic (no API call) Top Layer prompt generator — one treatment per beat.
 *
 * Mirrors the shape of `generateBrollPromptsFromBeats` but produces
 * `TopLayerBeatPrompt` objects suitable for the graphics slot system.
 * Returns an array parallel to the input beats (empty text beats skipped).
 */
export function generateTopLayerPromptsFromBeats(
  beats: BrollBeat[],
  opts?: GenerateTopLayerPromptsFromBeatsOptions
): TopLayerBeatPrompt[] {
  const results: TopLayerBeatPrompt[] = []
  const preset: GraphicsStylePreset = opts?.stylePreset ?? 'premium'

  for (const beat of beats) {
    const text = beat.transcript_text?.trim()
    if (!text) continue

    const mode = inferGroundedGraphicsMode(text)

    let prompts: { stillPrompt: string; motionPrompt: string }
    let primaryKind: 'graph-image' | 'text-image'

    switch (mode) {
      case 'empire':
        prompts = buildEmpirePrompts(text, preset, opts?.subjectProfile)
        primaryKind = 'graph-image'
        break
      case 'stat':
        prompts = buildStatPrompts(text, preset)
        primaryKind = 'graph-image'
        break
      case '3d-text':
        prompts = buildThreeDTextPrompts(text, preset)
        primaryKind = 'text-image'
        break
      default:
        prompts = buildTypographyPrompts(text, preset)
        primaryKind = 'text-image'
        break
    }

    results.push({
      beatId: beat.id,
      mode,
      treatmentLabel: TREATMENT_LABELS[mode],
      primaryKind,
      stillPrompt: prompts.stillPrompt,
      motionPrompt: prompts.motionPrompt,
      transcript: text
    })
  }

  return results
}
