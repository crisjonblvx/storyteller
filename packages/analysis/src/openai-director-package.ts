import type { StoryMode } from '@storyteller/shared'
import type { SubjectProfile } from '@storyteller/shared'
import { clampBrollShotDurationSeconds } from '@storyteller/shared'
import type { PromptPackDefinition } from './prompt-packs.js'
import { STORYTELLER_TRANSCRIPT_CONTENT_PACKAGE_PROMPT } from './creative-director-prompt.js'
import type { ExtractedClipCandidate } from './clip-candidate-extractor.js'
import { inferBrollTone } from './ai-direction.js'
import { buildCinematicBrollPrompt } from './broll-providers.js'
import type { AiBrollSegmentResult } from './openai-broll.js'
import { packInstructionsCompact, subjectInstructions, subjectQualityBar } from './openai-broll.js'

export type DirectorCreativePackage = {
  viralIntroScript?: string
  soundBites?: Array<{
    candidateId?: string
    title?: string
    quote?: string
    timestampHint?: string
    why?: string
  }>
  microHooks?: string[]
  cliffhangers?: string[]
  visualIdeas?: string[]
  creativeDirection?: string
}

type DirectorBrollItem = {
  candidateId?: string
  literal?: string
  emotional?: string
  symbolic?: string
  runway?: string
  kling?: string
  toneTags?: unknown
  score?: unknown
}

function jsonShape(durationSeconds: number, qualityBar: string): string {
  return `Return ONLY valid JSON with this shape (no markdown):
{
  "viralIntroScript": "string — 0:00–1:00 intro, timestamped lines",
  "soundBites": [{ "candidateId": "uuid-from-candidates", "title": "", "quote": "", "timestampHint": "", "why": "" }],
  "microHooks": ["4–12 word lines"],
  "cliffhangers": ["retention lines"],
  "visualIdeas": ["edit / graphic ideas"],
  "creativeDirection": "string",
  "brollItems": [{
    "candidateId": "uuid-from-candidates",
    "literal": "",
    "emotional": "",
    "symbolic": "",
    "runway": "",
    "kling": "",
    "toneTags": ["tag"],
    "score": 0.85
  }]
}

STRICT RULES:
- Every candidateId in soundBites and brollItems must match an id from CANDIDATES_JSON exactly.
- Do not invent new candidate ids or paraphrase quotes for soundBites.quote — use the candidate text or a clearly marked subset that remains a complete thought.
- Up to 18 brollItems, strongest first.

CINEMATIC B-ROLL (CRITICAL):
- Do NOT describe the speaker literally talking, explaining, or facing camera.
- Translate the IDEA into a movie shot: subject, setting + time-of-day or weather anchor, motivated practical light source named explicitly, at least one visible prop tied to the line, a filmable physical micro-action with an emotional micro-arc, named lens + camera move + DOF, style note, then duration.
- "literal", "emotional", and "symbolic" must all be cinematic scene briefs at this depth (different angles on the same idea), not transcript narration.
- runway / kling: dense single-paragraph prompts for AI video (Runway gen4.5 / VEO 3 / Kling), photoreal, no on-screen text.
- Every shot writes for EXACTLY ${durationSeconds} seconds, single continuous take. Do not use ranges like "8–12s".
- Quality bar (match the level of detail, not the demographics or topic): "${qualityBar}"

FORBIDDEN — these are template boilerplate from a previous version:
- "Cinematic shot:" / "Emotional beat:" / "Symbolic texture:" as openers
- Label-style sentences ("Camera: …", "Lighting: …", "Style: …")
- Vague rooms with no time, weather, or prop anchor ("a quiet room", "a dim space")
- Duration ranges (write the exact ${durationSeconds}s value)`
}

function parseDirectorJson(raw: string): DirectorCreativePackage & { brollItems?: DirectorBrollItem[] } {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const brollItems = Array.isArray(parsed.brollItems)
    ? (parsed.brollItems as DirectorBrollItem[])
    : undefined
  return {
    viralIntroScript: typeof parsed.viralIntroScript === 'string' ? parsed.viralIntroScript : undefined,
    soundBites: Array.isArray(parsed.soundBites) ? (parsed.soundBites as DirectorCreativePackage['soundBites']) : undefined,
    microHooks: Array.isArray(parsed.microHooks)
      ? parsed.microHooks.filter((x): x is string => typeof x === 'string')
      : undefined,
    cliffhangers: Array.isArray(parsed.cliffhangers)
      ? parsed.cliffhangers.filter((x): x is string => typeof x === 'string')
      : undefined,
    visualIdeas: Array.isArray(parsed.visualIdeas)
      ? parsed.visualIdeas.filter((x): x is string => typeof x === 'string')
      : undefined,
    creativeDirection: typeof parsed.creativeDirection === 'string' ? parsed.creativeDirection : undefined,
    brollItems
  }
}

function fallbackAiResultsFromCandidates(
  candidates: ExtractedClipCandidate[],
  mode: StoryMode,
  aiDirection: string,
  shotDurationSeconds: number
): AiBrollSegmentResult[] {
  const tone = inferBrollTone(aiDirection)
  const out: AiBrollSegmentResult[] = []
  for (const c of candidates.slice(0, 14)) {
    const bundle = buildCinematicBrollPrompt({
      ideaSummary: c.text,
      mode,
      directionText: aiDirection,
      toneHint: tone,
      shotDurationSeconds
    })
    const primarySeg = c.sourceSegmentIds[0] ?? c.id
    out.push({
      segmentId: primarySeg,
      segmentStart: c.start,
      segmentEnd: c.end,
      literal: bundle.literal,
      emotional: bundle.emotional,
      symbolic: bundle.symbolic,
      runway: bundle.runway,
      kling: bundle.kling,
      toneTags: ['cinematic-fallback'],
      score: 0.52
    })
  }
  return out
}

function directorItemsToAiResults(
  items: DirectorBrollItem[],
  byCandidateId: Map<string, ExtractedClipCandidate>
): AiBrollSegmentResult[] {
  const out: AiBrollSegmentResult[] = []
  for (const row of items) {
    const id = typeof row.candidateId === 'string' ? row.candidateId : ''
    const c = id ? byCandidateId.get(id) : undefined
    if (!c) continue
    const literal = typeof row.literal === 'string' ? row.literal : ''
    const emotional = typeof row.emotional === 'string' ? row.emotional : ''
    const symbolic = typeof row.symbolic === 'string' ? row.symbolic : ''
    if (!literal && !emotional && !symbolic) continue
    const toneTags = Array.isArray(row.toneTags)
      ? row.toneTags.filter((t): t is string => typeof t === 'string')
      : []
    const score = typeof row.score === 'number' && Number.isFinite(row.score) ? Math.min(1, Math.max(0, row.score)) : 0.82
    const runway = typeof row.runway === 'string' && row.runway.trim() ? row.runway : literal
    const kling = typeof row.kling === 'string' && row.kling.trim() ? row.kling : literal
    const primarySeg = c.sourceSegmentIds[0] ?? c.id
    out.push({
      segmentId: primarySeg,
      segmentStart: c.start,
      segmentEnd: c.end,
      literal,
      emotional,
      symbolic,
      runway,
      kling,
      toneTags,
      score
    })
  }
  return out
}

/**
 * Stage 2 — single OpenAI call: creative package + B-roll rows derived only from `candidates`.
 */
export async function generateDirectorPackageOpenAI(params: {
  apiKey: string
  model?: string
  candidates: ExtractedClipCandidate[]
  subjectProfile: SubjectProfile
  promptPack: PromptPackDefinition
  aiDirection: string
  mode: StoryMode
  /** Per-shot duration (defaults to 8s). */
  shotDurationSeconds?: number
  onProgress?: (p: { phase: string; detail?: string }) => void
}): Promise<
  | { ok: true; creativePackage: DirectorCreativePackage; aiResults: AiBrollSegmentResult[] }
  | { ok: false; error: string }
> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    candidates,
    subjectProfile,
    promptPack,
    aiDirection,
    mode,
    shotDurationSeconds,
    onProgress
  } = params
  const dur = clampBrollShotDurationSeconds(shotDurationSeconds)

  if (!candidates.length) {
    return { ok: false, error: 'No clip candidates — run Stage 1 extraction first.' }
  }

  onProgress?.({ phase: 'director', detail: 'Stage 2: running creative director (single request)…' })

  const byId = new Map(candidates.map((c) => [c.id, c]))
  const payload = candidates.map((c) => ({
    id: c.id,
    text: c.text,
    start: c.start,
    end: c.end,
    duration: Math.round(c.duration * 100) / 100,
    clipType: c.clipType,
    completenessScore: Math.round(c.completenessScore * 1000) / 1000
  }))

  const userContent = [
    `PROJECT_MODE: ${mode}`,
    `AI_DIRECTION: ${aiDirection || '(none)'}`,
    `SHOT_DURATION_SECONDS: ${dur} (write every shot for this exact length — no ranges)`,
    '',
    packInstructionsCompact(promptPack),
    '',
    subjectInstructions(subjectProfile),
    '',
    'CANDIDATES_JSON (use only these ids — do not add clips from outside this list):',
    JSON.stringify(payload, null, 2),
    '',
    jsonShape(dur, subjectQualityBar(subjectProfile, dur))
  ].join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${STORYTELLER_TRANSCRIPT_CONTENT_PACKAGE_PROMPT}\n\nYou output valid JSON only — no prose outside the JSON object.`
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

  let pkg: DirectorCreativePackage & { brollItems?: DirectorBrollItem[] }
  try {
    pkg = parseDirectorJson(raw)
  } catch {
    return { ok: false, error: 'Could not parse director JSON from OpenAI.' }
  }

  const items = pkg.brollItems ?? []
  let aiResults = directorItemsToAiResults(items, byId)
  const { brollItems: _drop, ...creativeOnly } = pkg

  if (aiResults.length === 0) {
    aiResults = fallbackAiResultsFromCandidates(candidates, mode, aiDirection, dur)
    if (!creativeOnly.microHooks) creativeOnly.microHooks = []
    creativeOnly.microHooks.push(
      '(B-roll used on-device templates — director JSON had no usable brollItems; check candidate ids.)'
    )
  }

  return { ok: true, creativePackage: creativeOnly, aiResults }
}
