import {
  StorytellerGatewayClient,
  resolveGatewayUrl,
  userMessageForGatewayError,
  type StorytellerAccountSummaryWire,
  type StorytellerUsageHistory
} from '@storyteller/ai-gateway'

export type GatewayAccountResult =
  | { ok: true; account: StorytellerAccountSummaryWire }
  | { ok: false; error: string }

export type GatewayUsageResult =
  | { ok: true; usage: StorytellerUsageHistory }
  | { ok: false; error: string }

function client(accessToken: string | null | undefined): StorytellerGatewayClient | null {
  const baseUrl = resolveGatewayUrl(process.env)
  if (!baseUrl) return null
  return new StorytellerGatewayClient({
    baseUrl,
    accessToken: accessToken ?? null,
    proxyToken: process.env.STORYTELLER_PROXY_TOKEN ?? null
  })
}

export async function fetchGatewayAccount(
  accessToken: string | null | undefined
): Promise<GatewayAccountResult> {
  const gw = client(accessToken)
  if (!gw) {
    return { ok: false, error: 'Storyteller AI is not configured on this build.' }
  }
  if (!accessToken?.trim()) {
    return { ok: false, error: 'Sign in to view your Storyteller AI account.' }
  }
  try {
    const account = await gw.getAccount()
    return { ok: true, account }
  } catch (e) {
    return { ok: false, error: userMessageForGatewayError(e instanceof Error ? e : new Error(String(e))) }
  }
}

export async function fetchGatewayUsage(
  accessToken: string | null | undefined,
  opts?: { limit?: number; offset?: number }
): Promise<GatewayUsageResult> {
  const gw = client(accessToken)
  if (!gw) {
    return { ok: false, error: 'Storyteller AI is not configured on this build.' }
  }
  if (!accessToken?.trim()) {
    return { ok: false, error: 'Sign in to view usage history.' }
  }
  try {
    const usage = await gw.getUsage(opts)
    return { ok: true, usage }
  } catch (e) {
    return { ok: false, error: userMessageForGatewayError(e instanceof Error ? e : new Error(String(e))) }
  }
}
