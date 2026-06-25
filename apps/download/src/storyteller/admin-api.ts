const TOKEN_KEY = 'storyteller_admin_token'

export function adminConfig() {
  return {
    gatewayUrl:
      import.meta.env.VITE_STORYTELLER_GATEWAY_URL || 'https://storyteller-api.contentcreators.life'
  }
}

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export type AdminOverview = {
  periodStart: string
  userCount: number
  activeUsersMtd: number
  jobsMtd: number
  creditsConsumedMtd: number
  estimatedUsdMtd: number
}

export type AdminUserRow = {
  userId: string
  email: string
  signupDate: string | null
  planId: string
  balance: number
  episodePassesUsed: number
  clipBatchesUsed: number
  aiVideosUsed: number
  creditsSpentMtd: number
  lastActivity: string | null
}

export type AdminActivityItem = {
  jobId: string
  userEmail: string
  intent: string
  provider: string
  status: string
  creditsReserved: number
  estimatedUsd: number
  createdAt: string
}

export async function adminFetch<T>(
  path: string,
  opts: { token?: string; method?: string; body?: unknown } = {}
): Promise<T> {
  const { gatewayUrl } = adminConfig()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${gatewayUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  })

  const data = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string }
  if (!res.ok) {
    throw new Error(data.message ?? `Request failed (${res.status})`)
  }
  return data
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
