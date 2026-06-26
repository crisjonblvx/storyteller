const GATEWAY_CONNECTION_ERROR =
  'Storyteller AI could not connect. Please try again in a moment.'

export function normalizeGatewayErrorForDisplay(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  if (!raw) return ''
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
