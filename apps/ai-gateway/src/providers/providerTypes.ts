import type { GenerateMediaRequest, GenerationJobResult, ProviderName } from '@storyteller/ai-gateway'

export interface ProviderSubmitResult {
  providerJobId: string
}

export interface MediaProvider {
  name: ProviderName
  isAvailable(): boolean
  submit(request: GenerateMediaRequest, jobId: string): Promise<ProviderSubmitResult>
  poll(providerJobId: string, request: GenerateMediaRequest): Promise<{
    status: 'running' | 'succeeded' | 'failed'
    progress?: number
    result?: GenerationJobResult
    errorMessage?: string
    errorCode?: string
  }>
  cancel?(providerJobId: string): Promise<void>
}
