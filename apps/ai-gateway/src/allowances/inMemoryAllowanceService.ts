import { getPlanDefinition, type MeteringUnitId, type StorytellerPlanId } from '@storyteller/ai-gateway'
import type { AllowanceConsumeResult, AllowanceService, AllowanceUsage } from './allowanceServicePort.js'

type PeriodUsage = { episodePasses: number; clipBatches: number; aiVideos: number }

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * In-memory allowance tracker for development and tests.
 * Resets on each server restart — not suitable for production.
 */
export class InMemoryAllowanceService implements AllowanceService {
  private usage = new Map<string, PeriodUsage>()

  private key(userId: string, period: string) {
    return `${userId}:${period}`
  }

  private getOrCreate(userId: string, period: string): PeriodUsage {
    const k = this.key(userId, period)
    if (!this.usage.has(k)) {
      this.usage.set(k, { episodePasses: 0, clipBatches: 0, aiVideos: 0 })
    }
    return this.usage.get(k)!
  }

  async checkAndConsume(
    userId: string,
    unit: MeteringUnitId,
    planId: StorytellerPlanId
  ): Promise<AllowanceConsumeResult> {
    const plan = getPlanDefinition(planId)
    const period = currentPeriod()
    const u = this.getOrCreate(userId, period)

    if (unit === 'episode_pass') {
      const included = plan.allowances.episodePasses
      if (u.episodePasses >= included) {
        return {
          ok: false,
          message: `Episode Pass limit reached (${included}/mo on ${plan.label}). Upgrade or purchase an add-on.`,
          unit,
          used: u.episodePasses,
          included
        }
      }
      u.episodePasses++
    } else if (unit === 'clip_batch') {
      const included = plan.allowances.clipBatches
      if (u.clipBatches >= included) {
        return {
          ok: false,
          message: `Clip Batch limit reached (${included}/mo on ${plan.label}). Upgrade or purchase an add-on.`,
          unit,
          used: u.clipBatches,
          included
        }
      }
      u.clipBatches++
    } else if (unit === 'ai_video') {
      const included = plan.allowances.aiVideos
      if (u.aiVideos >= included) {
        return {
          ok: false,
          message: `AI Video limit reached (${included}/mo on ${plan.label}). Upgrade or purchase an add-on.`,
          unit,
          used: u.aiVideos,
          included
        }
      }
      u.aiVideos++
    }

    return { ok: true }
  }

  async getMonthlyUsage(userId: string, planId: StorytellerPlanId): Promise<AllowanceUsage> {
    const plan = getPlanDefinition(planId)
    const period = currentPeriod()
    const u = this.getOrCreate(userId, period)
    return {
      period,
      episodePassesUsed: u.episodePasses,
      clipBatchesUsed: u.clipBatches,
      aiVideosUsed: u.aiVideos,
      included: plan.allowances
    }
  }
}
