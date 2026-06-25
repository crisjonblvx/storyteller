import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { GatewayEnv } from '../env.js'

export function createAdminClient(env: GatewayEnv): SupabaseClient | null {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export function isSupabasePersistenceEnabled(env: GatewayEnv): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey)
}
