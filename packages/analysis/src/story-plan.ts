import type { StoryMode } from '@storyteller/shared'

export interface StoryPlanDraft {
  outline: string[]
  intro_suggestions: string[]
  recap_suggestions: string[]
  cold_open?: string
  journalism?: {
    headline_working: string
    slug: string
    angle: string
    anchor_intro: string
    vo_sot_guidance: string
    lower_third_ideas: string[]
  }
  creator?: {
    virality_notes: string[]
    intro_sequence_ideas: string[]
    recap_structure: string[]
    aspect_hint: 'vertical' | 'horizontal' | 'both'
  }
}

/** Mode-aware stub — swap for LLM-backed generator */
export function generateStoryPlanDraft(mode: StoryMode, topicHint: string): StoryPlanDraft {
  const base: StoryPlanDraft = {
    outline: [
      `Hook: establish stakes around “${topicHint}”`,
      'Development: strongest evidence and emotion',
      'Close: clear takeaway or next step'
    ],
    intro_suggestions: [
      'Start with the sharpest moment, then context.',
      'Open with scene + one-line why it matters.'
    ],
    recap_suggestions: [
      'Restate the core tension, then resolution or call to action.',
      'Sound bites: favor complete thoughts editors can cut clean; keep punchy fragments for on-screen hooks only.'
    ]
  }
  if (mode === 'journalism') {
    base.journalism = {
      headline_working: `Report: ${topicHint}`,
      slug: topicHint.toLowerCase().replace(/\s+/g, '-') + '-pkg',
      angle: 'Balanced field report with VO/SOT structure.',
      anchor_intro: 'Tonight — a developing story from the field…',
      vo_sot_guidance: 'VO bridges between SOTs; NAT for scene energy.',
      lower_third_ideas: ['Reporter name + location', 'Key subject ID on first SOT']
    }
  }
  if (mode === 'creator') {
    base.creator = {
      virality_notes: ['Lead with conflict or curiosity in 2 seconds.', 'Pattern interrupt before second 5.'],
      intro_sequence_ideas: ['Cold open clip → title bump → promise of payoff'],
      recap_structure: ['Tease → proof → recap CTA'],
      aspect_hint: 'both'
    }
  }
  base.cold_open = '“This is the moment everything changed.” [cut to strongest SOT]'
  return base
}
