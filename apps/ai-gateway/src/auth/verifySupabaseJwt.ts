import * as jose from 'jose'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'

export interface AuthUser {
  id: string
  email?: string
}

export async function verifySupabaseJwt(
  authorization: string | undefined,
  env: GatewayEnv
): Promise<AuthUser> {
  const token = parseBearer(authorization)
  if (!token) {
    throw new GatewayError('Missing Authorization bearer token.', 'UNAUTHORIZED', 401)
  }

  // Prefer local JWT verification when the secret is available (faster, no network hop).
  if (env.supabaseJwtSecret) {
    return verifyLocal(token, env.supabaseJwtSecret)
  }

  // Fallback: verify via Supabase REST API — requires the anon key (or service role key) as apikey.
  const apiKey = env.supabaseAnonKey ?? env.supabaseServiceRoleKey
  if (env.supabaseUrl && apiKey) {
    return verifyViaSupabaseApi(token, env.supabaseUrl, apiKey)
  }

  // Dev-only unsafe fallback when nothing is configured.
  if (env.nodeEnv === 'development') {
    return decodeUnsafe(token)
  }

  throw new GatewayError('Gateway auth is not configured.', 'AUTH_NOT_CONFIGURED', 503)
}

async function verifyLocal(token: string, jwtSecret: string): Promise<AuthUser> {
  const secret = new TextEncoder().encode(jwtSecret)
  try {
    const { payload } = await jose.jwtVerify(token, secret, { algorithms: ['HS256'] })
    const sub = typeof payload.sub === 'string' ? payload.sub : null
    if (!sub) {
      throw new GatewayError('Invalid token subject.', 'UNAUTHORIZED', 401)
    }
    return { id: sub, email: typeof payload.email === 'string' ? payload.email : undefined }
  } catch (e) {
    if (e instanceof GatewayError) throw e
    throw new GatewayError('Invalid or expired session.', 'UNAUTHORIZED', 401)
  }
}

async function verifyViaSupabaseApi(token: string, supabaseUrl: string, apiKey: string): Promise<AuthUser> {
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: apiKey
      },
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    throw new GatewayError('Auth verification request failed.', 'UNAUTHORIZED', 401)
  }
  if (!res.ok) {
    throw new GatewayError('Invalid or expired session.', 'UNAUTHORIZED', 401)
  }
  const body = (await res.json()) as { id?: string; email?: string }
  if (!body.id) {
    throw new GatewayError('Invalid auth response.', 'UNAUTHORIZED', 401)
  }
  return { id: body.id, email: body.email }
}

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const t = header.slice(7).trim()
  return t || null
}

/** Dev-only fallback when SUPABASE_JWT_SECRET is unset. */
function decodeUnsafe(token: string): AuthUser {
  const parts = token.split('.')
  if (parts.length < 2) {
    throw new GatewayError('Malformed JWT.', 'UNAUTHORIZED', 401)
  }
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
    sub?: string
    email?: string
  }
  if (!payload.sub) {
    throw new GatewayError('JWT missing sub.', 'UNAUTHORIZED', 401)
  }
  return { id: payload.sub, email: payload.email }
}
