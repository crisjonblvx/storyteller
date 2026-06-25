import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STORYTELLER_PLANS, type StorytellerPlanId } from '@storyteller/ai-gateway'
import type { GatewayEnv } from '../env.js'
import { verifySupabaseJwt } from '../auth/verifySupabaseJwt.js'
import { GatewayError, normalizeError } from '../utils/errors.js'
import { log } from '../utils/logger.js'

export interface BillingRouteDeps {
  env: GatewayEnv
  sb: SupabaseClient | null
}

const PLAN_IDS = Object.keys(STORYTELLER_PLANS) as StorytellerPlanId[]

export function registerBillingRoutes(app: FastifyInstance, deps: BillingRouteDeps): void {
  const { env, sb } = deps

  // ── POST /v1/billing/checkout ───────────────────────────────────────────────
  // Creates a Stripe Checkout Session for the requested plan and returns the URL.
  // The desktop app opens it in the system browser via shell.openExternal().
  app.post('/v1/billing/checkout', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!env.stripeSecretKey) {
        return reply
          .status(503)
          .send({ error: 'Billing not configured on this gateway.', code: 'BILLING_UNAVAILABLE' })
      }

      const user = await verifySupabaseJwt(req.headers.authorization, env)
      const body = req.body as { planId?: string }
      const planId = body?.planId as StorytellerPlanId | undefined

      if (!planId || !PLAN_IDS.includes(planId)) {
        throw new GatewayError(
          `planId must be one of: ${PLAN_IDS.join(', ')}.`,
          'INVALID_REQUEST',
          400
        )
      }

      const priceId = env.stripePrices[planId]
      if (!priceId) {
        throw new GatewayError(
          `No Stripe price configured for plan "${planId}". Set STRIPE_PRICE_${planId.toUpperCase()} in gateway env.`,
          'BILLING_NOT_CONFIGURED',
          503
        )
      }

      const stripe = new Stripe(env.stripeSecretKey)

      // Reuse an existing Stripe customer if we already stored one.
      let customerId: string | undefined
      if (sb) {
        const { data } = await sb
          .from('gateway_user_credits')
          .select('stripe_customer_id')
          .eq('user_id', user.id)
          .maybeSingle()
        customerId = data?.stripe_customer_id ?? undefined
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        ...(customerId
          ? { customer: customerId }
          : user.email
            ? { customer_email: user.email }
            : {}),
        metadata: { supabase_user_id: user.id },
        subscription_data: { metadata: { supabase_user_id: user.id, plan_id: planId } },
        success_url: env.stripeBillingSuccessUrl,
        cancel_url: env.stripeBillingCancelUrl,
      })

      log.info('billing_checkout_created', { userId: user.id, planId, sessionId: session.id })
      return reply.send({ url: session.url, sessionId: session.id })
    } catch (e) {
      return sendError(reply, e)
    }
  })

  // ── POST /v1/webhooks/stripe ────────────────────────────────────────────────
  // Receives Stripe events and updates the user's plan in Supabase.
  // Requires the raw request body for signature verification — server.ts
  // configures a content type parser that stores req.rawBody.
  app.post('/v1/webhooks/stripe', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!env.stripeSecretKey || !env.stripeWebhookSecret) {
      return reply.status(503).send({ error: 'Billing not configured.' })
    }

    const sig = req.headers['stripe-signature'] as string | undefined
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody

    if (!sig || !rawBody) {
      return reply.status(400).send({ error: 'Missing Stripe signature or raw body.' })
    }

    const stripe = new Stripe(env.stripeSecretKey)
    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, env.stripeWebhookSecret)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.info('stripe_webhook_invalid_signature', { error: msg })
      return reply.status(400).send({ error: `Webhook signature verification failed: ${msg}` })
    }

    try {
      await handleStripeEvent(event, env, sb)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.info('stripe_webhook_handler_error', { type: event.type, error: msg })
      // Return 200 so Stripe doesn't retry for handler-level errors.
      return reply.send({ ok: false, error: msg })
    }

    return reply.send({ ok: true })
  })
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleStripeEvent(
  event: Stripe.Event,
  env: GatewayEnv,
  sb: SupabaseClient | null
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode !== 'subscription') break
      const userId = session.metadata?.supabase_user_id
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id
      const planId = session.subscription_data?.metadata?.plan_id as StorytellerPlanId | undefined
      if (userId && planId && PLAN_IDS.includes(planId)) {
        await upsertUserPlan(sb, userId, planId, customerId)
        log.info('billing_plan_activated', { userId, planId, customerId })
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.supabase_user_id
      const planId = derivePlanFromSubscription(sub, env)
      if (userId && planId) {
        await upsertUserPlan(sb, userId, planId, typeof sub.customer === 'string' ? sub.customer : undefined)
        log.info('billing_plan_updated', { userId, planId, status: sub.status })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = sub.metadata?.supabase_user_id
      if (userId) {
        await upsertUserPlan(sb, userId, 'starter', undefined)
        log.info('billing_plan_cancelled', { userId })
      }
      break
    }

    default:
      log.info('stripe_webhook_ignored', { type: event.type })
  }
}

/** Map the first Stripe Price on a subscription back to a Storyteller plan ID. */
function derivePlanFromSubscription(
  sub: Stripe.Subscription,
  env: GatewayEnv
): StorytellerPlanId | null {
  const priceId = sub.items.data[0]?.price?.id
  if (!priceId) return null
  const entry = Object.entries(env.stripePrices).find(([, pid]) => pid === priceId)
  if (!entry) return null
  return entry[0] as StorytellerPlanId
}

async function upsertUserPlan(
  sb: SupabaseClient | null,
  userId: string,
  planId: StorytellerPlanId,
  customerId?: string
): Promise<void> {
  if (!sb) return
  const patch: Record<string, unknown> = {
    plan_id: planId,
    updated_at: new Date().toISOString()
  }
  if (customerId) patch.stripe_customer_id = customerId

  const { error } = await sb
    .from('gateway_user_credits')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })

  if (error) throw new Error(`Failed to update plan for user ${userId}: ${error.message}`)
}

// ── Error helper ──────────────────────────────────────────────────────────────

function sendError(reply: FastifyReply, e: unknown) {
  const err = normalizeError(e)
  const status = e instanceof GatewayError ? e.statusCode : 500
  return reply.status(status).send({ error: err.message, code: err.code, message: err.message })
}
