const GATEWAY_CONNECTION_ERROR =
  'Storyteller AI could not connect. Please try again in a moment.'

/**
 * Returns true when the message is an auth/sign-in error from the gateway.
 * These are TRANSIENT — being signed out is not a permanent failure — so they
 * should never be persisted to disk and should be hidden at display time.
 */
export function isAuthGatewayError(message: string | null | undefined): boolean {
  const raw = (message ?? '').trim()
  if (!raw) return false
  return (
    /\bSign in to Storyteller\b/i.test(raw) ||
    /\bsign in to use AI features\b/i.test(raw) ||
    /\bsign in.*hosted gateway\b/i.test(raw)
  )
}

export function normalizeGatewayErrorForDisplay(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return ''
  // Auth errors are transient — suppress stale sign-in messages rather than
  // showing them on every project open. A fresh attempt will surface a new
  // sign-in prompt if the user is still signed out.
  if (isAuthGatewayError(raw)) return ''
  if (
    /\bfetch failed\b/i.test(raw) ||
    /\bStoryteller AI is unreachable:/i.test(raw) ||
    /\bStoryteller AI could not connect\b/i.test(raw) ||
    /\bCheck your internet connection and try again\b/i.test(raw) ||
    /\bECONNREFUSED\b/i.test(raw) ||
    /\bENOTFOUND\b/i.test(raw) ||
    /\bETIMEDOUT\b/i.test(raw)
  ) {
    return GATEWAY_CONNECTION_ERROR
  }
  return raw
}
