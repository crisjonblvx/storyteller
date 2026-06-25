import type { BrollPrompt, StoryMode, SubjectProfile } from '@storyteller/shared'
import {
  clampBrollShotDurationSeconds,
  DEFAULT_BROLL_SHOT_DURATION_SECONDS
} from '@storyteller/shared'
import type { BrollToneHint } from './ai-direction.js'
import { castDescription } from './openai-broll.js'
import type { PromptPackDefinition, PromptPackId } from './prompt-packs.js'

/**
 * The unit the renderer hands us: a "beat" is a saved soundbite, an intro clip,
 * or any other timeline-anchored snippet of speech. Source-time, not edit-time.
 */
export interface BrollBeat {
  /** Stable id for de-dup / cache keys (soundbite id, clip id, …). */
  id: string
  /** Source-media seconds, NOT edit-time. */
  source_start: number
  /** Source-media seconds, NOT edit-time. */
  source_end: number
  /** The actual spoken line — drives imagery selection. */
  transcript_text: string
  /** 0..1, optional. Used for tie-breaking and shown in the card. */
  score?: number | null
  /** Where this beat came from (informational; helps the prompt pick mood). */
  origin?: 'intro' | 'saved-timeline' | 'soundbite'
}

export interface GenerateBrollPromptsFromBeatsOptions {
  tone?: BrollToneHint
  mode?: StoryMode
  directionText?: string
  /**
   * Cap. Defaults to all beats (one prompt per beat is the whole point of this
   * function). Provide if you want a hard ceiling.
   */
  maxPrompts?: number
  /**
   * Project-level cast description. When provided and `visibility` allows
   * visible people, the subject clause uses these specifics instead of
   * generic "a woman in her 30s" defaults — so the deterministic local
   * writer honors the same Subject panel the user filled out for the AI.
   */
  subjectProfile?: SubjectProfile
  /**
   * Per-shot duration the deterministic writer should bake into every
   * `primary` / `runway` / `kling` string. Defaults to 8 seconds when
   * omitted so callers that don't care still get the AI-matching value.
   */
  shotDurationSeconds?: number
  /**
   * Active prompt pack — drives lighting, lens, movement, and styleNote
   * pools so cinematic_documentary, viral_social, podcast_premium, etc.
   * each produce visibly distinct deterministic prompts. When omitted the
   * writer falls back to the original tone-based pools.
   */
  promptPack?: PromptPackDefinition
}

/* -------------------------------------------------------------------------- */
/*  Style picker                                                              */
/* -------------------------------------------------------------------------- */

/** Words that strongly imply "render this literally" (people, places, objects). */
const LITERAL_TOKENS =
  /\b(book|table|home|house|school|street|stage|microphone|kitchen|car|phone|door|chair|bed|window|city|garden|office|store|yard|kid|kids|daughter|son|mom|dad|mother|father|wife|husband|friend|crowd|audience|guest|congregation|coffee|tea|cup|paper|notebook|pen|page|word|words|hand|hands|face|eyes|smile|tear|tears|bills|laptop|screen|email|messages?|document|documents|photo|photograph|tool|tools|keys|bag|box|room|desk|calendar|map|list|notes?)\b/i

/** Words / patterns that lean *emotional* — show the feeling on faces, hands, light. */
const EMOTIONAL_TOKENS =
  /\b(love|fear|afraid|scared|anxious|hope|hopeful|hopeless|joy|joyful|grief|grieve|grieving|cry|crying|tear|tears|hurt|hurting|broken|brokenness|anger|angry|rage|peace|peaceful|calm|panic|trauma|wounded|forgive|forgiveness|grateful|gratitude|sad|sadness|happy|laugh|laughter|wonder|delight|tender|gentle|warm|cold|alone|loneliness|exhausted|tired|weary|brave|bold|courage|relief|relieved|trust|distrust|surrender|hold|held|hug|embrace|whisper|cherish|miss|missing|longing|yearning|breathe|breath|breathing|heart|heartbreak|stress|stressed|overwhelmed|urgency|urgent)\b/i

/** Abstract nouns / metaphor signals — go symbolic (texture, weather, scale). */
const SYMBOLIC_TOKENS =
  /\b(time|silence|stillness|noise|chaos|storm|shaken|shake|wind|fire|water|ocean|river|wave|waves|light|darkness|shadow|sky|cloud|clouds|seasons|season|spring|winter|summer|fall|wilderness|desert|mountain|valley|ground|root|roots|dust|spirit|soul|truth|lies|knowing|mis-knowing|uncertainty|certainty|order|wisdom|destiny|purpose|venom|seeped|seep|drift|drifting|paralysis|paralyzed|frozen|stuck|fog|veil|threshold|shore|edge|abyss|infinity|eternity|memory|memories|legacy|absence|presence|reactive|react|reaction|misreading|mis-knowing)\b/i

/**
 * Decide which of the three styles is the *most useful* visual for this line —
 * we only emit ONE style per beat (the user asked us to stop tripling everything).
 */
export function pickStyleForLine(
  line: string,
  mode: StoryMode = 'story',
  tone: BrollToneHint = 'neutral'
): 'literal' | 'emotional' | 'symbolic' {
  const t = line.replace(/\s+/g, ' ').trim()
  if (!t) return 'literal'

  if (mode === 'journalism') return 'literal'

  let literal = 0
  let emotional = 0
  let symbolic = 0

  if (LITERAL_TOKENS.test(t)) literal += 2
  if (EMOTIONAL_TOKENS.test(t)) emotional += 2
  if (SYMBOLIC_TOKENS.test(t)) symbolic += 2

  if (/\?$/.test(t)) emotional += 1
  if (/(?:^|\s)(maybe|perhaps|sometimes|often|always|never|every|all|nothing)\b/i.test(t))
    symbolic += 1

  if (tone === 'cinematic') {
    emotional += 1
    symbolic += 1
  } else if (tone === 'journalistic') {
    literal += 2
  } else if (tone === 'social' || tone === 'viral') {
    literal += 1
  }

  if (literal === 0 && emotional === 0 && symbolic === 0) return 'literal'
  if (emotional > literal && emotional >= symbolic) return 'emotional'
  if (symbolic > literal && symbolic > emotional) return 'symbolic'
  return 'literal'
}

/* -------------------------------------------------------------------------- */
/*  Line analysis: pull subject / setting / action / emotion from the words   */
/* -------------------------------------------------------------------------- */

interface LineAnalysis {
  /** Cleaned-up, single-sentence form of the line. */
  cleaned: string
  /** "A young Black woman", "a man", … — derived from pronouns/cues. */
  subject: string
  /** "in a dimly lit kitchen", "at a wooden church pew", … */
  setting: string
  /** "rubs her face", "stares at her phone", "paces the room", … */
  action: string
  /** Single dominant feeling word — "anxious", "grief", "hope", … */
  feeling: string | null
  /** Concrete nouns the writer can use as motivated props. */
  props: string[]
  /**
   * True when neither `subject` nor `setting` was matched by a hint table —
   * lets the composer pick a different sentence template (or skip the
   * "subject + setting" opener entirely) so generic narration doesn't all
   * read identically.
   */
  generic: boolean
}

/** Some transcript lines are mid-sentence fragments — trim leading conjunctions. */
function tidyLine(line: string): string {
  let t = line.replace(/\s+/g, ' ').trim()
  t = t.replace(/^(?:and|but|so|because|that|then|cuz|cause|or|like|well|yeah|yo|um|uh)[\s,]+/i, '')
  if (t.length === 0) return line.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const SETTING_HINTS: Array<{ rx: RegExp; setting: string }> = [
  { rx: /\b(church|congregation|pew|sermon|pulpit)\b/i, setting: 'in a quiet sanctuary, late afternoon light through stained glass' },
  { rx: /\b(kitchen|table)\b/i, setting: 'at a worn kitchen table with a single overhead light' },
  { rx: /\b(office|desk|laptop|email|inbox)\b/i, setting: 'at a cluttered desk lit only by a laptop screen' },
  { rx: /\b(car|driving|drive)\b/i, setting: 'inside a parked car at dusk, city lights bleeding through the windshield' },
  { rx: /\b(stage|podcast|microphone|interview)\b/i, setting: 'in a dim studio with a single warm key light' },
  { rx: /\b(school|classroom|teacher|student)\b/i, setting: 'in an empty classroom with afternoon sun across the floor' },
  { rx: /\b(street|sidewalk|city|alley|crowd)\b/i, setting: 'on a wet city street at night, sodium-vapor reflections' },
  { rx: /\b(bedroom|bed|sleep|night)\b/i, setting: 'in a darkened bedroom with one bedside lamp on' },
  { rx: /\b(book|library|read|reading|page|pages)\b/i, setting: 'in a small reading nook, warm practical lamp, dust in the light' },
  { rx: /\b(phone|text|message|messages|call)\b/i, setting: 'in a dim room, the only light coming from a phone screen' },
  { rx: /\b(news|headline|headlines|broadcast|media|feed|feeds|screen)\b/i, setting: 'in a living room lit by a muted screen, the remote resting untouched nearby' },
  { rx: /\b(decision|choice|plan|strategy|future|next step|goal|goals)\b/i, setting: 'at a modest desk before dawn, a notebook open beside a dim laptop' },
  { rx: /\b(pressure|stress|deadline|urgent|urgency|overwhelm|overwhelmed)\b/i, setting: 'in a quiet room after hours, practical light pooling around a small workspace' },
  { rx: /\b(relationship|partner|spouse|husband|wife|love interest)\b/i, setting: 'in a small living room, two figures held in soft window light' }
]

const SUBJECT_HINTS: Array<{ rx: RegExp; subject: string }> = [
  { rx: /\b(daughter|son|kid|kids|child|children)\b/i, subject: 'a parent and child, faces caught in soft window light' },
  { rx: /\b(wife|husband|partner|spouse|love interest)\b/i, subject: 'a couple sitting close, knees almost touching' },
  { rx: /\b(team|teammates|friends|crew|guys|y\u2019all|y'all)\b/i, subject: 'a small tight-knit group, leaned in around a table' },
  { rx: /\b(congregation|audience|crowd)\b/i, subject: 'a crowd of attentive listeners, faces half in shadow' },
  { rx: /\b(she|her|woman|girl|mother|mom|sister)\b/i, subject: 'a woman in her 30s, expression unguarded' },
  { rx: /\b(he|him|man|guy|brother|father|dad)\b/i, subject: 'a man in his 30s, expression focused and grounded' }
]

/**
 * When SUBJECT_HINTS misses (the line has no specific person noun and no cast
 * was provided) we used to emit one of two repetitive defaults — "the speaker
 * in frame…" or "a real-world setting, visible and emotionally readable…" —
 * which made every quantum-computing/business-talk line read the same. Pick
 * from this hash-varied pool instead so the *shape* of the opening clause
 * differs across cards even when the line is generic narration.
 */
const DEFAULT_SUBJECTS: string[] = [
  'a hand resting flat on a worn surface, the rest of the body just out of frame',
  'the back of a head against a window, only a sliver of profile catching the light',
  'two hands wrapped around a ceramic mug, knuckles slightly tense',
  'a single chair pulled up to a table, the person mid-thought rather than mid-speech',
  'a pair of feet in worn shoes pacing a short stretch of floor, never the full body',
  'an open notebook with a pen laid across it, fingers hovering over the next line',
  'a profile silhouetted against a bright window, expression readable only in the shoulders',
  'a person seated at the edge of a couch, elbows on knees, weight forward',
  'a figure framed three-quarters from behind, gaze toward something off-screen',
  'eye-level fragments — a jaw, a thumb, a half-breath — never the whole face at once'
]

/**
 * Same idea for first-person lines ("I think", "we built…"). These read as
 * the narrator without naming a generic "speaker" — they're *physical*
 * fragments instead of metadata about the voice.
 */
const DEFAULT_FIRST_PERSON_SUBJECTS: string[] = [
  'a hand turning a page slowly, the body it belongs to mostly out of frame',
  'fingers tightening once around a glass of water, then releasing',
  'a notebook open on a knee, pen tapping twice before pausing',
  'a half-finished cup of coffee on a desk corner, steam mostly gone',
  'a thumb tracing the edge of a phone case, screen dark',
  'a figure standing at a window, only the shoulders and a sliver of cheek visible',
  'a chair turned slightly away from the table, as if mid-thought',
  'a hand resting on a closed laptop, the room quiet around it'
]

const ACTION_HINTS: Array<{ rx: RegExp; action: string }> = [
  { rx: /\b(news|headline|headlines|broadcast|media|feed|feeds|screen|fear and urgency)\b/i, action: 'lowering the volume on a loud broadcast, hand lingering on the remote before setting it down' },
  { rx: /\b(decision|choice|choose|choosing|chose|plan|strategy|future|next step|goal|goals)\b/i, action: 'writing a simple plan in a notebook, pausing before underlining one line' },
  { rx: /\b(pressure|stress|deadline|urgent|urgency|overwhelm|overwhelmed)\b/i, action: 'clearing the workspace one object at a time until only the essential page remains' },
  { rx: /\b(read|reading|page|pages|book)\b/i, action: 'turning pages slowly, fingertips tracing the lines' },
  { rx: /\b(write|writing|notebook|pen|journal|wrote|foreword)\b/i, action: 'writing by hand, pen pausing mid-thought' },
  { rx: /\b(cry|crying|tear|tears|sob)\b/i, action: 'a single tear forming, blinked away before it falls' },
  { rx: /\b(laugh|laughing|smile|smiling)\b/i, action: 'the corner of a mouth lifting into a quiet, unguarded smile' },
  { rx: /\b(pray|prayer|kneel|kneeling)\b/i, action: 'hands folded, head lowered, breath held' },
  { rx: /\b(call|phone|text|message|messages)\b/i, action: 'staring at a phone screen, thumb hovering over an unread message' },
  { rx: /\b(walk|walking|pacing|pace)\b/i, action: 'pacing back and forth, never settling' },
  { rx: /\b(stare|staring|look|looking|gaze|gazing)\b/i, action: 'staring into middle distance, the eyes giving nothing away' },
  { rx: /\b(hold|held|hug|embrace|grab|grabbing)\b/i, action: 'two hands meeting, holding longer than they need to' },
  { rx: /\b(work|working|grind|hustle|build|building)\b/i, action: 'hands deep in the work, focused, unbothered by the camera' },
  { rx: /\b(drive|driving|car)\b/i, action: 'gripping the steering wheel a beat too tightly' },
  { rx: /\b(react|reacting|reactive|panic)\b/i, action: 'a sudden small movement — a flinch, a turn — that shows the body deciding before the mind does' },
  { rx: /\b(freeze|frozen|stuck|paralys)\b/i, action: 'completely still, the only motion the rise and fall of breath' },
  { rx: /\b(speak|speaking|saying|told|tell|telling|conversation|talk|talking)\b/i, action: 'leaning in across a small table, voice low enough that we feel the words rather than hear them' },
  { rx: /\b(listen|listening|hear|heard)\b/i, action: 'eyes closed for a beat, taking in what was just said before answering' },
  { rx: /\b(remember|memory|memories|childhood)\b/i, action: 'fingers brushing the edge of an old photograph, eyes elsewhere' },
  { rx: /\b(decision|decide|choose|choosing|chose)\b/i, action: 'standing at a doorway between two rooms, weight shifting slowly between feet' },
  { rx: /\b(love|loved|loving|loves)\b/i, action: 'a hand placed over another hand on a shared armrest, no words exchanged' },
  { rx: /\b(team|crew|friends|guys|y\u2019all|y'all|together)\b/i, action: 'a circle of hands meeting in the middle of a table, then breaking away' },
  { rx: /\b(family|daughter|son|kid|kids|child|children|mother|mom|father|dad)\b/i, action: 'a parent and child sharing a small ordinary moment — a meal, a book, a haircut — both unaware of the camera' },
  { rx: /\b(faith|believe|believing|trust)\b/i, action: 'a hand placed flat against an old wooden surface, holding for a beat longer than expected' },
  { rx: /\b(question|questioning|wonder|wondering|asking)\b/i, action: 'looking up from what they\u2019re doing, the question still living in their face' },
  { rx: /\b(impact|moved|moving|changed|change)\b/i, action: 'a long, even exhale — the body acknowledging something the words can\u2019t' }
]

/**
 * When no `ACTION_HINTS` row matches the line, we use a small rotation of
 * neutral-but-specific micro-actions instead of returning the same default
 * sentence in every card. Indexed deterministically by a hash of the line so
 * regenerating the same beat yields the same action.
 */
const DEFAULT_ACTIONS: string[] = [
  'a small, unforced motion that lets us watch the thought land',
  'a slow turn of the head, eyes catching the light differently for half a second',
  'fingers tightening once around the edge of a chair, then releasing',
  'a long exhale, shoulders dropping a quarter-inch',
  'a half-smile that doesn\u2019t reach the eyes — present, but elsewhere',
  'looking away, then back, the way people do when a thought is rearranging itself',
  'one hand finding the other across a tabletop, holding for a beat',
  'a slight nod, more to themselves than to anyone in the room'
]

/**
 * Pool of concrete, lived-in settings used when no `SETTING_HINTS` row
 * matches. Replaces the single fallback "in a specific lived-in location with
 * visible practical light sources" that used to duplicate across every card
 * with a generic transcript.
 */
const DEFAULT_SETTINGS: string[] = [
  'in a small home office at the end of the day, one desk lamp doing all the work',
  'on a kitchen counter at dawn, daylight just starting to climb the wall',
  'in a corner of a coffee shop after the rush, chairs upturned in the background',
  'in the back of a parked rideshare, city lights smearing past the window',
  'on a balcony at dusk, the building across the way going dark window by window',
  'in a hallway between two rooms, light spilling under a closed door',
  'in a quiet conference room after everyone else has gone, blinds half drawn',
  'in a bedroom with the bed unmade, late afternoon light pooling on the floor',
  'on a stoop after a long walk, the day cooling down around them',
  'in a small studio apartment, every object close enough to touch'
]

/** Tiny stable string hash for picking varied defaults across cards. */
function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

const FEELING_HINTS: Array<{ rx: RegExp; feeling: string }> = [
  { rx: /\b(fear|afraid|scared|terrif)\b/i, feeling: 'fear' },
  { rx: /\b(anxi|panic|stress|overwhelm)\b/i, feeling: 'anxiety' },
  { rx: /\b(grief|grieve|grieving|mourn|loss)\b/i, feeling: 'grief' },
  { rx: /\b(love|cherish|tender)\b/i, feeling: 'love' },
  { rx: /\b(hope|hopeful)\b/i, feeling: 'hope' },
  { rx: /\b(anger|angry|rage|furious)\b/i, feeling: 'anger' },
  { rx: /\b(joy|joyful|delight|happy|happiness)\b/i, feeling: 'joy' },
  { rx: /\b(peace|calm|stillness)\b/i, feeling: 'peace' },
  { rx: /\b(lonel|alone)\b/i, feeling: 'loneliness' },
  { rx: /\b(brave|bold|courage)\b/i, feeling: 'courage' },
  { rx: /\b(weary|exhausted|tired|burned out|burnt out)\b/i, feeling: 'exhaustion' },
  { rx: /\b(forgive|forgiveness|surrender|let go)\b/i, feeling: 'release' },
  { rx: /\b(uncertain|confus|misknow|mis-knowing|misread)\b/i, feeling: 'uncertainty' }
]

const PROP_NOUNS = [
  'phone', 'book', 'page', 'notebook', 'pen', 'cup', 'coffee', 'tea',
  'photograph', 'photo', 'letter', 'envelope', 'bills', 'keys', 'ring',
  'mirror', 'window', 'door', 'chair', 'bed', 'lamp', 'candle', 'document',
  'documents', 'calendar', 'map', 'list', 'notes'
]

function findFirstMatch<T>(text: string, table: Array<{ rx: RegExp; value: T }>): T | null {
  for (const row of table) if (row.rx.test(text)) return row.value
  return null
}

function analyzeLine(rawLine: string, subjectProfile?: SubjectProfile): LineAnalysis {
  const cleaned = tidyLine(rawLine)
  const lower = cleaned.toLowerCase()
  const seed = hashString(cleaned)

  /**
   * Visibility hard-overrides everything else: when the user said "no
   * visible people" or "hands only", the subject clause never names a
   * person regardless of what the line implies.
   */
  const visibility = subjectProfile?.visibility ?? 'standard'
  const cast = subjectProfile ? castDescription(subjectProfile) : ''
  const matchedSubject = findFirstMatch(
    cleaned,
    SUBJECT_HINTS.map((h) => ({ rx: h.rx, value: h.subject }))
  )
  const isFirstPerson = /\b(I|me|my|mine|myself|we|us|our|ours)\b/.test(cleaned)

  let subject: string
  let subjectIsGeneric = false
  if (visibility === 'no_visible_people') {
    subject = 'no person on screen — environment, objects, or texture only'
  } else if (visibility === 'hands_only') {
    subject = 'a single pair of hands working in frame, no face visible'
  } else if (cast) {
    /**
     * When the user gave us a cast, use it as the on-screen identity.
     * The line still picks the framing (couple, group, alone) via
     * SUBJECT_HINTS — we just swap the demographic words.
     */
    if (matchedSubject?.includes('couple')) {
      subject = `a couple — one ${cast} and one partner — sitting close, knees almost touching`
    } else if (
      matchedSubject?.includes('parent and child') ||
      matchedSubject?.includes('crowd') ||
      matchedSubject?.includes('group')
    ) {
      // Group framings keep the line's framing but anchor on the user's cast.
      subject = `${matchedSubject}, anchored on ${cast}`
    } else {
      subject = `${cast}, framed alone in the shot`
    }
  } else if (matchedSubject) {
    subject = matchedSubject
  } else if (isFirstPerson) {
    // Vary across cards via the line hash so eight first-person beats don't
    // all open with the same "the speaker in frame…" default.
    subject = DEFAULT_FIRST_PERSON_SUBJECTS[seed % DEFAULT_FIRST_PERSON_SUBJECTS.length]!
    subjectIsGeneric = true
  } else {
    subject = DEFAULT_SUBJECTS[seed % DEFAULT_SUBJECTS.length]!
    subjectIsGeneric = true
  }

  const matchedSetting = findFirstMatch(
    cleaned,
    SETTING_HINTS.map((h) => ({ rx: h.rx, value: h.setting }))
  )
  const setting =
    matchedSetting ?? DEFAULT_SETTINGS[(seed >> 3) % DEFAULT_SETTINGS.length]!
  const settingIsGeneric = !matchedSetting

  const matchedAction = findFirstMatch(
    cleaned,
    ACTION_HINTS.map((h) => ({ rx: h.rx, value: h.action }))
  )
  // Vary the default across cards so 8 default-action cards don't read identically.
  const action = matchedAction ?? DEFAULT_ACTIONS[seed % DEFAULT_ACTIONS.length]!

  const feeling = findFirstMatch(
    cleaned,
    FEELING_HINTS.map((h) => ({ rx: h.rx, value: h.feeling }))
  )

  const props = PROP_NOUNS.filter((p) => lower.includes(p))

  return {
    cleaned,
    subject,
    setting,
    action,
    feeling,
    props,
    generic: subjectIsGeneric && settingIsGeneric
  }
}

/* -------------------------------------------------------------------------- */
/*  Style direction (lighting / lens / cadence) per chosen style              */
/* -------------------------------------------------------------------------- */

interface StyleDirection {
  lighting: string
  lens: string
  movement: string
  styleNote: string
}

function pickVariant<T>(items: readonly T[], seed: string, offset = 0): T {
  return items[(hashString(seed) + offset) % items.length]!
}

/**
 * Per-pack style pools. Each entry returns lighting / lens / movement /
 * styleNote arrays that the variant picker draws from. The arrays are
 * intentionally distinct across packs so switching the prompt pack from
 * `cinematic_documentary` to `viral_social` produces visibly different
 * shots even when the line, mode, and tone are identical.
 *
 * `null` means "use tone-based defaults" (the original behavior). The
 * `journalism` pack still goes through the locked-down journalistic branch
 * below for safety.
 */
type StylePools = {
  lighting: readonly string[]
  lens: readonly string[]
  movement: readonly string[]
  styleNote: readonly string[]
}

function packPools(
  packId: PromptPackId | undefined,
  style: 'literal' | 'emotional' | 'symbolic'
): StylePools | null {
  if (!packId) return null

  if (packId === 'cinematic_documentary') {
    if (style === 'literal') {
      return {
        lighting: [
          'late-day window light with motivated practical lamp, shadows allowed to breathe',
          'one warm desk lamp doing the heavy lifting, the rest of the room falling into honest dark',
          'cool screen glow on the face with a warm practical kept in frame',
          'overcast daylight filtered through sheer curtains, neutral grade'
        ],
        lens: [
          '35mm motivated framing, environment readable',
          '40mm at near-distance, the subject and the room sharing focus',
          '50mm at mid-distance, observational rather than intrusive',
          '85mm tight portrait when emotion peaks, otherwise resting wider'
        ],
        movement: [
          'slow push-in over the full take, almost imperceptible',
          'static frame, one motivated rack focus during the shot',
          'a small dolly drift that follows where attention goes',
          'subtle handheld breath, never calling attention to itself'
        ],
        styleNote: [
          'observational documentary realism, environment carrying the stakes',
          'photoreal scene-storytelling, props doing real narrative work',
          'lived-in moment captured at human scale',
          'narrative-cinema grain — specific, motivated, never staged-looking'
        ]
      }
    }
    if (style === 'emotional') {
      return {
        lighting: [
          'warm key with cool ambient fill, one side of the face into shadow',
          'late-day side light, gentle contrast, shadows allowed to breathe',
          'soft window light broken by blinds, background practicals dim',
          'cool screen light on the hands with a warm practical behind'
        ],
        lens: [
          '50mm wide open, focus slipping between eyes and hands',
          '85mm detail study, hands and breath doing the storytelling',
          '40mm intimate environmental portrait, background softly alive',
          '65mm close portrait compression, shallow but readable'
        ],
        movement: [
          'slow handheld drift with tiny reframes',
          'static frame, one controlled rack focus',
          'barely perceptible push-in over the full shot',
          'gentle over-the-shoulder float, no cutaways'
        ],
        styleNote: [
          'documentary intimacy, restrained and unperformed',
          'feeling-first realism with specific environmental detail',
          'private emotional beat grounded in real context',
          'interior tension carried by expression, objects, and light'
        ]
      }
    }
    return {
      lighting: [
        'late sun breaking through haze, edges flaring softly',
        'cool dawn light with long shadows and visible atmosphere',
        'rain-streaked practical light, reflections carrying the emotion',
        'high-contrast natural light, weather acting like a character'
      ],
      lens: [
        'anamorphic-feel 40mm, slight flare allowed',
        '50mm macro detail, texture larger than the object',
        '24mm wide frame, negative space doing the work',
        '35mm with soft halation and imperfect edges'
      ],
      movement: [
        'slow dolly drift, scale matters more than subject',
        'locked frame with weather or light providing motion',
        'slow overhead move, abstracting the space into pattern',
        'gentle sideways move past foreground texture'
      ],
      styleNote: [
        'metaphorical and poetic, texture and rhythm over literal illustration',
        'symbolic but grounded in real-world materials',
        'environment-as-emotion, no faces needed',
        'quiet visual metaphor, restrained and photoreal'
      ]
    }
  }

  if (packId === 'viral_social') {
    return {
      lighting: [
        'bold high-contrast key with one saturated practical, readable on a phone screen',
        'punchy ring-light feel with a colored gel rim, energy popping off the subject',
        'golden-hour sun directly on the subject, warm halation around the edges',
        'window light kicked up by a bounce card, cleanly readable, no muddy mids'
      ],
      lens: [
        '24mm wide-angle, subject filling the lower third with environment popping behind',
        '35mm close-medium with snappy depth, every detail crisp',
        'POV-style 18mm with motivated handheld energy',
        '50mm tight on the reaction, background falling away fast'
      ],
      movement: [
        'quick whip-pan into the subject, then a beat of stillness on the reaction',
        'snap push-in on the punch moment, then hold',
        'steadicam orbit a quarter of the way around the subject, ending on the reveal',
        'fast rack focus from foreground prop to subject reaction'
      ],
      styleNote: [
        'hook-forward readable beat, immediate visual payoff',
        'social-native energy: setup, payoff, and reaction in one shot',
        'punchy editorial polish, designed to reward a rewatch',
        'crisp consumer-cinema look — saturated, sharp, never sleepy'
      ]
    }
  }

  if (packId === 'podcast_premium') {
    return {
      lighting: [
        'soft warm key with a cool rim, microphone catching one specular highlight',
        'practical desk lamp glow on the face, bookshelf bokeh going warm in the back',
        'mixed daylight + warm tungsten practical, comfortable and intentional',
        'subtle key-fill-back three-point lift, never clinical, always inviting'
      ],
      lens: [
        '50mm two-shot at the table, conversation framed cleanly',
        '85mm medium close-up on the listener, rack focus living between speakers',
        '35mm parallax wide showing the studio context, mic visible in frame',
        '65mm portrait of the host alone, bookshelf or art softly behind'
      ],
      movement: [
        'subtle parallax drift across the table, pace matching the conversation',
        'static frame with a single rack focus between two speakers',
        'gentle handheld float that follows speaker change without cutting',
        'slow reframe from wide two-shot to medium single as the point lands'
      ],
      styleNote: [
        'intimate conversational authority, warm and unhurried',
        'editorial podcast polish — books, gear, and ideas all visible',
        'shot-reverse-shot energy without cutting, single take rhythm',
        'thoughtful interview craft, never glossy, never raw'
      ]
    }
  }

  if (packId === 'journalism') {
    return {
      lighting: [
        'available light documented as-is, fluorescent or window, no augmentation',
        'streetlight at night with practical signage glowing in the background',
        'overcast daylight on real exteriors, neutral and unflattering when honest',
        'office fluorescents and a desk lamp, captured exactly as they are'
      ],
      lens: [
        '35mm prime, eye-level field-coverage framing',
        '28mm wide for context, identifying signage in frame',
        '50mm interview prime, locked tripod at honest eye-line',
        '85mm follow lens for handheld walk-and-talk'
      ],
      movement: [
        'locked tripod for interviews, no camera tricks',
        'steady handheld follow, motivated by the subject moving',
        'static establishing wide, then a single push to medium',
        'observational pan that watches what the subject watches'
      ],
      styleNote: [
        'editorial documentary realism, no melodrama',
        'field-coverage truth, evidence visible, stakes clear',
        'reporter-grade observational coverage, environment as context',
        'newsroom-honest framing — neutral, factual, human-scale'
      ]
    }
  }

  if (packId === 'motivational') {
    return {
      lighting: [
        'sunrise gradient through a window, light breaking across the subject',
        'golden-hour low sun with long shadows and visible atmosphere',
        'pre-dawn cool blue resolving into a warm key as the shot progresses',
        'gym or workshop practicals catching sweat and effort, visible texture'
      ],
      lens: [
        '24mm low-angle hero framing, subject empowered against the sky',
        '35mm walking medium, momentum in every step',
        '50mm push-in on determined eyes, environment dropping into bokeh',
        '85mm long-lens compression of the subject moving toward the camera'
      ],
      movement: [
        'slow rise from a low angle as the subject straightens up',
        'forward-tracking dolly matching the subject\u2019s pace',
        'pull-back reveal of the journey already covered',
        'building push-in that accelerates as the moment lands'
      ],
      styleNote: [
        'aspirational, forward-moving, earned emotion never staged',
        'transformation narrative grounded in visible effort',
        'light as metaphor: breaking through, rising up, opening out',
        'commercial-cinema polish with documentary honesty'
      ]
    }
  }

  return null
}

function styleDirection(
  style: 'literal' | 'emotional' | 'symbolic',
  tone: BrollToneHint,
  mode: StoryMode,
  seed: string,
  packId?: PromptPackId
): StyleDirection {
  const pools = packPools(packId, style)
  if (pools) {
    return {
      lighting: pickVariant(pools.lighting, seed),
      lens: pickVariant(pools.lens, seed, 7),
      movement: pickVariant(pools.movement, seed, 13),
      styleNote: pickVariant(pools.styleNote, seed, 19)
    }
  }

  const cinematic = tone === 'cinematic' || mode === 'creator'
  const journalistic = tone === 'journalistic' || mode === 'journalism'

  if (journalistic) {
    return {
      lighting: 'available light, neutral grade',
      lens: '35mm prime, eye-level',
      movement: 'locked tripod or subtle handheld',
      styleNote: 'editorial documentary realism, no melodrama'
    }
  }

  if (style === 'literal') {
    return {
      lighting: cinematic
        ? pickVariant(
            [
              'motivated practicals with a soft key and gentle falloff',
              'warm table-lamp practicals with a cool spill from the screen',
              'low morning window light, practical lamp kept in frame'
            ],
            seed
          )
        : pickVariant(
            [
              'window light plus one practical, naturalistic',
              'available daylight softened by curtains',
              'one practical lamp, honest shadows, neutral grade'
            ],
            seed
          ),
      lens: pickVariant(['35mm, shallow depth of field', '40mm, close but not intimate', '28mm, wider environmental framing'], seed, 7),
      movement: pickVariant(
        [
          'slow push-in, almost no camera motion',
          'locked frame with one gentle rack focus',
          'small lateral slider move, patient and restrained'
        ],
        seed,
        13
      ),
      styleNote: pickVariant(
        [
          'photoreal and observational, the moment enough on its own',
          'quiet documentary realism, no stock-photo posing',
          'editorial and grounded, ordinary objects carrying the meaning'
        ],
        seed,
        19
      )
    }
  }

  if (style === 'emotional') {
    return {
      lighting: pickVariant(
        [
          'warm key with cool ambient fill, one side falling into shadow',
          'soft window light broken by blinds, background practicals dim',
          'cool screen light on the hands with a warm practical behind',
          'late-day side light, gentle contrast, shadows allowed to breathe'
        ],
        seed
      ),
      lens: pickVariant(
        [
          '50mm, wide open, focus slipping between eyes and hands',
          '65mm close portrait compression, shallow but readable',
          '40mm intimate environmental portrait, background softly alive',
          '85mm detail study, hands and breath doing the storytelling'
        ],
        seed,
        7
      ),
      movement: pickVariant(
        [
          'slow handheld drift with tiny reframes',
          'static frame, one controlled rack focus',
          'barely perceptible push-in over the full shot',
          'gentle over-the-shoulder float, no cutaways'
        ],
        seed,
        13
      ),
      styleNote: pickVariant(
        [
          'documentary intimacy with visible human stakes',
          'private emotional beat grounded in real context',
          'feeling-first realism with specific environmental detail',
          'interior tension carried by expression, objects, and light'
        ],
        seed,
        19
      )
    }
  }

  return {
    lighting: pickVariant(
      [
        'high-contrast natural light, weather acting like a character',
        'late sun breaking through haze, edges flaring softly',
        'cool dawn light with long shadows and visible atmosphere',
        'rain-streaked practical light, reflections carrying the emotion'
      ],
      seed
    ),
    lens: pickVariant(
      [
        'anamorphic-feel 40mm, slight flare allowed',
        '50mm macro detail, texture larger than the object',
        '24mm wide frame, negative space doing the work',
        '35mm with soft halation and imperfect edges'
      ],
      seed,
      7
    ),
    movement: pickVariant(
      [
        'slow dolly drift, scale matters more than subject',
        'locked frame with weather or light providing motion',
        'slow overhead move, abstracting the space into pattern',
        'gentle sideways move past foreground texture'
      ],
      seed,
      13
    ),
    styleNote: pickVariant(
      [
        'metaphorical and poetic, texture and rhythm over literal illustration',
        'symbolic but grounded in real-world materials',
        'environment-as-emotion, no faces needed',
        'quiet visual metaphor, restrained and photoreal'
      ],
      seed,
      19
    )
  }
}

/* -------------------------------------------------------------------------- */
/*  Compose the actual prompt sentence                                        */
/* -------------------------------------------------------------------------- */

function feelingClause(feeling: string | null): string {
  if (!feeling) return ''
  return `, the room reading as ${feeling}`
}

function propsClause(props: string[]): string {
  if (props.length === 0) return ''
  if (props.length === 1) return `, ${props[0]} present in frame as motivated detail`
  return `, ${props.slice(0, 2).join(' and ')} present in frame as motivated detail`
}

/**
 * Pool of abstract environments used as the symbolic-style opener when the
 * line gave us no real setting hint (or the matched setting was itself a
 * generic fallback). Decoupled from the old single fallback string so that
 * adding new DEFAULT_SETTINGS doesn't require touching this list.
 */
const ABSTRACT_SYMBOLIC_OPENERS: string[] = [
  'a real room reduced to light, shadow, and geometric pattern',
  'a textured interior where reflections and negative space carry the idea',
  'an ordinary space abstracted through contrast, atmosphere, and scale',
  'a lived-in environment rendered as rhythm, shape, and material detail',
  'an empty corridor where the light shifts a degree at a time',
  'a single window pane fogged from the inside, the world beyond softened',
  'a still surface — water in a glass, a tabletop, a mirror — catching one edge of the room',
  'the underside of an everyday object made strange by close framing'
]

function symbolicEnvironment(setting: string, seed: string): string {
  const place = setting
    .replace(/^(?:in|at|on|inside)\s+/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .trim()
  // When the setting came from DEFAULT_SETTINGS we can detect it heuristically
  // — the matched SETTING_HINTS entries always start with "in/at/on" + a
  // concrete noun like "kitchen", "office", "studio". If we instead see one
  // of the long lived-in fallback fragments (or no place at all), pick from
  // the abstract pool so the symbolic shot doesn't read as a literal one.
  const isGenericFallback =
    !place ||
    place === 'specific lived-in location with visible practical light sources' ||
    DEFAULT_SETTINGS.some((s) => setting === s)
  if (isGenericFallback) {
    return pickVariant(ABSTRACT_SYMBOLIC_OPENERS, seed, 31)
  }
  return `${place} rendered as texture, shadow, and scale`
}

/**
 * Compose the editorial / Runway / Kling shot for a beat.
 *
 * Sentence-structure variety is the whole point: rather than a single template
 * for each style, we keep a small pool of templates and pick one by hash. Two
 * cards with the same elements (subject / setting / action / lighting / lens
 * / movement / styleNote) will read with a different *shape* — opening on the
 * action, opening on the setting, leading with lighting, etc. The "Emotion is
 * visible…" hardcoded filler that used to repeat across every emotional card
 * has been removed entirely.
 */

interface ShotIngredients {
  subject: string
  setting: string
  /** "in a kitchen…" → "the kitchen…" so it can lead a sentence. */
  settingNoLead: string
  action: string
  feeling: string
  props: string
  lighting: string
  lens: string
  movement: string
  styleNote: string
  direction: string
  durLong: string
  durShort: string
  generic: boolean
  isFirstPerson: boolean
}

/** Strip the leading "in/at/on/inside [a|an|the] " so the setting can begin a sentence. */
function dropLeadingPreposition(setting: string): string {
  return setting.replace(/^(?:in|at|on|inside)\s+(?:a|an|the)\s+/i, '')
}

type ShotTemplate = (ing: ShotIngredients) => string

const LITERAL_PRIMARY_TEMPLATES: ShotTemplate[] = [
  (i) =>
    `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ` +
    `Lighting: ${i.lighting}. Lens: ${i.lens}. Camera: ${i.movement}. ` +
    `Style: ${i.styleNote}${i.direction}. ${i.durLong}, single continuous take, photoreal, no on-screen text.`,
  (i) =>
    `Open on ${i.subject}, ${i.action}${i.feeling}${i.props}. The space — ${i.settingNoLead} — does as much work as the subject. ` +
    `${i.lighting}; ${i.lens}; ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, photoreal, single take, no text.`,
  (i) =>
    `${i.settingNoLead.charAt(0).toUpperCase() + i.settingNoLead.slice(1)}. Inside it: ${i.subject}, ${i.action}${i.feeling}${i.props}. ` +
    `${i.lighting}. ${i.lens}. ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, photoreal, no text.`,
  (i) =>
    `${i.action}${i.feeling}${i.props} — ${i.subject}, ${i.setting}. ` +
    `Captured with ${i.lens.toLowerCase()}, ${i.lighting.toLowerCase()}, ${i.movement.toLowerCase()}. ${i.styleNote}${i.direction}. ${i.durLong}, photoreal, no text.`
]

const EMOTIONAL_PRIMARY_TEMPLATES: ShotTemplate[] = [
  (i) =>
    `${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ` +
    `The shot trusts posture, breath, and the light to do the work — no performed reaction. ` +
    `${i.lighting}. ${i.lens}. ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, one breath, no cuts, no text.`,
  (i) =>
    `${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. We hold on ${i.subject}, ${i.setting}. ` +
    `${i.lighting}. ${i.lens}. ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, single continuous take, no text.`,
  (i) =>
    `Inside ${i.settingNoLead}: ${i.subject}, the camera close enough to read the smallest changes. ${i.action}${i.feeling}${i.props}. ` +
    `${i.lighting}; ${i.lens}; ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, no cuts, no text.`,
  (i) =>
    `A held moment — ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ` +
    `Read in the body, not the dialogue. ${i.lighting}, ${i.lens}, ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, one continuous take, no text.`,
  (i) =>
    `${i.subject}, ${i.action}${i.feeling}${i.props}, ${i.setting}. ` +
    `${i.lighting} carries the weight; ${i.lens} keeps it personal; ${i.movement} keeps it honest. ${i.styleNote}${i.direction}. ${i.durLong}, no cuts, no text.`
]

const SYMBOLIC_PRIMARY_TEMPLATES: ShotTemplate[] = [
  (i) =>
    `${i.subject} — held as metaphor more than literal subject${i.feeling}. ${i.settingNoLead}. ` +
    `${i.lighting}. ${i.lens}. ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, one slow continuous gesture, no faces, no text.`,
  (i) =>
    `${i.lighting.charAt(0).toUpperCase() + i.lighting.slice(1)}. ${i.subject}${i.feeling}, the rest of the frame negative space. ` +
    `${i.lens}. ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, no text.`,
  (i) =>
    `Pure environment beat: ${i.settingNoLead}, ${i.subject} reduced to texture and silhouette${i.feeling}. ` +
    `${i.lighting}; ${i.lens}; ${i.movement}. ${i.styleNote}${i.direction}. ${i.durLong}, no faces, no text.`,
  (i) =>
    `${i.movement.charAt(0).toUpperCase() + i.movement.slice(1)} across ${i.subject}, ${i.settingNoLead}${i.feeling}. ` +
    `${i.lighting}. ${i.lens}. ${i.styleNote}${i.direction}. ${i.durLong}, single poetic shot, no text.`
]

const LITERAL_RUNWAY_TEMPLATES: ShotTemplate[] = [
  (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}. ${i.styleNote}. ${i.durShort}, photoreal, no text.`,
  (i) => `${i.action.charAt(0).toUpperCase() + i.action.slice(1)} — ${i.subject}, ${i.setting}${i.feeling}${i.props}. ${i.lighting}; ${i.lens}; ${i.movement}. ${i.durShort}, photoreal, no text.`,
  (i) => `${i.settingNoLead.charAt(0).toUpperCase() + i.settingNoLead.slice(1)}: ${i.subject}, ${i.action}${i.feeling}${i.props}. ${i.lighting}. ${i.lens}. ${i.movement}. ${i.durShort}, no text.`
]

const EMOTIONAL_RUNWAY_TEMPLATES: ShotTemplate[] = [
  (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}. ${i.styleNote}. ${i.durShort}, one continuous shot, no text.`,
  (i) => `${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.subject}, ${i.setting}. ${i.lighting}; ${i.lens}; ${i.movement}. ${i.durShort}, single take, no text.`,
  (i) => `Inside ${i.settingNoLead}: ${i.subject}, ${i.action}${i.feeling}${i.props}. ${i.lighting}. ${i.lens}. ${i.movement}. ${i.durShort}, no cuts, no text.`,
  (i) => `${i.subject}, the room ${dropLeadingPreposition(i.setting).replace(/^the\s+/i, '')}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}. ${i.durShort}, single take, no text.`
]

const SYMBOLIC_RUNWAY_TEMPLATES: ShotTemplate[] = [
  (i) => `${i.subject}, abstracted but photoreal${i.feeling}. ${i.lighting}. ${i.lens}. ${i.movement}. ${i.styleNote}. ${i.durShort}, single poetic shot, no text.`,
  (i) => `${i.lighting.charAt(0).toUpperCase() + i.lighting.slice(1)}. ${i.subject}${i.feeling}, ${i.settingNoLead}. ${i.lens}, ${i.movement}. ${i.durShort}, no faces, no text.`,
  (i) => `${i.movement.charAt(0).toUpperCase() + i.movement.slice(1)} — ${i.subject}, ${i.settingNoLead}${i.feeling}. ${i.lighting}, ${i.lens}. ${i.durShort}, no text.`
]

function pickTemplate(templates: ShotTemplate[], seed: string, offset: number): ShotTemplate {
  return templates[(hashString(seed) + offset) % templates.length]!
}

/* -------------------------------------------------------------------------- */
/*  Pack-distinctive shot templates                                           */
/*                                                                            */
/*  Each pack has its own structural formula and signature trailing tags so   */
/*  switching packs produces visibly different prompts — not just different   */
/*  word choices in the same skeleton. Modeled on the user-supplied example   */
/*  outputs (Cinematic Documentary / Viral Social / Podcast Premium /         */
/*  Journalism / Motivational).                                               */
/* -------------------------------------------------------------------------- */

const PACK_PRIMARY_TEMPLATES: Record<PromptPackId, ShotTemplate[]> = {
  cinematic_documentary: [
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, cinematic shadows, ${i.movement}, ${i.lens}, Antoine Fuqua style, shallow depth of field, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.lighting}, realistic environment, ${i.movement}, ${i.lens}, cinematic realism, Antoine Fuqua inspired visual storytelling, ${i.durLong}.`,
    (i) =>
      `Close-up: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, dramatic shadows, ${i.lens}, ${i.movement}. Cinematic realism, Antoine Fuqua style, high contrast lighting, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, emotional tension, cinematic realism, Antoine Fuqua visual style, ${i.durLong}.`
  ],
  viral_social: [
    (i) =>
      `A vertical cinematic social clip of ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, TikTok-style realism, Antoine Fuqua energy, emotionally raw, ${i.durLong}.`,
    (i) =>
      `Vertical social-media cinematic: ${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. Quick beat-sync energy, ${i.lighting}, ${i.lens}, ${i.movement}, hook-forward visual storytelling, social-native pacing, ${i.durLong}.`,
    (i) =>
      `Vertical clip: ${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. Strong first-second hook, ${i.lighting}, ${i.lens}, ${i.movement}, social-media cinematic realism, Antoine Fuqua energy, ${i.durLong}.`,
    (i) =>
      `Vertical cinematic reel: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, quick visual irony in frame, TikTok-aesthetic realism, emotionally punchy, ${i.durLong}.`
  ],
  podcast_premium: [
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, premium podcast documentary aesthetic, polished cinematic realism, ${i.durLong}.`,
    (i) =>
      `Premium podcast visual: ${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.lighting}, elegant framing, ${i.lens}, ${i.movement}, luxury documentary aesthetic, emotionally restrained storytelling, ${i.durLong}.`,
    (i) =>
      `${i.subject} in a tastefully designed space ${i.setting.replace(/^in /, '— ').replace(/^at /, '— ').replace(/^on /, '— ')}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, premium YouTube finance documentary aesthetic, ${i.durLong}.`,
    (i) =>
      `Modern luxury setting: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.movement}, ${i.lens}, premium podcast trailer aesthetic, polished cinematic shadows, ${i.durLong}.`
  ],
  journalism: [
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, observational documentary cinematography, investigative journalism aesthetic, ${i.durLong}.`,
    (i) =>
      `Documentary footage: ${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.lighting}, realistic environment, ${i.lens}, ${i.movement}, investigative newsroom realism, no melodrama, ${i.durLong}.`,
    (i) =>
      `Field-coverage shot: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, authentic detail in frame, ${i.lens}, ${i.movement}, investigative documentary aesthetic, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting} — ${i.action}${i.feeling}${i.props}. Captured handheld, ${i.lighting}, ${i.lens}, ${i.movement}, grounded documentary realism, investigative journalism tone, ${i.durLong}.`
  ],
  motivational: [
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, transformation energy, inspirational documentary aesthetic, Antoine Fuqua visual style, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, emotionally uplifting transformation moment, premium motivational commercial aesthetic, ${i.durLong}.`,
    (i) =>
      `Transformation beat: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, earned emotion never staged, inspirational realism, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, light as metaphor — breaking through, rising up, cinematic transformation energy, ${i.durLong}.`
  ],
  music_video: [
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, dramatic color grading, ${i.movement}, ${i.lens}, music video aesthetic, kinetic energy, ${i.durLong}.`,
    (i) =>
      `Music video beat: ${i.subject} ${i.setting}. ${i.action.charAt(0).toUpperCase() + i.action.slice(1)}${i.feeling}${i.props}. ${i.lighting}, bold rim light, ${i.lens}, ${i.movement}, visceral emotional impact, stylized high-contrast, ${i.durLong}.`,
    (i) =>
      `Slow-motion: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, speed ramp on beat hit, music video visual language, ${i.durLong}.`,
    (i) =>
      `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, silhouette against color wash, music video energy, cuts on the beat, ${i.durLong}.`
  ]
}

const PACK_RUNWAY_TEMPLATES: Record<PromptPackId, ShotTemplate[]> = {
  cinematic_documentary: [
    (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, cinematic shadows, ${i.movement}, ${i.lens}, Antoine Fuqua style, shallow depth of field, ${i.durShort}.`,
    (i) => `${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, cinematic realism, Antoine Fuqua inspired, ${i.durShort}.`,
    (i) => `Close-up of ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, high contrast lighting, cinematic realism, ${i.durShort}.`
  ],
  viral_social: [
    (i) => `Vertical social clip: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, TikTok-style realism, Antoine Fuqua energy, ${i.durShort}.`,
    (i) => `Vertical reel — ${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, beat-sync social pacing, emotionally raw, ${i.durShort}.`,
    (i) => `Vertical hook shot: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, social-native cinematic realism, ${i.durShort}.`
  ],
  podcast_premium: [
    (i) => `Premium podcast visual: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, premium podcast documentary aesthetic, ${i.durShort}.`,
    (i) => `${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, luxury documentary aesthetic, polished cinematic realism, ${i.durShort}.`,
    (i) => `Modern luxury frame — ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, premium podcast trailer aesthetic, ${i.durShort}.`
  ],
  journalism: [
    (i) => `Documentary footage: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, investigative documentary aesthetic, ${i.durShort}.`,
    (i) => `Field shot — ${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, observational realism, ${i.durShort}.`,
    (i) => `Newsroom-doc beat: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, investigative journalism tone, ${i.durShort}.`
  ],
  motivational: [
    (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.movement}, ${i.lens}, transformation energy, inspirational realism, ${i.durShort}.`,
    (i) => `Transformation beat — ${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, ${i.lens}, ${i.movement}, Antoine Fuqua visual style, ${i.durShort}.`,
    (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, premium motivational commercial aesthetic, earned emotion, ${i.durShort}.`
  ],
  music_video: [
    (i) => `${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, dramatic color grading, ${i.movement}, ${i.lens}, music video aesthetic, kinetic beat-sync, ${i.durShort}.`,
    (i) => `Beat cut: ${i.subject} ${i.setting}. ${i.action}${i.feeling}${i.props}. ${i.lighting}, bold rim light, ${i.lens}, ${i.movement}, music video visual language, ${i.durShort}.`,
    (i) => `Slow-mo beat: ${i.subject} ${i.setting}, ${i.action}${i.feeling}${i.props}, ${i.lighting}, ${i.lens}, ${i.movement}, speed ramp on impact, stylized color, ${i.durShort}.`
  ]
}

function composeShot(
  analysis: LineAnalysis,
  style: 'literal' | 'emotional' | 'symbolic',
  tone: BrollToneHint,
  mode: StoryMode,
  directionText: string | undefined,
  shotDurationSeconds: number,
  packId?: PromptPackId
): { primary: string; runway: string; kling: string } {
  // Including the packId in the seed means switching the prompt pack also
  // re-rolls subject/setting variants where applicable, so the visible
  // delta between packs is wider than just the lighting / lens fields.
  const seed = `${analysis.cleaned}|${style}|${tone}|${mode}|${packId ?? 'default'}`
  const dir = styleDirection(style, tone, mode, seed, packId)
  const direction = directionText?.trim() ? `, in keeping with: "${directionText.trim().slice(0, 80)}"` : ''
  const feeling = feelingClause(analysis.feeling)
  const props = propsClause(analysis.props)
  const dur = shotDurationSeconds

  const symbolicSubject =
    style === 'symbolic' ? symbolicEnvironment(analysis.setting, seed) : analysis.subject

  const ing: ShotIngredients = {
    subject: symbolicSubject,
    setting: analysis.setting,
    settingNoLead: dropLeadingPreposition(analysis.setting),
    action: analysis.action,
    feeling,
    props,
    lighting: dir.lighting,
    lens: dir.lens,
    movement: dir.movement,
    styleNote: dir.styleNote,
    direction,
    durLong: `${dur} seconds`,
    durShort: `${dur}s`,
    generic: analysis.generic,
    isFirstPerson: /\b(I|me|my|mine|myself|we|us|our|ours)\b/.test(analysis.cleaned)
  }

  // When a prompt pack is active, use its distinctive templates so the
  // structural fingerprint (e.g. "Antoine Fuqua style, shallow depth of
  // field, 8 seconds" vs "TikTok-style realism, emotionally raw, 8 seconds"
  // vs "premium podcast documentary aesthetic, 8 seconds") differs across
  // packs — not just word choices in a shared skeleton.
  if (packId && PACK_PRIMARY_TEMPLATES[packId] && PACK_RUNWAY_TEMPLATES[packId]) {
    return {
      primary: pickTemplate(PACK_PRIMARY_TEMPLATES[packId], seed, 0)(ing),
      runway: pickTemplate(PACK_RUNWAY_TEMPLATES[packId], seed, 5)(ing),
      kling:
        `[${packId}] Subject: ${ing.subject}. Setting: ${ing.setting}. Action: ${ing.action}${ing.feeling}. ` +
        `Lighting: ${ing.lighting}. Lens: ${ing.lens}. Movement: ${ing.movement}. Mood: ${ing.styleNote}. ${ing.durShort}.`
    }
  }

  if (style === 'literal') {
    return {
      primary: pickTemplate(LITERAL_PRIMARY_TEMPLATES, seed, 0)(ing),
      runway: pickTemplate(LITERAL_RUNWAY_TEMPLATES, seed, 5)(ing),
      kling:
        `Subject: ${ing.subject}. Setting: ${ing.setting}. Action: ${ing.action}${ing.feeling}. ` +
        `Lighting: ${ing.lighting}. Lens: ${ing.lens}. Movement: ${ing.movement}. Mood: ${ing.styleNote}. ${ing.durShort}.`
    }
  }

  if (style === 'emotional') {
    return {
      primary: pickTemplate(EMOTIONAL_PRIMARY_TEMPLATES, seed, 0)(ing),
      runway: pickTemplate(EMOTIONAL_RUNWAY_TEMPLATES, seed, 5)(ing),
      kling:
        `Feeling-first scene. Subject: ${ing.subject}. Setting: ${ing.setting}. Micro-action: ${ing.action}${ing.feeling}. ` +
        `Lighting: ${ing.lighting}. Lens: ${ing.lens}. Movement: ${ing.movement}. Mood: ${ing.styleNote}. ${ing.durShort}.`
    }
  }

  return {
    primary: pickTemplate(SYMBOLIC_PRIMARY_TEMPLATES, seed, 0)(ing),
    runway: pickTemplate(SYMBOLIC_RUNWAY_TEMPLATES, seed, 5)(ing),
    kling:
      `Metaphorical visuals. Environment: ${symbolicSubject}. Mood: ${ing.styleNote}${ing.feeling}. ` +
      `Lighting: ${ing.lighting}. Lens: ${ing.lens}. Movement: ${ing.movement}. ${ing.durShort}.`
  }
}

/* -------------------------------------------------------------------------- */
/*  Public: dedupe + main writer                                              */
/* -------------------------------------------------------------------------- */

/**
 * De-duplicate beats whose source windows overlap by more than `mergeOverlapSec`.
 * The longer beat wins; we keep the highest score among the merged group.
 */
export function dedupeBeatsBySourceWindow(
  beats: BrollBeat[],
  mergeOverlapSec = 1.5
): BrollBeat[] {
  if (beats.length === 0) return []
  const sorted = [...beats].sort((a, b) => a.source_start - b.source_start || a.source_end - b.source_end)
  const out: BrollBeat[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (!last) {
      out.push(b)
      continue
    }
    const overlap = Math.min(last.source_end, b.source_end) - Math.max(last.source_start, b.source_start)
    if (overlap >= mergeOverlapSec) {
      const lastDur = last.source_end - last.source_start
      const bDur = b.source_end - b.source_start
      const better = bDur > lastDur ? b : last
      const score = Math.max(last.score ?? 0, b.score ?? 0)
      out[out.length - 1] = {
        ...better,
        source_start: Math.min(last.source_start, b.source_start),
        source_end: Math.max(last.source_end, b.source_end),
        score
      }
    } else {
      out.push(b)
    }
  }
  return out
}

/**
 * One BrollPrompt per beat — single style, single shot description, anchored to
 * the source-media window of the spoken line.
 *
 * NOT a generic template. Each prompt is composed from the actual nouns,
 * actions, and feelings detected in the line, plus one of three style
 * directions (literal / emotional / symbolic) chosen automatically.
 */
export function generateBrollPromptsFromBeats(
  projectId: string,
  beats: BrollBeat[],
  options?: GenerateBrollPromptsFromBeatsOptions
): Omit<BrollPrompt, 'id' | 'created_at'>[] {
  const tone = options?.tone ?? 'neutral'
  const mode = options?.mode ?? 'story'
  const directionText = options?.directionText?.trim()
  const cleaned = dedupeBeatsBySourceWindow(beats)
  const cap = options?.maxPrompts ?? cleaned.length
  const prompts: Omit<BrollPrompt, 'id' | 'created_at'>[] = []
  const cast = options?.subjectProfile ? castDescription(options.subjectProfile) : ''
  const visibility = options?.subjectProfile?.visibility ?? 'standard'
  const dur = clampBrollShotDurationSeconds(
    options?.shotDurationSeconds ?? DEFAULT_BROLL_SHOT_DURATION_SECONDS
  )

  const packId = options?.promptPack?.id
  for (const beat of cleaned.slice(0, cap)) {
    const analysis = analyzeLine(beat.transcript_text, options?.subjectProfile)
    if (!analysis.cleaned) continue
    const style = pickStyleForLine(analysis.cleaned, mode, tone)
    const shot = composeShot(analysis, style, tone, mode, directionText, dur, packId)

    prompts.push({
      project_id: projectId,
      segment_start: beat.source_start,
      segment_end: beat.source_end,
      prompt_type: style,
      prompt_text: shot.primary,
      priority_score: beat.score ?? null,
      metadata_json: {
        category: style,
        sourceWindow: { start: beat.source_start, end: beat.source_end },
        sourceSpan: { start: beat.source_start, end: beat.source_end },
        transcriptExcerpt: analysis.cleaned.slice(0, 400),
        toneTags: [tone, mode, beat.origin ?? 'beat', analysis.feeling ?? 'neutral'],
        aiDirection: directionText ?? null,
        mode,
        beatId: beat.id,
        beatOrigin: beat.origin ?? 'beat',
        promptSource: 'beats-deterministic',
        stylePack: options?.promptPack?.label ?? null,
        stylePackId: packId ?? null,
        sceneSubject: analysis.subject,
        sceneSetting: analysis.setting,
        sceneAction: analysis.action,
        sceneFeeling: analysis.feeling,
        castDescription: cast || null,
        subjectVisibility: visibility,
        providerPrompts: {
          primary: shot.primary,
          runway: shot.runway,
          kling: shot.kling
        },
        confidence: beat.score ?? null
      }
    })
  }

  return prompts
}
