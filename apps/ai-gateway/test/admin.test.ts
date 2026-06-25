import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { buildTestServer } from './helpers/testServer.js'

describe('admin endpoints', () => {
  let app: FastifyInstance
  const adminPassword = 'test-admin-secret'

  before(async () => {
    process.env.STORYTELLER_ADMIN_PASSWORD = adminPassword
    process.env.NODE_ENV = 'development'
    delete process.env.SUPABASE_JWT_SECRET
    const built = await buildTestServer()
    app = built.app
  })

  after(async () => {
    delete process.env.STORYTELLER_ADMIN_PASSWORD
    await app?.close()
  })

  it('rejects login with wrong password (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/login',
      payload: { password: 'wrong-password' }
    })
    assert.equal(res.statusCode, 401)
    const body = res.json() as { code: string }
    assert.equal(body.code, 'UNAUTHORIZED')
  })

  it('returns admin token on valid login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/login',
      payload: { password: adminPassword }
    })
    assert.equal(res.statusCode, 200)
    const body = res.json() as { token: string; expiresIn: string }
    assert.equal(typeof body.token, 'string')
    assert.ok(body.token.length > 20)
    assert.equal(body.expiresIn, '12h')
  })

  it('rejects protected routes without token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' })
    assert.equal(res.statusCode, 401)
  })

  it('allows protected routes with valid admin token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/admin/login',
      payload: { password: adminPassword }
    })
    const { token } = login.json() as { token: string }

    const overview = await app.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(overview.statusCode, 200)
    const body = overview.json() as { userCount: number; jobsMtd: number }
    assert.equal(typeof body.userCount, 'number')
    assert.equal(typeof body.jobsMtd, 'number')

    const users = await app.inject({
      method: 'GET',
      url: '/v1/admin/users',
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(users.statusCode, 200)

    const activity = await app.inject({
      method: 'GET',
      url: '/v1/admin/activity',
      headers: { authorization: `Bearer ${token}` }
    })
    assert.equal(activity.statusCode, 200)
  })
})
