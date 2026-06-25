/**
 * Enhance panels — the four authoring UIs that live in `5. Enhance`:
 *
 *   - <AddTextOverlayPanel>   : text + optional subtitle + position
 *   - <AddHookOverlayPanel>   : same fields, top-of-frame, louder typography
 *   - <AddStatOverlayPanel>   : chart kind + value + target/prefix/suffix/label
 *   - <AddPausePanel>         : duration + optional editorial note
 *
 * Each panel gets:
 *   1. A "Add at playhead (X.Xs)" pill that captures the current preview time.
 *   2. A small form that calls back into the parent via `onSubmit`.
 *   3. A list of existing items (overlays of that kind, or pause gaps) with
 *      inline edit + delete — so the user never has to leave Enhance to manage
 *      what they've added.
 *
 * The panels are intentionally controlled (parent owns the sequence + persists)
 * so this component stays a pure "authoring UI" with no sequence-mutation
 * knowledge of its own. Anything that touches the timeline goes through the
 * `onAdd / onUpdate / onRemove` callbacks the parent supplies.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  OverlayChartKind,
  OverlayEvent
} from '@storyteller/timeline'
import type { PauseGapListItem } from '@storyteller/timeline'

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#a1a1aa',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
  fontWeight: 600
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: '#141416',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#f4f4f5',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box'
}

const sectionCard: CSSProperties = {
  background: '#1c1c1f',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: 24
}

const formGrid: CSSProperties = {
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'
}

const primaryBtn: CSSProperties = {
  background: '#6ee7c5',
  color: '#0a0a0b',
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer'
}

const ghostBtn: CSSProperties = {
  background: 'transparent',
  color: '#a1a1aa',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer'
}

const dangerGhostBtn: CSSProperties = {
  background: 'transparent',
  color: '#fca5a5',
  border: '1px solid rgba(252,165,165,0.3)',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer'
}

function PlayheadPill({ seconds }: { seconds: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(110,231,197,0.12)',
        color: '#6ee7c5',
        border: '1px solid rgba(110,231,197,0.3)',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: '#6ee7c5' }} />
      Playhead {seconds.toFixed(2)}s
    </span>
  )
}

function formatTimeRange(start: number, end: number): string {
  return `${start.toFixed(2)}s – ${end.toFixed(2)}s · ${(end - start).toFixed(1)}s hold`
}

const POSITIONS: Array<{ value: NonNullable<OverlayEvent['position']>; label: string }> = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom-left', label: 'Bottom L' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom-right', label: 'Bottom R' }
]

function PositionPicker(props: {
  value: NonNullable<OverlayEvent['position']>
  onChange: (v: NonNullable<OverlayEvent['position']>) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {POSITIONS.map((p) => {
        const active = props.value === p.value
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => props.onChange(p.value)}
            style={{
              ...ghostBtn,
              padding: '6px 10px',
              fontSize: 12,
              borderColor: active ? '#6ee7c5' : 'rgba(255,255,255,0.1)',
              color: active ? '#6ee7c5' : '#a1a1aa',
              background: active ? 'rgba(110,231,197,0.08)' : 'transparent'
            }}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function OverlayListRow(props: {
  event: OverlayEvent
  onUpdate: (patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) => void
  onRemove: () => void
  showPosition: boolean
}) {
  const { event, onUpdate, onRemove, showPosition } = props
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(event.content)
  const [draftSubtitle, setDraftSubtitle] = useState(event.subtitle ?? '')
  const [draftDuration, setDraftDuration] = useState(
    (event.timelineOutSeconds - event.timelineInSeconds).toFixed(1)
  )
  const [draftPosition, setDraftPosition] = useState<NonNullable<OverlayEvent['position']>>(
    event.position ?? 'bottom'
  )

  /**
   * Reset the draft state if the underlying event changes from elsewhere
   * (e.g. an undo, or the user removed and re-added). Without this the
   * inline editor would silently show stale content after a sequence update.
   */
  useEffect(() => {
    setDraftContent(event.content)
    setDraftSubtitle(event.subtitle ?? '')
    setDraftDuration((event.timelineOutSeconds - event.timelineInSeconds).toFixed(1))
    setDraftPosition(event.position ?? 'bottom')
  }, [event.id, event.content, event.subtitle, event.timelineInSeconds, event.timelineOutSeconds, event.position])

  return (
    <div
      style={{
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5', marginBottom: 2 }}>
            {event.content || <span style={{ color: '#71717a', fontStyle: 'italic' }}>(no content)</span>}
          </div>
          {event.subtitle && (
            <div style={{ fontSize: 12, color: '#a1a1aa' }}>{event.subtitle}</div>
          )}
          <div style={{ fontSize: 11, color: '#71717a', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {formatTimeRange(event.timelineInSeconds, event.timelineOutSeconds)}
            {event.position ? ` · ${event.position}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={ghostBtn} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button type="button" style={dangerGhostBtn} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={labelStyle}>Content</label>
            <input
              type="text"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Subtitle (optional)</label>
            <input
              type="text"
              value={draftSubtitle}
              onChange={(e) => setDraftSubtitle(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <label style={labelStyle}>Duration (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={draftDuration}
                onChange={(e) => setDraftDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
            {showPosition && (
              <div>
                <label style={labelStyle}>Position</label>
                <PositionPicker value={draftPosition} onChange={setDraftPosition} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={primaryBtn}
              onClick={() => {
                const dur = Math.max(0.5, Number(draftDuration) || 3)
                onUpdate({
                  content: draftContent.trim(),
                  subtitle: draftSubtitle.trim() || undefined,
                  timelineOutSeconds: event.timelineInSeconds + dur,
                  position: showPosition ? draftPosition : event.position
                })
                setEditing(false)
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AddTextOverlayPanel(props: {
  playheadSeconds: number
  events: OverlayEvent[]
  onAdd: (input: { content: string; subtitle?: string; durationSeconds: number; position?: OverlayEvent['position'] }) => Promise<OverlayEvent | null>
  onUpdate: (eventId: string, patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) => Promise<void>
  onRemove: (eventId: string) => Promise<void>
}) {
  const [content, setContent] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [duration, setDuration] = useState('3')
  const [position, setPosition] = useState<NonNullable<OverlayEvent['position']>>('bottom')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const dur = Math.max(0.5, Number(duration) || 3)
      const event = await props.onAdd({
        content: content.trim(),
        subtitle: subtitle.trim() || undefined,
        durationSeconds: dur,
        position
      })
      if (event) {
        setContent('')
        setSubtitle('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      title="Text Overlay"
      icon="Aa"
      iconColor="#6ee7c5"
      description="Lower-third or supporting copy that sits over your A-roll. Renders live in the preview and burns into the MP4."
      playheadSeconds={props.playheadSeconds}
      items={props.events}
      renderForm={() => (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>Text</label>
            <input
              type="text"
              placeholder="What should land on screen?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && content.trim()) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
          </div>
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Subtitle (optional)</label>
              <input
                type="text"
                placeholder="Smaller second line"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Duration (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Position</label>
            <PositionPicker value={position} onChange={setPosition} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: !content.trim() || submitting ? 0.55 : 1 }}
              disabled={!content.trim() || submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Adding…' : 'Add at playhead'}
            </button>
          </div>
        </div>
      )}
      renderItem={(ev) => (
        <OverlayListRow
          key={ev.id}
          event={ev}
          showPosition
          onUpdate={(patch) => void props.onUpdate(ev.id, patch)}
          onRemove={() => void props.onRemove(ev.id)}
        />
      )}
    />
  )
}

export function AddHookOverlayPanel(props: {
  playheadSeconds: number
  events: OverlayEvent[]
  onAdd: (input: { content: string; subtitle?: string; durationSeconds: number }) => Promise<OverlayEvent | null>
  onUpdate: (eventId: string, patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) => Promise<void>
  onRemove: (eventId: string) => Promise<void>
}) {
  const [content, setContent] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [duration, setDuration] = useState('2.5')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!content.trim()) return
    setSubmitting(true)
    try {
      const dur = Math.max(0.5, Number(duration) || 2.5)
      const event = await props.onAdd({
        content: content.trim(),
        subtitle: subtitle.trim() || undefined,
        durationSeconds: dur
      })
      if (event) {
        setContent('')
        setSubtitle('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      title="Hook Overlay"
      icon="🪝"
      iconColor="#fef3c7"
      description="Big top-of-frame text for the first three seconds — the visual hook that makes someone stop scrolling."
      playheadSeconds={props.playheadSeconds}
      items={props.events}
      renderForm={() => (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>Headline</label>
            <input
              type="text"
              placeholder="What's the hook?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={inputStyle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && content.trim()) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
          </div>
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Subtitle (optional)</label>
              <input
                type="text"
                placeholder="Smaller kicker line"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Duration (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: !content.trim() || submitting ? 0.55 : 1 }}
              disabled={!content.trim() || submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Adding…' : 'Add at playhead'}
            </button>
          </div>
        </div>
      )}
      renderItem={(ev) => (
        <OverlayListRow
          key={ev.id}
          event={ev}
          showPosition={false}
          onUpdate={(patch) => void props.onUpdate(ev.id, patch)}
          onRemove={() => void props.onRemove(ev.id)}
        />
      )}
    />
  )
}

export function AddStatOverlayPanel(props: {
  playheadSeconds: number
  events: OverlayEvent[]
  onAdd: (input: {
    chart: OverlayChartKind
    value: number
    target?: number
    prefix?: string
    suffix?: string
    label?: string
    durationSeconds: number
  }) => Promise<OverlayEvent | null>
  onUpdate: (eventId: string, patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) => Promise<void>
  onRemove: (eventId: string) => Promise<void>
}) {
  const [chart, setChart] = useState<OverlayChartKind>('counter')
  const [value, setValue] = useState('100')
  const [target, setTarget] = useState('')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [label, setLabel] = useState('')
  const [duration, setDuration] = useState('3.5')
  const [submitting, setSubmitting] = useState(false)

  const valueNum = Number(value)
  const targetNum = target.trim() === '' ? undefined : Number(target)
  const formValid = Number.isFinite(valueNum) && (chart !== 'bar' || (targetNum != null && Number.isFinite(targetNum) && targetNum > 0))

  const submit = async () => {
    if (!formValid) return
    setSubmitting(true)
    try {
      const dur = Math.max(0.5, Number(duration) || 3.5)
      const event = await props.onAdd({
        chart,
        value: valueNum,
        target: targetNum,
        prefix: prefix.trim() || undefined,
        suffix: suffix.trim() || undefined,
        label: label.trim() || undefined,
        durationSeconds: dur
      })
      if (event) {
        setLabel('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      title="Stat / Chart"
      icon="📊"
      iconColor="#6ee7c5"
      description="Reveal a number, a percent, or a fill bar mid-clip. Animates in over ~1 second the moment the playhead crosses the start time."
      playheadSeconds={props.playheadSeconds}
      items={props.events}
      renderForm={() => (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>Chart type</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['counter', 'bar', 'donut'] as OverlayChartKind[]).map((k) => {
                const active = chart === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setChart(k)}
                    style={{
                      ...ghostBtn,
                      borderColor: active ? '#6ee7c5' : 'rgba(255,255,255,0.1)',
                      color: active ? '#6ee7c5' : '#a1a1aa',
                      background: active ? 'rgba(110,231,197,0.08)' : 'transparent'
                    }}
                  >
                    {k === 'counter' ? 'Counter' : k === 'bar' ? 'Bar' : 'Donut %'}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>{chart === 'donut' ? 'Percent (0–100)' : 'Value'}</label>
              <input
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={inputStyle}
              />
            </div>
            {chart === 'bar' && (
              <div>
                <label style={labelStyle}>Target (100% point)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="required for bar"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  style={inputStyle}
                />
              </div>
            )}
            <div>
              <label style={labelStyle}>Prefix</label>
              <input
                type="text"
                placeholder="$"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Suffix</label>
              <input
                type="text"
                placeholder={chart === 'donut' ? '% (auto)' : 'M'}
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Label (optional)</label>
              <input
                type="text"
                placeholder="monthly recurring revenue"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Duration (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: !formValid || submitting ? 0.55 : 1 }}
              disabled={!formValid || submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Adding…' : 'Add at playhead'}
            </button>
          </div>
          {!formValid && chart === 'bar' && (
            <div style={{ fontSize: 12, color: '#fbbf24' }}>Bar charts need a target so the fill knows where 100% lives.</div>
          )}
        </div>
      )}
      renderItem={(ev) => (
        <StatOverlayListRow
          key={ev.id}
          event={ev}
          onUpdate={(patch) => void props.onUpdate(ev.id, patch)}
          onRemove={() => void props.onRemove(ev.id)}
        />
      )}
    />
  )
}

function StatOverlayListRow(props: {
  event: OverlayEvent
  onUpdate: (patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) => void
  onRemove: () => void
}) {
  const { event, onUpdate, onRemove } = props
  const stat = event.stat
  return (
    <div
      style={{
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5', marginBottom: 2 }}>
            {stat ? (
              <span style={{ color: '#6ee7c5' }}>
                {stat.prefix ?? ''}{stat.value}{stat.suffix ?? (stat.chart === 'donut' ? '%' : '')}
              </span>
            ) : event.content}
            {stat?.label && <span style={{ color: '#a1a1aa', marginLeft: 8, fontSize: 13 }}>· {stat.label}</span>}
          </div>
          <div style={{ fontSize: 11, color: '#71717a', fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 10 }}>
            <span>{formatTimeRange(event.timelineInSeconds, event.timelineOutSeconds)}</span>
            {stat && <span style={{ color: '#a78bfa' }}>{stat.chart}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => {
              const newDur = Number(window.prompt('New duration in seconds', (event.timelineOutSeconds - event.timelineInSeconds).toFixed(1)) ?? '')
              if (Number.isFinite(newDur) && newDur >= 0.5) {
                onUpdate({ timelineOutSeconds: event.timelineInSeconds + newDur })
              }
            }}
          >
            Adjust
          </button>
          <button type="button" style={dangerGhostBtn} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

export function AddPausePanel(props: {
  playheadSeconds: number
  pauseGaps: PauseGapListItem[]
  onAdd: (input: { atSeconds: number; durationSeconds: number; note?: string }) => Promise<{ insertedAt: number; durationSec: number; snapped: boolean } | null>
  onRemove: (videoClipId: string) => Promise<void>
}) {
  const [duration, setDuration] = useState('1.5')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastInsert, setLastInsert] = useState<{ at: number; dur: number; snapped: boolean } | null>(null)

  const submit = async () => {
    setSubmitting(true)
    try {
      const dur = Math.max(0.25, Number(duration) || 1.5)
      const result = await props.onAdd({
        atSeconds: props.playheadSeconds,
        durationSeconds: dur,
        note: note.trim() || undefined
      })
      if (result) {
        setLastInsert({ at: result.insertedAt, dur: result.durationSec, snapped: result.snapped })
        setNote('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PanelShell
      title="Pause / Breathing Room"
      icon="⏱️"
      iconColor="#a78bfa"
      description="Insert a real silent gap (black + silence). Pushes every later clip + overlay forward — true breathing room, not a marker."
      playheadSeconds={props.playheadSeconds}
      items={props.pauseGaps}
      renderForm={() => (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={formGrid}>
            <div>
              <label style={labelStyle}>Pause duration (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.25"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Editorial note (optional)</label>
              <input
                type="text"
                placeholder="e.g. let the punchline land"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: submitting ? 0.55 : 1 }}
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Inserting…' : 'Insert pause at playhead'}
            </button>
          </div>
          {lastInsert && (
            <div style={{ fontSize: 12, color: lastInsert.snapped ? '#fbbf24' : '#a1a1aa' }}>
              {lastInsert.snapped
                ? `Snapped to nearest clip boundary at ${lastInsert.at.toFixed(2)}s — ${lastInsert.dur.toFixed(1)}s pause inserted. Everything after shifted forward.`
                : `Inserted ${lastInsert.dur.toFixed(1)}s pause at ${lastInsert.at.toFixed(2)}s. Everything after shifted forward.`}
            </div>
          )}
        </div>
      )}
      renderItem={(g) => (
        <PauseGapListRow
          key={g.videoClipId}
          gap={g}
          onRemove={() => void props.onRemove(g.videoClipId)}
        />
      )}
    />
  )
}

function PauseGapListRow(props: { gap: PauseGapListItem; onRemove: () => void }) {
  return (
    <div
      style={{
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10,
        padding: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5' }}>
          {props.gap.durationSeconds.toFixed(1)}s pause
          <span style={{ color: '#71717a', fontWeight: 500, marginLeft: 8 }}>
            at {props.gap.timelineInSeconds.toFixed(2)}s
          </span>
        </div>
        {props.gap.note && (
          <div style={{ fontSize: 12, color: '#a1a1aa', fontStyle: 'italic' }}>"{props.gap.note}"</div>
        )}
      </div>
      <button type="button" style={dangerGhostBtn} onClick={props.onRemove}>
        Remove
      </button>
    </div>
  )
}

/**
 * Shared frame around each panel — title + playhead pill + form + list.
 * Generic over the item shape so AddTextOverlayPanel and AddPausePanel can
 * both render their lists without hand-rolling identical chrome twice.
 */
function PanelShell<T>(props: {
  title: string
  icon: string
  iconColor: string
  description: string
  playheadSeconds: number
  items: T[]
  renderForm: () => ReactNode
  renderItem: (item: T) => ReactNode
}) {
  const itemCount = props.items.length
  return (
    <div style={sectionCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h3
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: '#f4f4f5',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}
        >
          <span style={{ color: props.iconColor }}>{props.icon}</span> {props.title}
        </h3>
        <PlayheadPill seconds={props.playheadSeconds} />
        {itemCount > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#71717a' }}>
            {itemCount} on this timeline
          </span>
        )}
      </div>
      <p style={{ color: '#a1a1aa', fontSize: 13, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
        {props.description}
      </p>
      {props.renderForm()}
      {itemCount > 0 && (
        <div style={{ marginTop: 24, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
            On this timeline
          </div>
          {props.items.map((item) => props.renderItem(item))}
        </div>
      )}
    </div>
  )
}
