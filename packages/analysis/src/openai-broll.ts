/** OpenAI chat implementation for B-roll prompts. Routed only via `StorytellerAiGateway` in the Electron main process (local or future proxy), not from the renderer. */
import type { BrollPrompt, StoryMode } from '@storyteller/shared'
import type { SubjectProfile } from '@storyteller/shared'
import { clampBrollShotDurationSeconds, DEFAULT_BROLL_SHOT_DURATION_SECONDS } from '@storyteller/shared'
import type { PromptPackDefinition } from './prompt-packs.js'

export interface BrollSegmentInput {
  id: string
  start: number
  end: number
  text: string
}

export interface AiBrollSegmentResult {
  segmentId: string
  segmentStart: number
  segmentEnd: number
  literal: string
  emotional: string
  symbolic: string
  runway: string
  kling: string
  toneTags: string[]
  score: number
}

/**
 * Tally non-empty descriptive fields so callers can decide whether the
 * profile actually has signal to emit. Visibility is intentionally excluded
 * — it's always set, and means something different from "the user told us
 * what their cast looks like."
 */
function subjectFieldCount(profile: SubjectProfile): number {
  return (
    (profile.ethnicityOrAppearance?.trim() ? 1 : 0) +
    (profile.genderPresentation?.trim() ? 1 : 0) +
    (profile.ageRange?.trim() ? 1 : 0) +
    (profile.skinTone?.trim() ? 1 : 0) +
    (profile.hairstyleNotes?.trim() ? 1 : 0) +
    (profile.wardrobeNotes?.trim() ? 1 : 0)
  )
}

/**
 * Render the user-facing CAST description that the model should obey.
 * Returned as a flowing prose phrase ("a Black person in their 20s-50s
 * with short braids, in a denim jacket") so it can be dropped directly
 * into a Subject clause of a generated shot.
 *
 * Returns an empty string when the profile has no descriptive fields —
 * callers should then fall back to "a person" or "a single figure alone".
 */
export function castDescription(profile: SubjectProfile): string {
  if (subjectFieldCount(profile) === 0) return ''
  const parts: string[] = []
  // Demographic core, in the order a viewer reads identity on screen.
  const demographics: string[] = []
  if (profile.ageRange?.trim()) demographics.push(`in their ${profile.ageRange.trim()}`)
  if (profile.ethnicityOrAppearance?.trim())
    demographics.push(profile.ethnicityOrAppearance.trim())
  if (profile.genderPresentation?.trim()) demographics.push(profile.genderPresentation.trim())
  const head = demographics.length > 0 ? `a ${demographics.join(' ')} person` : 'a person'
  parts.push(head)
  // Descriptive details, comma-joined.
  const details: string[] = []
  if (profile.skinTone?.trim()) details.push(`${profile.skinTone.trim()} skin`)
  if (profile.hairstyleNotes?.trim()) details.push(profile.hairstyleNotes.trim())
  if (profile.wardrobeNotes?.trim()) details.push(`wearing ${profile.wardrobeNotes.trim()}`)
  if (details.length > 0) parts.push(details.join(', '))
  return parts.join(', ')
}

/**
 * One reference shot the LLM should match for *depth and specificity* — not
 * for demographics or topic. We construct it from the user's actual profile
 * so the model isn't anchored to a fixed cast (the previous reference
 * example always said "a Black woman", which was leaking into every
 * output). The structure deliberately models the cinematic checklist we
 * want every emitted shot to hit:
 *
 *   subject → setting + time anchor → motivated practical → specific prop →
 *   physical micro-detail (not a feeling word) → camera move → DOF/lens →
 *   style note → duration
 *
 * If the profile is empty we use a neutral subject ("a single figure alone
 * in frame") so the example still demonstrates that level — just without
 * prescribing demographics.
 */
export function subjectQualityBar(
  profile: SubjectProfile,
  shotDurationSeconds: number = DEFAULT_BROLL_SHOT_DURATION_SECONDS
): string {
  const cast = castDescription(profile) || 'a single figure alone in frame'
  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)
  return [
    `${cast} sitting alone at a worn kitchen table at 2AM,`,
    'laptop open to a stack of overdue bills,',
    'soft television glow flickering across the face,',
    'exhausted eyes catching the light,',
    'realistic apartment environment with practical lamp in the background,',
    'subtle camera push-in on a 35mm lens,',
    'shallow depth of field, high-contrast cinematic shadows,',
    `photoreal documentary realism, ${dur} seconds, single continuous take, no on-screen text.`
  ].join(' ')
}

export function subjectInstructions(profile: SubjectProfile): string {
  const lines: string[] = []
  switch (profile.visibility) {
    case 'no_visible_people':
      lines.push(
        'VISIBILITY: No visible people. Use environments, objects, hands-free work, abstract textures, architecture, nature, or symbolic non-human imagery only. Do not describe faces or bodies.'
      )
      break
    case 'hands_only':
      lines.push(
        'VISIBILITY: Hands and props only — close-ups of hands working, objects, tools. No faces or identifiable full bodies.'
      )
      break
    case 'diverse_crowd':
      lines.push(
        'VISIBILITY: Anonymous diverse crowd / group shots. If SUBJECT PROFILE specifies identity below, weight the crowd toward that identity but keep some diversity in supporting figures. Avoid stereotypical crowd shorthand.'
      )
      break
    default:
      lines.push(
        'VISIBILITY: Standard — people may appear when relevant to the transcript. Use the SUBJECT PROFILE for any on-screen person the shot centers. If the profile field is empty, do NOT invent ethnicity, gender, or age — keep people generic or silhouetted unless the transcript clearly implies identity.'
      )
  }

  const has = subjectFieldCount(profile)
  /**
   * Apply the user's profile fields whenever people may be visible.
   * `standard` always counts; `diverse_crowd` also counts because the
   * user explicitly described who the crowd is. `no_visible_people`
   * and `hands_only` never call out demographics by definition.
   */
  const peopleAllowed = profile.visibility === 'standard' || profile.visibility === 'diverse_crowd'
  if (has > 0 && peopleAllowed) {
    lines.push(
      `SUBJECT PROFILE (apply EXACTLY when a visible person is central to the shot — this is "${castDescription(profile)}"):`
    )
    if (profile.ethnicityOrAppearance?.trim())
      lines.push(`- Ethnicity / appearance: ${profile.ethnicityOrAppearance.trim()}`)
    if (profile.genderPresentation?.trim())
      lines.push(`- Gender presentation: ${profile.genderPresentation.trim()}`)
    if (profile.ageRange?.trim()) lines.push(`- Age range: ${profile.ageRange.trim()}`)
    if (profile.skinTone?.trim()) lines.push(`- Skin tone: ${profile.skinTone.trim()}`)
    if (profile.hairstyleNotes?.trim()) lines.push(`- Hair: ${profile.hairstyleNotes.trim()}`)
    if (profile.wardrobeNotes?.trim()) lines.push(`- Wardrobe: ${profile.wardrobeNotes.trim()}`)
  }

  lines.push(
    'Never default all characters to one ethnicity. Never omit user-specified identity when they provided it and a person is visible.'
  )
  return lines.join('\n')
}

export function packInstructionsCompact(pack: PromptPackDefinition): string {
  return `STYLE PACK: ${pack.label}
Tone: ${pack.tone}
Camera: ${pack.cameraStyle}
Lighting: ${pack.lighting}
Motion: ${pack.motionStyle}
Environment: ${pack.environmentStyle}
Detail: ${pack.detailLevel}`
}

const CHUNK_SIZE = 8

export async function generateBrollPromptsOpenAI(params: {
  apiKey: string
  model?: string
  segments: BrollSegmentInput[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  aiDirection: string
  mode: StoryMode
  /** Per-shot duration (defaults to 8s). */
  shotDurationSeconds?: number
  onProgress?: (p: { phase: string; detail?: string; chunk?: number; chunkTotal?: number }) => void
}): Promise<{ ok: true; results: AiBrollSegmentResult[] } | { ok: false; error: string }> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    segments,
    subjectProfile,
    promptPack,
    aiDirection,
    mode,
    shotDurationSeconds,
    onProgress
  } = params
  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)

  if (!segments.length) {
    return { ok: false, error: 'No transcript segments to generate from.' }
  }

  const chunks: BrollSegmentInput[][] = []
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    chunks.push(segments.slice(i, i + CHUNK_SIZE))
  }

  const all: AiBrollSegmentResult[] = []
  const chunkTotal = chunks.length

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!
    onProgress?.({ phase: 'generating', detail: `OpenAI chunk ${c + 1}/${chunkTotal}`, chunk: c + 1, chunkTotal })

    const userContent = [
      `PROJECT_MODE: ${mode}`,
      `AI_DIRECTION: ${aiDirection || '(none)'}`,
      `SHOT_DURATION_SECONDS: ${dur} (write every shot for this exact length — no ranges)`,
      '',
      packInstructionsCompact(promptPack),
      '',
      subjectInstructions(subjectProfile),
      '',
      'TRANSCRIPT_SEGMENTS (one JSON array):',
      JSON.stringify(
        chunk.map((s) => ({ id: s.id, start: s.start, end: s.end, text: s.text })),
        null,
        2
      ),
      '',
      'For EACH segment, output literal, emotional, and symbolic B-roll prompts.',
      'Every B-roll prompt must be premium and cinematic while staying grounded in that exact segment. The selected soundbite is the source of truth; do not invent facts, names, numbers, locations, or outcomes not implied by it.',
      'Think premium documentary/commercial B-roll: rich production design, motivated practical light, atmosphere, texture, precise props, controlled camera movement, and a visual metaphor or scene that an editor would actually cut against the line.',
      'PENALTY: Do NOT use these phrases: "single figure alone in frame", "observed from a respectful distance", "Posture, breath, hands", "available light", "quiet, naturally-lit interior space", "slow handheld drift" — these are generic training clichés.',
      `Write RUNWAY and KLING prompts as one dense paragraph: specific subject (age/demographic/action) + specific location/time + named light source + visible prop/stakes + camera movement tied to emotion + lens + end with "${dur} seconds, photoreal, no text".`,
      'SCENE STRUCTURE: [WHO: specific demographic] + [WHERE: exact location/time] + [WHAT: visible stakes/props] + [LIGHT: named source] + [MOVE: camera serves emotion]',
      'If the transcript mentions technology/money/objects, SHOW those specifically. If it mentions relationships/tension, SHOW two people or visible reactions. If abstract, SHOW texture/scale/geometry.',
      `Quality bar (match the depth, not the demographics): "${subjectQualityBar(subjectProfile, dur)}"`,
      'Return ONLY valid JSON with shape: {"items":[{"segmentId":"","segmentStart":0,"segmentEnd":0,"literal":"","emotional":"","symbolic":"","runway":"","kling":"","toneTags":[],"score":0.85}]}',
      'Scores 0–1 for expected usefulness. toneTags: 3–6 short tags.'
    ].join('\n')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a senior documentary and commercial DP writing premium cinematic B-roll briefs for AI video generators (Runway, Kling, VEO). Every prompt must correlate directly with the selected transcript segment.\n\n' +
              '⚠️ CRITICAL - AVOID THESE CLICHÉ PATTERNS:\n' +
              '❌ NEVER START WITH: "a single figure alone in frame, observed from a respectful distance"\n' +
              '❌ NEVER USE: "Posture, breath, hands, and available light carry the subtext"\n' +
              '❌ NEVER USE: "quiet, naturally-lit interior space" as generic setting\n' +
              '❌ NEVER USE: "slow handheld drift" as default camera move\n' +
              '❌ NEVER USE: "available light" - name the specific source\n\n' +
              '✅ GOOD EXAMPLE (Cinematic Documentary):\n' +
              '"A Black woman in her late 30s sitting alone at her kitchen table at 2AM, laptop open to overdue bills, soft television glow flickering across her face, exhausted eyes. Subtle camera push-in as tension builds. High contrast shadows, realistic apartment, 8 seconds."\n\n' +
              '✅ GOOD EXAMPLE (Viral Social):\n' +
              '"A stylish man stepping out of a luxury car in designer clothes, smiling for social media. Camera circles him as overdraft notification flashes on his phone screen - smile slowly fading. Dramatic urban lighting, 8 seconds."\n\n' +
              '✅ GOOD EXAMPLE (Symbolic):\n' +
              '"Close-up of multiple credit cards sliding across a dark table under harsh lighting, balances increasing rapidly. Anxious breathing in background. Macro lens cinematography, texture tells the story, 8 seconds."\n\n' +
              'REQUIREMENTS FOR EVERY PROMPT:\n' +
              '1. START with the specific subject: age/race/gender + specific action + specific location/time\n' +
              '2. INCLUDE visible stakes: laptop with bills, phone notification, documents, objects that carry meaning\n' +
              '3. NAME the light source specifically: "television glow flickering", "streetlight spill", "laptop screen", "rain-streaked window"\n' +
              '4. CAMERA MOVE serves emotion: push-in for realization, circle for transformation, whip pan for contrast, static for tension\n' +
              '5. MAKE IT PREMIUM: high-end documentary/commercial polish, realistic production design, atmosphere, rich contrast, precise props, cinematic texture\n' +
              '6. END with: duration + "photoreal, no text"\n\n' +
              'PROMPT TYPE DISTINCTIONS:\n' +
              'LITERAL: Wide establishing, real environment, identifiable context. Subject matter clearly visible. 24-35mm.\n' +
              'EMOTIONAL: Human reaction visible, relationship/chemistry present, two-shots or intimate with context. 40-50mm.\n' +
              'SYMBOLIC: Macro detail OR wide abstraction, subject may be absent, texture/geometry carries meaning. 50-85mm macro or 24mm wide.\n\n' +
              'Output valid JSON only.'
          },
          { role: 'user', content: userContent }
        ]
      })
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `OpenAI ${res.status}: ${errText.slice(0, 400)}` }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = data.choices?.[0]?.message?.content
    if (!raw) return { ok: false, error: 'Empty response from OpenAI.' }

    let parsed: { items?: unknown }
    try {
      parsed = JSON.parse(raw) as { items?: unknown }
    } catch {
      return { ok: false, error: 'Could not parse JSON from OpenAI.' }
    }

    const items = parsed.items
    if (!Array.isArray(items)) {
      return { ok: false, error: 'OpenAI JSON missing items array.' }
    }

    for (const row of items) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const segmentId = typeof r.segmentId === 'string' ? r.segmentId : ''
      const literal = typeof r.literal === 'string' ? r.literal : ''
      const emotional = typeof r.emotional === 'string' ? r.emotional : ''
      const symbolic = typeof r.symbolic === 'string' ? r.symbolic : ''
      const runway = typeof r.runway === 'string' ? r.runway : literal
      const kling = typeof r.kling === 'string' ? r.kling : literal
      const toneTags = Array.isArray(r.toneTags) ? r.toneTags.filter((t): t is string => typeof t === 'string') : []
      const score = typeof r.score === 'number' ? Math.min(1, Math.max(0, r.score)) : 0.8
      const segStart = typeof r.segmentStart === 'number' ? r.segmentStart : 0
      const segEnd = typeof r.segmentEnd === 'number' ? r.segmentEnd : 0

      const seg = chunk.find((s) => s.id === segmentId)
      const start = seg ? seg.start : segStart
      const end = seg ? seg.end : segEnd

      if (!literal && !emotional && !symbolic) continue

      all.push({
        segmentId,
        segmentStart: start,
        segmentEnd: end,
        literal,
        emotional,
        symbolic,
        runway,
        kling,
        toneTags,
        score
      })
    }
  }

  return { ok: true, results: all }
}

/** Expand model output to per-row prompts for UI + NLE-style lists. */
export function flattenAiBrollToPromptRows(
  projectId: string,
  results: AiBrollSegmentResult[],
  stylePackId: string,
  stylePackLabel: string
): Omit<BrollPrompt, 'id' | 'created_at'>[] {
  const out: Omit<BrollPrompt, 'id' | 'created_at'>[] = []
  for (const r of results) {
    const triple: Array<{ t: 'literal' | 'emotional' | 'symbolic'; text: string }> = [
      { t: 'literal', text: r.literal },
      { t: 'emotional', text: r.emotional },
      { t: 'symbolic', text: r.symbolic }
    ]
    for (const { t, text } of triple) {
      const trimmed = text.trim()
      if (!trimmed) continue
      out.push({
        project_id: projectId,
        segment_start: r.segmentStart,
        segment_end: r.segmentEnd,
        prompt_type: t,
        prompt_text: trimmed,
        priority_score: r.score,
        metadata_json: {
          stylePack: stylePackLabel,
          stylePackId,
          sourceSegmentId: r.segmentId,
          toneTags: r.toneTags,
          providerPrompts: {
            primary: trimmed,
            runway: r.runway,
            kling: r.kling
          },
          aiGenerated: true,
          confidence: r.score
        }
      })
    }
  }
  return out
}
