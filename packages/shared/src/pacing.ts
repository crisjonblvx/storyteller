export const SILENCE_PRESETS = [
  'natural',
  'light',
  'podcast_tight',
  'social_fast'
] as const
export type SilencePreset = (typeof SILENCE_PRESETS)[number]

import type { StoryMode } from './modes.js'

export const SILENCE_PRESET_LABELS: Record<SilencePreset, string> = {
  natural: 'Keep natural pauses',
  light: 'Light cleanup',
  podcast_tight: 'Podcast tight cut',
  social_fast: 'Social fast-paced'
}

/** Default pacing by mode — journalism stays restrained; creator is more aggressive */
export function defaultSilencePresetForMode(mode: StoryMode): SilencePreset {
  switch (mode) {
    case 'journalism':
      return 'light'
    case 'creator':
      return 'social_fast'
    default:
      return 'natural'
  }
}
