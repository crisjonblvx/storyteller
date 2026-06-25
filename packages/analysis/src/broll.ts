import type { BrollPrompt, StoryMode } from '@storyteller/shared'
import type { BrollToneHint } from './ai-direction.js'
import { buildBrollProviderBundle } from './broll-providers.js'

const WINDOW = 30

function toneToLabel(tone: BrollToneHint): string {
  switch (tone) {
    case 'cinematic':
      return 'premium cinematic pacing, motivated light, shallow depth of field where it helps readability'
    case 'journalistic':
      return 'editorial news B-roll: factual, observational, no melodrama or stock cliché poses'
    case 'social':
    case 'viral':
      return 'social-native energy, punchy framing, legible on a phone screen'
    default:
      return 'naturalistic coverage that supports the spoken line without overpowering it'
  }
}

function scoreForType(
  promptType: 'literal' | 'emotional' | 'symbolic',
  tone: BrollToneHint,
  mode: StoryMode
): number {
  if (mode === 'journalism') {
    if (promptType === 'literal') return 0.9
    if (promptType === 'emotional') return 0.58
    return 0.44
  }
  if (promptType === 'literal') {
    return tone === 'journalistic' ? 0.84 : tone === 'cinematic' ? 0.72 : 0.78
  }
  if (promptType === 'emotional') {
    return tone === 'cinematic' || tone === 'viral' ? 0.66 : tone === 'journalistic' ? 0.52 : 0.58
  }
  return tone === 'cinematic' ? 0.62 : tone === 'journalistic' ? 0.4 : 0.48
}

function pickHintForWindow(
  hints: { start: number; end: number; summary: string }[],
  segStart: number,
  segEnd: number
): { start: number; end: number; summary: string } | null {
  const overlapping = hints.filter((s) => s.start < segEnd && s.end > segStart)
  if (overlapping.length === 0) return null
  const withText = overlapping.filter((s) => s.summary.trim().length >= 8)
  const pool = withText.length ? withText : overlapping
  return [...pool].sort((a, b) => b.summary.length - a.summary.length)[0] ?? null
}

/**
 * Up to 3 prompts per 30s window: literal, emotional, symbolic — editorial text from segment meaning + direction + mode.
 */
export function generateBrollPromptsForTimeline(
  projectId: string,
  totalDurationSeconds: number,
  segmentHints: { start: number; end: number; summary: string }[],
  options?: {
    tone?: BrollToneHint
    mode?: StoryMode
    directionText?: string
    /** Per-shot duration (defaults to 8s). */
    shotDurationSeconds?: number
  }
): Omit<BrollPrompt, 'id' | 'created_at'>[] {
  const tone = options?.tone ?? 'neutral'
  const mode = options?.mode ?? 'story'
  const directionText = options?.directionText?.trim()
  const shotDurationSeconds = options?.shotDurationSeconds
  const toneLabel = toneToLabel(tone)
  const prompts: Omit<BrollPrompt, 'id' | 'created_at'>[] = []
  const windows = Math.ceil(Math.max(WINDOW, totalDurationSeconds) / WINDOW)

  for (let w = 0; w < windows; w++) {
    const segStart = w * WINDOW
    const segEnd = Math.min((w + 1) * WINDOW, totalDurationSeconds)
    const hint = pickHintForWindow(segmentHints, segStart, segEnd)
    if (!hint) continue

    const types: Array<'literal' | 'emotional' | 'symbolic'> = ['literal', 'emotional', 'symbolic']
    for (const promptType of types) {
      const bundle = buildBrollProviderBundle({
        promptType,
        segmentSummary: hint.summary,
        mode,
        directionText: directionText || undefined,
        toneHint: toneLabel,
        shotDurationSeconds
      })
      const score = scoreForType(promptType, tone, mode)
      if (score < 0.5) continue

      prompts.push({
        project_id: projectId,
        segment_start: segStart,
        segment_end: segEnd,
        prompt_type: promptType,
        prompt_text: bundle.primary,
        priority_score: score,
        metadata_json: {
          category: promptType,
          sourceWindow: { start: segStart, end: segEnd },
          transcriptExcerpt: hint.summary.slice(0, 400),
          sourceSpan: { start: hint.start, end: hint.end },
          toneTags: [tone, mode],
          aiDirection: directionText ?? null,
          mode,
          providerPrompts: {
            primary: bundle.primary,
            runway: bundle.runway,
            kling: bundle.kling
          },
          confidence: score
        }
      })
    }
  }

  return prompts.slice(0, Math.min(prompts.length, windows * 3))
}
