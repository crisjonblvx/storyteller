import { supabase, supabaseConfigured } from '@renderer/lib/supabase'

/** Supabase access token for hosted gateway requests (never log or persist). */
export async function getGatewayAccessToken(): Promise<string | null> {
  if (!supabase) {
    if (import.meta.env.DEV) {
      console.warn('[gateway-auth] Supabase client is null — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not configured')
    }
    return null
  }
  const { data, error } = await supabase.auth.getSession()
  if (import.meta.env.DEV && !data.session) {
    console.warn('[gateway-auth] getSession() returned no session', { supabaseConfigured, error: error?.message })
  }
  return data.session?.access_token ?? null
}
