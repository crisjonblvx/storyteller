import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { OverlayStatPayload } from '@storyteller/timeline'

/**
 * ChartRenderer — three first-cut chart kinds the user can drop in from
 * the `Add Stat / Chart` panel:
 *
 *   - counter : number that animates from 0 → value over `enterMs`,
 *               with optional prefix ("$") and suffix ("M", "%").
 *   - bar     : single horizontal progress bar that animates 0 → value/target.
 *   - donut   : single ring that animates 0 → value (interpreted 0-100%).
 *
 * Animation is driven by a per-mount key + `requestAnimationFrame`. We
 * deliberately don't sync the animation to the underlying video's playhead
 * — the user wants the chart to "swoosh in" when it appears, not lockstep
 * with the video time. If we ever need a "scrub-tied" mode (rare; mostly
 * for explainer videos) we can add a `progress?: number` prop and skip the
 * RAF loop.
 *
 * Why not a chart library?
 *   chartjs / recharts add ~50KB and a layout system we don't need for one
 *   ring + one bar + one number. Hand-rolled SVG is simpler, ships today,
 *   and matches the burned-in version we'll render in the MP4 exporter.
 */

export interface ChartRendererProps {
  payload: OverlayStatPayload
  /** Used by the parent to remount on overlay change so the entrance animation re-fires. */
  resetKey?: string | number
  /** Entrance animation length in ms. Defaults to 900ms — feels expensive without dragging. */
  enterMs?: number
  /** Theme color for the active fill / accent. Defaults to Storyteller mint. */
  accent?: string
  /** Background color for the chart card. Defaults to translucent black. */
  background?: string
}

export function ChartRenderer(props: ChartRendererProps) {
  const {
    payload,
    resetKey,
    enterMs = 900,
    accent = '#6ee7c5',
    background = 'rgba(20, 20, 22, 0.85)'
  } = props

  const progress = useEntranceProgress(enterMs, resetKey)

  switch (payload.chart) {
    case 'counter':
      return <CounterChart payload={payload} progress={progress} accent={accent} background={background} />
    case 'bar':
      return <BarChart payload={payload} progress={progress} accent={accent} background={background} />
    case 'donut':
    default:
      return <DonutChart payload={payload} progress={progress} accent={accent} background={background} />
  }
}

/**
 * RAF-driven 0 → 1 progress with an ease-out curve. Restart on `resetKey` so
 * editing the same overlay or scrubbing back to it replays the animation.
 */
function useEntranceProgress(durationMs: number, resetKey: string | number | undefined): number {
  const [t, setT] = useState(0)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    startRef.current = null
    setT(0)
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const elapsed = now - startRef.current
      const linear = Math.min(1, Math.max(0, elapsed / durationMs))
      const eased = 1 - Math.pow(1 - linear, 3)
      setT(eased)
      if (linear < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [durationMs, resetKey])

  return t
}

const cardBaseStyle = (background: string): CSSProperties => ({
  background,
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 14,
  padding: '16px 20px',
  color: '#f4f4f5',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 16px 36px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 180,
  maxWidth: '70%'
})

function CounterChart(props: {
  payload: OverlayStatPayload
  progress: number
  accent: string
  background: string
}) {
  const { payload, progress, accent, background } = props
  const animated = useMemo(() => payload.value * progress, [payload.value, progress])
  const formatted = useMemo(() => formatNumber(animated, payload.value), [animated, payload.value])
  return (
    <div style={cardBaseStyle(background)}>
      <div style={{ fontSize: 'clamp(28px, 6vw, 56px)', fontWeight: 800, lineHeight: 1, color: accent, fontVariantNumeric: 'tabular-nums' }}>
        {payload.prefix ?? ''}{formatted}{payload.suffix ?? ''}
      </div>
      {payload.label && (
        <div style={{ fontSize: 13, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          {payload.label}
        </div>
      )}
    </div>
  )
}

function BarChart(props: {
  payload: OverlayStatPayload
  progress: number
  accent: string
  background: string
}) {
  const { payload, progress, accent, background } = props
  const target = payload.target && payload.target > 0 ? payload.target : Math.max(payload.value, 1)
  const fillRatio = Math.max(0, Math.min(1, payload.value / target)) * progress
  const animatedValue = payload.value * progress
  return (
    <div style={cardBaseStyle(background)}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 'clamp(20px, 4vw, 36px)', fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums' }}>
          {payload.prefix ?? ''}{formatNumber(animatedValue, payload.value)}{payload.suffix ?? ''}
        </div>
        {payload.target != null && (
          <div style={{ fontSize: 12, color: '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}>
            of {payload.prefix ?? ''}{formatNumber(payload.target, payload.target)}{payload.suffix ?? ''}
          </div>
        )}
      </div>
      <div
        style={{
          width: '100%',
          height: 10,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.12)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${fillRatio * 100}%`,
            height: '100%',
            background: accent,
            borderRadius: 999,
            transition: 'background 200ms ease'
          }}
        />
      </div>
      {payload.label && (
        <div style={{ fontSize: 12, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          {payload.label}
        </div>
      )}
    </div>
  )
}

function DonutChart(props: {
  payload: OverlayStatPayload
  progress: number
  accent: string
  background: string
}) {
  const { payload, progress, accent, background } = props
  /** Interpret value as a 0-100 percentage; clamp the visual ring to that. */
  const pct = Math.max(0, Math.min(100, payload.value)) * progress
  const radius = 36
  const stroke = 8
  const circumference = 2 * Math.PI * radius
  const dash = (pct / 100) * circumference
  return (
    <div style={cardBaseStyle(background)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <svg width={radius * 2 + stroke * 2} height={radius * 2 + stroke * 2} viewBox={`0 0 ${radius * 2 + stroke * 2} ${radius * 2 + stroke * 2}`} aria-hidden="true">
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            stroke="rgba(255,255,255,0.14)"
            strokeWidth={stroke}
            fill="none"
          />
          <circle
            cx={radius + stroke}
            cy={radius + stroke}
            r={radius}
            stroke={accent}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${radius + stroke} ${radius + stroke})`}
          />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 'clamp(20px, 4vw, 32px)', fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums' }}>
            {payload.prefix ?? ''}{Math.round(pct)}{payload.suffix ?? '%'}
          </div>
          {payload.label && (
            <div style={{ fontSize: 12, color: '#d4d4d8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              {payload.label}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Animated numbers shouldn't show 7 decimal places mid-tween. We follow the
 * final number's scale: integers stay integers, decimals round to the same
 * precision as the target, and very large numbers (≥1000) drop the decimal.
 */
function formatNumber(animated: number, target: number): string {
  if (Math.abs(target) >= 1000) {
    return Math.round(animated).toLocaleString()
  }
  if (Number.isInteger(target)) {
    return Math.round(animated).toString()
  }
  /** Match the source precision (1 or 2 decimals). */
  const targetStr = target.toString()
  const decimals = targetStr.includes('.') ? Math.min(2, targetStr.split('.')[1]!.length) : 1
  return animated.toFixed(decimals)
}
