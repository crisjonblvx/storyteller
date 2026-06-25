import { defaultSilencePresetForMode, type SilencePreset, type StoryMode } from '@storyteller/shared'

export type BuilderPacing = 'Tight' | 'Balanced' | 'Cinematic'

export interface BuilderPacingConfig {
  silencePreset: SilencePreset
  maxClipSeconds: number
  pauseGapSeconds: number
}

export function resolveBuilderPacingConfig(
  mode: StoryMode,
  pacingMode: BuilderPacing = 'Balanced',
  requestedPreset?: SilencePreset
): BuilderPacingConfig {
  const basePreset = requestedPreset ?? defaultSilencePresetForMode(mode)
  switch (pacingMode) {
    case 'Tight':
      return {
        silencePreset: 'social_fast',
        maxClipSeconds: 7,
        pauseGapSeconds: 0
      }
    case 'Cinematic':
      return {
        silencePreset: 'natural',
        maxClipSeconds: 15,
        pauseGapSeconds: 0.45
      }
    case 'Balanced':
    default:
      return {
        silencePreset: basePreset,
        maxClipSeconds: 11,
        pauseGapSeconds: 0.12
      }
  }
}

export function capSourceWindowSeconds(start: number, end: number, maxClipSeconds: number): number {
  if (!Number.isFinite(maxClipSeconds) || maxClipSeconds <= 0) return end
  return Math.min(end, start + maxClipSeconds)
}
