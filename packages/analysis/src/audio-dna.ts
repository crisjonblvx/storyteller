import type { TimelineSequence, AudioImmersionScore } from '@storyteller/timeline'

export type AudioDnaId =
  | 'netflix_documentary'
  | 'bloomberg_finance'
  | 'espn_sports'
  | 'apple_keynote'
  | 'crime_documentary'
  | 'motivational'
  | 'youtube_creator'
  | 'podcast'

export interface AudioDnaDefinition {
  id: AudioDnaId
  label: string
  /** Overall philosophy — how this style treats audio */
  philosophy: string
  /** How room tone and ambience are used */
  ambientApproach: string
  /** Impact / accent sounds — boom, hit, accent */
  impactPhilosophy: string
  /** Transitions between segments */
  transitionStyle: string
  /** How silence is treated */
  silenceValue: string
  /** 0–1: how much boom/bass emphasis */
  boomIntensity: number
  /** 0–1: density of ambient layers */
  ambientDensity: number
  /** 0–1: prominence of transition sounds */
  transitionProminence: number
  /** Example audio moments that define this style */
  exampleMoments: string[]
}

export const AUDIO_DNA: Record<AudioDnaId, AudioDnaDefinition> = {
  netflix_documentary: {
    id: 'netflix_documentary',
    label: 'Netflix Documentary',
    philosophy: 'Almost everything is room tone. Silence is weaponized — used before reveals, after confessions, and wherever emotion needs to breathe. Sound design is invisible until the moment it becomes everything.',
    ambientApproach: 'Single, true-to-location room tone that never calls attention to itself. The hum of a refrigerator, distant traffic, building HVAC. Layered so quietly the viewer only notices when it disappears.',
    impactPhilosophy: 'Reserved exclusively for emotional peaks — a realization, a confession, a pivot. One deep bass note rather than a cluster. Restraint gives each impact enormous weight.',
    transitionStyle: 'Audio crossfades and room-tone swells, never whooshes. Transitions sound like the air shifting, not like a sound effect library.',
    silenceValue: 'Silence is the most powerful edit tool available. Hold it two beats longer than comfortable — that is where the truth lives. Silence before a reveal costs nothing and earns everything.',
    boomIntensity: 0.3,
    ambientDensity: 0.7,
    transitionProminence: 0.15,
    exampleMoments: [
      'Subject pauses mid-sentence — room tone fills the gap for four full seconds before cut',
      'A single low bass tone on the moment a name is revealed, then immediate silence',
      'Environmental ambience dissolves entirely as the camera holds on a face — that absent audio is the punctuation'
    ]
  },
  bloomberg_finance: {
    id: 'bloomberg_finance',
    label: 'Bloomberg Finance',
    philosophy: 'Authoritative and invisible. Audio serves information delivery, never spectacle. The viewer should trust the content, not notice the production.',
    ambientApproach: 'Controlled office and studio environments with subtle, consistent low hum. Never distracting. If the location has noise, it is cleaned — this is precision audio.',
    impactPhilosophy: 'Restrained corporate accents only on data reveals or market-moving moments. No giant booms. A subtle mid-range tone or soft confirmation chime, never bass-heavy or cinematic.',
    transitionStyle: 'Almost invisible — barely-there swooshes, clean cuts, or a subtle upward tone. The edit should be felt, not heard.',
    silenceValue: 'Silence is professional. Dead air between questions and answers signals credibility, not discomfort. Authority does not rush to fill silence.',
    boomIntensity: 0.05,
    ambientDensity: 0.4,
    transitionProminence: 0.1,
    exampleMoments: [
      'Chart appears on screen — no sound effect, just the natural audio of the studio environment',
      'Soft, barely-perceptible chime as a quarterly earnings number is displayed',
      'Clean cut between interviews with matched room tone — the seam is invisible'
    ]
  },
  espn_sports: {
    id: 'espn_sports',
    label: 'ESPN Sports',
    philosophy: 'High energy, physically felt. Every cut should feel like a hit. Audio builds and releases like the sport itself — crowd swells, crescendo, climax, exhale.',
    ambientApproach: 'Stadium crowd roar as an ambient bed, rising and falling with the emotional arc. Field presence and crowd murmur even in interview segments — the sport is always nearby.',
    impactPhilosophy: 'Heavy, layered impacts on every key moment: touchdowns, records, career milestones. Bass hits, crowd eruption, and metal-on-metal hits stacked for physical sensation.',
    transitionStyle: 'Fast risers, crowd swells, and whooshes that accelerate into the next segment. Transitions feel like entering the arena — you are inside the energy immediately.',
    silenceValue: 'Silence is used only before the biggest reveals, and held for less than a second. The energy must not die; silence is a coiled spring, not a pause.',
    boomIntensity: 0.95,
    ambientDensity: 0.85,
    transitionProminence: 0.9,
    exampleMoments: [
      'Game-winning play: crowd swell building 2 seconds before the moment, then explosion of bass + roar',
      'Stat reveal: quick metallic accent followed by crowd murmur bed swelling under the graphic',
      'Segment transition: 1-second riser from silence to full crowd noise, cut to field ambience'
    ]
  },
  apple_keynote: {
    id: 'apple_keynote',
    label: 'Apple Keynote',
    philosophy: 'Surgical precision. Every sound earns its place. The audio is designed to be indistinguishable from silence until the exact moment it is needed — then it is perfect.',
    ambientApproach: 'Near-silent. Clean studio with imperceptible low-level hum. The focus is entirely on the voice. No ambience competes with the product being demonstrated.',
    impactPhilosophy: 'Subtle, satisfying confirmation tones — the audio equivalent of a camera shutter or a perfectly designed button click. Never overwhelming. Understated perfection on product reveals and feature moments.',
    transitionStyle: 'Minimal swooshes with precise timing. A signature tone or gentle slide, always understated. Transitions sound engineered, not improvised.',
    silenceValue: 'Silence is a design choice. It frames announcements, creates anticipation, and punctuates "One more thing" moments with weight that words cannot achieve.',
    boomIntensity: 0.1,
    ambientDensity: 0.15,
    transitionProminence: 0.25,
    exampleMoments: [
      'Product name reveal: half-second of complete silence, then a single clean tone as the name appears',
      '"One more thing" — pause held uncomfortably long, crowd tension palpable, then the reveal',
      'Feature demonstration: a precise click or chime timed to the product action, then back to silence'
    ]
  },
  crime_documentary: {
    id: 'crime_documentary',
    label: 'Crime Documentary',
    philosophy: 'Tension through restraint. The sound design is sparse and unnerving — ordinary sounds made menacing by context. Nothing is safe. The refrigerator hum sounds like dread.',
    ambientApproach: 'Low, functional room tones given emotional weight by context: refrigerator cycling, clock ticking, fluorescent buzz, distant dog bark. Ambience that would be unremarkable in any other genre becomes loaded.',
    impactPhilosophy: 'Sparse but devastating. A single deep hit before a name reveal, a sharp cut to silence before a confession. Never decorative — impacts are used only when the information itself is a blow.',
    transitionStyle: 'Silence transitions. Or a tension drone that bleeds between segments without resolution. Whooshes are avoided — they release tension rather than sustaining it.',
    silenceValue: 'Silence is a threat. Used before names, facts, and revelations. The longer the silence, the worse the audience expects the news to be — and it usually is.',
    boomIntensity: 0.45,
    ambientDensity: 0.6,
    transitionProminence: 0.2,
    exampleMoments: [
      'Interview cuts to archival photo — refrigerator hum drops out entirely, silence, then a name read aloud',
      'Clock ticking under testimony that grows slowly louder as detail becomes more disturbing, then cuts clean',
      'Tension drone bleeding from one segment into the next with no resolution — cut mid-phrase to a new voice'
    ]
  },
  motivational: {
    id: 'motivational',
    label: 'Motivational',
    philosophy: 'Build toward triumph. The audio arc mirrors the narrative arc — starting restrained and building to a crescendo that earns the emotional payoff. Sound is forward momentum.',
    ambientApproach: 'Environmental layers that support the journey: gym ambience, early morning street atmosphere, rain on windows before the breakthrough. The world sounds like it is waiting for the protagonist to act.',
    impactPhilosophy: 'Rising swells and triumphant accents on action moments and realizations. The hit lands on effort, not reward — when the weight is lifted, not when the trophy is held.',
    transitionStyle: 'Rising momentum transitions — swells that build to the cut. Never a descent. Every transition climbs toward the next peak.',
    silenceValue: 'Brief silence before the pivotal decision or the first step — then sound returns with renewed energy. Silence marks the turning point, not the resolution.',
    boomIntensity: 0.65,
    ambientDensity: 0.55,
    transitionProminence: 0.7,
    exampleMoments: [
      'Subject begins training at 4am — ambient city quiet, then a single rising accent as they lace their shoes',
      'Pivotal realization: half-second silence, then a building swell that carries through the rest of the segment',
      'Accomplishment moment: a triumphant bass hit as the finish line is crossed, crowd bed rising under it'
    ]
  },
  youtube_creator: {
    id: 'youtube_creator',
    label: 'YouTube Creator',
    philosophy: 'Punchy, energetic, constantly engaging. Audio density is high because attention is low. Every few seconds, something sonic happens to retain the viewer and signal that the video rewards watching.',
    ambientApproach: 'Light, upbeat room presence or casual background that signals authenticity. Home studio hum, coffee shop murmur, occasional street noise — real but comfortable.',
    impactPhilosophy: 'Quick, punchy impact accents on every key word, reaction, or reveal. Layered whooshes on text appearing, pop sounds on list items, comedic hits on unexpected moments. High density is the point.',
    transitionStyle: 'Energetic whooshes, quick bass drops, and snappy transitions that signal something new is coming. Transitions are part of the content, not infrastructure.',
    silenceValue: 'Silence is a mistake. If there is a gap, fill it with music, a whoosh, or a sound effect. The exception: comic timing — a half-second of silence before a punchline.',
    boomIntensity: 0.6,
    ambientDensity: 0.5,
    transitionProminence: 0.85,
    exampleMoments: [
      'Title card appears: whoosh + pop synced to text, then immediately back to presenter energy',
      'List item revealed: quick ascending tone or soft click, keeping pace with rapid-fire delivery',
      'Reaction cut: comedic hit or soft boom on the expression, half-second silence, then back to content'
    ]
  },
  podcast: {
    id: 'podcast',
    label: 'Podcast',
    philosophy: 'Dialogue-first, always. No sound competes with the voice. The audio design is the absence of design — clean recording, clean room, full presence given to the words being spoken.',
    ambientApproach: 'True, clean room tone only — the acoustic signature of the recording space, treated to sound like a professional but not a sterile environment. No layered ambience, no environmental bed.',
    impactPhilosophy: 'None. There are no impact sounds in a podcast. If something deserves emphasis, the voice provides it. SFX would sound like an intrusion.',
    transitionStyle: 'Clean cuts with matched room tone, or a brief musical ident between sections. Nothing that would feel out of place on audio-only playback.',
    silenceValue: 'Natural conversation pauses are preserved. Silence is honesty — the listener knows they are hearing a real exchange when the silence is there. Over-editing the pauses out destroys intimacy.',
    boomIntensity: 0.0,
    ambientDensity: 0.2,
    transitionProminence: 0.05,
    exampleMoments: [
      'Guest pauses to gather thoughts — the silence is left in, the room tone holds, the intimacy is preserved',
      'Section break: brief musical ident, 2 seconds, then back to dialogue with matched room tone',
      'Emotional moment: no sound design at all — the voice and its weight carry the entire moment'
    ]
  }
}

export const AUDIO_DNA_LIST: AudioDnaDefinition[] = Object.values(AUDIO_DNA)

/** Keyword-based default when the user has not selected an Audio DNA. */
export function inferAudioDnaFromDirection(aiDirection: string | undefined): AudioDnaId {
  const t = (aiDirection ?? '').toLowerCase()
  if (/\b(netflix|hbo|hulu|documentary|doc\b|verite|vérité|cinematic|storytell)\b/.test(t)) {
    return 'netflix_documentary'
  }
  if (/\b(crime|murder|mystery|serial|detective|thriller|unsolved|investigation)\b/.test(t)) {
    return 'crime_documentary'
  }
  if (/\b(sports?|espn|nfl|nba|nhl|mlb|athlete|game|stadium|highlight|competition)\b/.test(t)) {
    return 'espn_sports'
  }
  if (/\b(apple|keynote|product launch|tech|startup|innovation|wwdc|presentation)\b/.test(t)) {
    return 'apple_keynote'
  }
  if (/\b(bloomberg|finance|business|corporate|wall street|earnings|investor|market)\b/.test(t)) {
    return 'bloomberg_finance'
  }
  if (/\b(motivat|inspire|grind|hustle|comeback|triumph|overcome|resilience)\b/.test(t)) {
    return 'motivational'
  }
  if (/\b(podcast|interview|conversation|radio|talk show|audio.?first)\b/.test(t)) {
    return 'podcast'
  }
  if (/\b(youtube|creator|viral|tiktok|reels|hook|fyp|content)\b/.test(t)) {
    return 'youtube_creator'
  }
  return 'netflix_documentary'
}

/**
 * Derives an immersion score purely from the current timeline structure —
 * no AI call required. Penalties are applied for gaps in audio coverage
 * and subtracted from a baseline of 100.
 */
export function computeAudioImmersionScore(sequence: TimelineSequence): AudioImmersionScore {
  const allAudioClips = sequence.audioTracks.flatMap(t => t.clips)
  const allVideoClips = sequence.videoTracks.flatMap(t => t.clips)

  const ambientClips = allAudioClips.filter(c => c.role === 'sfx-ambient')
  const transitionClips = allAudioClips.filter(c => c.role === 'sfx-transition')
  const aRollClips = allVideoClips.filter(c => c.role === 'a-roll')

  const dryDialogue = ambientClips.length === 0
  const missingAmbient = dryDialogue ? aRollClips.length : 0

  // Consecutive a-roll clips with no sfx-transition landing within 1s of the cut point
  let harshCuts = 0
  for (let i = 0; i < aRollClips.length - 1; i++) {
    const cutPoint = aRollClips[i].timelineOutSeconds
    const covered = transitionClips.some(c => Math.abs(c.timelineInSeconds - cutPoint) < 1)
    if (!covered) harshCuts++
  }

  const slots = sequence.soundDesignSlots ?? []
  const silenceOpportunities = slots.filter(s => s.category === 'silence').length
  const missingImpacts = slots.filter(s => s.category === 'impact' && s.status === 'empty').length

  let score = 100
  score -= Math.min(missingAmbient * 5, 30)
  score -= Math.min(harshCuts * 3, 20)
  score -= dryDialogue ? 15 : 0
  score -= Math.min(missingImpacts * 4, 20)
  // Silence opportunities that remain unaddressed (not accepted) subtract mildly
  const unaddressedSilence = slots.filter(s => s.category === 'silence' && s.status !== 'accepted').length
  score -= Math.min(unaddressedSilence * 2, 15)
  score = Math.max(0, score)

  return { score, missingAmbient, harshCuts, dryDialogue, missingImpacts, silenceOpportunities }
}
