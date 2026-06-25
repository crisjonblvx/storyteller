import type { SilencePreset } from '@storyteller/shared'

/** Minimum silence length (seconds) before we trim; remainder collapses to `threshold` pad */
export function silenceThresholdSeconds(preset: SilencePreset): number {
  switch (preset) {
    case 'natural':
      return 0.85
    case 'light':
      return 0.45
    case 'podcast_tight':
      return 0.22
    case 'social_fast':
      return 0.12
    default:
      return 0.45
  }
}
