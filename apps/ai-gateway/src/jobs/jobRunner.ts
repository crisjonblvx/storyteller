import type { GenerateMediaRequest } from '@storyteller/ai-gateway'
import type { CreditsService } from '@storyteller/ai-gateway'
import { log } from '../utils/logger.js'
import type { MediaProvider } from '../providers/providerTypes.js'
import type { JobStorePort } from './jobStorePort.js'

const POLL_MS = 5000
const MAX_POLLS = 120

export class JobRunner {
  private active = new Set<string>()

  constructor(
    private readonly store: JobStorePort,
    private readonly credits: CreditsService,
    private readonly providers: Map<string, MediaProvider>,
    private readonly requests = new Map<string, GenerateMediaRequest>()
  ) {}

  rememberRequest(jobId: string, request: GenerateMediaRequest): void {
    this.requests.set(jobId, request)
  }

  start(jobId: string, provider: MediaProvider, providerJobId: string): void {
    if (this.active.has(jobId)) return
    this.active.add(jobId)
    void this.loop(jobId, provider, providerJobId).catch((err) => {
      log.error('job_loop_uncaught', {
        jobId,
        provider: provider.name,
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }

  private async loop(jobId: string, provider: MediaProvider, providerJobId: string): Promise<void> {
    const request = this.requests.get(jobId)
    if (!request) return

    try {
      for (let i = 0; i < MAX_POLLS; i++) {
        const job = await this.store.get(jobId)
        if (!job || job.status === 'cancelled') {
          if (job) await this.credits.refund(job.userId, jobId)
          return
        }

        const tick = await provider.poll(providerJobId, request)
        if (tick.status === 'running') {
          await this.store.update(jobId, { status: 'running', progress: tick.progress ?? 30 })
          await sleep(POLL_MS)
          continue
        }

        if (tick.status === 'succeeded' && tick.result) {
          await this.store.update(jobId, {
            status: 'succeeded',
            progress: 100,
            result: tick.result
          })
          await this.credits.commit(job.userId, jobId)
          log.info('job_succeeded', { jobId, provider: provider.name, userId: job.userId })
          return
        }

        await this.store.update(jobId, {
          status: 'failed',
          error: {
            code: tick.errorCode ?? 'PROVIDER_FAILED',
            message: tick.errorMessage ?? 'Provider generation failed.',
            providerMessage: tick.errorMessage
          }
        })
        await this.credits.refund(job.userId, jobId)
        log.warn('job_failed', { jobId, provider: provider.name, error: tick.errorMessage })
        return
      }

      const job = await this.store.get(jobId)
      if (job) {
        await this.store.update(jobId, {
          status: 'failed',
          error: { code: 'TIMEOUT', message: 'Generation timed out waiting for the provider.' }
        })
        await this.credits.refund(job.userId, jobId)
      }
    } finally {
      this.active.delete(jobId)
      this.requests.delete(jobId)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
