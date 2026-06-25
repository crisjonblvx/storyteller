import type {
  GenerateMediaRequest,
  GenerationJobError,
  GenerationJobRecord,
  GenerationJobResult,
  GenerationJobStatus,
  ProviderName,
  StorytellerGenerationIntent
} from '@storyteller/ai-gateway'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobStorePort } from './jobStorePort.js'

type JobRow = {
  id: string
  user_id: string
  project_id: string
  intent: string
  provider: string
  status: string
  progress: number | null
  provider_job_id: string | null
  credits_reserved: number
  request_json: GenerateMediaRequest
  result_json: GenerationJobResult | null
  error_json: GenerationJobError | null
  created_at: string
  updated_at: string
}

export class SupabaseJobStore implements JobStorePort {
  constructor(private readonly sb: SupabaseClient) {}

  async create(params: {
    userId: string
    request: GenerateMediaRequest
    provider: ProviderName
    creditsReserved: number
  }): Promise<GenerationJobRecord> {
    const { data, error } = await this.sb
      .from('generation_jobs')
      .insert({
        user_id: params.userId,
        project_id: params.request.projectId,
        intent: params.request.intent,
        provider: params.provider,
        status: 'queued',
        progress: 0,
        credits_reserved: params.creditsReserved,
        request_json: params.request
      })
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`Failed to create generation job: ${error?.message ?? 'unknown'}`)
    }
    return rowToRecord(data as JobRow)
  }

  async get(jobId: string): Promise<GenerationJobRecord | undefined> {
    const { data, error } = await this.sb.from('generation_jobs').select('*').eq('id', jobId).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? rowToRecord(data as JobRow) : undefined
  }

  async update(
    jobId: string,
    patch: Partial<GenerationJobRecord>
  ): Promise<GenerationJobRecord | undefined> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.status) row.status = patch.status
    if (patch.progress !== undefined) row.progress = patch.progress
    if (patch.providerJobId !== undefined) row.provider_job_id = patch.providerJobId
    if (patch.result !== undefined) row.result_json = patch.result
    if (patch.error !== undefined) row.error_json = patch.error

    const { data, error } = await this.sb
      .from('generation_jobs')
      .update(row)
      .eq('id', jobId)
      .select('*')
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data ? rowToRecord(data as JobRow) : undefined
  }

  toStatus(job: GenerationJobRecord): GenerationJobStatus {
    return {
      jobId: job.jobId,
      status: job.status,
      provider: job.provider,
      progress: job.progress,
      result: job.result,
      error: job.error
    }
  }

  async findByProviderJobId(providerJobId: string): Promise<GenerationJobRecord | undefined> {
    const { data, error } = await this.sb
      .from('generation_jobs')
      .select('*')
      .eq('provider_job_id', providerJobId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? rowToRecord(data as JobRow) : undefined
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)
    const offset = Math.max(opts?.offset ?? 0, 0)

    const { count, error: countErr } = await this.sb
      .from('generation_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (countErr) throw new Error(countErr.message)

    const { data, error } = await this.sb
      .from('generation_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)

    return {
      items: (data ?? []).map((row) => rowToRecord(row as JobRow)),
      total: count ?? 0
    }
  }

  async listRecentAll(opts?: {
    limit?: number
    offset?: number
  }): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)
    const offset = Math.max(opts?.offset ?? 0, 0)

    const { count, error: countErr } = await this.sb
      .from('generation_jobs')
      .select('*', { count: 'exact', head: true })
    if (countErr) throw new Error(countErr.message)

    const { data, error } = await this.sb
      .from('generation_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)

    return {
      items: (data ?? []).map((row) => rowToRecord(row as JobRow)),
      total: count ?? 0
    }
  }
}

function rowToRecord(row: JobRow): GenerationJobRecord {
  return {
    jobId: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    intent: row.intent as StorytellerGenerationIntent,
    status: row.status as GenerationJobRecord['status'],
    provider: row.provider as ProviderName,
    progress: row.progress ?? undefined,
    providerJobId: row.provider_job_id ?? undefined,
    creditsReserved: row.credits_reserved,
    result: row.result_json ?? undefined,
    error: row.error_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
