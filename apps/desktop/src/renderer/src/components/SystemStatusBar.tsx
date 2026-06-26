import { useEffect, useRef, useState } from 'react'
import { supabase } from '@renderer/lib/supabase'
import type { AppStatus } from '@renderer/vite-env'

type Bridge = { getAppStatus?: () => Promise<AppStatus> }

function getBridge(): Bridge {
  return (typeof window !== 'undefined' && window.storyteller) || {}
}

/** Build-time renderer flags — reliable without IPC. */
const VITE_GATEWAY_URL: string = import.meta.env.VITE_STORYTELLER_GATEWAY_URL ?? ''
const VITE_REVIEW_READY: boolean = import.meta.env.VITE_AI_REVIEW_READY === 'true'
const VITE_MEDIA_READY: boolean = import.meta.env.VITE_AI_MEDIA_READY === 'true'

/**
 * Honest "what's wired" indicator. Shows Supabase plus Storyteller AI
 * capability wiring so the user knows ahead of time which
 * actions will succeed and which will be locked / no-op.
 *
 * Compact by default; click to expand for detail.
 */
export function SystemStatusBar(props: { compact?: boolean; align?: 'start' | 'end' }) {
  const compact = props.compact ?? true
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [open, setOpen] = useState(!compact)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    const bridge = getBridge()

    const tryLoad = () => {
      if (!bridge.getAppStatus) return
      void bridge
        .getAppStatus()
        .then((s) => {
          if (!cancelled) setStatus(s)
        })
        .catch(() => {
          // Retry once after 1.5 s in case the main process wasn't ready yet.
          if (!cancelled) {
            retryRef.current = setTimeout(() => {
              if (!cancelled && bridge.getAppStatus) {
                void bridge
                  .getAppStatus()
                  .then((s) => { if (!cancelled) setStatus(s) })
                  .catch(() => { /* ignore */ })
              }
            }, 1500)
          }
        })
    }

    tryLoad()
    return () => {
      cancelled = true
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [])

  const supabaseConfigured = Boolean(supabase)
  const proxyMode = status?.ai.mode === 'proxy'
  const gatewayConfigured = Boolean(
    status?.ai.mediaGatewayEnabled ?? status?.ai.gatewayUrl ?? VITE_GATEWAY_URL
  )
  const reviewReady =
    status?.ai.reviewReady ??
    (proxyMode || gatewayConfigured || Boolean(status?.ai.openaiConfigured) || VITE_REVIEW_READY)
  const gatewayReachable = status?.ai.gatewayReachable
  const mediaReady =
    status?.ai.mediaReady ??
    (gatewayConfigured ? gatewayReachable === true : proxyMode || VITE_MEDIA_READY)

  const items: Array<{ label: string; ok: boolean; hint: string }> = [
    {
      label: 'Supabase',
      ok: supabaseConfigured,
      hint: supabaseConfigured
        ? 'Cloud sync available — sign in to back up projects.'
        : 'Local-only mode. Add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to enable cloud sync.'
    },
    {
      label: 'AI review',
      ok: reviewReady,
      hint: reviewReady
        ? 'Transcription and editorial review are ready.'
        : 'Sign in to Storyteller to enable AI review and transcription.'
    },
    {
      label: 'AI media',
      ok: mediaReady,
      hint: mediaReady
        ? 'B-roll and motion generation are ready.'
        : gatewayConfigured && gatewayReachable === false
          ? 'Storyteller AI gateway is configured but not responding — preview generation may fail.'
          : 'Sign in to Storyteller to enable AI media generation.'
    },
    ...(gatewayConfigured
      ? [
          {
            label: 'AI gateway',
            ok: gatewayReachable === true,
            hint:
              gatewayReachable === true
                ? 'Hosted AI gateway is online.'
                : gatewayReachable === false
                  ? 'Gateway URL is set but /health did not respond — check deployment or network.'
                  : 'Checking gateway connectivity…'
          }
        ]
      : [])
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: props.align === 'end' ? 'flex-end' : 'flex-start',
        gap: 6,
        fontSize: 12
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
          padding: '4px 10px',
          borderRadius: 999,
          cursor: 'pointer'
        }}
        title="Click for detail"
      >
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>System</span>
        {items.map((it) => (
          <span key={it.label} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: it.ok ? 'var(--accent)' : 'rgba(255,120,120,0.85)',
                boxShadow: it.ok ? '0 0 6px rgba(110,231,197,0.6)' : 'none'
              }}
            />
            {it.label}
          </span>
        ))}
      </button>
      {open && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            maxWidth: 360,
            color: 'var(--muted)',
            lineHeight: 1.5
          }}
        >
          {items.map((it) => (
            <div key={it.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <span
                aria-hidden
                style={{
                  marginTop: 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: it.ok ? 'var(--accent)' : 'rgba(255,120,120,0.85)'
                }}
              />
              <div>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {it.label} · {it.ok ? 'ready' : 'not configured'}
                </div>
                <div style={{ fontSize: 12 }}>{it.hint}</div>
              </div>
            </div>
          ))}
          {status && (
            <div style={{ marginTop: 8, fontSize: 11 }}>
              Storyteller {status.app.buildLabel} · Electron {status.app.electron} · Node{' '}
              {status.app.node} · {status.app.platform}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
