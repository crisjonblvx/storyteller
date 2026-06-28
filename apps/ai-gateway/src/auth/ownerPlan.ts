import type { StorytellerPlanId } from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import type { AuthUser } from './verifySupabaseJwt.js'

export function resolveEffectivePlanId(
  user: AuthUser,
  planId: StorytellerPlanId,
  env: GatewayEnv
): StorytellerPlanId {
  if (planId === 'owner') return planId
  return isOwnerAccount(user, env) ? 'owner' : planId
}

export function isOwnerAccount(user: AuthUser, env: GatewayEnv): boolean {
  if (env.storytellerOwnerUserIds.includes(user.id)) {
    return true
  }
  const email = user.email?.trim().toLowerCase()
  return email != null && email !== '' && env.storytellerOwnerEmails.includes(email)
}
