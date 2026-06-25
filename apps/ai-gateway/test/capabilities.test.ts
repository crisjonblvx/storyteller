import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { buildTestServer, createStubProviders, fakeBearer } from './helpers/testServer.js'

let app: FastifyInstance

before(async () => {
  delete process.env.SUPABASE_JWT_SECRET
  process.env.NODE_ENV = 'development'
  const built = await buildTestServer()
  app = built.app
})

after(async () => {
  await app?.close()
})

describe('capability endpoints — auth & validation', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/grounded-review',
      payload: {}
    })
    assert.equal(res.statusCode, 401)
  })

  it('serves both /v1/capabilities/grounded-review and the legacy /v1/review/grounded alias', async () => {
    const payload = {
      candidates: [],
      subjectProfile: { id: 'subject', name: 'Subject' },
      promptPack: {
        id: 'pack',
        label: 'Pack',
        tone: '',
        cameraStyle: '',
        lighting: '',
        motionStyle: '',
        environmentStyle: '',
        detailLevel: ''
      },
      directionText: '',
      mode: 'story'
    }
    const headers = { authorization: fakeBearer() }
    const cap = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/grounded-review',
      headers,
      payload
    })
    const legacy = await app.inject({
      method: 'POST',
      url: '/v1/review/grounded',
      headers,
      payload
    })
    assert.equal(cap.statusCode, legacy.statusCode)
    assert.equal(cap.statusCode, 200)
    assert.deepEqual(cap.json(), {
      ok: false,
      error: 'No grounded candidates were provided.'
    })
    assert.deepEqual(legacy.json(), {
      ok: false,
      error: 'No grounded candidates were provided.'
    })
  })

  it('registers both /v1/capabilities/broll-prompts and /v1/broll/prompts', async () => {
    const payload = { projectId: '', segments: [] }
    const headers = { authorization: fakeBearer() }
    const cap = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/broll-prompts',
      headers,
      payload
    })
    const legacy = await app.inject({
      method: 'POST',
      url: '/v1/broll/prompts',
      headers,
      payload
    })
    // Both should reach the same handler — both 200 with ok:false (no openai key).
    assert.equal(cap.statusCode, legacy.statusCode)
    const capBody = cap.json() as { ok: boolean; error?: string }
    const legacyBody = legacy.json() as { ok: boolean; error?: string }
    assert.equal(capBody.ok, false)
    assert.equal(legacyBody.ok, false)
  })

  it('registers /v1/capabilities/broll-prompts-from-beats and its legacy alias', async () => {
    const headers = { authorization: fakeBearer() }
    const cap = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/broll-prompts-from-beats',
      headers,
      payload: { projectId: 'p', beats: [] }
    })
    const legacy = await app.inject({
      method: 'POST',
      url: '/v1/broll/prompts-from-beats',
      headers,
      payload: { projectId: 'p', beats: [] }
    })
    assert.equal(cap.statusCode, legacy.statusCode)
  })
})

describe('capability media-generate', () => {
  const headers = { authorization: fakeBearer() }

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      payload: {}
    })
    assert.equal(res.statusCode, 401)
  })

  it('returns 400 when prompt is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'p',
        capability: 'video-clip-from-text',
        creativeMode: 'cinematic_documentary'
      }
    })
    assert.equal(res.statusCode, 400)
    const body = res.json() as { code: string }
    assert.equal(body.code, 'INVALID_REQUEST')
  })

  it('returns 400 when capability is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'p',
        prompt: 'A drone shot of a forest',
        creativeMode: 'cinematic_documentary'
      }
    })
    assert.equal(res.statusCode, 400)
    const body = res.json() as { code: string }
    assert.equal(body.code, 'INVALID_REQUEST')
  })

  it('starts a job and does NOT leak the provider name in the capability response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'proj-1',
        slotId: 'slot-1',
        capability: 'video-clip-from-text',
        creativeMode: 'cinematic_documentary',
        prompt: 'A drone shot of a redwood forest at golden hour.'
      }
    })
    assert.equal(res.statusCode, 200)
    const body = res.json() as Record<string, unknown>
    assert.equal(typeof body.jobId, 'string')
    assert.equal(typeof body.estimatedCredits, 'number')
    assert.equal(body.status, 'running')
    // Capability response MUST NOT include provider name.
    assert.ok(!('provider' in body), `capability response leaked provider: ${JSON.stringify(body)}`)
  })

  it('legacy /v1/media/generate still returns provider for backwards compatibility', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/media/generate',
      headers,
      payload: {
        projectId: 'proj-1',
        slotId: 'slot-1',
        intent: 'broll_text_to_video',
        creativeMode: 'cinematic_documentary',
        prompt: 'A drone shot of a redwood forest.'
      }
    })
    assert.equal(res.statusCode, 200)
    const body = res.json() as Record<string, unknown>
    assert.equal(typeof body.provider, 'string')
  })
})

describe('capability media-jobs status', () => {
  const headers = { authorization: fakeBearer() }

  it('returns 404 for unknown jobs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/capabilities/media-jobs/does-not-exist',
      headers
    })
    assert.equal(res.statusCode, 404)
  })

  it('sanitizes provider name from the capability job status payload', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'proj-2',
        slotId: 'slot-2',
        capability: 'video-clip-from-text',
        creativeMode: 'cinematic_documentary',
        prompt: 'Sweeping aerial of an ocean cliff at sunrise.'
      }
    })
    assert.equal(created.statusCode, 200)
    const { jobId } = created.json() as { jobId: string }

    const status = await app.inject({
      method: 'GET',
      url: `/v1/capabilities/media-jobs/${jobId}`,
      headers
    })
    assert.equal(status.statusCode, 200)
    const body = status.json() as Record<string, unknown>
    assert.equal(body.jobId, jobId)
    assert.ok(!('provider' in body), `capability status leaked provider: ${JSON.stringify(body)}`)
  })
})

describe('capability media-generate with provider unavailable', () => {
  let app2: FastifyInstance
  const headers = { authorization: fakeBearer() }

  before(async () => {
    const built = await buildTestServer({
      providers: createStubProviders({
        available: { runway: false, higgsfield: false, openai: false, xai: false, gemini: false }
      })
    })
    app2 = built.app
  })

  after(async () => {
    await app2?.close()
  })

  it('returns 503 when the selected provider is unavailable on the gateway', async () => {
    const res = await app2.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'p',
        capability: 'video-clip-from-text',
        creativeMode: 'cinematic_documentary',
        prompt: 'A wide angle of a city skyline.'
      }
    })
    assert.equal(res.statusCode, 503)
    const body = res.json() as { code: string }
    assert.equal(body.code, 'PROVIDER_UNAVAILABLE')
  })
})
