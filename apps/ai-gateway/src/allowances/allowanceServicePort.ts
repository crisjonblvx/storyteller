import type { MeteringUnitId, PlanMonthlyAllowances } from '@storyteller/ai-gateway'
import type { StorytellerPlanId } from '@storyteller/ai-gateway'

export type AllowanceUsage = {
  period: string
  episodePassesUsed: number
  clipBatchesUsed: number
  aiVideosUsed: number
  /** Plan allowances included for the current billing period. */
  included: PlanMonthlyAllowances
}

export type AllowanceConsumeResult =
  | { ok: true }
  | { ok: false; message: string; unit: MeteringUnitId; used: number; included: number }

/**
 * Tracks and enforces monthly metering-unit allowances per plan tier.
 * Each `checkAndConsume` call is atomic — the unit is only decremented when the
 * user is within their included limit, preventing over-consumption races.
 */
export interface AllowanceService {
  /**
   * Atomically verify the user has an allowance for `unit` this month and
   * consume one if so. The caller must not proceed with the metered action
   * when the result is `{ ok: false }`.
   */
  checkAndConsume(
    userId: string,
    unit: MeteringUnitId,
    planId: StorytellerPlanId
  ): Promise<AllowanceConsumeResult>

  /** Current period's usage and plan-included counts — for the account UI. */
  getMonthlyUsage(userId: string, planId: StorytellerPlanId): Promise<AllowanceUsage>
}
