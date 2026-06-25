import type { GenerationJobRecord } from '@storyteller/ai-gateway'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobStorePort } from '../jobs/jobStorePort.js'
import { estimateUsdForJob, sumEstimatedUsd } from './usdEstimates.js'

function monthStartUtc(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type CreditRow = {
  user_id: string
  balance: number
  plan_id: string
}

type AllowanceRow = {
  user_id: string
  episode_passes_used: number
  clip_batches_used: number
  ai_videos_used: number
}

type JobAggRow = {
  user_id: string
  credits_reserved: number
  updated_at: string
}

export type AdminOverview = {
  periodStart: string
  userCount: number
  activeUsersMtd: number
  jobsMtd: number
  creditsConsumedMtd: number
  estimatedUsdMtd: number
  byProvider: Array<{ provider: string; jobs: number; credits: number; estimatedUsd: number }>
  byIntent: Array<{ intent: string; jobs: number; credits: number; estimatedUsd: number }>
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
  userId: string
  userEmail: string
  intent: string
  provider: string
  status: string
  creditsReserved: number
  estimatedUsd: number
  createdAt: string
  updatedAt: string
}

export type AdminUserDetail = AdminUserRow & {
  recentJobs: AdminActivityItem[]
}

export class AdminService {
  constructor(
    private readonly sb: SupabaseClient | null,
    private readonly store: JobStorePort
  ) {}

  async getOverview(): Promise<AdminOverview> {
    const periodStart = monthStartUtc()
    if (!this.sb) {
      return emptyOverview(periodStart)
    }

    const mtdJobs = await this.fetchMtdSucceededJobs(periodStart)
    const creditsConsumedMtd = mtdJobs.reduce((s, j) => s + j.credits, 0)
    const estimatedUsdMtd = sumEstimatedUsd(mtdJobs)

    const { count: userCount } = await this.sb
      .from('gateway_user_credits')
      .select('*', { count: 'exact', head: true })

    const activeUserIds = new Set(mtdJobs.map((j) => j.userId))
    const { data: breakdownRows } = await this.sb
      .from('generation_jobs')
      .select('provider, intent, credits_reserved')
      .eq('status', 'succeeded')
      .gte('created_at', periodStart)

    const byProvider = aggregateByField(
      (breakdownRows ?? []) as Array<{ provider: string; intent: string; credits_reserved: number }>,
      'provider'
    )
    const byIntent = aggregateByField(
      (breakdownRows ?? []) as Array<{ provider: string; intent: string; credits_reserved: number }>,
      'intent'
    )

    const { count: jobsMtd } = await this.sb
      .from('generation_jobs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStart)

    return {
      periodStart,
      userCount: userCount ?? 0,
      activeUsersMtd: activeUserIds.size,
      jobsMtd: jobsMtd ?? 0,
      creditsConsumedMtd,
      estimatedUsdMtd,
      byProvider,
      byIntent
    }
  }

  async listUsers(): Promise<AdminUserRow[]> {
    if (!this.sb) return []

    const period = currentPeriod()
    const periodStart = monthStartUtc()

    const { data: credits, error: creditsErr } = await this.sb
      .from('gateway_user_credits')
      .select('user_id, balance, plan_id')
      .order('updated_at', { ascending: false })
    if (creditsErr) throw new Error(creditsErr.message)

    const { data: allowances } = await this.sb
      .from('gateway_user_allowances')
      .select('user_id, episode_passes_used, clip_batches_used, ai_videos_used')
      .eq('period', period)

    const { data: mtdSpend } = await this.sb
      .from('generation_jobs')
      .select('user_id, credits_reserved, updated_at')
      .eq('status', 'succeeded')
      .gte('created_at', periodStart)

    const allowanceByUser = new Map((allowances ?? []).map((a) => [a.user_id, a as AllowanceRow]))
    const spendByUser = new Map<string, { credits: number; lastActivity: string | null }>()
    for (const row of (mtdSpend ?? []) as JobAggRow[]) {
      const prev = spendByUser.get(row.user_id) ?? { credits: 0, lastActivity: null }
      prev.credits += row.credits_reserved
      if (!prev.lastActivity || row.updated_at > prev.lastActivity) {
        prev.lastActivity = row.updated_at
      }
      spendByUser.set(row.user_id, prev)
    }

    const userIds = (credits ?? []).map((c) => (c as CreditRow).user_id)
    const authByUser = await this.fetchAuthUsers(userIds)

    return (credits ?? []).map((row) => {
      const c = row as CreditRow
      const allowance = allowanceByUser.get(c.user_id)
      const spend = spendByUser.get(c.user_id)
      const auth = authByUser.get(c.user_id)
      return {
        userId: c.user_id,
        email: auth?.email ?? '',
        signupDate: auth?.createdAt ?? null,
        planId: c.plan_id,
        balance: c.balance,
        episodePassesUsed: allowance?.episode_passes_used ?? 0,
        clipBatchesUsed: allowance?.clip_batches_used ?? 0,
        aiVideosUsed: allowance?.ai_videos_used ?? 0,
        creditsSpentMtd: spend?.credits ?? 0,
        lastActivity: spend?.lastActivity ?? null
      }
    })
  }

  async getActivity(opts?: { limit?: number; offset?: number }): Promise<{
    items: AdminActivityItem[]
    total: number
  }> {
    const { items, total } = await this.store.listRecentAll(opts)
    const userIds = [...new Set(items.map((j) => j.userId))]
    const authByUser = this.sb ? await this.fetchAuthUsers(userIds) : new Map()
    return {
      total,
      items: items.map((job) => toActivityItem(job, authByUser.get(job.userId)?.email ?? ''))
    }
  }

  async getUserDetail(userId: string): Promise<AdminUserDetail | null> {
    const users = await this.listUsers()
    const user = users.find((u) => u.userId === userId)
    if (!user) return null

    const { items } = await this.store.listForUser(userId, { limit: 20 })
    const authByUser = this.sb ? await this.fetchAuthUsers([userId]) : new Map()
    const email = authByUser.get(userId)?.email ?? user.email

    return {
      ...user,
      email,
      recentJobs: items.map((job) => toActivityItem(job, email))
    }
  }

  private async fetchMtdSucceededJobs(
    periodStart: string
  ): Promise<Array<{ userId: string; intent: string; credits: number }>> {
    if (!this.sb) return []
    const { data, error } = await this.sb
      .from('generation_jobs')
      .select('user_id, intent, credits_reserved')
      .eq('status', 'succeeded')
      .gte('created_at', periodStart)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => ({
      userId: row.user_id as string,
      intent: row.intent as string,
      credits: row.credits_reserved as number
    }))
  }

  private async fetchAuthUsers(
    userIds: string[]
  ): Promise<Map<string, { email: string; createdAt: string | null }>> {
    const map = new Map<string, { email: string; createdAt: string | null }>()
    if (!this.sb || userIds.length === 0) return map

    const unique = [...new Set(userIds)]
    await Promise.all(
      unique.map(async (id) => {
        const { data, error } = await this.sb!.auth.admin.getUserById(id)
        if (error || !data.user) return
        map.set(id, {
          email: data.user.email ?? '',
          createdAt: data.user.created_at ?? null
        })
      })
    )
    return map
  }
}

function toActivityItem(job: GenerationJobRecord, userEmail: string): AdminActivityItem {
  return {
    jobId: job.jobId,
    userId: job.userId,
    userEmail,
    intent: job.intent,
    provider: job.provider,
    status: job.status,
    creditsReserved: job.creditsReserved,
    estimatedUsd: estimateUsdForJob(job.intent, job.creditsReserved),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  }
}

function emptyOverview(periodStart: string): AdminOverview {
  return {
    periodStart,
    userCount: 0,
    activeUsersMtd: 0,
    jobsMtd: 0,
    creditsConsumedMtd: 0,
    estimatedUsdMtd: 0,
    byProvider: [],
    byIntent: []
  }
}

function aggregateByField(
  rows: Array<{ provider: string; intent: string; credits_reserved: number }>,
  field: 'provider' | 'intent'
): Array<{ provider?: string; intent?: string; jobs: number; credits: number; estimatedUsd: number }> {
  const buckets = new Map<string, { jobs: number; credits: number; intents: string[] }>()
  for (const row of rows) {
    const key = field === 'provider' ? row.provider : row.intent
    const prev = buckets.get(key) ?? { jobs: 0, credits: 0, intents: [] }
    prev.jobs += 1
    prev.credits += row.credits_reserved
    prev.intents.push(row.intent)
    buckets.set(key, prev)
  }
  return [...buckets.entries()]
    .map(([key, val]) => {
      const usd = rows
        .filter((r) => (field === 'provider' ? r.provider : r.intent) === key)
        .reduce((s, r) => s + estimateUsdForJob(r.intent, r.credits_reserved), 0)
      if (field === 'provider') {
        return { provider: key, jobs: val.jobs, credits: val.credits, estimatedUsd: usd }
      }
      return { intent: key, jobs: val.jobs, credits: val.credits, estimatedUsd: usd }
    })
    .sort((a, b) => b.credits - a.credits)
}
