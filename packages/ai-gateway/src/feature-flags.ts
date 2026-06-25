export interface StorytellerFeatureFlags {
  enableKling: boolean
  enableByok: boolean
}

export function resolveFeatureFlags(env: NodeJS.ProcessEnv): StorytellerFeatureFlags {
  return {
    enableKling: parseBool(env.ENABLE_KLING, false),
    enableByok: parseBool(env.ENABLE_BYOK, false)
  }
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === '') return defaultValue
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}
