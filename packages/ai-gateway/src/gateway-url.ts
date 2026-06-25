/**
 * Hosted Storyteller AI Gateway origin (no trailing slash).
 * `STORYTELLER_GATEWAY_URL` is canonical; `STORYTELLER_API_BASE_URL` is kept for compatibility.
 */
export function resolveGatewayUrl(env: NodeJS.ProcessEnv): string | null {
  const gateway =
    typeof env.STORYTELLER_GATEWAY_URL === 'string' ? env.STORYTELLER_GATEWAY_URL.trim() : ''
  const legacy =
    typeof env.STORYTELLER_API_BASE_URL === 'string' ? env.STORYTELLER_API_BASE_URL.trim() : ''
  const base = gateway || legacy
  return base.replace(/\/+$/, '') || null
}

/** True when the desktop should broker media generation through the hosted gateway. */
export function isHostedGatewayConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(resolveGatewayUrl(env))
}
