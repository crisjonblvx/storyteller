import Fastify, { type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import type { CreditsService } from '@storyteller/ai-gateway'
import { loadEnv, parseBool, type GatewayEnv } from './env.js'
import { createGatewayPersistence } from './createGatewayDeps.js'
import { JobRunner } from './jobs/jobRunner.js'
import { createRunwayProvider } from './providers/runwayProvider.js'
import { createHiggsfieldProvider } from './providers/higgsfieldProvider.js'
import { createOpenAiProvider } from './providers/openaiProvider.js'
import { createXaiProvider } from './providers/xaiProvider.js'
import { createGeminiProvider } from './providers/geminiProvider.js'
import { createIdeogramProvider } from './providers/ideogramProvider.js'
import { registerMediaGenerateRoutes } from './routes/mediaGenerate.js'
import { registerMediaJobRoutes } from './routes/mediaJobs.js'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerLlmProxyRoutes } from './routes/llmProxy.js'
import { registerTranscribeRoutes } from './routes/transcribe.js'
import { registerAccountRoutes } from './routes/account.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerAdminRoutes } from './routes/admin.js'
import type { JobStorePort } from './jobs/jobStorePort.js'
import type { MediaProvider } from './providers/providerTypes.js'
import type { AllowanceService } from './allowances/allowanceServicePort.js'
import { createAdminClient } from './supabase/adminClient.js'

// Extend FastifyRequest to carry the raw body for Stripe webhook signature verification.
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer
  }
}

export interface BuildServerOverrides {
  env?: Partial<GatewayEnv>
  store?: JobStorePort
  credits?: CreditsService
  allowances?: AllowanceService
  providers?: Map<string, MediaProvider>
  persistenceMode?: 'memory' | 'supabase'
}

/**
 * Build the Fastify app. Accepts optional overrides for tests
 * (custom env, in-memory persistence, stub providers).
 */
export async function buildServer(overrides: BuildServerOverrides = {}) {
  const baseEnv = loadEnv()
  const env: GatewayEnv = { ...baseEnv, ...overrides.env }
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })

  // Replace the default JSON parser to also stash rawBody for the Stripe webhook route.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      req.rawBody = body
      try {
        done(null, body.length > 0 ? (JSON.parse(body.toString()) as unknown) : {})
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)))
      }
    }
  )

  let store: JobStorePort
  let credits: CreditsService
  let allowances: AllowanceService
  let persistence: 'memory' | 'supabase'

  if (overrides.store && overrides.credits && overrides.allowances) {
    store = overrides.store
    credits = overrides.credits
    allowances = overrides.allowances
    persistence = overrides.persistenceMode ?? 'memory'
  } else {
    const resolved = createGatewayPersistence(env)
    store = overrides.store ?? resolved.store
    credits = overrides.credits ?? resolved.credits
    allowances = overrides.allowances ?? resolved.allowances
    persistence = overrides.persistenceMode ?? resolved.persistence
  }

  const legacyVideo = parseBool(process.env.ENABLE_LEGACY_VIDEO_PROVIDERS, false)
  const providerEntries: [string, MediaProvider][] = [
    ['openai', createOpenAiProvider(env)],
    ['xai', createXaiProvider(env)],
    ['gemini', createGeminiProvider(env)],
    ['ideogram', createIdeogramProvider(env)]
  ]
  if (legacyVideo) {
    providerEntries.push(['runway', createRunwayProvider(env)], ['higgsfield', createHiggsfieldProvider(env)])
  }
  const providers =
    overrides.providers ?? new Map<string, MediaProvider>(providerEntries)
  const runner = new JobRunner(store, credits, providers)

  app.get('/health', async () => ({
    ok: true,
    persistence,
    providers: {
      openai: providers.get('openai')?.isAvailable() ?? false,
      xai: providers.get('xai')?.isAvailable() ?? false,
      gemini: providers.get('gemini')?.isAvailable() ?? false,
      ideogram: providers.get('ideogram')?.isAvailable() ?? false,
      runway: providers.get('runway')?.isAvailable() ?? false,
      higgsfield: providers.get('higgsfield')?.isAvailable() ?? false
    },
    llm: Boolean(env.openaiApiKey)
  }))

  registerMediaGenerateRoutes(app, { env, store, runner, credits, allowances, providers })
  registerMediaJobRoutes(app, { env, store, credits, providers })
  registerAccountRoutes(app, { env, credits, store })
  registerWebhookRoutes(app, store)
  registerLlmProxyRoutes(app, env)
  await registerTranscribeRoutes(app, { env, credits, allowances })
  registerBillingRoutes(app, { env, sb: createAdminClient(env) })
  registerAdminRoutes(app, { env, store, sb: createAdminClient(env) })

  return { app, env, persistence, store, credits, allowances, providers, runner }
}
