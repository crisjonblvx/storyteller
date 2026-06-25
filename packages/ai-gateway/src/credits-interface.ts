/**
 * Credit ledger contract for the hosted gateway.
 * First-pass implementations may stub balance checks in memory.
 */

import type { PlanMonthlyAllowances } from './metering-types.js'
import type { StorytellerPlanId } from './plans.js'

export type AccountCreditSummary = {
  planId: StorytellerPlanId
  balance: number
  reserved: number
  available: number
  /** User-facing monthly allowances (informational until allowance ledger lands). */
  allowances?: PlanMonthlyAllowances
}

export interface CreditsService {
  /** Check whether the user can afford `amount` credits. */
  checkAvailable(userId: string, amount: number): Promise<{ ok: true } | { ok: false; message: string }>

  /** Current balance, reservations, and plan for account UI. */
  getAccountSummary(userId: string): Promise<AccountCreditSummary>

  reserve(userId: string, amount: number, jobId: string): Promise<void>
  commit(userId: string, jobId: string): Promise<void>
  refund(userId: string, jobId: string): Promise<void>
}
