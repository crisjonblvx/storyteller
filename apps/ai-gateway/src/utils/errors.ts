export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
    readonly providerMessage?: string
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export function normalizeError(e: unknown): { code: string; message: string; providerMessage?: string } {
  if (e instanceof GatewayError) {
    return { code: e.code, message: e.message, providerMessage: e.providerMessage }
  }
  if (e instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: e.message }
  }
  return { code: 'INTERNAL_ERROR', message: String(e) }
}
