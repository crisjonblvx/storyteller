import { resolveGatewayUrl } from './gateway-url.js'

export type StorytellerAiMode = 'local' | 'proxy' | 'unconfigured'

export interface ResolvedAiGatewayConfig {
  mode: StorytellerAiMode
  /** Base URL for Storyteller-hosted API (no trailing slash). Set when proxy can be used. */
  apiBaseUrl: string | null
  /** Same as apiBaseUrl; prefers STORYTELLER_GATEWAY_URL when set. */
  gatewayUrl: string | null
  /** Optional bearer token for proxy requests (session / license). */
  proxyToken: string | null
  /**
   * True when the resolver picked `local` mode based on an explicit
   * `STORYTELLER_AI_MODE=local` opt-in. Local mode is dev-only and callers
   * should refuse it in packaged/production builds.
   */
  localOptedIn: boolean
  /**
   * Why this mode was chosen. Useful for logs and diagnostics; never surfaced
   * to end users.
   */
  reason:
    | 'explicit-proxy'
    | 'explicit-local'
    | 'auto-proxy'
    | 'auto-unconfigured'
}

/**
 * Read gateway routing from environment.
 *
 * Routing matrix:
 * - `STORYTELLER_AI_MODE=proxy` → proxy mode (errors at use time if no URL set).
 * - `STORYTELLER_AI_MODE=local` → explicit dev-only local mode.
 *   Callers MUST additionally check that the build is not packaged before
 *   instantiating a local gateway.
 * - unset / `auto` (default):
 *   - if `STORYTELLER_GATEWAY_URL` is set → proxy mode.
 *   - otherwise → `unconfigured` (callers should return a clear error to the
 *     renderer; we deliberately do NOT auto-fall-back to local).
 *
 * This makes "talk to a real provider from the desktop process" an explicit
 * developer decision rather than a silent default.
 */
export function resolveAiGatewayConfig(env: NodeJS.ProcessEnv): ResolvedAiGatewayConfig {
  const gatewayUrl = resolveGatewayUrl(env)
  const rawMode = (env.STORYTELLER_AI_MODE ?? 'auto').toLowerCase().trim()
  const proxyToken =
    typeof env.STORYTELLER_PROXY_TOKEN === 'string' && env.STORYTELLER_PROXY_TOKEN.length > 0
      ? env.STORYTELLER_PROXY_TOKEN
      : null

  if (rawMode === 'proxy') {
    return {
      mode: 'proxy',
      apiBaseUrl: gatewayUrl,
      gatewayUrl,
      proxyToken,
      localOptedIn: false,
      reason: 'explicit-proxy'
    }
  }

  if (rawMode === 'local') {
    return {
      mode: 'local',
      apiBaseUrl: gatewayUrl,
      gatewayUrl,
      proxyToken,
      localOptedIn: true,
      reason: 'explicit-local'
    }
  }

  if (gatewayUrl) {
    return {
      mode: 'proxy',
      apiBaseUrl: gatewayUrl,
      gatewayUrl,
      proxyToken,
      localOptedIn: false,
      reason: 'auto-proxy'
    }
  }

  return {
    mode: 'unconfigured',
    apiBaseUrl: null,
    gatewayUrl: null,
    proxyToken,
    localOptedIn: false,
    reason: 'auto-unconfigured'
  }
}
