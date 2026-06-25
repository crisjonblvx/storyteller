import type {
  GenerateMediaRequest,
  GenerationJobRecord,
  GenerationJobStatus,
  ProviderName
} from '@storyteller/ai-gateway'

export interface JobStorePort {
  create(params: {
    userId: string
    request: GenerateMediaRequest
    provider: ProviderName
    creditsReserved: number
  }): Promise<GenerationJobRecord>

  get(jobId: string): Promise<GenerationJobRecord | undefined>
  update(jobId: string, patch: Partial<GenerationJobRecord>): Promise<GenerationJobRecord | undefined>
  toStatus(job: GenerationJobRecord): GenerationJobStatus
  findByProviderJobId(providerJobId: string): Promise<GenerationJobRecord | undefined>
  listForUser(
    userId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<{ items: GenerationJobRecord[]; total: number }>
  listRecentAll(opts?: { limit?: number; offset?: number }): Promise<{
    items: GenerationJobRecord[]
    total: number
  }>
}
