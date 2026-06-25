import type { FastifyInstance } from 'fastify'
import { sanitizeJobStatusForCapability } from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import type { JobStorePort } from '../jobs/jobStorePort.js'
import type { CreditsService } from '@storyteller/ai-gateway'
import type { MediaProvider } from '../providers/providerTypes.js'

export function registerMediaJobRoutes(
  app: FastifyInstance,
  deps: {
    env: GatewayEnv
    store: JobStorePort
    credits: CreditsService
    providers: Map<string, MediaProvider>
  }
): void {
  // Legacy provider-aware job status.
  app.get('/v1/media/jobs/:jobId', async (req, reply) => {
    try {
      const job = await fetchJobForUser(req, deps)
      return reply.send(deps.store.toStatus(job))
    } catch (e) {
      return sendError(reply, e)
    }
  })

  // Capability job status — strips provider/internal fields.
  app.get('/v1/capabilities/media-jobs/:jobId', async (req, reply) => {
    try {
      const job = await fetchJobForUser(req, deps)
      return reply.send(sanitizeJobStatusForCapability(deps.store.toStatus(job)))
    } catch (e) {
      return sendError(reply, e)
    }
  })

  // Both routes share cancellation logic.
  for (const path of ['/v1/media/jobs/:jobId/cancel', '/v1/capabilities/media-jobs/:jobId/cancel']) {
    app.post(path, async (req, reply) => {
      try {
        const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
        const { jobId } = req.params as { jobId: string }
        const job = await deps.store.get(jobId)
        if (!job || job.userId !== user.id) {
          throw new GatewayError('Job not found.', 'NOT_FOUND', 404)
        }
        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
          return reply.send({ ok: true, status: job.status })
        }
        const provider = deps.providers.get(job.provider)
        if (job.providerJobId && provider?.cancel) {
          await provider.cancel(job.providerJobId)
        }
        await deps.store.update(jobId, { status: 'cancelled' })
        await deps.credits.refund(user.id, jobId)
        return reply.send({ ok: true, status: 'cancelled' })
      } catch (e) {
        return sendError(reply, e)
      }
    })
  }
}

async function fetchJobForUser(
  req: import('fastify').FastifyRequest,
  deps: { env: GatewayEnv; store: JobStorePort }
) {
  const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
  const { jobId } = req.params as { jobId: string }
  const job = await deps.store.get(jobId)
  if (!job || job.userId !== user.id) {
    throw new GatewayError('Job not found.', 'NOT_FOUND', 404)
  }
  return job
}

function sendError(reply: import('fastify').FastifyReply, e: unknown) {
  const err = normalizeError(e)
  const status = e instanceof GatewayError ? e.statusCode : 500
  return reply.status(status).send({ error: err.message, code: err.code })
}
