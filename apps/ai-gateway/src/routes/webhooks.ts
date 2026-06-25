import type { FastifyInstance } from 'fastify'
import { storytellerAiFileName } from '@storyteller/shared'
import { log } from '../utils/logger.js'
import type { JobStorePort } from '../jobs/jobStorePort.js'

/**
 * Provider webhooks update job state when supported.
 * Runway/Higgsfield handlers are stubs that log payloads for now — polling remains authoritative.
 */
export function registerWebhookRoutes(app: FastifyInstance, store: JobStorePort): void {
  app.post('/v1/media/webhooks/runway', async (req, reply) => {
    const body = req.body as { taskId?: string; status?: string; output?: string[] }
    log.info('runway_webhook', { taskId: body?.taskId, status: body?.status })
    if (body?.taskId && body.status === 'SUCCEEDED' && body.output?.[0]) {
      await patchJobByProviderId(store, body.taskId, {
        status: 'succeeded',
        progress: 100,
        result: {
          url: body.output[0],
          mimeType: 'video/mp4',
          fileName: storytellerAiFileName({ kind: 'motion', id: body.taskId.slice(0, 8) })
        }
      })
    }
    return reply.send({ ok: true })
  })

  app.post('/v1/media/webhooks/higgsfield', async (req, reply) => {
    const body = req.body as {
      request_id?: string
      status?: string
      video?: { url?: string }
    }
    log.info('higgsfield_webhook', { requestId: body?.request_id, status: body?.status })
    if (body?.request_id && body.status === 'completed' && body.video?.url) {
      await patchJobByProviderId(store, body.request_id, {
        status: 'succeeded',
        progress: 100,
        result: {
          url: body.video.url,
          mimeType: 'video/mp4',
          fileName: storytellerAiFileName({ kind: 'motion', id: body.request_id.slice(0, 8) })
        }
      })
    }
    return reply.send({ ok: true })
  })
}

async function patchJobByProviderId(
  store: JobStorePort,
  providerJobId: string,
  patch: Parameters<JobStorePort['update']>[1]
): Promise<void> {
  const job = await store.findByProviderJobId(providerJobId)
  if (job) await store.update(job.jobId, patch)
}
