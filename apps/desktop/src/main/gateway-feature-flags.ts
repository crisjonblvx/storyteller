import { resolveFeatureFlags } from '@storyteller/ai-gateway'

export function getDesktopFeatureFlags() {
  return resolveFeatureFlags(process.env)
}
