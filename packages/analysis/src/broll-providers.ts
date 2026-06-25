import type { StoryMode } from '@storyteller/shared'
import {
  clampBrollShotDurationSeconds,
  DEFAULT_BROLL_SHOT_DURATION_SECONDS
} from '@storyteller/shared'

/** Video generators we can route B-roll prompts to (extend as you add integrations). */
export type BrollVideoProviderId = 'runway' | 'kling' | 'luma' | 'pika'

/** Pluggable target for future API calls (Runway, Kling, …). */
export interface BrollGenerationProvider {
  id: BrollVideoProviderId
  displayName: string
}

export const BROLL_GENERATION_PROVIDERS: BrollGenerationProvider[] = [
  { id: 'runway', displayName: 'Runway' },
  { id: 'kling', displayName: 'Kling' },
  { id: 'luma', displayName: 'Luma (planned)' },
  { id: 'pika', displayName: 'Pika (planned)' }
]

/**
 * Future: send `promptText` to the chosen provider SDK / HTTP API.
 * Returns a placeholder until keys and endpoints are wired.
 */
export async function generateBrollFromPrompt(_args: {
  providerId: BrollVideoProviderId
  promptText: string
}): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (_args.providerId === 'runway') {
    return {
      ok: false,
      error:
        'Runway generation runs in the Storyteller desktop app (Electron) — use Generate with Runway on a mapped slot. This package stub remains for non-desktop builds.'
    }
  }
  return { ok: false, error: 'This provider is not wired yet — use Runway from the desktop app or copy the prompt string.' }
}

export interface BrollProviderPromptBundle {
  /** Main editorial prompt shown in Storyteller */
  primary: string
  /** Runway Gen-3 style — motion + scene + lens */
  runway: string
  /** Kling-style — subject + environment + camera */
  kling: string
}

function extractSubjects(summary: string): string {
  const t = summary.replace(/\s+/g, ' ').trim()
  if (t.length < 12) return 'the people and actions described in the spoken line'
  return t.slice(0, 280)
}

function directionFlavor(direction: string | undefined, mode: StoryMode): string {
  const d = (direction ?? '').toLowerCase()
  if (mode === 'journalism') {
    if (/\b(news|field|report|investigate)\b/.test(d)) return 'documentary news field aesthetic, neutral color grade'
    return 'editorial news B-roll, factual and restrained, no melodrama'
  }
  if (/\b(cinematic|film|epic)\b/.test(d)) return 'cinematic lighting, shallow depth of field, slow dolly or handheld micro-movement'
  if (/\b(viral|tiktok|reels)\b/.test(d)) return 'fast social-native framing, punchy contrast, eye-level or slight high angle'
  if (/\b(urgent|breaking)\b/.test(d)) return 'tense pacing, cooler shadows, handheld urgency'
  if (/\b(podcast|intimate)\b/.test(d)) return 'warm practicals, close-medium shots, soft falloff'
  return mode === 'creator'
    ? 'premium creator aesthetic, polished but human, subtle camera movement'
    : 'naturalistic coverage that supports the spoken line without overpowering it'
}

function premiumCinematicFinish(duration: string): string {
  return [
    'Premium cinematic B-roll, high-end documentary/commercial polish, motivated practical lighting,',
    'rich contrast, precise production design, realistic texture, atmosphere in the frame,',
    'camera movement tied to the emotional beat — ending with a motivated push into the dominant',
    'texture, light source, or focal element that fills the frame as a natural visual exit.',
    'No talking head, no on-screen text,',
    `${duration}, single continuous take, photoreal.`
  ].join(' ')
}

/**
 * Build provider-ready prompts from segment meaning + mode + user direction (keyword-driven, no remote LLM).
 *
 * Each prompt type now generates distinctly different visual approaches:
 * - Literal: Show what is actually being discussed
 * - Emotional: Capture the feeling through human moments
 * - Symbolic: Abstract metaphors through environment/texture
 */
export function buildBrollProviderBundle(params: {
  promptType: 'literal' | 'emotional' | 'symbolic'
  segmentSummary: string
  mode: StoryMode
  directionText?: string
  toneHint: string
  /** Per-shot duration (defaults to 8s). */
  shotDurationSeconds?: number
}): BrollProviderPromptBundle {
  const { promptType, segmentSummary, mode, directionText, toneHint, shotDurationSeconds } = params
  const core = extractSubjects(segmentSummary)
  const flavor = directionFlavor(directionText, mode)
  const dur = clampBrollShotDurationSeconds(
    shotDurationSeconds ?? DEFAULT_BROLL_SHOT_DURATION_SECONDS
  )
  const timeWindow = `${dur} seconds`

  if (promptType === 'literal') {
    // LITERAL: Show the actual subject matter - documentary coverage style
    const primary = `Premium cinematic literal B-roll grounded in this exact soundbite: "${core}". Show the real-world subject, environment, tools, technology, location, or visible stakes implied by the line. Use a 24-35mm lens with readable environmental context, specific props, and a motivated light source. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    // Runway: Wide establishing with environmental storytelling
    const runway = `Wide premium documentary establishing shot grounded in: "${core}". Subject or symbolic subject matter appears in a specific, believable setting with visible context and props that directly support the spoken line. 24-28mm lens, deep environmental detail, motivated light source, slow controlled push or lateral dolly, high contrast cinematic grade. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    // Kling: Subject-focused in authentic environment
    const kling = `Premium cinematic B-roll of ${core} in an authentic environment, medium-wide framing, location identifiable, real props visible, subject or objects engaged in a meaningful action that matches the soundbite. Eye-level documentary framing with dramatic practical light, subtle camera movement, high-end production texture. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    return { primary, runway, kling }
  }

  if (promptType === 'emotional') {
    // EMOTIONAL: Human moments with narrative stakes
    const primary = `Premium emotional B-roll grounded in this exact soundbite: "${core}". Build a cinematic human moment around the feeling, pressure, ambition, loss, relief, or realization implied by the line. Faces or body language should carry the emotion, while visible props and environment make the stakes concrete. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    // Runway: Two-shot or intimate close with context
    const runway = `Cinematic emotional scene grounded in: "${core}". One person or a small relationship moment reacts to a visible situation, with props and environment revealing the stakes. 40-50mm lens, shallow depth but context still readable, subtle push-in on realization, expressive practical light, premium documentary realism. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    // Kling: Reactive moment with environmental storytelling
    const kling = `Premium emotional B-roll: subject responding to the situation implied by "${core}", engaged with people, objects, or environment rather than explaining to camera. Gesture, expression, and visible stakes carry meaning. Dramatic but believable light, polished documentary camera movement. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

    return { primary, runway, kling }
  }

  // SYMBOLIC: Abstract metaphors through texture, scale, environment
  const primary = `Premium symbolic B-roll grounded in this exact soundbite: "${core}". Create a cinematic visual metaphor using texture, scale, light, environment, money/technology/object detail, architecture, weather, or motion that supports the line without inventing new facts. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

  // Runway: Macro texture or wide abstraction
  const runway = `High-end symbolic cinematic B-roll grounded in: "${core}". Macro texture study or wide environmental abstraction where material, pattern, light, or scale tells the story. 50-85mm macro detail or 24mm negative-space wide shot, atmospheric particles or reflections if appropriate, no faces unless essential, no text. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

  // Kling: Environmental abstraction
  const kling = `Premium environmental abstraction grounded in "${core}": architecture, interiors, financial objects, technology, landscape, or macro texture imply the idea through space and scale. Cinematic contrast, motivated light, controlled camera move, refined texture, subject may be absent if the metaphor is stronger. ${toneHint}. ${flavor}. ${premiumCinematicFinish(timeWindow)}`

  return { primary, runway, kling }
}

import { BROLL_MOTION_AUDIO_POLICY } from '@storyteller/shared'

const MOTION_PROMPT_SUFFIX = (dur: number) =>
  `${dur} seconds, single continuous take, photoreal, no dialogue, no on-screen text. ${BROLL_MOTION_AUDIO_POLICY}`

type ConcreteFallbackScene = {
  style: 'literal' | 'emotional' | 'symbolic'
  stillImagePrompt: string
  motionPrompt: string
  why: string
}

/** Stable, order-independent hash so the same line always picks the same variant. */
function hashLine(line: string): number {
  let h = 2166136261
  for (let i = 0; i < line.length; i++) {
    h ^= line.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

type FallbackVariant = {
  style: 'literal' | 'emotional' | 'symbolic'
  stillImagePrompt: string
  motion: string
  why: string
}

type FallbackBucket = {
  rx: RegExp
  variants: FallbackVariant[]
}

/**
 * Keyword-driven scene ideas when the LLM omits brollIdeas. Each topic has several
 * distinct cinematic angles (literal / emotional / symbolic) and the specific line
 * deterministically selects one, so two soundbites in the same topic don't render the
 * identical shot. These are starter scenes — the UI invites regeneration with AI.
 *
 * Pass `variantIndex` to force a specific angle within the matched topic — the episode
 * diversifier uses this to give recurring topics deliberately different scenes.
 */
export function tryConcreteFallbackScene(
  line: string,
  shotDurationSeconds?: number,
  variantIndex?: number
): ConcreteFallbackScene | null {
  const dur = clampBrollShotDurationSeconds(
    shotDurationSeconds ?? DEFAULT_BROLL_SHOT_DURATION_SECONDS
  )
  const motion = (m: string) =>
    `${m}, then in the final moment push into the dominant texture, surface, or light until it fills the frame. ${MOTION_PROMPT_SUFFIX(dur)}.`

  const buckets: FallbackBucket[] = [
    {
      rx: /\b(space|spacex|rocket|satellite|orbit|launch pad|cape|commercial space|telecommunications|telecom|outer space|infrastructure in space)\b/i,
      variants: [
        {
          style: 'literal',
          stillImagePrompt:
            'Falcon-class rocket on a coastal launch pad at blue hour, steam venting from the base, gantry arms retracted, no people in frame, Roger Deakins-style motivated floodlights.',
          motion: 'Slow crane rise along the rocket stack as venting steam thickens and pad lights pulse, subtle heat shimmer',
          why: 'Literal space-industry coverage of the launch thesis.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Communications satellite drifting above a curved earth horizon, solar panels catching hard sunlight, deep starfield behind, cold cinematic grade, no text.',
          motion: 'Slow orbital drift past the satellite as earthlight sweeps across the solar array',
          why: 'Symbolic reach of satellite access and defense infrastructure.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Mission control room at night, rows of monitors with abstract telemetry (no legible text), an engineer leaning forward in silhouette against screen glow, tense practical light.',
          motion: 'Slow push-in over the engineer\u2019s shoulder as telemetry glows reflect on their face',
          why: 'Human stakes behind the space-economy moment.'
        },
        {
          style: 'literal',
          stillImagePrompt:
            'Sprawling satellite ground station at dawn, rows of white dish antennas tilted skyward, frost on the grass, cold blue light, no people, wide cinematic vista.',
          motion: 'Slow tracking dolly along the row of dish antennas as dawn light rakes across them',
          why: 'Defense and telecom ground infrastructure behind the space economy.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'A glowing rocket ascent arc over a dark coastline, light streaking through low cloud, distant city lights below, no people, epic negative space, cinematic grade.',
          motion: 'Slow vertical tilt following the glowing ascent arc as it pierces the cloud deck',
          why: 'The scale and momentum of the launch moment.'
        }
      ]
    },
    {
      rx: /\b(show|concert|ticket|tickets|pay more|miss out|go on forever|eager|sold out|line up)\b/i,
      variants: [
        {
          style: 'literal',
          stillImagePrompt:
            'Exterior of a sold-out arena at night, marquee lights glowing, velvet ropes and ticket scanners at the entrance, wet pavement reflections, crowd silhouettes out of focus, no legible signage.',
          motion: 'Slow lateral dolly past the entrance as marquee bulbs flicker and line energy builds',
          why: 'Scarcity and FOMO around access to the show.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Close macro of a hand holding a phone with a glowing abstract ticket pass (no readable text), warm bokeh of a crowd behind, shallow depth of field, premium night grade.',
          motion: 'Rack focus from the crowd bokeh to the glowing pass in the hand',
          why: 'Symbol of paying to get in versus waiting it out.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Empty theater seats lit by a single stage wash before doors open, dust motes in the beam, anticipation in the stillness, cinematic contrast.',
          motion: 'Slow push down the aisle toward the lit stage as house lights dim',
          why: 'The patience side of the line \u2014 the show goes on regardless.'
        },
        {
          style: 'literal',
          stillImagePrompt:
            'Night exterior box-office window with a glowing abstract sold-out sign (no legible text), a single hand sliding cash under the glass, neon reflections on wet pavement, shallow depth of field.',
          motion: 'Slow push-in on the exchange at the box-office window as neon flickers',
          why: 'Paying a premium to get in at the last minute.'
        }
      ]
    },
    {
      rx: /\b(news|what the heck|what just happened|watching right now|understand what|headline|broadcast|y'?all)\b/i,
      variants: [
        {
          style: 'literal',
          stillImagePrompt:
            'Dim living room at night, phone screen glow on a table, TV shows blurred abstract footage with no legible chyrons or headlines, scattered notes and a half-empty mug, static documentary framing.',
          motion: 'Slow push-in toward the glowing screen as room light dims',
          why: 'Audience confusion over the news \u2014 without readable broadcast text.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Bank of newsroom monitors showing blurred abstract motion (no legible text), an empty operator chair, cool blue practical light, long lens compression.',
          motion: 'Slow lateral truck across the wall of blurred monitors',
          why: 'The firehose of information behind the headlines.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Person sitting on the edge of a bed at night scrolling a phone, face lit by screen glow, blankets and a glass of water nearby, intimate documentary framing.',
          motion: 'Slow push-in on the lit face as the scroll reflections flicker',
          why: 'The personal weight of trying to keep up with the story.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Macro of a phone in a dark room showing a fast blur of abstract notifications (no legible text), a tired eye just out of focus behind it, intimate practical glow.',
          motion: 'Rack focus from the blurred notifications to the eye and back',
          why: 'The overwhelm of trying to keep up with the story.'
        }
      ]
    },
    {
      rx: /\b(first.?gen(eration)?|generational.wealth|first.generation|never.built|real.wealth|selling.cars|grinding|sacrifice|cutting.back|family.member|pour.from|empty.cup|protect|1[,]?000\b|bank.account|my.family|nobody.in.your.family|can.?t.afford|couldn.?t.afford|growing.up.with(out)?|didn.?t.have)\b/i,
      variants: [
        {
          style: 'emotional',
          stillImagePrompt:
            'Worn kitchen table late at night, a single hanging lamp casting warm amber light, a handwritten budget on a yellow legal pad, a bank envelope with a small fold of bills, a half-empty mug of coffee, a phone face-down at the edge, quiet domestic intimacy, deep shadows at the frame edges.',
          motion: 'Slow push-in toward the handwritten budget as the lamp hums and the shadows around the edges settle',
          why: 'The kitchen table and handwritten budget are the real physical world of first-generation wealth — intimate and specific, not symbolic.'
        },
        {
          style: 'literal',
          stillImagePrompt:
            'Car dealership showroom lot at night, a lone salesperson at a cluttered desk past closing time, fluorescent overhead light casting harsh pools across polished hoods visible through the glass, a printed inventory sheet and a half-eaten meal beside a phone showing a low bank balance, warm but tired practical light.',
          motion: 'Slow push-in past the empty showroom floor toward the lit desk as the fluorescent lights buzz and the dark lot recedes outside',
          why: 'The specific job and physical evidence of grinding — the inventory sheet, the late hour, the meal — show sacrifice without explaining it.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Two family members seated across from each other at a modest kitchen table, one gesturing at a bank statement, the other listening with arms crossed, a meal half-eaten between them, warm practical overhead light, tension readable in posture alone, no legible documents.',
          motion: 'Slow push-in from a distance as the conversation continues in silence and the meal goes cold between them',
          why: 'The family-and-money conversation is the specific human scene where generational wealth gets made or broken.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Close macro of a weathered hand placing a single folded bill into a plain white envelope on a kitchen table, household objects softly out of focus behind, warm motivated lamp light from frame right, documentary texture and quiet restraint.',
          motion: 'Slow push-in as the hand seals the envelope and sets it down carefully on the table',
          why: 'The physical act of saving — the envelope, the hand — makes the sacrifice intimate and specific.'
        }
      ]
    },
    {
      rx: /\b(invest|investor|250,?000|liquid|qualified|accredited|ipo|go public|publicly traded|stock|trillion|long-?term.returns?|annualized.returns?)\b/i,
      variants: [
        {
          style: 'symbolic',
          stillImagePrompt:
            'Private club entrance at dusk, a heavy wood-and-brass door slightly ajar with warm amber light spilling through, a suited doorman seen from behind checking a clipboard guest list, a velvet rope across one side, marble steps, no legible signage.',
          motion: 'Slow push toward the brass door as the warm light from inside intensifies and the doorman\'s shadow lengthens across the marble',
          why: 'The access barrier is the mechanism — the doorman and the door make the qualified-investor threshold physical and human.'
        },
        {
          style: 'literal',
          stillImagePrompt:
            'Dark home office at night, a single desk lamp on a glossy desk, a legal document with a signature line visible but no legible text, a pen resting precisely on the page, a glass of water, quiet and deliberate, no screens.',
          motion: 'Slow push-in toward the pen on the signature line as the lamp light tightens and the document comes into sharp relief',
          why: 'The document and pen ground the investment threshold as a real, deliberate decision rather than a financial abstraction.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Exterior glass financial tower at dusk, floor-to-ceiling windows glowing amber from within, reflections of an ordinary street and pedestrians in the glass facade, dramatic tonal separation between the warm interior and cool blue exterior, no legible signage.',
          motion: 'Slow push toward the glass facade as interior warmth blooms and the street-level reflection fades into the glass',
          why: 'The warm interior / cool exterior contrast visualizes the barrier between those inside the deal and those outside.'
        },
        {
          style: 'literal',
          stillImagePrompt:
            'Close detail of a brass exchange bell and wooden podium under a warm spotlight, microphones and confetti residue on the floor, no legible signage, premium documentary grade.',
          motion: 'Slow push-in toward the brass bell as the spotlight tightens and confetti residue drifts',
          why: 'The going-public / IPO moment, grounded in the physical ceremony.'
        }
      ]
    },
    {
      rx: /\b(school|schools|educator|teacher|degree|doctorate|student|students|test|tests|learn|learning|knowledge|information|pass it down|curriculum|education|literacy)\b/i,
      variants: [
        {
          style: 'literal',
          stillImagePrompt:
            'Empty classroom at golden hour, chalkboard with abstract erased smudges (no legible text), rows of wooden desks, dust in the light beams, nostalgic documentary framing.',
          motion: 'Slow dolly between the empty desks toward the chalkboard as light shifts',
          why: 'The institutions tasked with passing down knowledge.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Towering library stacks fading into shadow, a single shaft of light on one shelf, leather spines with no legible titles, warm dust, cinematic depth.',
          motion: 'Slow push down the aisle of stacks toward the single lit shelf',
          why: 'Knowledge that exists but isn\u2019t evenly handed down.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Close macro of hands turning the pages of a worn textbook on a kitchen table under a single lamp, abstract diagrams (no legible text), warm intimate light.',
          motion: 'Slow push-in on the hands as a page turns and the lamp glows',
          why: 'The personal effort to self-teach what wasn\u2019t taught.'
        }
      ]
    },
    {
      rx: /\b(iron man|tony stark|stark|anduril|weapons|defense|futuristic|future|technology|tech|ai\b|robot|drone|prototype|innovation|engineer|build|building)\b/i,
      variants: [
        {
          style: 'literal',
          stillImagePrompt:
            'High-tech R&D lab at night, a sleek matte prototype under focused key light on a workbench, tools and cables arranged precisely, cool teal practical glow, no people, premium product-film grade.',
          motion: 'Slow orbit around the prototype as rim light traces its edges',
          why: 'The literal futuristic-tech enterprise being described.'
        },
        {
          style: 'symbolic',
          stillImagePrompt:
            'Cavernous hangar with an autonomous drone suspended in a hard spotlight, polished concrete floor reflections, dramatic negative space, cinematic contrast, no text.',
          motion: 'Slow crane down toward the suspended drone as the spotlight tightens',
          why: 'Scale and ambition of a modern defense-tech company.'
        },
        {
          style: 'emotional',
          stillImagePrompt:
            'Engineer in silhouette studying a glowing holographic display of abstract schematics (no legible text), face lit by the projection, focused and still, dark lab.',
          motion: 'Slow push-in past the engineer toward the glowing holographic schematic',
          why: 'The visionary-builder energy of the comparison.'
        }
      ]
    }
  ]

  for (const bucket of buckets) {
    if (!bucket.rx.test(line)) continue
    const selector =
      variantIndex != null && Number.isFinite(variantIndex)
        ? Math.abs(Math.trunc(variantIndex))
        : hashLine(line)
    const variant = bucket.variants[selector % bucket.variants.length]!
    return {
      style: variant.style,
      stillImagePrompt: variant.stillImagePrompt,
      motionPrompt: motion(variant.motion),
      why: variant.why
    }
  }
  return null
}

/**
 * On-device fallback when the Director fails — every field is a cinematic translation, not a talking-head literal.
 */
export function buildCinematicBrollPrompt(params: {
  ideaSummary: string
  mode: StoryMode
  directionText?: string
  toneHint: string
  /** Per-shot duration (defaults to 8s). */
  shotDurationSeconds?: number
}): {
  literal: string
  emotional: string
  symbolic: string
  runway: string
  kling: string
  literalStill?: string
  literalMotion?: string
} {
  const idea = params.ideaSummary.replace(/\s+/g, ' ').trim().slice(0, 280)
  const concrete = tryConcreteFallbackScene(idea, params.shotDurationSeconds)
  const flavor = directionFlavor(params.directionText, params.mode)
  const tone = params.toneHint
  const dur = clampBrollShotDurationSeconds(
    params.shotDurationSeconds ?? DEFAULT_BROLL_SHOT_DURATION_SECONDS
  )
  const tw = `${dur} seconds`
  const emo = buildBrollProviderBundle({
    promptType: 'emotional',
    segmentSummary: idea,
    mode: params.mode,
    directionText: params.directionText,
    toneHint: tone,
    shotDurationSeconds: dur
  })
  const sym = buildBrollProviderBundle({
    promptType: 'symbolic',
    segmentSummary: idea,
    mode: params.mode,
    directionText: params.directionText,
    toneHint: tone,
    shotDurationSeconds: dur
  })
  return {
    literal: concrete
      ? `${concrete.stillImagePrompt} ${concrete.motionPrompt}`
      : `Premium cinematic B-roll grounded in this exact soundbite: "${idea}". Show the real-world subject or visible stakes implied by the line through environment, props, light, and motion. No talking head, no on-screen text. ${flavor}. Single continuous ${tw} shot, ${tone}, photoreal.`,
    literalStill: concrete?.stillImagePrompt,
    literalMotion: concrete?.motionPrompt,
    emotional: emo.primary,
    symbolic: sym.primary,
    runway: `Premium documentary/commercial B-roll grounded in: "${idea}". A cinematic environment or symbolic action embodies the idea, with specific props, dramatic practical lighting, rich contrast, atmospheric texture, and a slow push-in or controlled dolly. No talking head, no on-screen text. ${flavor}. ${tw}, photoreal.`,
    kling: `${emo.kling} ${sym.kling.slice(0, 220)}`
  }
}
