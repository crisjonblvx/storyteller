import { supabase } from '@renderer/lib/supabase'

/** Supabase access token for hosted gateway requests (never log or persist). */
export async function getGatewayAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
