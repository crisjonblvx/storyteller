import type { FastifyInstance } from 'fastify'
import {
  getPlanDefinition,
  intentToCapability,
  type StorytellerAccountSummaryWire,
  type StorytellerMediaCapability,
  type StorytellerUsageHistory,
  type StorytellerUsageItem
} from '@storyteller/ai-gateway'
import type { CreditsService } from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import type { JobStorePort } from '../jobs/jobStorePort.js'

const ALL_CAPABILITIES: StorytellerMediaCapability[] = [
  'video-clip-from-text',
  'video-clip-from-image',
  'concept-frame',
  'storyboard-frame',
  'motion-graphic',
  'refine-prompt'
]

export interface AccountRouteDeps {
  env: GatewayEnv
  credits: CreditsService
  store: JobStorePort
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const handler = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    try {
      const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
      const summary = await deps.credits.getAccountSummary(user.id)
      const plan = getPlanDefinition(summary.planId)
      const mediaEnabled = summary.available > 0
      const body: StorytellerAccountSummaryWire = {
        planId: plan.id,
        planLabel: plan.label,
        priceUsdMonthly: plan.priceUsdMonthly,
        monthlyAllowances: plan.allowances,
        monthlyCredits: plan.monthlyCredits,
        balance: summary.balance,
        reserved: summary.reserved,
        available: summary.available,
        capabilities: mediaEnabled ? ALL_CAPABILITIES : [],
        mediaEnabled,
        reviewEnabled: true
      }
      return reply.send(body)
    } catch (e) {
      return sendError(reply, e)
    }
  }

  app.get('/v1/account', handler)
  app.get('/v1/capabilities/account', handler)

  const usageHandler = async (
    req: import('fastify').FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>,
    reply: import('fastify').FastifyReply
  ) => {
    try {
      const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
      const limit = req.query.limit ? Number(req.query.limit) : 20
      const offset = req.query.offset ? Number(req.query.offset) : 0
      const { items, total } = await deps.store.listForUser(user.id, { limit, offset })
      const history: StorytellerUsageHistory = {
        total,
        items: items.map(toUsageItem)
      }
      return reply.send(history)
    } catch (e) {
      return sendError(reply, e)
    }
  }

  app.get('/v1/account/usage', usageHandler)
  app.get('/v1/capabilities/account/usage', usageHandler)
}

function toUsageItem(job: import('@storyteller/ai-gateway').GenerationJobRecord): StorytellerUsageItem {
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    capability: intentToCapability(job.intent),
    status: job.status,
    creditsReserved: job.creditsReserved,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorMessage: job.error?.message
  }
}

function sendError(reply: import('fastify').FastifyReply, e: unknown) {
  const err = normalizeError(e)
  const status = e instanceof GatewayError ? e.statusCode : 500
  return reply.status(status).send({
    error: err.message,
    code: err.code,
    message: err.message
  })
}
