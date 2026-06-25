import type { CreditsService, AccountCreditSummary } from '@storyteller/ai-gateway'
import type { StorytellerPlanId } from '@storyteller/ai-gateway'

/**
 * In-memory credit ledger for first-pass gateway deployments.
 * Replace with Supabase/Postgres-backed balances in production.
 */
export class InMemoryCreditsService implements CreditsService {
  private balances = new Map<string, number>()
  private plans = new Map<string, StorytellerPlanId>()
  private reservations = new Map<string, { userId: string; amount: number }>()

  constructor(defaultBalance = 1000) {
    this.defaultBalance = defaultBalance
  }

  private defaultBalance: number

  private balance(userId: string): number {
    if (!this.balances.has(userId)) {
      this.balances.set(userId, this.defaultBalance)
    }
    return this.balances.get(userId)!
  }

  private reservedTotal(userId: string): number {
    return [...this.reservations.values()]
      .filter((r) => r.userId === userId)
      .reduce((sum, r) => sum + r.amount, 0)
  }

  async getAccountSummary(userId: string): Promise<AccountCreditSummary> {
    const balance = this.balance(userId)
    const reserved = this.reservedTotal(userId)
    return {
      planId: this.plans.get(userId) ?? 'starter',
      balance,
      reserved,
      available: Math.max(0, balance - reserved)
    }
  }

  async checkAvailable(
    userId: string,
    amount: number
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const summary = await this.getAccountSummary(userId)
    if (summary.available < amount) {
      return {
        ok: false,
        message: `Insufficient credits (need ${amount}, have ${summary.available}).`
      }
    }
    return { ok: true }
  }

  async reserve(userId: string, amount: number, jobId: string): Promise<void> {
    const check = await this.checkAvailable(userId, amount)
    if (!check.ok) {
      throw new Error(check.message)
    }
    this.reservations.set(jobId, { userId, amount })
  }

  async commit(userId: string, jobId: string): Promise<void> {
    const res = this.reservations.get(jobId)
    if (!res || res.userId !== userId) return
    this.balances.set(userId, this.balance(userId) - res.amount)
    this.reservations.delete(jobId)
  }

  async refund(userId: string, jobId: string): Promise<void> {
    const res = this.reservations.get(jobId)
    if (!res || res.userId !== userId) return
    this.reservations.delete(jobId)
  }
}
