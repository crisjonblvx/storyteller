import type { StoryMode, SubjectProfile } from '@storyteller/shared'
import { clampBrollShotDurationSeconds } from '@storyteller/shared'
import type { PromptPackDefinition } from './prompt-packs.js'
import { packInstructionsCompact, subjectInstructions } from './openai-broll.js'
import type { GroundedReviewBrollIdea } from './openai-grounded-review.js'

export type GenerateBrollForSoundbiteOpenAIParams = {
  apiKey: string
  model?: string
  soundbiteId: string
  transcriptText: string
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  directionText: string
  mode: StoryMode
  shotDurationSeconds?: number
  /** Still-image summaries from prior generations for this soundbite. AI avoids repeating these visual approaches. */
  previousIdeas?: string[]
}

export type GenerateBrollForSoundbiteResult =
  | { ok: true; brollIdeas: GroundedReviewBrollIdea[] }
  | { ok: false; error: string }

export async function generateBrollForSoundbiteOpenAI(
  params: GenerateBrollForSoundbiteOpenAIParams
): Promise<GenerateBrollForSoundbiteResult> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    soundbiteId,
    transcriptText,
    subjectProfile,
    promptPack,
    directionText,
    mode,
    shotDurationSeconds,
    previousIdeas
  } = params

  const line = transcriptText.trim()
  if (!line) {
    return { ok: false, error: 'Soundbite transcript is empty.' }
  }

  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)
  const userContent = [
    `PROJECT_MODE: ${mode}`,
    `AI_DIRECTION: ${directionText || '(none)'}`,
    `SOUNDBITE_ID: ${soundbiteId}`,
    `SPOKEN_LINE: ${JSON.stringify(line)}`,
    `SHOT_DURATION_SECONDS: ${dur}`,
    '',
    packInstructionsCompact(promptPack),
    '',
    subjectInstructions(subjectProfile),
    '',
    'TASK — write THREE premium B-roll ideas for this exact spoken line.',
    'Return the strongest editorial idea FIRST, then two real alternates.',
    'Across the three ideas, cover literal / emotional / symbolic when possible; do not return three slight variations of the same shot.',
    'Choose styles using this rule:',
    '  - literal: line names a concrete person, place, company, device, or event and the literal image is genuinely the strongest choice',
    '  - emotional: the line lands through pressure, ambition, fear, confusion, relief, awe, or obsession — body language, intimate environment, and a specific prop carry the meaning; this is the right style for personal sacrifice, first-person struggle, family tension, or a pivotal life moment',
    '  - symbolic: the line explains a mechanism, hidden value, access barrier, liquidity problem, uncertainty, long-term thesis, or abstraction that is better shown through a restrained physical metaphor',
    '',
    'RULES:',
    '- FIRST QUESTION before writing anything: Does this line describe a personal struggle, sacrifice, family tension, real job, or first-person memory? If yes, show THAT specific real-world moment — a car dealership lot at night, a kitchen table with handwritten bills, a church parking lot, a family conversation over a meal. Invent the most plausible real scene from the speaker\'s actual world.',
    '- If the line is about a relationship tension (family vs. finances, personal vs. community, insider vs. outsider) — show a human scene with two people, or the physical domestic environment where that tension lives.',
    '- The stillImagePrompt must name at least one specific prop that comes directly from the spoken words or is strongly implied by the personal context (a car dealership\'s printed inventory sheet, a handwritten budget on a legal pad, a bank envelope with folded bills, a worn wallet on a kitchen table).',
    '- Generic scenes forbidden unless the line is literally about them: no trading floor unless someone explicitly mentions trading, no bank vault unless someone mentions a vault, no brokerage laptop unless someone mentions a brokerage, no holographic lab unless someone mentions technology development.',
    '- Stay grounded in the spoken line, but do NOT default to generic noun-illustration.',
    '- If the line is explanatory or abstract, show the underlying mechanism or stakes, not just the surface nouns.',
    '- For lines about valuation opacity, hidden holdings, gatekeeping, liquidity, qualification, scarcity, confusion, or long-term investing, prefer a real-world cinematic metaphor over another laptop / dashboard / ticker wall.',
    '- Metaphors must stay restrained and documentary-plausible. Think premium real-world production design, not fantasy concept art or sci-fi VFX overload.',
    '- Premium financial documentary / Antoine Fuqua-inspired realism when appropriate, but only when it serves the line.',
    '- Be visually inventive and emotionally surprising while staying truthful to the spoken line.',
    '- stillImagePrompt = static opening frame ONLY (subject, environment, prop, light, composition/framing, lens and depth-of-field feel, color-grade note) — NO camera moves.',
    '- stillImagePrompt must include a concrete environment, a visible prop, a motivated practical light source, and when people are present: lens (35mm or 50mm), shallow depth of field, and a framing choice (e.g. doorway, over-shoulder, wide master).',
    '- stillImagePrompt must NOT include televisions, TV monitors, computer screens, or any background screens unless the spoken line explicitly describes watching or using one. If a screen must appear, it shows only blurred abstract footage with no legible text, no chyrons, no BREAKING NEWS banners, no subtitles.',
    `- motionPrompt = I2V motion from that still. The shot must end with a cinematically motivated exit frame: in the final 1–2 seconds, push into or land on the dominant texture, surface, lens, or light source until it fills the frame — creating a natural visual portal for cutting back to the interview. End with: "${dur} seconds, single continuous take, photoreal, no dialogue, no on-screen text. Diegetic ambient sound and subtle environmental SFX only. No music, no narrator, no broadcast news audio, no scripted dialogue or voiceover".`,
    '- prompt = one unified director paragraph combining still + motion.',
    '- why = one sentence on editorial fit, specifically why this approach is stronger than a more obvious literal shot.',
    '- Do NOT invent facts beyond the spoken line.',
    '',
    'FEW-SHOT EXAMPLES (these demonstrate target quality — adapt to the actual line, do not copy literally):',
    '',
    'EXAMPLE 1 — Personal sacrifice line: "I was selling cars at the time, grinding, cutting back, saying no to things I wanted"',
    '→ STRONGEST IDEA (emotional): stillImagePrompt: "Car dealership showroom lot at night, a lone salesperson at a cluttered desk past closing time, fluorescent overhead light casting harsh pools across polished hoods outside the glass, a printed inventory sheet and a half-eaten meal beside a phone showing a bank app with a low balance, warm but tired practical light." motionPrompt: "Slow push-in past the empty showroom floor toward the lit desk as fluorescent lights buzz, ending on extreme close-up of the glowing phone screen as the bank balance fills the frame. [SUFFIX]" why: "The specific job and the physical evidence of sacrifice — the inventory sheet, the meal, the bank balance — show grinding without explaining it."',
    '→ ALTERNATE (literal): stillImagePrompt: "Exterior of a used-car lot at night, rows of windshields catching the lot lights, a handwritten sale tag visible in one windshield, one overhead lamp buzzing, no people, cool-warm practical mix." motionPrompt: "Slow lateral dolly along the row of windshields as lot lights flicker, ending on extreme close-up of the handwritten price tag until the ink fills the frame. [SUFFIX]"',
    '→ ALTERNATE (symbolic): stillImagePrompt: "Close macro of a hand crossing out a line on a handwritten budget sheet on a kitchen table, a single lamp, a coffee mug, a stack of car-dealer paperwork, warm domestic light against deep shadow." motionPrompt: "Slow push-in toward the crossing-out hand, ending on extreme macro of the pen nib crossing out the number until the ink stroke fills the frame. [SUFFIX]"',
    '',
    'EXAMPLE 2 — First-generation wealth / family line: "$1,000 in the bank, nobody in your family has ever built real wealth"',
    '→ STRONGEST IDEA (symbolic): stillImagePrompt: "A check-cashing storefront window at dusk, neon CASH sign glowing orange-pink, a fee schedule posted on the glass, a person\'s reflection studying it from outside, cracked sidewalk, no legible text beyond the blurred fee grid, cool blue street contrasting the warm neon." motionPrompt: "Slow push toward the glass as the neon reflection blooms, ending on extreme close-up of the warm neon glow through the window until light fills the frame. [SUFFIX]" why: "The check-cashing window makes the cost of having no financial infrastructure physical and specific — it\'s where a $1,000 gap actually lives in the world."',
    '→ ALTERNATE (literal): stillImagePrompt: "Factory locker room at end of a shift, a single row of gray metal lockers, one slightly ajar showing a hard hat and a work glove, a pay envelope face-down on the bench, overhead fluorescent hum, tired but dignified, no people in frame, deep shadows at the edges." motionPrompt: "Slow push down the row of lockers toward the one left ajar, ending on extreme close-up of the pay envelope corner as fluorescent light catches the edge. [SUFFIX]"',
    '→ ALTERNATE (emotional): stillImagePrompt: "A bus stop at first light, a lone figure in a work uniform seated on the bench, a lunch pail on their lap, breath barely visible in the cold air, the city still dark behind them, sodium-vapor streetlight overhead as the only warm practical source." motionPrompt: "Slow push from behind the shelter pole toward the seated figure as the city starts to wake, ending on extreme close-up of the gloved hands folded over the lunch pail until the worn knuckles fill the frame. [SUFFIX]"',
    '',
    'EXAMPLE 3 — Financial mechanism / access line: "$250,000 liquid, qualified investor, that\'s who can access this deal"',
    '→ STRONGEST IDEA (symbolic): stillImagePrompt: "Private club entrance at dusk, a heavy wood-and-brass door slightly ajar with warm light spilling through, a suited doorman seen from behind checking a guest list on a clipboard, velvet rope across one side, marble steps, no legible signage." motionPrompt: "Slow push toward the brass door as the light from inside intensifies, ending on extreme close-up of the brass door handle as warm light blooms through the gap and fills the frame. [SUFFIX]" why: "The access barrier is the mechanism — showing the doorman and the door makes the qualified-investor threshold physical and human."',
    '→ ALTERNATE (literal): stillImagePrompt: "Dark home office at night, a single desk lamp on a glossy desk, a legal document with a signature line visible but no legible text, a pen resting on the page, a glass of water, quiet and deliberate, no screens." motionPrompt: "Slow push-in toward the pen on the signature line, ending on extreme close-up of the pen tip touching paper as the lamp light blooms to fill the frame. [SUFFIX]"',
    '→ ALTERNATE (symbolic): stillImagePrompt: "Exterior glass tower at dusk, floor-to-ceiling windows glowing amber from within, reflections of a street and ordinary people in the glass, dramatic tonal separation between inside warmth and outside cool blue, no legible signage." motionPrompt: "Slow push toward the glass facade, ending on extreme close-up of the window glass as the street reflection fades and pure amber interior light fills the frame. [SUFFIX]"',
    '',
    ...(previousIdeas && previousIdeas.length > 0
      ? [
          '',
          'PREVIOUSLY GENERATED — DO NOT REPEAT THESE VISUAL APPROACHES. Write three ideas that take this line somewhere completely different:',
          ...previousIdeas.map((idea, i) => `  ${i + 1}. ${idea}`),
          'The new ideas must NOT revisit these locations, props, or scenes. Find a different visual world entirely.'
        ]
      : []),
    '',
    'Output ONLY valid JSON matching this exact shape:',
    '{"brollIdeas":[{"style":"literal|emotional|symbolic","stillImagePrompt":"<static frame description>","motionPrompt":"<I2V motion ending with duration suffix>","prompt":"<unified director paragraph>","why":"<one editorial sentence>"},{"style":"literal|emotional|symbolic","stillImagePrompt":"<static frame description>","motionPrompt":"<I2V motion ending with duration suffix>","prompt":"<unified director paragraph>","why":"<one editorial sentence>"},{"style":"literal|emotional|symbolic","stillImagePrompt":"<static frame description>","motionPrompt":"<I2V motion ending with duration suffix>","prompt":"<unified director paragraph>","why":"<one editorial sentence>"}]}'
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.75,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a premium documentary director and visual storyteller — your standard is the intimate, scene-specific B-roll of the best Netflix and HBO documentary series. Your first instinct when reading a spoken line is: "What real moment, place, or memory does this speaker\'s life actually imply?" You write prompts from that specific personal world: a car dealership lot at closing time, a kitchen table with bills spread under a single lamp, a church parking lot conversation, a family member\'s face across a dinner table. The scene must feel like it could be a real memory from the speaker\'s life — with motivated practical lighting, at least one specific prop named or strongly implied by the exact words, and an emotional truth that matches the feeling of the line (grinding, sacrifice, exclusion, breakthrough, determination, quiet pride). When a line describes personal struggle, sacrifice, first-generation wealth, or a family dynamic — show that specific real-world moment, not a financial symbol. Generic financial shorthand (empty trading floors, bank vaults, holographic labs, brokerage laptops) is forbidden unless the spoken line is literally and explicitly about those things. Be visually inventive and emotionally truthful. Output only valid JSON.'
        },
        { role: 'user', content: userContent }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: body.slice(0, 400) || `OpenAI request failed (${res.status})` }
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = payload.choices?.[0]?.message?.content?.trim()
  if (!raw) {
    return { ok: false, error: 'Empty response from OpenAI.' }
  }

  try {
    const parsed = JSON.parse(raw) as { brollIdeas?: unknown }
    const ideas = normalizeSoundbiteBrollIdeas(parsed.brollIdeas)
    if (ideas.length === 0) {
      return { ok: false, error: 'Model returned no usable B-roll ideas.' }
    }
    return { ok: true, brollIdeas: ideas }
  } catch {
    return { ok: false, error: 'Could not parse B-roll JSON from OpenAI.' }
  }
}

function normalizeSoundbiteBrollIdeas(value: unknown): GroundedReviewBrollIdea[] {
  if (!Array.isArray(value)) return []
  const out: GroundedReviewBrollIdea[] = []
  const seen = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const style =
      r.style === 'emotional' || r.style === 'symbolic' ? r.style : ('literal' as const)
    const stillImagePrompt =
      typeof r.stillImagePrompt === 'string' ? r.stillImagePrompt.trim() : ''
    const motionPrompt = typeof r.motionPrompt === 'string' ? r.motionPrompt.trim() : ''
    const promptRaw = typeof r.prompt === 'string' ? r.prompt.trim() : ''
    const prompt =
      promptRaw ||
      (stillImagePrompt && motionPrompt ? `${stillImagePrompt} ${motionPrompt}`.trim() : stillImagePrompt || motionPrompt)
    if (!prompt) continue
    const why = typeof r.why === 'string' ? r.why.trim() : undefined
    const key = [style, stillImagePrompt, motionPrompt, prompt].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      style,
      prompt,
      ...(stillImagePrompt ? { stillImagePrompt } : {}),
      ...(motionPrompt ? { motionPrompt } : {}),
      why
    })
    if (out.length >= 3) break
  }
  return out
}
