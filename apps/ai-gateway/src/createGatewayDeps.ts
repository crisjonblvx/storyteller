import type { CreditsService } from '@storyteller/ai-gateway'
import { InMemoryCreditsService } from './credits/creditsService.js'
import { SupabaseCreditsService } from './credits/supabaseCreditsService.js'
import type { GatewayEnv } from './env.js'
import { InMemoryJobStore } from './jobs/inMemoryJobStore.js'
import type { JobStorePort } from './jobs/jobStorePort.js'
import { SupabaseJobStore } from './jobs/supabaseJobStore.js'
import { createAdminClient, isSupabasePersistenceEnabled } from './supabase/adminClient.js'
import { log } from './utils/logger.js'
import type { AllowanceService } from './allowances/allowanceServicePort.js'
import { InMemoryAllowanceService } from './allowances/inMemoryAllowanceService.js'
import { SupabaseAllowanceService } from './allowances/supabaseAllowanceService.js'

export interface GatewayPersistence {
  store: JobStorePort
  credits: CreditsService
  allowances: AllowanceService
  persistence: 'memory' | 'supabase'
}

export function createGatewayPersistence(env: GatewayEnv): GatewayPersistence {
  const sb = createAdminClient(env)
  if (sb && isSupabasePersistenceEnabled(env)) {
    log.info('gateway_persistence', { mode: 'supabase' })
    return {
      store: new SupabaseJobStore(sb),
      credits: new SupabaseCreditsService(sb),
      allowances: new SupabaseAllowanceService(sb),
      persistence: 'supabase'
    }
  }
  log.info('gateway_persistence', { mode: 'memory' })
  return {
    store: new InMemoryJobStore(),
    credits: new InMemoryCreditsService(),
    allowances: new InMemoryAllowanceService(),
    persistence: 'memory'
  }
}
