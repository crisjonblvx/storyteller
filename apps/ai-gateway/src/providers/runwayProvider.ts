import RunwayML, { TaskFailedError } from '@runwayml/sdk'
import type { GenerateMediaRequest, GenerationJobResult } from '@storyteller/ai-gateway'
import { storytellerAiFileName } from '@storyteller/shared'
import type { GatewayEnv } from '../env.js'
import { GatewayError } from '../utils/errors.js'
import type { MediaProvider } from './providerTypes.js'

function aspectToRunwayRatio(ar?: string): '1280:720' | '720:1280' {
  if (ar === '9:16' || ar === '4:5') return '720:1280'
  return '1280:720'
}

export function createRunwayProvider(env: GatewayEnv): MediaProvider {
  const apiKey = env.runwayApiKey

  return {
    name: 'runway',
    isAvailable: () => Boolean(apiKey),
    async submit(request, _jobId) {
      if (!apiKey) {
        throw new GatewayError('Runway is not configured on the gateway.', 'PROVIDER_UNAVAILABLE', 503)
      }
      const client = new RunwayML({ apiKey })
      const duration = Math.min(10, Math.max(2, Math.round(request.durationSeconds ?? 5)))
      const created = await client.textToVideo.create({
        model: 'gen4.5',
        promptText: request.prompt.trim().slice(0, 1000),
        ratio: aspectToRunwayRatio(request.aspectRatio),
        duration
      })
      return { providerJobId: created.id }
    },
    async poll(providerJobId, request) {
      if (!apiKey) {
        throw new GatewayError('Runway is not configured.', 'PROVIDER_UNAVAILABLE', 503)
      }
      const client = new RunwayML({ apiKey })
      try {
        const task = await client.tasks.retrieve(providerJobId)
        if (task.status === 'SUCCEEDED') {
          const url = 'output' in task ? task.output?.[0] : undefined
          if (!url) {
            return { status: 'failed', errorMessage: 'Runway returned no output URL.' }
          }
          return {
            status: 'succeeded',
            progress: 100,
            result: buildVideoResult(url, request, providerJobId)
          }
        }
        if (task.status === 'FAILED') {
          const reason =
            'failure' in task && task.failure
              ? task.failure
              : 'failureCode' in task && task.failureCode
                ? task.failureCode
                : 'Runway generation failed.'
          return { status: 'failed', errorMessage: String(reason) }
        }
        if (task.status === 'CANCELLED') {
          return { status: 'failed', errorMessage: 'Runway task was cancelled.' }
        }
        return { status: 'running', progress: task.status === 'RUNNING' ? 60 : 20 }
      } catch (e) {
        if (e instanceof TaskFailedError) {
          const td = e.taskDetails
          const reason =
            ('failure' in td && td.failure) ||
            ('status' in td && td.status) ||
            'Runway generation failed.'
          return { status: 'failed', errorMessage: String(reason) }
        }
        return { status: 'running', progress: 50 }
      }
    },
    async cancel(providerJobId) {
      if (!apiKey) return
      const client = new RunwayML({ apiKey })
      await client.tasks.delete(providerJobId)
    }
  }
}

function buildVideoResult(
  url: string,
  request: GenerateMediaRequest,
  taskId: string
): GenerationJobResult {
  const slot = request.slotId ?? taskId.slice(0, 8)
  return {
    url,
    mimeType: 'video/mp4',
    fileName: storytellerAiFileName({ kind: 'motion', id: slot })
  }
}
