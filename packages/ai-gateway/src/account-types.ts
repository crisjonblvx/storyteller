import type { StorytellerMediaCapability } from './media-types.js'
import type { PlanMonthlyAllowances } from './metering-types.js'
import type { StorytellerPlanDefinition, StorytellerPlanId } from './plans.js'

export type StorytellerAccountStatus = {
  plan: StorytellerPlanDefinition
  credits: {
    balance: number
    reserved: number
    available: number
  }
  /** Capability ids the account can invoke right now. */
  capabilities: StorytellerMediaCapability[]
  /** When false, media generation should show upgrade / sign-in messaging. */
  mediaEnabled: boolean
  /** When false, review/transcription should show upgrade / sign-in messaging. */
  reviewEnabled: boolean
}

export type StorytellerUsageItem = {
  jobId: string
  projectId: string
  capability: StorytellerMediaCapability
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  creditsReserved: number
  createdAt: string
  updatedAt: string
  errorMessage?: string
}

export type StorytellerUsageHistory = {
  items: StorytellerUsageItem[]
  total: number
}

/** Structured gateway error body returned by HTTP routes. */
export type GatewayErrorBody = {
  error?: string
  code?: string
  message?: string
  providerMessage?: string
}

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
    readonly providerMessage?: string
  ) {
    super(message)
    this.name = 'GatewayRequestError'
  }
}

export function parseGatewayErrorBody(
  status: number,
  body: GatewayErrorBody | null | undefined
): GatewayRequestError {
  const code = body?.code ?? 'UNKNOWN'
  const message = body?.message ?? body?.error ?? `Request failed (${status})`
  const providerMessage =
    typeof body?.providerMessage === 'string' ? body.providerMessage.trim() : undefined
  return new GatewayRequestError(message, code, status, providerMessage || undefined)
}

/** Map gateway error codes to product-level user copy (no provider names). */
export function userMessageForGatewayError(error: GatewayRequestError | Error): string {
  if (error instanceof GatewayRequestError) {
    if (error.code === 'INSUFFICIENT_CREDITS') {
      return 'You’re out of Storyteller AI credits. Upgrade your plan or wait for your balance to refresh.'
    }
    if (error.code === 'ALLOWANCE_EXCEEDED') {
      return error.message || 'Monthly limit reached for this feature. Upgrade your plan or purchase an add-on.'
    }
    if (error.code === 'UNAUTHORIZED' || error.statusCode === 401) {
      return 'Sign in to Storyteller to use AI features.'
    }
    if (error.code === 'PROVIDER_UNAVAILABLE' || error.statusCode === 503) {
      return 'AI media is temporarily unavailable. Try again in a few minutes.'
    }
    if (error.code === 'PROVIDER_ERROR') {
      return error.message || 'Image generation failed. Check your prompt and try again.'
    }
    if (error.statusCode === 402) {
      return 'This action requires an active Storyteller AI plan.'
    }
    return error.message
  }
  return error.message
}

/** User-facing message with optional provider detail for debugging. */
export function formatGatewayErrorDetail(
  error: GatewayRequestError | Error,
  providerMessage?: string
): string {
  const base = userMessageForGatewayError(error)
  const detail =
    providerMessage?.trim() ||
    (error instanceof GatewayRequestError ? error.providerMessage?.trim() : undefined)
  if (!detail || detail === base) return base
  const clipped = detail.length > 280 ? `${detail.slice(0, 277)}…` : detail
  return `${base} — ${clipped}`
}

export type StorytellerAccountSummaryWire = {
  planId: StorytellerPlanId
  planLabel: string
  /** USD/month — informational until Stripe lands. */
  priceUsdMonthly: number
  /** User-facing included units per billing period. */
  monthlyAllowances: PlanMonthlyAllowances
  /** Internal credit pool (legacy ledger display). */
  monthlyCredits: number
  balance: number
  reserved: number
  available: number
  capabilities: StorytellerMediaCapability[]
  mediaEnabled: boolean
  reviewEnabled: boolean
}
