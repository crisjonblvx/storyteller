import type { StoryMode } from '@storyteller/shared'

export type PromptPackId =
  | 'cinematic_documentary'
  | 'viral_social'
  | 'podcast_premium'
  | 'journalism'
  | 'motivational'
  | 'music_video'

export interface PromptPackDefinition {
  id: PromptPackId
  label: string
  tone: string
  cameraStyle: string
  lighting: string
  motionStyle: string
  environmentStyle: string
  detailLevel: string
  /** Narrative approach for this pack */
  narrativeApproach: string
  /** Examples of the visual style */
  shotExamples: string[]
}

export const PROMPT_PACKS: Record<PromptPackId, PromptPackDefinition> = {
  cinematic_documentary: {
    id: 'cinematic_documentary',
    label: 'Cinematic Documentary',
    tone: 'grounded, observational, human-scale emotion with narrative stakes',
    cameraStyle: '35–85mm motivated framing. PUSH-IN for intimacy/realization, STATIC for tension, SLOW CIRCLE for transformation moments. Shot composition: wide establishing → medium interaction → intimate close-up when emotion peaks',
    lighting: 'Motivated practical sources named specifically: window light with visible time-of-day, lamp glow, screen flicker, streetlight spill. Shadows carry emotional weight — not just fill, but storytelling',
    motionStyle: 'Deliberate breathing pace. Camera movement serves emotional beats: push-in when walls close in, pull-back when character realizes, slow drift when lost in thought',
    environmentStyle: 'Lived-in spaces with visible history: worn furniture, personal objects, environmental storytelling elements (unopened mail, half-empty coffee, phone face-up)',
    detailLevel: 'Specific props that carry meaning: exact items mentioned in transcript rendered as texture and stakes',
    narrativeApproach: 'Scene-based mini-stories: A [specific person] at [specific time/place] dealing with [visible stakes]. Environmental details carry subtext. Demographics specific when relevant',
    shotExamples: [
      'Late-night kitchen table with laptop glow flickering on exhausted face, bills visible, subtle push-in as realization hits',
      'Two people on opposite ends of couch, tension visible in body language, rain outside window, slow dolly reveals emotional distance',
      'Credit cards sliding across table under harsh light, balances rising on screen, macro detail of anxious hands'
    ]
  },
  viral_social: {
    id: 'viral_social',
    label: 'Viral Social',
    tone: 'punchy, hook-forward, high clarity with immediate visual payoff',
    cameraStyle: 'Dynamic framing: WHIP PAN between reveals, QUICK PUSH-IN on reactions, STEADICAM movement through spaces. Wide-to-tight compositions that reward rewatching',
    lighting: 'Bold, readable, high-contrast. Ring lights acceptable as visible sources. Saturated colors that pop on small screens. Golden hour or studio punch',
    motionStyle: 'Beat-sync, snappy. Fast reframes on punchlines, slow-mo on impact moments, quick cuts implied through camera whip. Energy builds to a moment',
    environmentStyle: 'Trend-aware but specific: recognizable locations (coffee shop corner, car interior, bedroom setup) with personal touches visible',
    detailLevel: '1-2 sharp visual hooks per shot: the specific reaction, the product, the transformation. Props are punchlines, not decoration',
    narrativeApproach: 'Immediate visual payoff: A [specific person] doing [specific action] that creates instant reaction. The setup and payoff in one shot. Objects reveal status/surprise',
    shotExamples: [
      'Stepping out of luxury car in designer clothes, camera circles as overdraft notification flashes on phone screen, smile fading',
      'POV hands unboxing product with quick push-in on the reveal moment, expression visible in reflection',
      'Wide showing clean aesthetic bedroom, whip pan to messy reality behind camera, reaction on face'
    ]
  },
  podcast_premium: {
    id: 'podcast_premium',
    label: 'Podcast Premium',
    tone: 'intimate, conversational authority, warm intellectual connection',
    cameraStyle: 'Two-shot and medium close-up balance. RACK FOCUS between speakers. Parallax from subtle camera movement. Shot-reverse-shot energy without cutting',
    lighting: 'Soft key with warm practical sources: desk lamp glow, window light as fill, subtle rim separation. Cozy but professional — not clinical',
    motionStyle: 'Minimal elegance: slow drift during listening, stillness during key points, gentle reframes that follow conversation rhythm',
    environmentStyle: 'Tasteful sets with intellectual cues: books visible, art on walls, quality headphones, microphone as design element. Bookshelf or minimal studio',
    detailLevel: 'Polished presentation: subtle gear visible, beverage at hand, notes on table. Props suggest preparation and expertise',
    narrativeApproach: 'Conversation as visual relationship: Two people in dialogue space, or single host connected to unseen audience through direct address. Objects support authority (books, notes, quality gear)',
    shotExamples: [
      'Two-shot of hosts at small table, warm practical between them, rack focus as one listens while other speaks',
      'Medium close of single host, bookshelf bokeh behind, subtle parallax drift, direct to camera authority',
      'Detail of hands gesturing with coffee mug, microphone visible, notes on table in soft focus'
    ]
  },
  journalism: {
    id: 'journalism',
    label: 'Journalism',
    tone: 'neutral, factual, non-sensational with human impact visible',
    cameraStyle: 'Documentary field coverage: stable tripod for interviews, handheld urgency for action, establishing wide shots with clear context. Shot sequence: wide context → medium subject → detail evidence',
    lighting: 'Available light documented as-is: window daylight, fluorescent office, streetlight at night. No augmentation, reality preserved',
    motionStyle: 'Observational: follow the subject through real spaces, steady movement, no stylized camera tricks. Movement motivated by action',
    environmentStyle: 'Real context that informs the story: press scrums, streets, offices, homes, field locations. Environmental details specific to the beat',
    detailLevel: 'Specific location cues: signage visible, documents in hand, technology being used. Evidence of the story visible in frame',
    narrativeApproach: 'Documentary truth: A [specific person] in [specific real location] doing [newsworthy action]. Context visible, stakes clear, no melodrama. Demographics and environment specific to the story',
    shotExamples: [
      'Reporter in field location, subject walking through their actual environment, documents visible in hand',
      'Interview setup: subject at kitchen table, window light, visible home environment that contextualizes their story',
      'Wide establishing of location with identifying signage/landmark, then push to medium of subject in that context'
    ]
  },
  motivational: {
    id: 'motivational',
    label: 'Motivational',
    tone: 'aspirational, forward-moving, resilient with earned emotion',
    cameraStyle: 'Dynamic range: heroic wide establishing to intimate detail. LOW ANGLES for empowerment, PUSH-IN on determination, PULL-BACK to reveal journey progress. Dawn/dusk golden moments',
    lighting: 'Uplifting gradients: sunrise/sunset as emotional beats, gym/workplace practicals, city glow as backdrop. Light as metaphor — breaking through, rising up',
    motionStyle: 'Building energy: purposeful walk-and-work, slow rise from starting position, accelerating movement as momentum builds. Triumph earned through effort visible',
    environmentStyle: 'Spaces of transformation: training facilities, workspaces at dawn, city skylines, nature trails, home office with visible progress markers',
    detailLevel: 'Effort and progress visible: sweat, worn equipment, completed work, sunrise light. Before/during/after states implied in single shots',
    narrativeApproach: 'Transformation narrative: A [specific person] at [specific stage of journey] doing [effort toward goal]. Environment reflects progress. Dawn/light used as emotional punctuation',
    shotExamples: [
      'Jogging at sunrise through neighborhood, peaceful expression, sunlight breaking through trees, earned triumph visible on face',
      'Early morning workspace, coffee and plans visible, push-in on determination as work begins',
      'Low angle of subject looking up at city skyline, then cut to detail of hands doing the work, dawn light both shots'
    ]
  },
  music_video: {
    id: 'music_video',
    label: 'Music Video',
    tone: 'visceral, kinetic, emotionally charged — visuals that feel like the music sounds',
    cameraStyle: 'High-energy motion language: WHIP PAN on beat hits, DUTCH TILT for disorientation, SNAP ZOOM into emotion peaks, slow-motion hero moments frozen at impact. Frame-within-frame compositions. Silhouettes against color-washed skies',
    lighting: 'Dramatic and stylized: rim lights in bold color, lens flares on beats, strobe-adjacent rapid shifts, neon practicals in dark environments, golden-hour backlight halos. Lighting as rhythm — hot on hits, cool in valleys',
    motionStyle: 'Every cut lands on a musical beat. Within-clip movement mirrors song energy: fast frenetic handheld on verses, slow ethereal floats on choruses. Freeze frames, speed ramps, and reverse-motion on drops and builds',
    environmentStyle: 'Visually transformative spaces: empty warehouses with dramatic light shafts, rooftops at dusk, rain-soaked streets, industrial backdrops with bold color grading, surreal or abstract environments that feel like the track\'s emotional landscape',
    detailLevel: 'Extreme macro details for texture and impact: fingers on strings, eyes at peak emotion, fabric movement in slow-mo, environmental elements (smoke, water, light particles) treated as visual percussion',
    narrativeApproach: 'Visual music — A [specific subject / performer] in [visually distinct environment] doing [action that embodies the track\'s energy]. Each beat slot is one visual statement. Metaphor and symbolism over literal narrative. Color, light, and motion ARE the story',
    shotExamples: [
      'Artist silhouetted against strobing color wash, slow-mo fabric movement, snap zoom to eye close-up on the drop',
      'Handheld whip pan through rain-soaked neon street, motion blur catching every beat, resolving on subject mid-motion',
      'Macro of hands — instrument, gesture, texture — in extreme slow-mo, light particles visible, cutting on every downbeat'
    ]
  }
}

export const PROMPT_PACK_LIST: PromptPackDefinition[] = Object.values(PROMPT_PACKS)

/** Keyword-based default when user selects "auto". */
export function inferPromptPackFromDirection(
  aiDirection: string | undefined,
  mode: StoryMode
): PromptPackId {
  const t = (aiDirection ?? '').toLowerCase()
  if (mode === 'music_video') return 'music_video'
  if (/\b(news|journalist|report|field|investigate|package)\b/.test(t) || mode === 'journalism') {
    return 'journalism'
  }
  if (/\b(viral|tiktok|reels|hook|fyp)\b/.test(t)) return 'viral_social'
  if (/\b(podcast|youtube|conversation|studio)\b/.test(t)) return 'podcast_premium'
  if (/\b(motivat|inspire|grind|hustle|comeback)\b/.test(t)) return 'motivational'
  if (/\b(cinematic|documentary|verite|vérité)\b/.test(t) || /\bdoc\b/.test(t)) {
    return 'cinematic_documentary'
  }
  if (mode === 'creator') return 'viral_social'
  return 'cinematic_documentary'
}

/**
 * Preferred entry-point for selecting the auto pack.
 * Strong keyword signals in `aiDirection` take priority; when no keyword
 * matches, `primaryGoal` provides a project-level override before the
 * mode-based fallback.
 */
export function defaultPromptPackId(
  mode: StoryMode,
  aiDirection?: string | null,
  primaryGoal?: 'fast_social' | 'professional' | 'broadcast' | null
): PromptPackId {
  // Music video always uses the dedicated pack
  if (mode === 'music_video') return 'music_video'

  const t = (aiDirection ?? '').toLowerCase()
  // Strong keyword signals win regardless of primaryGoal
  if (/\b(news|journalist|report|field|investigate|package)\b/.test(t) || mode === 'journalism') {
    return 'journalism'
  }
  if (/\b(viral|tiktok|reels|hook|fyp)\b/.test(t)) return 'viral_social'
  if (/\b(podcast|youtube|conversation|studio)\b/.test(t)) return 'podcast_premium'
  if (/\b(motivat|inspire|grind|hustle|comeback)\b/.test(t)) return 'motivational'
  if (/\b(cinematic|documentary|verite|vérité)\b/.test(t) || /\bdoc\b/.test(t)) {
    return 'cinematic_documentary'
  }
  // No strong keyword signal — use primaryGoal override
  if (primaryGoal === 'fast_social') return 'viral_social'
  if (primaryGoal === 'broadcast') return 'journalism'
  if (primaryGoal === 'professional') return 'cinematic_documentary'
  // Mode-based fallback
  if (mode === 'creator') return 'viral_social'
  return 'cinematic_documentary'
}

/**
 * Generate pack-specific instructions for the AI prompt.
 * For the music_video pack, `vibeVision` injects the creator's creative brief
 * directly into the motion and narrative sections.
 */
export function packInstructions(packId: PromptPackId, vibeVision?: string | null): string {
  const pack = PROMPT_PACKS[packId]
  const vibeSection = packId === 'music_video' && vibeVision?.trim()
    ? `\nCREATOR'S VIBE & VISION: ${vibeVision.trim()}\nUse the above as the primary emotional and visual directive — it overrides generic defaults.\n`
    : ''
  return `STYLE PACK: ${pack.label}
${vibeSection}
TONE: ${pack.tone}

CAMERA APPROACH: ${pack.cameraStyle}

LIGHTING: ${pack.lighting}

MOTION: ${pack.motionStyle}

ENVIRONMENT: ${pack.environmentStyle}

DETAIL REQUIREMENT: ${pack.detailLevel}

NARRATIVE APPROACH: ${pack.narrativeApproach}

EXAMPLE SHOTS FOR THIS PACK:
${pack.shotExamples.map(ex => `- ${ex}`).join('\n')}

GENERATE prompts that match this specific visual language. Each prompt should read like one of the examples above — scene-based, emotionally specific, with visible stakes and environmental storytelling.`
}
