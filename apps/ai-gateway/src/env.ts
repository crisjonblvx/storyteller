export interface GatewayEnv {
  port: number
  nodeEnv: string
  supabaseUrl: string | null
  supabaseAnonKey: string | null
  supabaseServiceRoleKey: string | null
  supabaseJwtSecret: string | null
  runwayApiKey: string | null
  higgsfieldApiKey: string | null
  higgsfieldApiSecret: string | null
  openaiApiKey: string | null
  xaiApiKey: string | null
  xaiVideoModel: string
  geminiApiKey: string | null
  geminiVideoModel: string
  ideogramApiKey: string | null
  enableByok: boolean
  enableKling: boolean
  // Stripe billing
  stripeSecretKey: string | null
  stripeWebhookSecret: string | null
  /** Stripe Price IDs — set these after creating products in the Stripe dashboard. */
  stripePrices: Record<string, string>
  /** Billing portal / deep-link redirect URLs */
  stripeBillingSuccessUrl: string
  stripeBillingCancelUrl: string
  /** Server-only admin dashboard password / signing secret. Never expose via VITE_*. */
  storytellerAdminSecret: string | null
  /** Internal accounts that should resolve to the owner plan automatically. */
  storytellerOwnerEmails: string[]
  storytellerOwnerUserIds: string[]
}

export function loadEnv(): GatewayEnv {
  return {
    port: Number(process.env.PORT ?? 8787),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    supabaseUrl: trimOrNull(process.env.SUPABASE_URL),
    supabaseAnonKey: trimOrNull(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: trimOrNull(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseJwtSecret: trimOrNull(process.env.SUPABASE_JWT_SECRET),
    runwayApiKey: trimOrNull(process.env.RUNWAY_API_KEY) ?? trimOrNull(process.env.RUNWAYML_API_SECRET),
    higgsfieldApiKey: trimOrNull(process.env.HIGGSFIELD_API_KEY),
    higgsfieldApiSecret: trimOrNull(process.env.HIGGSFIELD_API_SECRET),
    openaiApiKey: trimOrNull(process.env.OPENAI_API_KEY),
    xaiApiKey: trimOrNull(process.env.GROK_API_KEY) ?? trimOrNull(process.env.XAI_API_KEY),
    xaiVideoModel: trimOrNull(process.env.GROK_API_MODEL) ?? 'grok-imagine-video-1.5',
    geminiApiKey: trimOrNull(process.env.GEMINI_API_KEY),
    geminiVideoModel: trimOrNull(process.env.GEMINI_VIDEO_MODEL) ?? 'veo-3.1-generate-preview',
    ideogramApiKey: trimOrNull(process.env.IDEOGRAM_API_KEY),
    enableByok: parseBool(process.env.ENABLE_BYOK, false),
    enableKling: parseBool(process.env.ENABLE_KLING, false),
    stripeSecretKey: trimOrNull(process.env.STRIPE_SECRET_KEY),
    stripeWebhookSecret: trimOrNull(process.env.STRIPE_WEBHOOK_SECRET),
    stripePrices: {
      student:      trimOrNull(process.env.STRIPE_PRICE_STUDENT)      ?? '',
      starter:      trimOrNull(process.env.STRIPE_PRICE_STARTER)      ?? '',
      intro_pro:    trimOrNull(process.env.STRIPE_PRICE_INTRO_PRO)    ?? '',
      reel_creator: trimOrNull(process.env.STRIPE_PRICE_REEL_CREATOR) ?? '',
      studio:       trimOrNull(process.env.STRIPE_PRICE_STUDIO)       ?? '',
    },
    stripeBillingSuccessUrl:
      trimOrNull(process.env.STRIPE_BILLING_SUCCESS_URL) ??
      'storyteller://billing/success?session_id={CHECKOUT_SESSION_ID}',
    stripeBillingCancelUrl:
      trimOrNull(process.env.STRIPE_BILLING_CANCEL_URL) ?? 'storyteller://billing/cancel',
    storytellerAdminSecret:
      trimOrNull(process.env.STORYTELLER_ADMIN_PASSWORD) ??
      trimOrNull(process.env.STORYTELLER_ADMIN_SECRET),
    storytellerOwnerEmails: parseList(process.env.STORYTELLER_OWNER_EMAILS, { lowercase: true }),
    storytellerOwnerUserIds: parseList(process.env.STORYTELLER_OWNER_USER_IDS),
  }
}

function trimOrNull(v: string | undefined): string | null {
  if (!v?.trim()) return null
  return v.trim()
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === '') return defaultValue
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function parseList(
  raw: string | undefined,
  opts?: {
    lowercase?: boolean
  }
): string[] {
  if (!raw?.trim()) return []
  const out = new Set<string>()
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    out.add(opts?.lowercase ? trimmed.toLowerCase() : trimmed)
  }
  return [...out]
}

export { parseBool }
