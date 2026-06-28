import { InMemoryCreditsService } from '../../src/credits/creditsService.js'
import { InMemoryJobStore } from '../../src/jobs/inMemoryJobStore.js'
import { InMemoryAllowanceService } from '../../src/allowances/inMemoryAllowanceService.js'
import { buildServer } from '../../src/server.js'
import type { MediaProvider } from '../../src/providers/providerTypes.js'

export interface StubProviderConfig {
  /** Override available state per provider name. */
  available?: Record<string, boolean>
}

export function createStubProviders(config: StubProviderConfig = {}): Map<string, MediaProvider> {
  const available = config.available ?? {
    runway: true,
    higgsfield: true,
    openai: true,
    xai: true,
    gemini: true
  }
  return new Map<string, MediaProvider>([
    ['runway', stubProvider('runway', available.runway ?? true)],
    ['higgsfield', stubProvider('higgsfield', available.higgsfield ?? true)],
    ['openai', stubProvider('openai', available.openai ?? true)],
    ['xai', stubProvider('xai', available.xai ?? true)],
    ['gemini', stubProvider('gemini', available.gemini ?? true)]
  ])
}

function stubProvider(
  name: 'runway' | 'higgsfield' | 'openai' | 'xai' | 'gemini',
  isAvail: boolean
): MediaProvider {
  return {
    name,
    isAvailable: () => isAvail,
    async submit(_request, jobId) {
      return { providerJobId: `${name}-stub-${jobId}` }
    },
    async poll(_providerJobId, request) {
      return {
        status: 'succeeded',
        progress: 100,
        result: {
          url: `https://stub.example.com/${name}/${request.slotId ?? 'output'}.mp4`,
          mimeType: 'video/mp4',
          fileName: `${name}-output.mp4`
        }
      }
    },
    async cancel() {
      return undefined
    }
  }
}

export async function buildTestServer(
  options: {
    providers?: Map<string, MediaProvider>
    nodeEnv?: string
    credits?: InMemoryCreditsService
    allowances?: InMemoryAllowanceService
  } = {}
) {
  // Use development node env so verifySupabaseJwt accepts unsigned tokens.
  if (options.nodeEnv) {
    process.env.NODE_ENV = options.nodeEnv
  } else if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development'
  }
  return buildServer({
    store: new InMemoryJobStore(),
    credits: options.credits ?? new InMemoryCreditsService(),
    allowances: options.allowances ?? new InMemoryAllowanceService(),
    providers: options.providers ?? createStubProviders(),
    persistenceMode: 'memory'
  })
}

/** Make a fake unsigned JWT that verifySupabaseJwt's dev-mode fallback accepts. */
export function fakeBearer(sub = 'test-user-id', email = '[email protected]'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub, email })).toString('base64url')
  return `Bearer ${header}.${payload}.sig`
}
