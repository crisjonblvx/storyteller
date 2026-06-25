import { useState, useRef, useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, HighlightClipRole } from '@storyteller/shared'
import { HIGHLIGHT_CLIP_ROLES } from '@storyteller/shared'
import { AssetUploadZone } from '@renderer/components/AssetUploadZone'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'

// ─── Beat-sync config passed to the assemble handler ─────────────────────────

export interface BeatSyncConfig {
  musicTrackName?: string
  beatSyncEnabled: boolean
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDuration(sec: number | null): string {
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

const ROLE_COLORS: Record<HighlightClipRole, { bg: string; border: string; text: string }> = {
  hype:        { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.45)',  text: '#f59e0b' },
  play:        { bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.45)',  text: '#38bdf8' },
  reaction:    { bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.45)', text: '#f472b6' },
  commentary:  { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.45)', text: '#a78bfa' },
  crowd:       { bg: 'rgba(45,212,191,0.12)',  border: 'rgba(45,212,191,0.45)',  text: '#2dd4bf' },
  recap:       { bg: 'rgba(163,230,53,0.12)',  border: 'rgba(163,230,53,0.45)',  text: '#a3e635' },
  unassigned:  { bg: 'rgba(113,113,122,0.08)', border: 'rgba(113,113,122,0.25)', text: '#71717a' }
}

// ─── HighlightClipCard ────────────────────────────────────────────────────────

function HighlightClipCard({
  asset,
  onRoleChange
}: {
  asset: Asset
  onRoleChange: (assetId: string, role: HighlightClipRole) => void
}) {
  const role: HighlightClipRole = asset.highlight_clip_role ?? 'unassigned'
  const colors = ROLE_COLORS[role]
  const [isDragging, setIsDragging] = useState(false)

  const typeIcon =
    asset.asset_type === 'audio' ? '🎙' :
    asset.asset_type === 'photo' || asset.asset_type === 'image' ? '🖼' : '🎬'

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('assetId', asset.id)
        e.dataTransfer.setData('role', role)
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        borderRadius: 10,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        transition: 'border-color 0.15s, opacity 0.15s',
        cursor: 'grab',
        opacity: isDragging ? 0.45 : 1,
      }}
    >
      {/* Icon */}
      <div style={{ fontSize: 20, textAlign: 'center', lineHeight: 1 }}>{typeIcon}</div>

      {/* Info */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: '#f4f4f5',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {displayName(asset)}
        </div>
        <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 3 }}>
          {asset.asset_type}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
          {` · ${formatDuration(asset.duration_seconds)}`}
          {asset.probe_status === 'success' ? '' : ` · probe ${asset.probe_status}`}
        </div>
      </div>

      {/* Role selector */}
      <select
        value={role}
        onChange={(e) => onRoleChange(asset.id, e.target.value as HighlightClipRole)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'rgba(0,0,0,0.45)',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          color: colors.text,
          fontSize: 12,
          fontWeight: 600,
          padding: '6px 28px 6px 10px',
          cursor: 'pointer',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23a1a1aa'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          minWidth: 140
        }}
      >
        {HIGHLIGHT_CLIP_ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Role summary bar ─────────────────────────────────────────────────────────

function RoleSummaryBar({ assets }: { assets: Asset[] }) {
  const counts: Partial<Record<HighlightClipRole, number>> = {}
  for (const a of assets) {
    const r = a.highlight_clip_role ?? 'unassigned'
    counts[r] = (counts[r] ?? 0) + 1
  }
  const entries = (Object.entries(counts) as [HighlightClipRole, number][]).filter(([, n]) => n > 0)
  if (entries.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      {entries.map(([role, count]) => {
        const colors = ROLE_COLORS[role]
        const label = HIGHLIGHT_CLIP_ROLES.find((r) => r.id === role)?.label ?? role
        return (
          <span
            key={role}
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '4px 10px',
              borderRadius: 999,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              color: colors.text
            }}
          >
            {label} × {count}
          </span>
        )
      })}
    </div>
  )
}

// ─── Format toggle ────────────────────────────────────────────────────────────

function FormatToggle({
  value,
  onChange
}: {
  value: 'short' | 'long'
  onChange: (v: 'short' | 'long') => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid rgba(14,165,233,0.3)',
        marginBottom: 24
      }}
    >
      {(['short', 'long'] as const).map((fmt) => {
        const active = value === fmt
        return (
          <button
            key={fmt}
            type="button"
            onClick={() => onChange(fmt)}
            style={{
              padding: '8px 20px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              background: active
                ? 'linear-gradient(135deg, rgba(14,165,233,0.25) 0%, rgba(8,47,73,0.3) 100%)'
                : 'transparent',
              color: active ? '#38bdf8' : '#71717a',
              transition: 'all 0.15s'
            }}
          >
            {fmt === 'short' ? '⚡ Short Form' : '🏆 Long Form'}
            <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2, opacity: 0.75 }}>
              {fmt === 'short' ? '≤ 90 s' : 'Full length'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Static waveform heights seeded from filename ────────────────────────────

const WAVEFORM_BAR_COUNT = 40

function seedWaveform(filename: string): number[] {
  const seed = filename.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, i) => {
    const t =
      (Math.sin(seed * 0.017 + i * 0.71) + Math.sin(i * 1.37 + seed * 0.031)) * 0.5 + 0.5
    return Math.max(0.08, Math.min(1, t * 0.82 + 0.1))
  })
}

// ─── MusicTrackSection ────────────────────────────────────────────────────────

function MusicTrackSection({
  musicTrack,
  beatSyncEnabled,
  onFileChange,
  onRemove,
  onToggleBeatSync
}: {
  musicTrack: File | null
  beatSyncEnabled: boolean
  onFileChange: (file: File) => void
  onRemove: () => void
  onToggleBeatSync: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const waveformBars = useMemo(
    () => (musicTrack ? seedWaveform(musicTrack.name) : []),
    [musicTrack]
  )

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && /\.(mp3|wav|m4a|aac)$/i.test(file.name)) {
      onFileChange(file)
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFileChange(file)
  }

  const sizeLabel = musicTrack
    ? musicTrack.size > 1_048_576
      ? `${(musicTrack.size / 1_048_576).toFixed(1)} MB`
      : `${(musicTrack.size / 1024).toFixed(0)} KB`
    : ''

  return (
    <div
      style={{
        marginTop: 28,
        padding: '18px 20px',
        borderRadius: 12,
        background: 'rgba(14,165,233,0.05)',
        border: '1px solid rgba(14,165,233,0.2)'
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 16 }}>🎵</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#f4f4f5' }}>Music Track</span>
        </div>
        <div style={{ fontSize: 12, color: '#71717a', paddingLeft: 24 }}>
          Beat-sync your cuts to the music.
        </div>
      </div>

      {/* No-track drop zone */}
      {!musicTrack && (
        <div
          role="button"
          tabIndex={0}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          style={{
            padding: '22px 20px',
            borderRadius: 10,
            border: '1.5px dashed rgba(14,165,233,0.35)',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
            userSelect: 'none'
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>🎧</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#38bdf8', marginBottom: 4 }}>
            Drop a track or click to browse
          </div>
          <div style={{ fontSize: 11, color: '#52525b' }}>
            Your cuts will sync to the beat &nbsp;·&nbsp; MP3, WAV, M4A, AAC
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac"
            style={{ display: 'none' }}
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* Loaded track display */}
      {musicTrack && (
        <div>
          {/* File info row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, rgba(14,165,233,0.3) 0%, rgba(8,47,73,0.4) 100%)',
                  border: '1px solid rgba(14,165,233,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  flexShrink: 0
                }}
              >
                🎵
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    color: '#f4f4f5',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 260
                  }}
                >
                  {musicTrack.name}
                </div>
                <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>{sizeLabel}</div>
              </div>
            </div>

            {/* Remove button */}
            <button
              type="button"
              onClick={onRemove}
              title="Remove track"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                border: '1px solid rgba(113,113,122,0.3)',
                background: 'rgba(113,113,122,0.12)',
                color: '#a1a1aa',
                cursor: 'pointer',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                lineHeight: 1
              }}
            >
              ×
            </button>
          </div>

          {/* Waveform visualization */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              height: 40,
              marginBottom: 14,
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(14,165,233,0.15)'
            }}
          >
            {waveformBars.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h * 100}%`,
                  borderRadius: 2,
                  background: beatSyncEnabled
                    ? `rgba(56,189,248,${0.5 + h * 0.5})`
                    : `rgba(113,113,122,${0.3 + h * 0.3})`,
                  boxShadow: beatSyncEnabled && h > 0.6
                    ? `0 0 4px rgba(14,165,233,${(h - 0.6) * 0.8})`
                    : 'none',
                  transition: 'background 0.3s, box-shadow 0.3s'
                }}
              />
            ))}
          </div>

          {/* Beat-sync toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: beatSyncEnabled
                ? 'rgba(14,165,233,0.08)'
                : 'rgba(113,113,122,0.06)',
              border: beatSyncEnabled
                ? '1px solid rgba(14,165,233,0.25)'
                : '1px solid rgba(113,113,122,0.2)',
              transition: 'all 0.2s',
              cursor: 'pointer'
            }}
            role="button"
            tabIndex={0}
            onClick={onToggleBeatSync}
            onKeyDown={(e) => e.key === 'Enter' && onToggleBeatSync()}
          >
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: beatSyncEnabled ? '#38bdf8' : '#71717a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>⚡</span>
                <span>Sync cuts to beat</span>
              </div>
              <div style={{ fontSize: 11, color: '#52525b', marginTop: 2, paddingLeft: 18 }}>
                {beatSyncEnabled
                  ? 'Cuts will land on detected beat markers'
                  : 'AI will choose its own cut timing'}
              </div>
            </div>

            {/* Pill toggle */}
            <div
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: beatSyncEnabled
                  ? 'linear-gradient(90deg, #0ea5e9, #38bdf8)'
                  : 'rgba(63,63,70,0.8)',
                position: 'relative',
                flexShrink: 0,
                border: beatSyncEnabled ? '1px solid rgba(56,189,248,0.5)' : '1px solid rgba(113,113,122,0.35)',
                boxShadow: beatSyncEnabled ? '0 0 8px rgba(14,165,233,0.45)' : 'none',
                transition: 'background 0.2s, box-shadow 0.2s, border-color 0.2s'
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 3,
                  left: beatSyncEnabled ? 22 : 3,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  transition: 'left 0.2s'
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── HighlightIngestPanel ─────────────────────────────────────────────────────

export function HighlightIngestPanel(props: {
  projectId: string
  projectTitle: string
  assets: Asset[]
  assetsLoading: boolean
  assetsError: string | null
  supabase: SupabaseClient | null
  userId?: string
  assembling: boolean
  assembleError: string | null
  targetFormat: 'short' | 'long'
  onFormatChange: (fmt: 'short' | 'long') => void
  onUploaded: () => void
  onAssemble: (config?: BeatSyncConfig) => void
}) {
  const {
    projectId,
    projectTitle,
    assets,
    assetsLoading,
    assetsError,
    supabase,
    userId,
    assembling,
    assembleError,
    targetFormat,
    onFormatChange,
    onUploaded,
    onAssemble
  } = props

  const [musicTrack, setMusicTrack] = useState<File | null>(null)
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(true)

  const updateAssetHighlightClipRole = useLocalAssetsStore((s) => s.updateAssetHighlightClipRole)

  const mediaAssets = assets.filter(
    (a) => a.asset_type === 'video' || a.asset_type === 'audio'
  )

  const unassignedCount = mediaAssets.filter(
    (a) => !a.highlight_clip_role || a.highlight_clip_role === 'unassigned'
  ).length

  const canAssemble = mediaAssets.length > 0

  async function handleRoleChange(assetId: string, role: HighlightClipRole) {
    updateAssetHighlightClipRole(projectId, assetId, role)

    if (supabase) {
      const { error } = await supabase
        .from('assets')
        .update({ highlight_clip_role: role })
        .eq('id', assetId)
      if (error) {
        console.warn('[HighlightIngestPanel] highlight_clip_role update failed:', error.message)
      }
    }
  }

  return (
    <div>
      {/* Format toggle */}
      <FormatToggle value={targetFormat} onChange={onFormatChange} />

      {/* Upload zone */}
      <AssetUploadZone
        projectId={projectId}
        projectTitle={projectTitle}
        projectMode="highlight"
        supabaseClient={supabase}
        userId={userId}
        onUploaded={onUploaded}
      />

      {/* Clip list */}
      <div style={{ marginTop: 28 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 10
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, color: '#f4f4f5' }}>
            Add Your Game Footage
          </h3>
          <span style={{ fontSize: 12, color: '#a1a1aa' }}>
            {mediaAssets.length} clip{mediaAssets.length === 1 ? '' : 's'}
            {unassignedCount > 0 && ` · ${unassignedCount} unassigned`}
          </span>
        </div>

        {assetsLoading && (
          <p style={{ color: '#a1a1aa', fontSize: 13 }}>Loading assets…</p>
        )}
        {assetsError && (
          <p style={{ color: 'var(--danger)', fontSize: 13 }}>{assetsError}</p>
        )}

        {!assetsLoading && mediaAssets.length === 0 && (
          <div
            style={{
              padding: '20px 16px',
              borderRadius: 10,
              border: '1px dashed rgba(14,165,233,0.25)',
              color: '#a1a1aa',
              fontSize: 13,
              textAlign: 'center'
            }}
          >
            Drop in your game footage above — hype clips, plays, reactions, and your recap.
          </div>
        )}

        {mediaAssets.length > 0 && (
          <>
            <RoleSummaryBar assets={mediaAssets} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mediaAssets.map((a) => (
                <HighlightClipCard key={a.id} asset={a} onRoleChange={handleRoleChange} />
              ))}
            </div>

            {/* Role legend */}
            <div
              style={{
                marginTop: 14,
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                fontSize: 11,
                color: '#71717a',
                lineHeight: 1.7
              }}
            >
              <strong style={{ color: '#a1a1aa', display: 'block', marginBottom: 4 }}>
                Role guide
              </strong>
              <span style={{ color: ROLE_COLORS.hype.text }}>Hype</span> — opening energy &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.play.text }}>Play</span> — game action &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.reaction.text }}>Reaction</span> — celebration &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.commentary.text }}>Commentary</span> — talking head &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.crowd.text }}>Crowd</span> — atmosphere &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.recap.text }}>Recap</span> — outro/stat
            </div>
          </>
        )}
      </div>

      {/* Music Track section */}
      <MusicTrackSection
        musicTrack={musicTrack}
        beatSyncEnabled={beatSyncEnabled}
        onFileChange={(file) => { setMusicTrack(file); setBeatSyncEnabled(true) }}
        onRemove={() => { setMusicTrack(null); setBeatSyncEnabled(true) }}
        onToggleBeatSync={() => setBeatSyncEnabled((prev) => !prev)}
      />

      {/* Assemble CTA */}
      {canAssemble && (
        <div
          style={{
            marginTop: 28,
            padding: '20px 24px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(14,165,233,0.08) 0%, rgba(8,47,73,0.06) 100%)',
            border: '1px solid rgba(14,165,233,0.3)'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f4f4f5', marginBottom: 4 }}>
            Assemble Highlight Reel
          </div>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>
            Storyteller AI will scan your game footage, build a {targetFormat === 'short' ? 'short-form' : 'long-form'} cut —
            opening hype first, key plays in the middle, and your recap at the end.
            {musicTrack && beatSyncEnabled && (
              <span style={{ color: '#38bdf8' }}>
                {' '}Cuts will be aligned to the beat of <em>{musicTrack.name}</em>.
              </span>
            )}
            {' '}B-roll tags and overlay suggestions will be generated automatically in the next steps.
          </div>

          {unassignedCount > 0 && (
            <div
              style={{
                fontSize: 12,
                color: '#38bdf8',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>⚠</span>
              <span>
                {unassignedCount} clip{unassignedCount === 1 ? '' : 's'} still unassigned —
                Storyteller will append {unassignedCount === 1 ? 'it' : 'them'} at the end.
                Tag them above for the best result.
              </span>
            </div>
          )}

          {assembleError && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>
              {assembleError}
            </div>
          )}

          <button
            type="button"
            disabled={assembling}
            onClick={() =>
              onAssemble({
                musicTrackName: musicTrack?.name,
                beatSyncEnabled: !!(musicTrack && beatSyncEnabled)
              })
            }
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              background: assembling
                ? 'rgba(14,165,233,0.3)'
                : 'linear-gradient(135deg, #0ea5e9 0%, #082f49 100%)',
              color: assembling ? 'rgba(255,255,255,0.4)' : '#ffffff',
              fontWeight: 700,
              fontSize: 14,
              cursor: assembling ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s'
            }}
          >
            {assembling ? 'Building…' : 'Assemble Highlight Reel →'}
          </button>
        </div>
      )}
    </div>
  )
}
