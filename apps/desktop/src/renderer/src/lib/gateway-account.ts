import type { StorytellerAccountSummaryWire, StorytellerUsageHistory } from '@storyteller/ai-gateway'
import { getGatewayAccessToken } from '@renderer/lib/gateway-auth'
import { useCallback, useEffect, useState } from 'react'

export type GatewayAccountState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; account: StorytellerAccountSummaryWire }
  | { status: 'error'; error: string }
  | { status: 'unavailable' }

export type GatewayUsageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; usage: StorytellerUsageHistory }
  | { status: 'error'; error: string }

export async function loadGatewayAccount(): Promise<GatewayAccountState> {
  const bridge = window.storyteller?.getGatewayAccount
  if (!bridge) return { status: 'unavailable' }
  const accessToken = await getGatewayAccessToken()
  if (!accessToken) {
    return { status: 'error', error: 'Sign in to view your Storyteller AI account.' }
  }
  const res = await bridge({ accessToken })
  if (!res.ok) return { status: 'error', error: res.error }
  return { status: 'ready', account: res.account }
}

export async function loadGatewayUsage(limit = 15): Promise<GatewayUsageState> {
  const bridge = window.storyteller?.getGatewayUsage
  if (!bridge) return { status: 'idle' }
  const accessToken = await getGatewayAccessToken()
  if (!accessToken) {
    return { status: 'error', error: 'Sign in to view usage history.' }
  }
  const res = await bridge({ accessToken, limit })
  if (!res.ok) return { status: 'error', error: res.error }
  return { status: 'ready', usage: res.usage }
}

export function capabilityLabel(capability: string): string {
  switch (capability) {
    case 'video-clip-from-text':
      return 'Video clip'
    case 'video-clip-from-image':
      return 'Image-to-video'
    case 'motion-graphic':
      return 'Motion graphic'
    case 'concept-frame':
      return 'Concept frame'
    case 'storyboard-frame':
      return 'Storyboard frame'
    case 'refine-prompt':
      return 'Prompt refine'
    default:
      return capability.replace(/-/g, ' ')
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'Completed'
    case 'running':
      return 'Running'
    case 'queued':
      return 'Queued'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status
  }
}

/** Poll account credits when hosted AI is enabled. */
export function useGatewayCredits(enabled: boolean): {
  available: number | null
  outOfCredits: boolean
  refresh: () => Promise<void>
} {
  const [available, setAvailable] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setAvailable(null)
      return
    }
    const state = await loadGatewayAccount()
    if (state.status === 'ready') setAvailable(state.account.available)
    else setAvailable(null)
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    available,
    outOfCredits: enabled && available === 0,
    refresh
  }
}
