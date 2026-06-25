import type { CreditsService, AccountCreditSummary } from '@storyteller/ai-gateway'
import type { StorytellerPlanId } from '@storyteller/ai-gateway'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_BALANCE = 1000

export class SupabaseCreditsService implements CreditsService {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly defaultBalance = DEFAULT_BALANCE
  ) {}

  private async ensureUser(userId: string): Promise<{ balance: number; planId: StorytellerPlanId }> {
    const { data } = await this.sb
      .from('gateway_user_credits')
      .select('balance, plan_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (data?.balance != null) {
      return {
        balance: data.balance,
        planId: (data.plan_id as StorytellerPlanId) ?? 'starter'
      }
    }

    const { data: inserted, error } = await this.sb
      .from('gateway_user_credits')
      .insert({ user_id: userId, balance: this.defaultBalance, plan_id: 'starter' })
      .select('balance, plan_id')
      .single()

    if (error) {
      const retry = await this.sb
        .from('gateway_user_credits')
        .select('balance, plan_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (retry.data?.balance != null) {
        return {
          balance: retry.data.balance,
          planId: (retry.data.plan_id as StorytellerPlanId) ?? 'starter'
        }
      }
      throw new Error(`Failed to init credits: ${error.message}`)
    }
    return {
      balance: inserted?.balance ?? this.defaultBalance,
      planId: (inserted?.plan_id as StorytellerPlanId) ?? 'starter'
    }
  }

  async getAccountSummary(userId: string): Promise<AccountCreditSummary> {
    const { balance, planId } = await this.ensureUser(userId)
    const reserved = await this.reservedTotal(userId)
    return {
      planId,
      balance,
      reserved,
      available: Math.max(0, balance - reserved)
    }
  }

  private async reservedTotal(userId: string): Promise<number> {
    const { data, error } = await this.sb
      .from('gateway_credit_reservations')
      .select('amount')
      .eq('user_id', userId)
    if (error) throw new Error(error.message)
    return (data ?? []).reduce((sum, r) => sum + (r.amount as number), 0)
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
    if (!check.ok) throw new Error(check.message)
    const { error } = await this.sb.from('gateway_credit_reservations').insert({
      job_id: jobId,
      user_id: userId,
      amount
    })
    if (error) throw new Error(`Credit reserve failed: ${error.message}`)
  }

  async commit(userId: string, jobId: string): Promise<void> {
    const { data: res, error: resErr } = await this.sb
      .from('gateway_credit_reservations')
      .select('amount')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .maybeSingle()
    if (resErr) throw new Error(resErr.message)
    if (!res) return

    const balance = await this.ensureUser(userId)
    const next = Math.max(0, balance.balance - res.amount)
    const { error: updErr } = await this.sb
      .from('gateway_user_credits')
      .update({ balance: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (updErr) throw new Error(updErr.message)

    await this.sb.from('gateway_credit_reservations').delete().eq('job_id', jobId)
  }

  async refund(userId: string, jobId: string): Promise<void> {
    await this.sb
      .from('gateway_credit_reservations')
      .delete()
      .eq('job_id', jobId)
      .eq('user_id', userId)
  }
}
