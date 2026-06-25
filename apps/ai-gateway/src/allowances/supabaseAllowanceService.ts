import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlanDefinition, type MeteringUnitId, type StorytellerPlanId } from '@storyteller/ai-gateway'
import type { AllowanceConsumeResult, AllowanceService, AllowanceUsage } from './allowanceServicePort.js'

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type AllowanceRow = {
  episode_passes_used: number
  clip_batches_used: number
  ai_videos_used: number
}

/**
 * Supabase-backed allowance service.
 * Uses the `try_consume_allowance` Postgres RPC for atomic conditional increments —
 * prevents race conditions when two requests arrive simultaneously.
 */
export class SupabaseAllowanceService implements AllowanceService {
  constructor(private readonly sb: SupabaseClient) {}

  async checkAndConsume(
    userId: string,
    unit: MeteringUnitId,
    planId: StorytellerPlanId
  ): Promise<AllowanceConsumeResult> {
    const plan = getPlanDefinition(planId)
    const period = currentPeriod()

    const limit =
      unit === 'episode_pass'
        ? plan.allowances.episodePasses
        : unit === 'clip_batch'
          ? plan.allowances.clipBatches
          : plan.allowances.aiVideos

    const { data, error } = await this.sb.rpc('try_consume_allowance', {
      p_user_id: userId,
      p_period: period,
      p_unit: unit,
      p_limit: limit
    })

    if (error) {
      throw new Error(`Allowance check failed: ${error.message}`)
    }

    if (data === true) {
      return { ok: true }
    }

    const usage = await this.getCurrentUsage(userId, period)
    const used =
      unit === 'episode_pass'
        ? (usage?.episode_passes_used ?? limit)
        : unit === 'clip_batch'
          ? (usage?.clip_batches_used ?? limit)
          : (usage?.ai_videos_used ?? limit)

    const unitLabel =
      unit === 'episode_pass' ? 'Episode Pass' : unit === 'clip_batch' ? 'Clip Batch' : 'AI Video'

    return {
      ok: false,
      message: `${unitLabel} limit reached (${limit}/mo on ${plan.label}). Upgrade or purchase an add-on.`,
      unit,
      used,
      included: limit
    }
  }

  async getMonthlyUsage(userId: string, planId: StorytellerPlanId): Promise<AllowanceUsage> {
    const plan = getPlanDefinition(planId)
    const period = currentPeriod()
    const row = await this.getCurrentUsage(userId, period)
    return {
      period,
      episodePassesUsed: row?.episode_passes_used ?? 0,
      clipBatchesUsed: row?.clip_batches_used ?? 0,
      aiVideosUsed: row?.ai_videos_used ?? 0,
      included: plan.allowances
    }
  }

  private async getCurrentUsage(userId: string, period: string): Promise<AllowanceRow | null> {
    const { data } = await this.sb
      .from('gateway_user_allowances')
      .select('episode_passes_used, clip_batches_used, ai_videos_used')
      .eq('user_id', userId)
      .eq('period', period)
      .maybeSingle()
    return data ?? null
  }
}
