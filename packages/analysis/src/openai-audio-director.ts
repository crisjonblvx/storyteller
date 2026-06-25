import type { SoundDesignSlot, SoundDesignSlotCategory, SoundMotivatedTimingNote } from '@storyteller/timeline'
import type { AudioDnaDefinition } from './audio-dna.js'

const VALID_CATEGORIES = new Set<string>(['ambient', 'movement', 'impact', 'transition', 'silence'])
const VALID_NOTE_TYPES = new Set<string>(['hold-before', 'cut-earlier', 'cut-on-word', 'silence-after'])

function newSlotId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`
}

function dnaCeiling(category: SoundDesignSlotCategory, dna: AudioDnaDefinition | undefined): number {
  if (!dna) return 1
  switch (category) {
    case 'ambient': return dna.ambientDensity
    case 'impact': return dna.boomIntensity
    case 'transition': return dna.transitionProminence
    default: return 1
  }
}

export type GenerateAudioDirectorSuggestionsParams = {
  apiKey: string
  model?: string
  projectId: string
  audioDna: AudioDnaDefinition
  /** All transcript segments in order */
  segments: Array<{
    id: string
    text: string
    start_time: number
    end_time: number
    speaker_label?: string | null
  }>
  /** Optional: user's free-form creative direction */
  aiDirection?: string
  /** Total sequence duration in seconds */
  sequenceDurationSeconds: number
}

export type GenerateAudioDirectorResult =
  | { ok: true; slots: SoundDesignSlot[]; timingNotes: SoundMotivatedTimingNote[] }
  | { ok: false; error: string }

function buildSystemPrompt(dna: AudioDnaDefinition): string {
  return [
    'You are a world-class post-production sound designer with thirty years of documentary and narrative experience.',
    `Your aesthetic is governed by the ${dna.label} Audio DNA: ${dna.philosophy}`,
    '',
    'CORE LAW — RESTRAINT: Fewer, perfectly placed sounds beat more sounds every time.',
    'If you are uncertain whether a moment warrants a sound, do not suggest one. Silence is a valid answer.',
    '',
    'THE FIVE SOUND DESIGN CATEGORIES:',
    '  ambient    — Room tone and environmental beds. The invisible foundation. One layer covers an entire scene.',
    '  movement   — Foley and physical action sounds. Only when the transcript implies real physical motion.',
    '  impact     — Emotional and narrative accents. Cinematic booms, hits, accents. Reserved for genuine turning points.',
    '  transition — Audio bridges between beats. Whooshes, swells, drones. Only at genuine topic or energy shifts.',
    '  silence    — Intentional removal of all audio. The rarest and most powerful tool.',
    '',
    'Your governing aesthetic for this project:',
    `  Ambient approach: ${dna.ambientApproach}`,
    `  Impact philosophy: ${dna.impactPhilosophy}`,
    `  Transition style: ${dna.transitionStyle}`,
    `  Silence value: ${dna.silenceValue}`,
    '',
    'Output only valid JSON matching the schema provided in the user message.'
  ].join('\n')
}

function buildUserContent(
  dna: AudioDnaDefinition,
  segments: GenerateAudioDirectorSuggestionsParams['segments'],
  aiDirection: string | undefined,
  sequenceDurationSeconds: number
): string {
  const transcriptLines = segments.map(
    s => `[${s.id}] ${s.start_time.toFixed(1)}s\u2013${s.end_time.toFixed(1)}s: "${s.text.trim()}"`
  )

  return [
    `AUDIO_DNA: ${dna.id}`,
    `  Philosophy: ${dna.philosophy}`,
    `  Ambient: ${dna.ambientApproach}`,
    `  Impacts: ${dna.impactPhilosophy}`,
    `  Transitions: ${dna.transitionStyle}`,
    `  Silence: ${dna.silenceValue}`,
    `  boomIntensity=${dna.boomIntensity} ambientDensity=${dna.ambientDensity} transitionProminence=${dna.transitionProminence}`,
    '',
    `AI_DIRECTION: ${aiDirection ?? '(none)'}`,
    `SEQUENCE_DURATION: ${sequenceDurationSeconds}s`,
    `TOTAL_SEGMENTS: ${segments.length}`,
    '',
    'TRANSCRIPT:',
    ...transcriptLines,
    '',
    'GENERATION RULES \u2014 READ BEFORE WRITING A SINGLE SLOT:',
    '',
    'AMBIENT (world/scene bed):',
    '- Max 1 ambient layer per distinct location or scene shift',
    '- Only suggest when the transcript implies a specific location (office, outdoors, car, home)',
    '- Do NOT suggest ambient for every segment \u2014 one ambient layer covers a whole scene',
    '- A 90-second video should have 1\u20133 ambient slots total',
    '',
    'MOVEMENT (foley, physical action):',
    '- Only suggest when the transcript explicitly implies physical action',
    '- Trigger words: walked, sat, picked up, opened, grabbed, stood, ran, drove, typed, wrote',
    '- A 90-second video should have 0\u20134 movement slots',
    '- If no physical action is mentioned, suggest zero movement slots',
    '',
    'IMPACT (emotional/story accents):',
    '- Only on genuine emotional or narrative turning points',
    '- Must be tied to a specific word in the transcript (timingAnchorWord required)',
    '- A full video should have 2\u20134 impacts maximum \u2014 never more',
    '- Forbidden unless the moment is a realization, confession, reveal, pivot, or climax',
    '',
    'TRANSITION (between beats/topics):',
    '- Only at genuine topic or energy shifts \u2014 not every cut',
    '- A 90-second video should have 2\u20134 transitions maximum',
    '- Forbidden between segments that continue the same thought',
    '',
    'SILENCE (intentional audio removal):',
    '- This is the rarest and most powerful suggestion',
    '- Only suggest silence where removal of ALL sound would hit harder than any addition',
    '- A full video should have 0\u20132 silence suggestions \u2014 often zero',
    '- If nothing warrants silence, return zero',
    '',
    'TOTAL SLOT COUNT:',
    '- For video under 60s: max 8 slots total',
    '- For 60\u2013180s: max 14 slots total',
    '- For 180\u2013300s: max 20 slots total',
    '- For over 300s: max 25 slots total',
    '- When in doubt, suggest fewer',
    '',
    'Each slot MUST include a `reason` field: one sentence explaining exactly why this specific sound belongs at this exact moment. Vague reasons ("adds atmosphere") are rejected.',
    '',
    'OUTPUT \u2014 return JSON exactly matching this shape:',
    '{"slots":[{"category":"ambient|movement|impact|transition|silence","tags":["string"],"transcriptKeywords":["string"],"linkedSegmentIds":["seg-id"],"timelineStart":0.0,"timelineEnd":4.2,"intensity":0.0,"timingAnchorWord":"crashed","reason":"One sentence."}],"timingNotes":[{"transcriptSegmentId":"seg-id","anchorWord":"crashed","noteType":"hold-before|cut-earlier|cut-on-word|silence-after","framesAdjustment":6,"sfxCategory":"impact","rationale":"One sentence."}]}'
  ].join('\n')
}

export async function generateAudioDirectorSuggestions(
  params: GenerateAudioDirectorSuggestionsParams
): Promise<GenerateAudioDirectorResult> {
  const {
    apiKey,
    model = 'gpt-5.4-mini',
    projectId,
    audioDna,
    segments,
    aiDirection,
    sequenceDurationSeconds
  } = params

  if (segments.length === 0) {
    return { ok: false, error: 'No transcript segments provided.' }
  }

  const systemContent = buildSystemPrompt(audioDna)
  const userContent = buildUserContent(audioDna, segments, aiDirection, sequenceDurationSeconds)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemContent },
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
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeAudioDirectorResponse(parsed, projectId, audioDna)
    return { ok: true, ...normalized }
  } catch {
    return { ok: false, error: 'Could not parse audio director JSON from OpenAI.' }
  }
}

export function normalizeAudioDirectorResponse(
  raw: unknown,
  projectId: string,
  audioDna?: AudioDnaDefinition
): { slots: SoundDesignSlot[]; timingNotes: SoundMotivatedTimingNote[] } {
  if (!raw || typeof raw !== 'object') return { slots: [], timingNotes: [] }
  const obj = raw as Record<string, unknown>

  const slots: SoundDesignSlot[] = []
  if (Array.isArray(obj.slots)) {
    for (const row of obj.slots) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>

      const category = r.category
      if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) continue
      const cat = category as SoundDesignSlotCategory

      const rawIntensity = typeof r.intensity === 'number' ? r.intensity : 0.5
      const clamped = Math.max(0, Math.min(1, rawIntensity))
      const ceiling = dnaCeiling(cat, audioDna)
      const intensity = Math.min(clamped, ceiling)

      const timelineStart = typeof r.timelineStart === 'number' ? r.timelineStart : 0
      const timelineEnd = typeof r.timelineEnd === 'number' ? r.timelineEnd : timelineStart
      if (timelineEnd < timelineStart) continue

      const tags = Array.isArray(r.tags)
        ? r.tags.filter((t): t is string => typeof t === 'string')
        : []
      const transcriptKeywords = Array.isArray(r.transcriptKeywords)
        ? r.transcriptKeywords.filter((t): t is string => typeof t === 'string')
        : undefined
      const linkedTranscriptSegmentIds = Array.isArray(r.linkedSegmentIds)
        ? r.linkedSegmentIds.filter((t): t is string => typeof t === 'string')
        : undefined
      const timingAnchorWord =
        typeof r.timingAnchorWord === 'string' && r.timingAnchorWord.trim()
          ? r.timingAnchorWord.trim()
          : undefined
      const reason =
        typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : undefined

      const slot: SoundDesignSlot = {
        id: newSlotId(),
        projectId,
        category: cat,
        tags,
        timelineStart,
        timelineEnd,
        intensity,
        status: 'suggested',
        ...(transcriptKeywords ? { transcriptKeywords } : {}),
        ...(linkedTranscriptSegmentIds ? { linkedTranscriptSegmentIds } : {}),
        ...(timingAnchorWord ? { timingAnchorWord } : {}),
        ...(reason ? { metadata: { reason } } : {})
      }
      slots.push(slot)
    }
  }

  const timingNotes: SoundMotivatedTimingNote[] = []
  if (Array.isArray(obj.timingNotes)) {
    for (const row of obj.timingNotes) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>

      const noteType = r.noteType
      if (typeof noteType !== 'string' || !VALID_NOTE_TYPES.has(noteType)) continue

      const transcriptSegmentId =
        typeof r.transcriptSegmentId === 'string' ? r.transcriptSegmentId.trim() : ''
      if (!transcriptSegmentId) continue

      const anchorWord = typeof r.anchorWord === 'string' ? r.anchorWord.trim() : ''
      if (!anchorWord) continue

      const rawFrames = typeof r.framesAdjustment === 'number' ? r.framesAdjustment : 0
      const framesAdjustment = Math.max(-12, Math.min(12, Math.round(rawFrames)))

      const sfxCategory =
        typeof r.sfxCategory === 'string' && VALID_CATEGORIES.has(r.sfxCategory)
          ? (r.sfxCategory as SoundDesignSlotCategory)
          : 'impact'

      const rationale = typeof r.rationale === 'string' ? r.rationale.trim() : ''

      timingNotes.push({
        transcriptSegmentId,
        anchorWord,
        noteType: noteType as SoundMotivatedTimingNote['noteType'],
        framesAdjustment,
        sfxCategory,
        rationale
      })
    }
  }

  return { slots, timingNotes }
}

export function generateAudioDirectorFallback(
  projectId: string,
  audioDna: AudioDnaDefinition,
  segments: GenerateAudioDirectorSuggestionsParams['segments'],
  sequenceDurationSeconds: number
): { slots: SoundDesignSlot[]; timingNotes: SoundMotivatedTimingNote[] } {
  const allText = segments.map(s => s.text).join(' ').toLowerCase()
  const slots: SoundDesignSlot[] = []

  const officePattern = /\b(office|desk|workplace|conference|meeting|cubicle|hvac|coworker|colleague)\b/
  const outdoorPattern = /\b(outside|outdoor|park|forest|street|garden|backyard|field|nature|birds|wind)\b/

  if (officePattern.test(allText)) {
    slots.push({
      id: newSlotId(),
      projectId,
      category: 'ambient',
      tags: ['office', 'HVAC', 'interior'],
      transcriptKeywords: ['office'],
      timelineStart: 0,
      timelineEnd: sequenceDurationSeconds,
      intensity: Math.min(audioDna.ambientDensity * 0.8, 1),
      status: 'suggested'
    })
  }

  if (outdoorPattern.test(allText)) {
    slots.push({
      id: newSlotId(),
      projectId,
      category: 'ambient',
      tags: ['outdoor', 'nature', 'exterior'],
      transcriptKeywords: ['outdoor'],
      timelineStart: 0,
      timelineEnd: sequenceDurationSeconds,
      intensity: Math.min(audioDna.ambientDensity * 0.8, 1),
      status: 'suggested'
    })
  }

  const midpoint = sequenceDurationSeconds / 2
  slots.push({
    id: newSlotId(),
    projectId,
    category: 'transition',
    tags: ['mid-sequence', 'beat-shift'],
    timelineStart: Math.max(0, midpoint - 0.5),
    timelineEnd: Math.min(sequenceDurationSeconds, midpoint + 0.5),
    intensity: Math.min(audioDna.transitionProminence, 1),
    status: 'suggested'
  })

  return { slots, timingNotes: [] }
}
