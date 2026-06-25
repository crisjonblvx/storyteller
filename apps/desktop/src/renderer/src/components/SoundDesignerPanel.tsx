import React, { CSSProperties, useState } from 'react'
import type { TimelineSequence, SoundDesignSlot, SoundDesignSlotCategory } from '@storyteller/timeline'
import type { AudioDnaId } from '@storyteller/analysis'
import type { TranscriptSegment } from '@storyteller/shared'
import {
  AUDIO_DNA,
  AUDIO_DNA_LIST,
  computeAudioImmersionScore,
  generateAudioDirectorSuggestions,
  generateAudioDirectorFallback
} from '@storyteller/analysis'
import { getGatewayAccessToken } from '@renderer/lib/gateway-auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisPhase = 'idle' | 'analyzing' | 'ready' | 'error'

export type SoundDesignerPanelProps = {
  projectId: string
  sequence: TimelineSequence
  segments: TranscriptSegment[]
  audioDnaId: AudioDnaId | undefined
  onAudioDnaChange: (id: AudioDnaId) => void
  onSequenceChange: (seq: TimelineSequence) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<SoundDesignSlotCategory, { icon: string; label: string }> = {
  ambient: { icon: '🌲', label: 'Environment' },
  movement: { icon: '👣', label: 'Movement' },
  impact: { icon: '💥', label: 'Impact' },
  transition: { icon: '🌬️', label: 'Transition' },
  silence: { icon: '🔇', label: 'Silence' }
}

const CATEGORY_ORDER: SoundDesignSlotCategory[] = [
  'ambient', 'movement', 'impact', 'transition', 'silence'
]

// ─── Palette ──────────────────────────────────────────────────────────────────

const BG = '#0a0a0b'
const CARD = '#1c1c1f'
const BORDER = 'rgba(255,255,255,0.08)'
const TEAL = '#6ee7c5'
const TEXT_PRIMARY = '#f4f4f5'
const TEXT_SECONDARY = '#a1a1aa'
const SELECTED_BG = 'rgba(110,231,197,0.08)'
const ERROR_COLOR = '#ef4444'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <>
      <style>{`@keyframes sdp-spin { to { transform: rotate(360deg) } }`}</style>
      <span style={{
        display: 'inline-block',
        width: 15,
        height: 15,
        border: `2px solid ${TEAL}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'sdp-spin 0.7s linear infinite',
        flexShrink: 0
      }} />
    </>
  )
}

type SlotCardProps = {
  slot: SoundDesignSlot
  onCycleStatus: (id: string) => void
  onIntensityChange: (id: string, v: number) => void
}

function SlotCard({ slot, onCycleStatus, onIntensityChange }: SlotCardProps) {
  const isRejected = slot.status === 'rejected'
  const reason = typeof slot.metadata?.reason === 'string' ? slot.metadata.reason : null

  const cardStyle: CSSProperties = {
    background: CARD,
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    padding: '14px 16px',
    marginBottom: 10,
    opacity: isRejected ? 0.4 : 1,
    transition: 'opacity 0.2s'
  }

  return (
    <div style={cardStyle}>
      {/* Row 1: time range + accept toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isRejected ? 0 : 8 }}>
        <span style={{ fontSize: 13, color: TEXT_SECONDARY, fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(slot.timelineStart)} – {formatTime(slot.timelineEnd)}
        </span>
        <StatusToggle status={slot.status} onToggle={() => onCycleStatus(slot.id)} />
      </div>

      {!isRejected && (
        <>
          {/* Row 2: tags */}
          {slot.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {slot.tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                  color: TEXT_SECONDARY,
                  border: `1px solid ${BORDER}`
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Row 3: reason */}
          {reason && (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: TEXT_SECONDARY, fontStyle: 'italic', lineHeight: 1.5 }}>
              {reason}
            </p>
          )}

          {/* Row 4: intensity slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: TEXT_SECONDARY, flexShrink: 0 }}>Intensity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={slot.intensity}
              onChange={(e) => onIntensityChange(slot.id, parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: TEAL, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 12, color: TEXT_PRIMARY, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {slot.intensity.toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

type StatusToggleProps = {
  status: SoundDesignSlot['status']
  onToggle: () => void
}

function StatusToggle({ status, onToggle }: StatusToggleProps) {
  const isAccepted = status === 'accepted'
  const isRejected = status === 'rejected'

  const btnStyle: CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: '50%',
    border: isAccepted
      ? `2px solid ${TEAL}`
      : isRejected
        ? '2px solid rgba(255,255,255,0.2)'
        : '2px solid rgba(255,255,255,0.3)',
    background: isAccepted ? TEAL : isRejected ? 'rgba(255,255,255,0.1)' : 'transparent',
    color: isAccepted ? '#0a0a0b' : isRejected ? TEXT_SECONDARY : TEXT_SECONDARY,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s'
  }

  return (
    <button onClick={onToggle} style={btnStyle} title={`Status: ${status} — click to cycle`}>
      {isAccepted ? '✓' : isRejected ? '×' : '○'}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SoundDesignerPanel({
  projectId,
  sequence,
  segments,
  audioDnaId,
  onAudioDnaChange,
  onSequenceChange
}: SoundDesignerPanelProps) {
  const [phase, setPhase] = useState<AnalysisPhase>(() =>
    (sequence.soundDesignSlots?.length ?? 0) > 0 ? 'ready' : 'idle'
  )
  const [slots, setSlots] = useState<SoundDesignSlot[]>(() =>
    sequence.soundDesignSlots ?? []
  )
  const [error, setError] = useState<string | null>(null)
  const [activeDna, setActiveDna] = useState<AudioDnaId>(audioDnaId ?? 'netflix_documentary')
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false)
  const [applied, setApplied] = useState(false)

  const immersion = computeAudioImmersionScore(sequence)
  const activeDnaDefinition = AUDIO_DNA[activeDna]
  const acceptedCount = slots.filter(s => s.status === 'accepted').length

  const scoreColor =
    immersion.score >= 80 ? '#22c55e' :
    immersion.score >= 60 ? '#eab308' :
    '#f97316'

  function handleDnaChange(id: AudioDnaId) {
    setActiveDna(id)
    onAudioDnaChange(id)
  }

  async function handleAnalyze() {
    if (segments.length === 0) return
    setPhase('analyzing')
    setError(null)
    setApplied(false)

    const dna = AUDIO_DNA[activeDna]
    const token = await getGatewayAccessToken()

    if (!token) {
      const result = generateAudioDirectorFallback(
        projectId,
        dna,
        segments,
        sequence.durationSeconds
      )
      setSlots(result.slots)
      setPhase('ready')
      return
    }

    const result = await generateAudioDirectorSuggestions({
      apiKey: token,
      projectId,
      audioDna: dna,
      segments,
      sequenceDurationSeconds: sequence.durationSeconds
    })

    if (result.ok) {
      setSlots(result.slots)
      setPhase('ready')
    } else {
      setError(result.error)
      setPhase('error')
    }
  }

  function cycleStatus(slotId: string) {
    setSlots(prev => prev.map(s => {
      if (s.id !== slotId) return s
      const next: SoundDesignSlot['status'] =
        s.status === 'suggested' ? 'accepted' :
        s.status === 'accepted' ? 'rejected' : 'suggested'
      return { ...s, status: next }
    }))
  }

  function updateIntensity(slotId: string, intensity: number) {
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, intensity } : s))
  }

  function handleApply() {
    const accepted = slots.filter(s => s.status === 'accepted')
    const existing = sequence.soundDesignSlots ?? []
    // Deduplicate: accepted slots replace any existing slot with the same id.
    const acceptedIds = new Set(accepted.map(s => s.id))
    const preserved = existing.filter(s => !acceptedIds.has(s.id))
    onSequenceChange({ ...sequence, soundDesignSlots: [...preserved, ...accepted] })
    setApplied(true)
  }

  // ── Slot grouping ──────────────────────────────────────────────────────────

  const grouped = CATEGORY_ORDER.reduce<Map<SoundDesignSlotCategory, SoundDesignSlot[]>>(
    (acc, cat) => {
      const group = slots.filter(s => s.category === cat)
      if (group.length > 0) acc.set(cat, group)
      return acc
    },
    new Map()
  )

  const categoryCounts = CATEGORY_ORDER.reduce<Partial<Record<SoundDesignSlotCategory, number>>>(
    (acc, cat) => {
      const n = slots.filter(s => s.category === cat).length
      if (n > 0) acc[cat] = n
      return acc
    },
    {}
  )

  // ── Styles ─────────────────────────────────────────────────────────────────

  const root: CSSProperties = {
    background: BG,
    padding: '28px 32px',
    minHeight: '100%',
    color: TEXT_PRIMARY,
    fontFamily: 'inherit'
  }

  const sectionLabel: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: TEXT_SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 12
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={root}>

      {/* ── Section 1: Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT_PRIMARY, display: 'flex', alignItems: 'center', gap: 10 }}>
            🎧 Audio Director
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: TEXT_SECONDARY }}>
            Review sound design opportunities for your story.
          </p>
        </div>

        {/* Immersion score badge */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowScoreBreakdown(v => !v)}
            style={{
              background: `${scoreColor}22`,
              border: `1px solid ${scoreColor}`,
              borderRadius: 20,
              padding: '6px 16px',
              color: scoreColor,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>🎵</span>
            <span>{immersion.score}</span>
          </button>

          {showScoreBreakdown && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 100,
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: '14px 18px', minWidth: 210, fontSize: 13,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
            }}>
              <div style={{ fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 10 }}>Score Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, color: TEXT_SECONDARY }}>
                <div>Missing ambient: <span style={{ color: TEXT_PRIMARY }}>{immersion.missingAmbient}</span></div>
                <div>Harsh cuts: <span style={{ color: TEXT_PRIMARY }}>{immersion.harshCuts}</span></div>
                <div>
                  Dry dialogue:{' '}
                  <span style={{ color: immersion.dryDialogue ? ERROR_COLOR : '#22c55e' }}>
                    {immersion.dryDialogue ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Audio DNA selector ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={sectionLabel}>Sound Personality</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {AUDIO_DNA_LIST.map(d => (
            <button
              key={d.id}
              onClick={() => handleDnaChange(d.id)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: activeDna === d.id ? `1px solid ${TEAL}` : `1px solid ${BORDER}`,
                background: activeDna === d.id ? SELECTED_BG : 'transparent',
                color: activeDna === d.id ? TEAL : TEXT_SECONDARY,
                fontSize: 13,
                fontWeight: activeDna === d.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {d.label}
            </button>
          ))}
        </div>

        {activeDnaDefinition && (
          <p style={{ margin: '12px 0 0', fontSize: 13, color: TEXT_SECONDARY, fontStyle: 'italic', lineHeight: 1.55 }}>
            {activeDnaDefinition.philosophy.split('. ').slice(0, 2).join('. ') + '.'}
          </p>
        )}
      </div>

      {/* ── Section 3: Analyze button ── */}
      <div style={{ marginBottom: 36 }}>
        <button
          onClick={() => { void handleAnalyze() }}
          disabled={segments.length === 0 || phase === 'analyzing'}
          style={{
            padding: '12px 28px',
            borderRadius: 10,
            border: `1px solid ${segments.length === 0 ? BORDER : TEAL}`,
            background: segments.length === 0 || phase === 'analyzing' ? 'transparent' : SELECTED_BG,
            color: segments.length === 0 ? TEXT_SECONDARY : TEAL,
            fontSize: 15,
            fontWeight: 600,
            cursor: segments.length === 0 || phase === 'analyzing' ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            opacity: segments.length === 0 ? 0.45 : 1,
            transition: 'all 0.15s'
          }}
        >
          {phase === 'analyzing' ? <><Spinner /> Analyzing…</> : 'Analyze Story'}
        </button>
        {segments.length === 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: TEXT_SECONDARY }}>
            Upload and transcribe media first to enable analysis.
          </p>
        )}
      </div>

      {/* ── Section 6: Idle placeholder (shown before first analysis) ── */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '56px 0', color: TEXT_SECONDARY }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎧</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: TEXT_PRIMARY, marginBottom: 8 }}>No sound analysis yet.</div>
          <div style={{ fontSize: 14 }}>Choose a sound personality, then click Analyze Story.</div>
        </div>
      )}

      {/* ── Error state ── */}
      {phase === 'error' && error && (
        <div style={{
          background: `${ERROR_COLOR}18`,
          border: `1px solid ${ERROR_COLOR}44`,
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16
        }}>
          <p style={{ margin: 0, fontSize: 14, color: ERROR_COLOR, lineHeight: 1.5 }}>
            {error}
          </p>
          <button
            onClick={() => { setPhase('idle'); setError(null) }}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              border: `1px solid ${ERROR_COLOR}`,
              background: 'transparent',
              color: ERROR_COLOR,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Section 4: Results ── */}
      {phase === 'ready' && slots.length > 0 && (
        <div>
          {/* Summary line */}
          <div style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 24,
            fontSize: 14,
            color: TEXT_SECONDARY,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center'
          }}>
            <span>
              Storyteller found <strong style={{ color: TEAL }}>{slots.length}</strong> audio{' '}
              {slots.length === 1 ? 'opportunity' : 'opportunities'}.
            </span>
            <span style={{ marginLeft: 4, color: TEXT_SECONDARY }}>
              {Object.entries(categoryCounts)
                .map(([cat, n]) => `${n} ${CATEGORY_META[cat as SoundDesignSlotCategory].label.toLowerCase()}`)
                .join(' · ')}
            </span>
          </div>

          {/* Category groups */}
          {CATEGORY_ORDER.map(cat => {
            const group = grouped.get(cat)
            if (!group) return null
            const meta = CATEGORY_META[cat]
            return (
              <div key={cat} style={{ marginBottom: 28 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: `1px solid ${BORDER}`
                }}>
                  <span style={{ fontSize: 16 }}>{meta.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>({group.length})</span>
                </div>
                {group.map(slot => (
                  <SlotCard
                    key={slot.id}
                    slot={slot}
                    onCycleStatus={cycleStatus}
                    onIntensityChange={updateIntensity}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Section 4: Empty results ── */}
      {phase === 'ready' && slots.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: TEXT_SECONDARY }}>
          <div style={{ fontSize: 14 }}>No audio opportunities found for this transcript.</div>
        </div>
      )}

      {/* ── Section 5: Footer CTA ── */}
      {acceptedCount > 0 && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: BG,
          borderTop: `1px solid ${BORDER}`,
          padding: '16px 0',
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <button
            onClick={handleApply}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: `1px solid ${TEAL}`,
              background: TEAL,
              color: '#0a0a0b',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'opacity 0.15s'
            }}
          >
            Apply Accepted Sounds ({acceptedCount})
          </button>
          {applied && (
            <span style={{ fontSize: 14, color: TEAL, fontWeight: 600 }}>Applied ✓</span>
          )}
        </div>
      )}
    </div>
  )
}
