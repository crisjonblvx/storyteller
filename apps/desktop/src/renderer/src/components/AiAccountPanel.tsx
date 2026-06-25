import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  STORYTELLER_PLANS,
  type StorytellerPlanId
} from '@storyteller/ai-gateway'
import {
  capabilityLabel,
  loadGatewayAccount,
  loadGatewayUsage,
  statusLabel,
  type GatewayAccountState,
  type GatewayUsageState
} from '@renderer/lib/gateway-account'

const PRICING_URL = 'https://storyteller.app/pricing'

type Props = {
  /** When true, show compact inline credits only. */
  compact?: boolean
  /** Called when account data loads (for parent refresh hooks). */
  onAccountLoaded?: (available: number) => void
}

export function AiAccountPanel(props: Props) {
  const compact = props.compact ?? false
  const [open, setOpen] = useState(!compact)
  const [accountState, setAccountState] = useState<GatewayAccountState>({ status: 'idle' })
  const [usageState, setUsageState] = useState<GatewayUsageState>({ status: 'idle' })
  const [showUpgrade, setShowUpgrade] = useState(false)

  const refresh = useCallback(async () => {
    setAccountState({ status: 'loading' })
    const next = await loadGatewayAccount()
    setAccountState(next)
    if (next.status === 'ready') {
      props.onAccountLoaded?.(next.account.available)
    }
  }, [props.onAccountLoaded])

  const refreshUsage = useCallback(async () => {
    setUsageState({ status: 'loading' })
    setUsageState(await loadGatewayUsage())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (open && usageState.status === 'idle') {
      void refreshUsage()
    }
  }, [open, usageState.status, refreshUsage])

  if (accountState.status === 'unavailable') return null

  const account = accountState.status === 'ready' ? accountState.account : null
  const lowCredits = account != null && account.available < 10
  const outOfCredits = account != null && account.available <= 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'transparent',
          border: `1px solid ${outOfCredits ? 'rgba(251,191,36,0.45)' : 'var(--border)'}`,
          color: 'var(--muted)',
          padding: '4px 10px',
          borderRadius: 999,
          cursor: 'pointer'
        }}
        title="Storyteller AI credits and usage"
      >
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>AI credits</span>
        {accountState.status === 'loading' && <span>…</span>}
        {account && (
          <>
            <span style={{ color: outOfCredits ? '#fbbf24' : lowCredits ? '#fcd34d' : 'var(--accent)' }}>
              {account.available.toLocaleString()} available
            </span>
            <span style={{ opacity: 0.7 }}>· {account.planLabel}</span>
          </>
        )}
        {accountState.status === 'error' && (
          <span style={{ color: '#f87171' }}>{accountState.error}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            maxWidth: 400,
            color: 'var(--muted)',
            lineHeight: 1.5
          }}
        >
          {account ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div>
                  <div style={{ color: 'var(--text)', fontWeight: 600 }}>{account.planLabel} plan</div>
                  <div style={{ fontSize: 12 }}>
                    {account.available.toLocaleString()} available · {account.reserved.toLocaleString()} reserved ·{' '}
                    {account.balance.toLocaleString()} balance
                  </div>
                </div>
                <button type="button" style={ghostBtn} onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>

              {outOfCredits && (
                <div style={warnBox}>
                  You&apos;re out of credits. Upgrade your plan to keep generating B-roll and motion graphics.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" style={primaryBtn} onClick={() => setShowUpgrade((v) => !v)}>
                  {showUpgrade ? 'Hide plans' : 'Upgrade plan'}
                </button>
              </div>

              {showUpgrade && (
                <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                  {(Object.keys(STORYTELLER_PLANS) as StorytellerPlanId[]).map((id) => {
                    const plan = STORYTELLER_PLANS[id]
                    const current = plan.id === account.planId
                    return (
                      <div
                        key={id}
                        style={{
                          border: `1px solid ${current ? 'rgba(110,231,197,0.35)' : 'var(--border)'}`,
                          borderRadius: 8,
                          padding: 10,
                          background: current ? 'rgba(110,231,197,0.06)' : 'transparent'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <strong style={{ color: 'var(--text)' }}>{plan.label}</strong>
                          {current && (
                            <span style={{ fontSize: 11, color: 'var(--accent)' }}>Current</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12 }}>{plan.tagline}</div>
                        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--muted)' }}>
                          ${plan.priceUsdMonthly}/mo · {plan.allowances.episodePasses} episode passes ·{' '}
                          {plan.allowances.clipBatches} clip batches · {plan.allowances.aiVideos} AI videos
                        </div>
                        <div style={{ fontSize: 11, marginTop: 2, opacity: 0.75 }}>
                          ~{plan.monthlyCredits.toLocaleString()} internal credits / month
                        </div>
                        {!current && (
                          <a href={PRICING_URL} target="_blank" rel="noreferrer" style={linkStyle}>
                            View pricing →
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Recent usage</div>
              {usageState.status === 'loading' && <div>Loading…</div>}
              {usageState.status === 'error' && (
                <div style={{ color: '#f87171' }}>{usageState.error}</div>
              )}
              {usageState.status === 'ready' && usageState.usage.items.length === 0 && (
                <div>No generation jobs yet.</div>
              )}
              {usageState.status === 'ready' && usageState.usage.items.length > 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {usageState.usage.items.map((item) => (
                    <div
                      key={item.jobId}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 11,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: 'rgba(255,255,255,0.03)'
                      }}
                    >
                      <span>
                        {capabilityLabel(item.capability)} · {statusLabel(item.status)}
                      </span>
                      <span style={{ whiteSpace: 'nowrap' }}>
                        −{item.creditsReserved} · {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : accountState.status === 'loading' ? (
            <div>Loading account…</div>
          ) : accountState.status === 'error' ? (
            <div style={{ color: '#f87171' }}>{accountState.error}</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

const ghostBtn: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--muted)',
  padding: '4px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12
}

const primaryBtn: CSSProperties = {
  background: 'var(--accent)',
  color: '#0f172a',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600
}

const warnBox: CSSProperties = {
  fontSize: 12,
  color: '#fcd34d',
  background: 'rgba(251,191,36,0.08)',
  border: '1px solid rgba(251,191,36,0.25)',
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: 10
}

const linkStyle: CSSProperties = {
  display: 'inline-block',
  marginTop: 6,
  fontSize: 12,
  color: 'var(--accent)'
}
