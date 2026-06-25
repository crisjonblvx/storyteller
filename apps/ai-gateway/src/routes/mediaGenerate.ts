import type { FastifyInstance } from 'fastify'
import {
  buildInternalGenerateRequest,
  estimateMediaCredits,
  type GenerateMediaCapabilityRequest,
  type GenerateMediaCapabilityResponse,
  type GenerateMediaRequest,
  type GenerateMediaResponse
} from '@storyteller/ai-gateway'
import {
  providerSupportsIntent,
  selectProvider,
  selectVideoFallbackProvider,
  selectStillFallbackProvider
} from '@storyteller/ai-gateway/server'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import { log } from '../utils/logger.js'
import type { JobStorePort } from '../jobs/jobStorePort.js'
import type { JobRunner } from '../jobs/jobRunner.js'
import type { CreditsService } from '@storyteller/ai-gateway'
import type { MediaProvider } from '../providers/providerTypes.js'
import type { AllowanceService } from '../allowances/allowanceServicePort.js'

export interface MediaGenerateDeps {
  env: GatewayEnv
  store: JobStorePort
  runner: JobRunner
  credits: CreditsService
  allowances: AllowanceService
  providers: Map<string, MediaProvider>
}

export function registerMediaGenerateRoutes(app: FastifyInstance, deps: MediaGenerateDeps): void {
  // Legacy provider-aware endpoint (kept for backwards compatibility).
  app.post('/v1/media/generate', async (req, reply) => {
    try {
      const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
      const body = req.body as GenerateMediaRequest
      validateGenerateRequest(body)
      const result = await startMediaJob(deps, user.id, body, { capability: body.intent })
      return reply.send(result satisfies GenerateMediaResponse)
    } catch (e) {
      return sendError(reply, e)
    }
  })

  // Capability-first endpoint. Provider selection stays server-side and
  // the response does not leak the resolved provider name.
  app.post('/v1/capabilities/media-generate', async (req, reply) => {
    try {
      const user = await verifySupabaseJwt(req.headers.authorization, deps.env)
      const body = req.body as GenerateMediaCapabilityRequest
      validateCapabilityRequest(body)
      const internal = buildInternalGenerateRequest(body)
      internal.metadata = {
        ...internal.metadata,
        capability: body.capability
      }
      const internalResult = await startMediaJob(deps, user.id, internal, {
        capability: body.capability
      })
      const capabilityResult: GenerateMediaCapabilityResponse = {
        jobId: internalResult.jobId,
        status: internalResult.status,
        estimatedCredits: internalResult.estimatedCredits,
        message: internalResult.message
      }
      return reply.send(capabilityResult)
    } catch (e) {
      return sendError(reply, e)
    }
  })
}

async function startMediaJob(
  deps: MediaGenerateDeps,
  userId: string,
  body: GenerateMediaRequest,
  observability?: { capability?: string }
): Promise<GenerateMediaResponse> {
  if (
    (body.intent === 'image_to_video' || body.intent === 'motion_graphic') &&
    !body.referenceImageUrl?.trim()
  ) {
    throw new GatewayError(
      'video-clip-from-image requires referenceImageUrl (approved still).',
      'INVALID_REQUEST',
      400
    )
  }

  let providerName = selectProvider(body)
  let provider = deps.providers.get(providerName)
  if (!provider?.isAvailable()) {
    const isStillIntent = body.intent === 'concept_frame' || body.intent === 'storyboard_frame'
    const fallback = isStillIntent
      ? selectStillFallbackProvider(providerName)
      : selectVideoFallbackProvider(providerName)
    const fb = deps.providers.get(fallback)
    if (fb?.isAvailable() && providerSupportsIntent(fallback, body.intent)) {
      providerName = fallback
      provider = fb
    }
  }
  if (!provider?.isAvailable()) {
    throw new GatewayError(
      `${providerName} is not available on this gateway.`,
      'PROVIDER_UNAVAILABLE',
      503
    )
  }
  if (!providerSupportsIntent(providerName, body.intent)) {
    throw new GatewayError(
      `Provider ${providerName} does not support intent ${body.intent}.`,
      'UNSUPPORTED_INTENT',
      400
    )
  }

  const estimatedCredits = estimateMediaCredits(body.intent, {
    durationSeconds: body.durationSeconds
  })

  if (!body.courtesyRegen) {
    // Fetch account summary once — used for both the credit check and the plan-tier allowance check.
    const summary = await deps.credits.getAccountSummary(userId)
    if (summary.available < estimatedCredits) {
      throw new GatewayError(
        `Insufficient credits (need ${estimatedCredits}, have ${summary.available}).`,
        'INSUFFICIENT_CREDITS',
        402
      )
    }

    // Gate on monthly AI Video allowance for generation intents.
    if (
      body.intent === 'broll_text_to_video' ||
      body.intent === 'motion_graphic' ||
      body.intent === 'image_to_video'
    ) {
      const allowCheck = await deps.allowances.checkAndConsume(userId, 'ai_video', summary.planId)
      if (!allowCheck.ok) {
        throw new GatewayError(allowCheck.message, 'ALLOWANCE_EXCEEDED', 402)
      }
    }
  }

  const job = await deps.store.create({
    userId,
    request: body,
    provider: providerName,
    creditsReserved: estimatedCredits
  })

  if (!body.courtesyRegen) {
    await deps.credits.reserve(userId, estimatedCredits, job.jobId)
  }
  deps.runner.rememberRequest(job.jobId, body)

  const submitted = await provider.submit(body, job.jobId)
  await deps.store.update(job.jobId, {
    status: 'running',
    providerJobId: submitted.providerJobId,
    progress: 10
  })
  deps.runner.start(job.jobId, provider, submitted.providerJobId)

  log.info('job_queued', {
    jobId: job.jobId,
    userId,
    projectId: body.projectId,
    intent: body.intent,
    capability: observability?.capability ?? body.metadata?.capability,
    provider: providerName,
    slotId: body.slotId
  })

  return {
    jobId: job.jobId,
    status: 'running',
    provider: providerName,
    estimatedCredits,
    message: 'Generation started. Poll GET /v1/media/jobs/:jobId for status.'
  }
}

function validateGenerateRequest(body: GenerateMediaRequest): void {
  if (!body || typeof body !== 'object') {
    throw new GatewayError('Invalid request body.', 'INVALID_REQUEST', 400)
  }
  if (!body.projectId?.trim()) {
    throw new GatewayError('projectId is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.prompt?.trim()) {
    throw new GatewayError('prompt is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.intent) {
    throw new GatewayError('intent is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.creativeMode) {
    throw new GatewayError('creativeMode is required.', 'INVALID_REQUEST', 400)
  }
}

function validateCapabilityRequest(body: GenerateMediaCapabilityRequest): void {
  if (!body || typeof body !== 'object') {
    throw new GatewayError('Invalid request body.', 'INVALID_REQUEST', 400)
  }
  if (!body.projectId?.trim()) {
    throw new GatewayError('projectId is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.prompt?.trim()) {
    throw new GatewayError('prompt is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.capability) {
    throw new GatewayError('capability is required.', 'INVALID_REQUEST', 400)
  }
  if (!body.creativeMode) {
    throw new GatewayError('creativeMode is required.', 'INVALID_REQUEST', 400)
  }
}

function sendError(reply: import('fastify').FastifyReply, e: unknown) {
  const err = normalizeError(e)
  const status = e instanceof GatewayError ? e.statusCode : 500
  return reply.status(status).send({
    error: err.message,
    code: err.code,
    message: err.message,
    ...(err.providerMessage ? { providerMessage: err.providerMessage } : {})
  })
}
