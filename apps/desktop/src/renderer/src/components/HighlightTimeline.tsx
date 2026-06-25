import { useState } from 'react'
import type { Asset, HighlightClipRole, GamePhase, TimelineSegment } from '@storyteller/shared'
import { GAME_PHASES, HIGHLIGHT_CLIP_ROLES } from '@storyteller/shared'
import type { LocalProject } from '@renderer/stores/project-workflow'

// ─── Role metadata ────────────────────────────────────────────────────────────

const ROLE_EMOJI: Record<HighlightClipRole, string> = {
  hype:        '🔥',
  play:        '🎬',
  reaction:    '😲',
  commentary:  '🎤',
  crowd:       '👏',
  recap:       '🏁',
  unassigned:  '❓',
}

const ROLE_COLORS: Record<HighlightClipRole, { bg: string; border: string; text: string }> = {
  hype:        { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.45)',  text: '#f59e0b' },
  play:        { bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.45)',  text: '#38bdf8' },
  reaction:    { bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.45)', text: '#f472b6' },
  commentary:  { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.45)', text: '#a78bfa' },
  crowd:       { bg: 'rgba(45,212,191,0.12)',  border: 'rgba(45,212,191,0.45)',  text: '#2dd4bf' },
  recap:       { bg: 'rgba(163,230,53,0.12)',  border: 'rgba(163,230,53,0.45)',  text: '#a3e635' },
  unassigned:  { bg: 'rgba(113,113,122,0.08)', border: 'rgba(113,113,122,0.25)', text: '#71717a' },
}

// ─── Default phases to show even when empty ───────────────────────────────────

const DEFAULT_VISIBLE_PHASE_IDS: GamePhase[] = ['first_half', 'second_half', 'postgame']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function displayName(a: Asset): string {
  return (
    a.original_filename ??
    a.local_path?.split(/[/\\]/).pop() ??
    a.storage_path?.split('/').pop() ??
    a.id
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 13,
        height: 13,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: '#ffffff',
        borderRadius: '50%',
        animation: 'ht-spin 0.7s linear infinite',
        verticalAlign: 'middle',
      }}
    />
  )
}

// ─── ClipCard ─────────────────────────────────────────────────────────────────

function ClipCard({ segment, asset }: { segment: TimelineSegment; asset: Asset | undefined }) {
  const colors = ROLE_COLORS[segment.role]
  const score = segment.highlightScore
  const typeIcon =
    !asset ? '🎬' :
    asset.asset_type === 'audio' ? '🎙' :
    asset.asset_type === 'photo' || asset.asset_type === 'image' ? '🖼' : '🎬'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 10px',
        borderRadius: 8,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        minWidth: 110,
        maxWidth: 150,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Thumbnail placeholder */}
      <div
        style={{
          width: '100%',
          height: 52,
          borderRadius: 5,
          background: 'rgba(0,0,0,0.35)',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          marginBottom: 2,
        }}
      >
        {typeIcon}
      </div>

      {/* File name */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#d4d4d8',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {asset ? displayName(asset) : segment.assetId.slice(0, 8)}
      </div>

      {/* Duration */}
      <div style={{ fontSize: 10, color: '#71717a' }}>
        {formatDuration(segment.durationSeconds ?? asset?.duration_seconds)}
      </div>

      {/* Highlight score badge */}
      {score > 70 && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 5px',
            borderRadius: 5,
            background: 'rgba(245,158,11,0.25)',
            border: '1px solid rgba(245,158,11,0.5)',
            color: '#fbbf24',
          }}
        >
          ⚡ {score}
        </div>
      )}
    </div>
  )
}

// ─── RoleLane ─────────────────────────────────────────────────────────────────

function RoleLane({
  role,
  segments,
  assetMap,
  activePhaseIds,
  onClipDrop,
}: {
  role: HighlightClipRole
  segments: TimelineSegment[]
  assetMap: Map<string, Asset>
  activePhaseIds: GamePhase[]
  onClipDrop: (assetId: string, role: HighlightClipRole, phase: GamePhase) => void
}) {
  const colors = ROLE_COLORS[role]
  const roleLabel = HIGHLIGHT_CLIP_ROLES.find((r) => r.id === role)?.label ?? role
  const [dropHoverPhase, setDropHoverPhase] = useState<GamePhase | null>(null)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        minHeight: 96,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {/* Lane header */}
      <div
        style={{
          width: 110,
          flexShrink: 0,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          borderRight: `2px solid ${colors.border}`,
          alignSelf: 'stretch',
        }}
      >
        <span style={{ fontSize: 16 }}>{ROLE_EMOJI[role]}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: colors.text }}>{roleLabel}</span>
      </div>

      {/* Per-phase clip buckets */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflowX: 'auto' }}>
        {activePhaseIds.map((phaseId, idx) => {
          const phaseSegments = segments
            .filter((s) => s.phase === phaseId)
            .sort((a, b) => a.orderInPhase - b.orderInPhase)

          const isHovered = dropHoverPhase === phaseId

          return (
            <div
              key={phaseId}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropHoverPhase(phaseId)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setDropHoverPhase(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDropHoverPhase(null)
                const assetId = e.dataTransfer.getData('assetId')
                const droppedRole = (e.dataTransfer.getData('role') || role) as HighlightClipRole
                if (assetId) {
                  onClipDrop(assetId, droppedRole, phaseId)
                }
              }}
              style={{
                minWidth: 160,
                borderRight: idx < activePhaseIds.length - 1
                  ? '1px solid rgba(255,255,255,0.05)'
                  : 'none',
                padding: '10px 10px',
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
                alignContent: 'flex-start',
                transition: 'box-shadow 0.15s, background 0.15s',
                boxShadow: isHovered ? 'inset 0 0 0 2px rgba(14,165,233,0.75)' : 'none',
                background: isHovered ? 'rgba(14,165,233,0.07)' : 'transparent',
                borderRadius: isHovered ? 6 : 0,
              }}
            >
              {isHovered && phaseSegments.length === 0 && (
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                    fontSize: 11,
                    color: '#38bdf8',
                    fontWeight: 600,
                    gap: 5,
                    pointerEvents: 'none',
                  }}
                >
                  <span>＋</span>
                  <span>Drop here</span>
                </div>
              )}
              {phaseSegments.map((seg) => (
                <ClipCard
                  key={seg.id}
                  segment={seg}
                  asset={assetMap.get(seg.assetId)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HighlightTimelineProps {
  project: LocalProject
  assets: Asset[]
  segments: TimelineSegment[]
  onSegmentUpdate: (segmentId: string, updates: Partial<TimelineSegment>) => void
  onSegmentReorder: (segmentId: string, newPhase: GamePhase, newOrder: number) => void
  onAutoAssign: () => void
  onClipDrop: (assetId: string, role: HighlightClipRole, phase: GamePhase) => void
  isAutoAssigning?: boolean
}

// ─── HighlightTimeline ────────────────────────────────────────────────────────

export function HighlightTimeline({
  assets,
  segments,
  onAutoAssign,
  onClipDrop,
  isAutoAssigning = false,
}: HighlightTimelineProps) {
  const assetMap = new Map(assets.map((a) => [a.id, a]))

  // Determine which phases are active (have at least one segment).
  const phasesWithClips = new Set(segments.map((s) => s.phase))

  const activePhaseIds: GamePhase[] = GAME_PHASES
    .map((p) => p.id)
    .filter((id) => phasesWithClips.has(id) || DEFAULT_VISIBLE_PHASE_IDS.includes(id))

  // Determine which roles are active (have at least one segment).
  const activeRoles: HighlightClipRole[] = HIGHLIGHT_CLIP_ROLES
    .map((r) => r.id)
    .filter((id) => id !== 'unassigned' && segments.some((s) => s.role === id))

  const isEmpty = segments.length === 0

  return (
    <>
      {/* Keyframe for the spinner — injected once into the document */}
      <style>{`
        @keyframes ht-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          background: '#0a0a0b',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f4f4f5' }}>
              Game Timeline
            </div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>
              Clips organized by phase and role · drag clips from the panel above to assign
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#a1a1aa' }}>
            {segments.length} clip{segments.length === 1 ? '' : 's'} assigned
          </div>
        </div>

        {/* ── Phase header row ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            overflowX: 'auto',
          }}
        >
          {/* Left spacer matching the role lane header width */}
          <div style={{ width: 110, flexShrink: 0, borderRight: '2px solid rgba(255,255,255,0.08)' }} />

          {/* Phase pills */}
          {activePhaseIds.map((phaseId) => {
            const meta = GAME_PHASES.find((p) => p.id === phaseId)!
            const count = segments.filter((s) => s.phase === phaseId).length
            return (
              <div
                key={phaseId}
                style={{
                  minWidth: 160,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  borderRight: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#d4d4d8',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meta.short}
                </span>
                {count > 0 && (
                  <span style={{ fontSize: 10, color: '#52525b' }}>{count}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Empty state ── */}
        {isEmpty && (
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1 }}>🏟️</div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#d4d4d8' }}>
              No clips on the timeline yet
            </div>
            <div style={{ fontSize: 13, color: '#52525b', maxWidth: 340, lineHeight: 1.55 }}>
              Drag clips from your footage above, or let Storyteller auto-assign them by game phase and role.
            </div>
            <button
              type="button"
              onClick={onAutoAssign}
              disabled={isAutoAssigning}
              style={{
                marginTop: 8,
                width: '100%',
                maxWidth: 320,
                padding: '12px 0',
                borderRadius: 10,
                border: 'none',
                background: isAutoAssigning
                  ? 'rgba(14,165,233,0.3)'
                  : 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
                color: isAutoAssigning ? 'rgba(255,255,255,0.5)' : '#ffffff',
                fontWeight: 700,
                fontSize: 14,
                cursor: isAutoAssigning ? 'not-allowed' : 'pointer',
                boxShadow: isAutoAssigning ? 'none' : '0 4px 14px rgba(14,165,233,0.35)',
                letterSpacing: '0.01em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {isAutoAssigning ? (
                <>
                  <Spinner />
                  <span>Assigning clips…</span>
                </>
              ) : (
                '⚡ Auto-Assign Clips'
              )}
            </button>
          </div>
        )}

        {/* ── Role swim lanes ── */}
        {!isEmpty && activeRoles.length === 0 && (
          <div style={{ padding: '28px 24px', textAlign: 'center' }}>
            <p style={{ color: '#71717a', fontSize: 13 }}>
              Clips are assigned but no roles are set. Tag clips with roles in the ingest panel above.
            </p>
          </div>
        )}

        {!isEmpty && activeRoles.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            {activeRoles.map((role) => (
              <RoleLane
                key={role}
                role={role}
                segments={segments.filter((s) => s.role === role)}
                assetMap={assetMap}
                activePhaseIds={activePhaseIds}
                onClipDrop={onClipDrop}
              />
            ))}

            {/* Auto-assign CTA at bottom of populated timeline */}
            <div
              style={{
                padding: '14px 18px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 11, color: '#52525b' }}>
                Phase assignments off? Let AI re-sort them.
              </span>
              <button
                type="button"
                onClick={onAutoAssign}
                disabled={isAutoAssigning}
                style={{
                  padding: '7px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: isAutoAssigning
                    ? 'rgba(14,165,233,0.3)'
                    : 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)',
                  color: isAutoAssigning ? 'rgba(255,255,255,0.5)' : '#ffffff',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: isAutoAssigning ? 'not-allowed' : 'pointer',
                  boxShadow: isAutoAssigning ? 'none' : '0 2px 8px rgba(14,165,233,0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isAutoAssigning ? (
                  <>
                    <Spinner />
                    <span>Assigning…</span>
                  </>
                ) : (
                  '⚡ Auto-Assign'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
