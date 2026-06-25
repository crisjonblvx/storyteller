import type { FastifyInstance } from 'fastify'
import type {
  AnalyzeGroundedReviewParams,
  GenerateBrollForSoundbiteParams,
  GenerateBrollPromptsFromBeatsParams,
  GenerateBrollPromptsParams
} from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import {
  hostedAnalyzeGroundedReview,
  hostedGenerateBrollForSoundbite,
  hostedGenerateBrollPrompts,
  hostedGenerateBrollPromptsFromBeats
} from '../services/llmHosted.js'

export function registerLlmProxyRoutes(app: FastifyInstance, env: GatewayEnv): void {
  registerCapabilityPost<GenerateBrollPromptsParams>(app, env, [
    '/v1/capabilities/broll-prompts',
    '/v1/broll/prompts'
  ], async (body) => hostedGenerateBrollPrompts(env, body))

  registerCapabilityPost<GenerateBrollPromptsFromBeatsParams>(app, env, [
    '/v1/capabilities/broll-prompts-from-beats',
    '/v1/broll/prompts-from-beats'
  ], async (body) => hostedGenerateBrollPromptsFromBeats(env, body))

  registerCapabilityPost<GenerateBrollForSoundbiteParams>(app, env, [
    '/v1/capabilities/broll-for-soundbite',
    '/v1/broll/for-soundbite'
  ], async (body) => hostedGenerateBrollForSoundbite(env, body))

  registerCapabilityPost<AnalyzeGroundedReviewParams>(app, env, [
    '/v1/capabilities/grounded-review',
    '/v1/review/grounded'
  ], async (body) => hostedAnalyzeGroundedReview(env, body))
}

function registerCapabilityPost<TBody>(
  app: FastifyInstance,
  env: GatewayEnv,
  paths: string[],
  handler: (body: TBody) => Promise<unknown>
): void {
  for (const path of paths) {
    app.post(path, async (req, reply) => {
      try {
        await verifySupabaseJwt(req.headers.authorization, env)
        const body = req.body as TBody
        const result = await handler(body)
        return reply.send(result)
      } catch (e) {
        return sendError(reply, e)
      }
    })
  }
}

function sendError(reply: import('fastify').FastifyReply, e: unknown) {
  const err = normalizeError(e)
  const status = e instanceof GatewayError ? e.statusCode : 500
  return reply.status(status).send({
    ok: false,
    error: err.message,
    code: err.code,
    ...(err.providerMessage ? { providerMessage: err.providerMessage } : {})
  })
}
