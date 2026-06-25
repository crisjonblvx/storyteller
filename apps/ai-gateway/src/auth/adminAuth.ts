import * as jose from 'jose'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'

const ADMIN_TOKEN_TTL = '12h'
const ADMIN_ISSUER = 'storyteller-admin'

export function getAdminSecret(env: GatewayEnv): string | null {
  return env.storytellerAdminSecret
}

export function isAdminAuthConfigured(env: GatewayEnv): boolean {
  return Boolean(getAdminSecret(env))
}

export async function signAdminToken(env: GatewayEnv): Promise<string> {
  const secret = getAdminSecret(env)
  if (!secret) {
    throw new GatewayError('Admin auth is not configured.', 'ADMIN_NOT_CONFIGURED', 503)
  }
  const key = new TextEncoder().encode(secret)
  return new jose.SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ADMIN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(ADMIN_TOKEN_TTL)
    .sign(key)
}

export async function verifyAdminToken(
  authorization: string | undefined,
  env: GatewayEnv
): Promise<void> {
  const secret = getAdminSecret(env)
  if (!secret) {
    throw new GatewayError('Admin auth is not configured.', 'ADMIN_NOT_CONFIGURED', 503)
  }

  const token = parseBearer(authorization)
  if (!token) {
    throw new GatewayError('Missing admin bearer token.', 'UNAUTHORIZED', 401)
  }

  const key = new TextEncoder().encode(secret)
  try {
    const { payload } = await jose.jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ADMIN_ISSUER
    })
    if (payload.role !== 'admin') {
      throw new GatewayError('Invalid admin token.', 'UNAUTHORIZED', 401)
    }
  } catch (e) {
    if (e instanceof GatewayError) throw e
    throw new GatewayError('Invalid or expired admin token.', 'UNAUTHORIZED', 401)
  }
}

export function verifyAdminPassword(env: GatewayEnv, password: string): boolean {
  const secret = getAdminSecret(env)
  if (!secret) return false
  return password === secret
}

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null
  const t = header.slice(7).trim()
  return t || null
}
