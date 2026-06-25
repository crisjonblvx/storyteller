import type { FastifyInstance } from 'fastify'
import type { GatewayEnv } from '../env.js'
import {
  isAdminAuthConfigured,
  signAdminToken,
  verifyAdminPassword,
  verifyAdminToken
} from '../auth/adminAuth.js'
import { AdminService } from '../admin/adminService.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import type { JobStorePort } from '../jobs/jobStorePort.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AdminRouteDeps {
  env: GatewayEnv
  store: JobStorePort
  sb: SupabaseClient | null
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const admin = new AdminService(deps.sb, deps.store)

  app.post<{ Body: { password?: string } }>(
    '/v1/admin/login',
    async (req, reply) => {
      try {
        if (!isAdminAuthConfigured(deps.env)) {
          throw new GatewayError('Admin auth is not configured.', 'ADMIN_NOT_CONFIGURED', 503)
        }
        const password = req.body?.password ?? ''
        if (!verifyAdminPassword(deps.env, password)) {
          throw new GatewayError('Invalid admin password.', 'UNAUTHORIZED', 401)
        }
        const token = await signAdminToken(deps.env)
        return reply.send({ token, expiresIn: '12h' })
      } catch (e) {
        return sendError(reply, e)
      }
    }
  )

  app.get('/v1/admin/overview', async (req, reply) => {
    try {
      await verifyAdminToken(req.headers.authorization, deps.env)
      const overview = await admin.getOverview()
      return reply.send(overview)
    } catch (e) {
      return sendError(reply, e)
    }
  })

  app.get('/v1/admin/users', async (req, reply) => {
    try {
      await verifyAdminToken(req.headers.authorization, deps.env)
      const users = await admin.listUsers()
      return reply.send({ users })
    } catch (e) {
      return sendError(reply, e)
    }
  })

  app.get<{ Params: { userId: string } }>('/v1/admin/users/:userId', async (req, reply) => {
    try {
      await verifyAdminToken(req.headers.authorization, deps.env)
      const user = await admin.getUserDetail(req.params.userId)
      if (!user) {
        throw new GatewayError('User not found.', 'NOT_FOUND', 404)
      }
      return reply.send(user)
    } catch (e) {
      return sendError(reply, e)
    }
  })

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/v1/admin/activity',
    async (req, reply) => {
      try {
        await verifyAdminToken(req.headers.authorization, deps.env)
        const limit = req.query.limit ? Number(req.query.limit) : 30
        const offset = req.query.offset ? Number(req.query.offset) : 0
        const activity = await admin.getActivity({ limit, offset })
        return reply.send(activity)
      } catch (e) {
        return sendError(reply, e)
      }
    }
  )
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
