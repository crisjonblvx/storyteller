// Audio Director is hidden behind VITE_AUDIO_DIRECTOR_ENABLED until sound sourcing strategy is finalized.

export const FEATURES = {
  audioDirector: import.meta.env.VITE_AUDIO_DIRECTOR_ENABLED === 'true',
} as const
