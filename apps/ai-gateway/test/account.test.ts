import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { InMemoryCreditsService } from '../src/credits/creditsService.js'
import { buildTestServer, fakeBearer } from './helpers/testServer.js'

describe('account endpoints', () => {
  let app: FastifyInstance
  const headers = { authorization: fakeBearer('account-user') }

  before(async () => {
    delete process.env.SUPABASE_JWT_SECRET
    process.env.NODE_ENV = 'development'
    const built = await buildTestServer({
      credits: new InMemoryCreditsService(100)
    })
    app = built.app
  })

  after(async () => {
    await app?.close()
  })

  it('rejects unauthenticated account requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/capabilities/account' })
    assert.equal(res.statusCode, 401)
  })

  it('returns account summary without provider fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/capabilities/account',
      headers
    })
    assert.equal(res.statusCode, 200)
    const body = res.json() as Record<string, unknown>
    assert.equal(body.planId, 'starter')
    assert.equal(typeof body.available, 'number')
    assert.equal(typeof body.balance, 'number')
    assert.equal(body.mediaEnabled, true)
    assert.ok(Array.isArray(body.capabilities))
    assert.ok(!('provider' in body))
  })

  it('surfaces owner plan details for allowlisted founder accounts', async () => {
    process.env.STORYTELLER_OWNER_EMAILS = '[email protected]'
    const built = await buildTestServer({
      credits: new InMemoryCreditsService(100)
    })
    const ownerApp = built.app
    try {
      const res = await ownerApp.inject({
        method: 'GET',
        url: '/v1/capabilities/account',
        headers: { authorization: fakeBearer('owner-account-user', '[email protected]') }
      })
      assert.equal(res.statusCode, 200)
      const body = res.json() as Record<string, unknown>
      assert.equal(body.planId, 'owner')
      assert.equal(body.planLabel, 'Owner')
    } finally {
      delete process.env.STORYTELLER_OWNER_EMAILS
      await ownerApp.close()
    }
  })

  it('returns usage history without provider names', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/capabilities/media-generate',
      headers,
      payload: {
        projectId: 'proj-usage',
        capability: 'video-clip-from-text',
        creativeMode: 'cinematic_documentary',
        prompt: 'A wide shot of a mountain lake at dawn.'
      }
    })
    assert.equal(created.statusCode, 200)

    const usage = await app.inject({
      method: 'GET',
      url: '/v1/capabilities/account/usage?limit=5',
      headers
    })
    assert.equal(usage.statusCode, 200)
    const body = usage.json() as { items: Array<Record<string, unknown>>; total: number }
    assert.ok(body.total >= 1)
    assert.ok(body.items.length >= 1)
    const first = body.items[0]
    assert.equal(typeof first.jobId, 'string')
    assert.equal(first.capability, 'video-clip-from-text')
    assert.ok(!('provider' in first))
  })

  it('returns 402 when credits are insufficient', async () => {
    const built = await buildTestServer({
      credits: new InMemoryCreditsService(1)
    })
    const poorApp = built.app
    try {
      const res = await poorApp.inject({
        method: 'POST',
        url: '/v1/capabilities/media-generate',
        headers: { authorization: fakeBearer('poor-user') },
        payload: {
          projectId: 'p',
          capability: 'video-clip-from-text',
          creativeMode: 'cinematic_documentary',
          prompt: 'Ocean waves at sunset.'
        }
      })
      assert.equal(res.statusCode, 402)
      const body = res.json() as { code: string }
      assert.equal(body.code, 'INSUFFICIENT_CREDITS')
    } finally {
      await poorApp.close()
    }
  })
})
