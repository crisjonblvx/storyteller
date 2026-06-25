import { randomUUID } from 'node:crypto'
import type {
  GenerateMediaRequest,
  GenerationJobRecord,
  GenerationJobStatus,
  GenerationJobStatusValue,
  ProviderName
} from '@storyteller/ai-gateway'
import type { JobStorePort } from './jobStorePort.js'

export class InMemoryJobStore implements JobStorePort {
  private jobs = new Map<string, GenerationJobRecord>()

  async create(params: {
    userId: string
    request: GenerateMediaRequest
    provider: ProviderName
    creditsReserved: number
  }): Promise<GenerationJobRecord> {
    const now = new Date().toISOString()
    const job: GenerationJobRecord = {
      jobId: randomUUID(),
      userId: params.userId,
      projectId: params.request.projectId,
      intent: params.request.intent,
      status: 'queued',
      provider: params.provider,
      progress: 0,
      creditsReserved: params.creditsReserved,
      createdAt: now,
      updatedAt: now
    }
    this.jobs.set(job.jobId, job)
    return job
  }

  async get(jobId: string): Promise<GenerationJobRecord | undefined> {
    return this.jobs.get(jobId)
  }

  async update(
    jobId: string,
    patch: Partial<GenerationJobRecord>
  ): Promise<GenerationJobRecord | undefined> {
    const job = this.jobs.get(jobId)
    if (!job) return undefined
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() }
    this.jobs.set(jobId, next)
    return next
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

  async setStatus(jobId: string, status: GenerationJobStatusValue): Promise<void> {
    await this.update(jobId, { status })
  }

  async findByProviderJobId(providerJobId: string): Promise<GenerationJobRecord | undefined> {
    for (const job of this.jobs.values()) {
      if (job.providerJobId === providerJobId) return job
    }
    return undefined
  }

  async listForUser(
    userId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)
    const offset = Math.max(opts?.offset ?? 0, 0)
    const all = [...this.jobs.values()]
      .filter((j) => j.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      items: all.slice(offset, offset + limit),
      total: all.length
    }
  }

  async listRecentAll(opts?: {
    limit?: number
    offset?: number
  }): Promise<{ items: GenerationJobRecord[]; total: number }> {
    const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100)
    const offset = Math.max(opts?.offset ?? 0, 0)
    const all = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      items: all.slice(offset, offset + limit),
      total: all.length
    }
  }
}
