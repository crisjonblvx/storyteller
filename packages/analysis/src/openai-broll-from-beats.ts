/**
 * Beat-driven, single-API-call B-roll prompt writer.
 *
 * The legacy heuristic walks the entire transcript in 30s windows and emits 3
 * cards per window — way too noisy. This path takes a small, hand-picked list
 * of beats (intro clips, saved-timeline clips, soundbites) and asks the model
 * to write ONE shot per beat, with a style chosen to match the spoken line.
 *
 * Routed only via `StorytellerAiGateway` in the Electron main process — never
 * called from the renderer (no provider keys in the browser).
 */
import type { BrollPrompt, StoryMode, SubjectProfile } from '@storyteller/shared'
import { clampBrollShotDurationSeconds } from '@storyteller/shared'
import type { PromptPackDefinition } from './prompt-packs.js'
import {
  castDescription,
  packInstructionsCompact,
  subjectInstructions,
  subjectQualityBar
} from './openai-broll.js'
import {
  type BrollBeat,
  dedupeBeatsBySourceWindow,
  generateBrollPromptsFromBeats
} from './broll-from-beats.js'

export interface AiBeatPromptResult {
  beatId: string
  style: 'literal' | 'emotional' | 'symbolic'
  /** Concise editorial line shown in the card body. */
  primary: string
  /** Provider-ready dense paragraph for Runway. */
  runway: string
  /** Provider-ready paragraph for Kling. */
  kling: string
  /** 0..1 — model's own confidence; UI shows this on the card. */
  score: number
  /** 3-6 short tags. */
  toneTags: string[]
  /** Two-line "why this shot" reasoning the writer can show in the inspector. */
  rationale?: string
}

const BATCH_SIZE = 12

export interface GenerateBrollPromptsFromBeatsOpenAIParams {
  apiKey: string
  model?: string
  beats: BrollBeat[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  aiDirection: string
  mode: StoryMode
  /**
   * Per-shot duration the writer should target (matches the project's
   * configured B-roll shot length — defaults to 8s). Threaded into every
   * `primary` / `runway` / `kling` string so the model writes for the
   * same shot length we'll later send to Runway / VEO 3 / Kling.
   */
  shotDurationSeconds?: number
  onProgress?: (p: { phase: string; detail?: string; chunk?: number; chunkTotal?: number }) => void
}

export async function generateBrollPromptsFromBeatsOpenAI(
  params: GenerateBrollPromptsFromBeatsOpenAIParams
): Promise<{ ok: true; results: AiBeatPromptResult[] } | { ok: false; error: string }> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    beats,
    subjectProfile,
    promptPack,
    aiDirection,
    mode,
    shotDurationSeconds,
    onProgress
  } = params
  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)

  const cleaned = dedupeBeatsBySourceWindow(beats)
  if (cleaned.length === 0) {
    return { ok: false, error: 'No beats to generate prompts from.' }
  }

  const chunks: BrollBeat[][] = []
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    chunks.push(cleaned.slice(i, i + BATCH_SIZE))
  }

  const all: AiBeatPromptResult[] = []
  const chunkTotal = chunks.length

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!
    onProgress?.({
      phase: 'generating',
      detail: `Writing beat prompts ${c + 1}/${chunkTotal}…`,
      chunk: c + 1,
      chunkTotal
    })

    const userContent = [
      `PROJECT_MODE: ${mode}`,
      `AI_DIRECTION: ${aiDirection || '(none)'}`,
      `SHOT_DURATION_SECONDS: ${dur} (write every shot for this exact length — no ranges)`,
      '',
      packInstructionsCompact(promptPack),
      '',
      subjectInstructions(subjectProfile),
      '',
      'BEATS — each one is a single moment from the edit timeline that needs a B-roll cover shot:',
      JSON.stringify(
        chunk.map((b) => ({
          id: b.id,
          start: b.source_start,
          end: b.source_end,
          line: b.transcript_text,
          origin: b.origin ?? 'beat'
        })),
        null,
        2
      ),
      '',
      'TASK — for EACH beat, write ONE B-roll shot (not three). First, choose the single most useful style from {literal, emotional, symbolic} based on what the line is *about*:',
      '  - literal:   line names concrete people, places, or objects → cover shot of that scene',
      '  - emotional: line is about a feeling → faces, hands, light, warmth/cold',
      '  - symbolic:  line is metaphor / abstraction → texture, weather, scale, rhythm (no faces required)',
      '',
      'STRUCTURE — every `primary`, `runway`, and `kling` value MUST be one dense paragraph (one or two sentences max) that hits ALL of the following slots in order. Do not label them; write them as flowing prose:',
      '  1. Subject  – who/what is in frame. CAST EXACTLY per SUBJECT_PROFILE above. If the profile names ethnicity / age / gender, use those words; if a field is blank, do NOT invent it (use "a person", "a single figure alone", or no-person framing instead). Never default to any one ethnicity globally.',
      '  2. Setting + time anchor – grounded location AND a specific time-of-day or environmental anchor (e.g. "at her kitchen table at 2AM", "on a wet city street just after the rain stops", "in the parked car at golden hour"). Generic interiors are forbidden — name the room AND the hour or weather.',
      '  3. Specific prop in frame – one motivated object the audience can actually see (laptop open to overdue bills, a phone screen flashing overdraft alerts, a stack of unopened red final notices, a coffee gone cold, a gym bag on the passenger seat). NOT abstract nouns.',
      '  4. Action  – one filmable micro-action with an emotional micro-arc (smile slowly fading, hand pausing over the keyboard, eyes drifting from the screen to the window, breath catching once).',
      '  5. Motivated practical – name the actual light source (television glow, sodium-vapor streetlight through blinds, single overhead bulb, screen reflected in his glasses, dawn through trees). The light has to come from something visible in the world of the shot.',
      '  6. Lens + camera move + DOF – e.g. "subtle 35mm push-in, shallow depth of field", "50mm handheld drift, focus slipping between her eyes and the bills", "macro 100mm on the credit cards, rack focus to the rising balance". Always name lens, move, and DOF.',
      '  7. Style note – a short cinematic descriptor: "cinematic realism", "high-contrast documentary realism", "editorial photoreal", etc.',
      `  8. Exit frame + duration – Write one sentence describing the shot's final 1–2 seconds — choose the ending that feels most earned by the specific props, setting, and action you already described in slots 1–7. Do NOT default to "push into the dominant texture" — that phrase is overused. Instead pick the exit that belongs to THIS shot: it might end on a specific named object (the cold meal between them, the folded bills in the wallet, the edge of the legal pad), or on the light source itself (the side-door amber spilling across the floor), or on a held detail (the phone face-down beside the budget, the hand going still), or on a small physical moment (the breath releasing, the eyes closing once). The ending should feel like the natural visual portal back to the interview — specific, not formulaic. Then end with: "${dur} seconds, single continuous take, photoreal, no on-screen text".`,
      '',
      'IMAGERY RULES — extract concrete nouns and verbs FROM THE LINE ITSELF and dramatize them.',
      '  • Do NOT include televisions, TV monitors, computer monitors, or background screens unless the spoken line explicitly describes watching or using one. Domestic and office interiors must NOT have background TVs as set dressing.',
      '  • If the beat is explaining a mechanism, hidden value, uncertainty, gatekeeping, liquidity, valuation distortion, or another invisible system, choose the style that makes the mechanism legible — often symbolic or emotional, not literal.',
      '  • Generic finance shorthand is forbidden unless the beat is explicitly about a screen or trading terminal: no default laptop-on-desk, no generic charts wall, no person typing at a desk, no abstract market dashboard as the main image.',
      '  • Avoid repeating the same business-tech image language across beats. Different lines should land in different visual worlds.',
      '  • Metaphors must stay documentary-plausible and emotionally disciplined. Real-world production design is good; over-stylized fantasy concept art is not.',
      '  • Every shot must have at LEAST one visible motivated prop and a specific time/weather anchor — never just "a quiet room".',
      '  • Every shot must have at LEAST one physical micro-detail (a tear forming, a smile fading, knuckles tightening, breath visible in cold air). No abstract feeling words floating without a body to land in.',
      '  • Every shot must name a real light source you can see, not just "cinematic lighting".',
      '  • If the line says "I rub my face at midnight while bills pile up", the shot is the person at the kitchen table at 2AM, overdue bills lit by the laptop screen, single overhead bulb, rubbing the face once — exhausted. Subtle 35mm push-in, shallow depth of field, high-contrast cinematic shadows.',
      '  • If the line says "my daughter wrote the foreword", anchor on a young person holding a worn paperback at the bedroom desk, lamplight on the page, a parent reading it back at the kitchen — NOT a generic "books on a table".',
      '  • If the line is metaphor (mis-knowing, frozen, reactive, drift), the shot is environment-as-metaphor (a figure walking confidently the wrong way through fog at dawn; rain pooling around motionless feet on a sidewalk) — still with a specific time/weather anchor and visible practical light, never abstract.',
      '',
      'FORBIDDEN PHRASES — do NOT use any of these. They are template boilerplate from a previous version and reading them means the writer failed:',
      '  • "Cinematic shot:" / "Emotional beat:" / "Symbolic texture:" as openers',
      '  • "Camera: slow push-in on a 35mm lens, subtle handheld stabilization." (label-style sentence)',
      '  • "Lighting: motivated practicals, natural contrast." (label-style sentence)',
      '  • "Style: cinematic lighting, shallow depth of field, slow dolly or handheld micro-movement." (label-style sentence)',
      '  • "in a quiet room" / "in a dim space" / "naturally-lit interior" with no time, weather, or prop anchor',
      '  • "8–12 seconds" or any duration range — write every shot for exactly the SHOT_DURATION_SECONDS above',
      '  • Any sentence that quotes the transcript verbatim ("From transcript: …") instead of describing what to film',
      '',
      'Obey the SUBJECT / VISIBILITY rules. Obey the STYLE PACK. No two beats may share an opening clause.',
      '',
      'Output ONLY valid JSON: {"items":[{"beatId":"","style":"literal|emotional|symbolic","primary":"","runway":"","kling":"","toneTags":[],"score":0.85,"rationale":"one short sentence on why this shot for this line"}]}'
    ].join('\n')

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are a senior cinematic Director of Photography writing ONE specific B-roll shot per spoken beat for AI video models (Runway gen4.5, VEO 3, Kling).',
              'Every shot must read as actual scene direction with the visual depth of a feature film: a specific time-of-day or weather anchor, a motivated practical light source named explicitly, at least one visible prop tied to the line, a filmable physical micro-action with an emotional micro-arc, and a named lens + camera move + DOF.',
              'You are explicitly NOT a template engine. Generic openers, label-style sentences ("Camera: …", "Lighting: …", "Style: …"), and vague rooms ("a quiet space", "a dim room") are forbidden — they are the boilerplate this prompt is replacing.',
              `Reference quality bar (match this level of cinematic specificity, not the demographics or topic): "${subjectQualityBar(subjectProfile, dur)}". Output valid JSON only.`
            ].join(' ')
          },
          { role: 'user', content: userContent }
        ]
      })
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `OpenAI ${res.status}: ${errText.slice(0, 400)}` }
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
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
      const beatId = typeof r.beatId === 'string' ? r.beatId : ''
      const style =
        r.style === 'emotional' || r.style === 'symbolic' ? r.style : ('literal' as const)
      const primary = typeof r.primary === 'string' ? r.primary.trim() : ''
      const runway = typeof r.runway === 'string' ? r.runway.trim() : primary
      const kling = typeof r.kling === 'string' ? r.kling.trim() : primary
      const toneTags = Array.isArray(r.toneTags)
        ? r.toneTags.filter((t): t is string => typeof t === 'string')
        : []
      const score = typeof r.score === 'number' ? Math.min(1, Math.max(0, r.score)) : 0.8
      const rationale = typeof r.rationale === 'string' ? r.rationale : undefined
      if (!beatId || !primary) continue
      all.push({ beatId, style, primary, runway, kling, toneTags, score, rationale })
    }
  }

  return { ok: true, results: all }
}

/**
 * Convert AI per-beat results back into the BrollPrompt shape the UI cards
 * already render. We re-attach the source window from the original beats list
 * so anchor / mapping logic still works.
 */
export function flattenAiBeatsToPromptRows(
  projectId: string,
  beats: BrollBeat[],
  results: AiBeatPromptResult[],
  stylePackId: string,
  stylePackLabel: string,
  subjectProfile?: SubjectProfile
): Omit<BrollPrompt, 'id' | 'created_at'>[] {
  const beatById = new Map(beats.map((b) => [b.id, b]))
  const out: Omit<BrollPrompt, 'id' | 'created_at'>[] = []
  const cast = subjectProfile ? castDescription(subjectProfile) : ''
  const visibility = subjectProfile?.visibility ?? 'standard'
  for (const r of results) {
    const beat = beatById.get(r.beatId)
    if (!beat) continue
    out.push({
      project_id: projectId,
      segment_start: beat.source_start,
      segment_end: beat.source_end,
      prompt_type: r.style,
      prompt_text: r.primary,
      priority_score: r.score,
      metadata_json: {
        category: r.style,
        stylePack: stylePackLabel,
        stylePackId,
        sourceWindow: { start: beat.source_start, end: beat.source_end },
        sourceSpan: { start: beat.source_start, end: beat.source_end },
        transcriptExcerpt: beat.transcript_text.slice(0, 400),
        toneTags: r.toneTags,
        beatId: beat.id,
        beatOrigin: beat.origin ?? 'beat',
        promptSource: 'beats-ai',
        rationale: r.rationale ?? null,
        castDescription: cast || null,
        subjectVisibility: visibility,
        providerPrompts: {
          primary: r.primary,
          runway: r.runway,
          kling: r.kling
        },
        aiGenerated: true,
        confidence: r.score
      }
    })
  }
  return out
}

/**
 * Helper for the gateway: try OpenAI, fall back to deterministic on any error.
 * The gateway never wants to surface "AI failed → no list" — a cinematic
 * deterministic line is always better than nothing.
 */
export async function generateBeatsPromptsWithFallback(params: {
  apiKey: string | undefined
  model?: string
  projectId: string
  beats: BrollBeat[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  aiDirection: string
  mode: StoryMode
  /** Per-shot duration (defaults to 8s when omitted). */
  shotDurationSeconds?: number
  onProgress?: (p: { phase: string; detail?: string; chunk?: number; chunkTotal?: number }) => void
}): Promise<{
  ok: true
  prompts: Omit<BrollPrompt, 'id' | 'created_at'>[]
  source: 'ai' | 'deterministic'
  reason?: string
}> {
  const dur = clampBrollShotDurationSeconds(params.shotDurationSeconds)
  const fallback = (reason?: string) => ({
    ok: true as const,
    source: 'deterministic' as const,
    reason,
    prompts: generateBrollPromptsFromBeats(params.projectId, params.beats, {
      mode: params.mode,
      directionText: params.aiDirection,
      subjectProfile: params.subjectProfile,
      shotDurationSeconds: dur
    })
  })

  if (!params.apiKey) {
    return fallback('OPENAI_API_KEY not set — used deterministic writer.')
  }

  try {
    const res = await generateBrollPromptsFromBeatsOpenAI({
      apiKey: params.apiKey,
      model: params.model,
      beats: params.beats,
      subjectProfile: params.subjectProfile,
      promptPack: params.promptPack,
      aiDirection: params.aiDirection,
      mode: params.mode,
      shotDurationSeconds: dur,
      onProgress: params.onProgress
    })
    if (!res.ok) return fallback(res.error)
    const rows = flattenAiBeatsToPromptRows(
      params.projectId,
      params.beats,
      res.results,
      params.promptPack.id,
      params.promptPack.label,
      params.subjectProfile
    )
    if (rows.length === 0) return fallback('AI returned 0 rows — used deterministic writer.')
    return { ok: true, source: 'ai', prompts: rows }
  } catch (err) {
    return fallback(err instanceof Error ? err.message : 'AI writer threw an error.')
  }
}
