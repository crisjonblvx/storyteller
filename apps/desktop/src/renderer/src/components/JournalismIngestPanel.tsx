import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, JournalismClipRole } from '@storyteller/shared'
import { JOURNALISM_CLIP_ROLES } from '@storyteller/shared'
import { AssetUploadZone } from '@renderer/components/AssetUploadZone'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'

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

const ROLE_COLORS: Record<JournalismClipRole, { bg: string; border: string; text: string }> = {
  sot:        { bg: 'rgba(99,179,237,0.12)',  border: 'rgba(99,179,237,0.45)',  text: '#90cdf4' },
  standup:    { bg: 'rgba(110,231,197,0.12)', border: 'rgba(110,231,197,0.45)', text: '#6ee7c5' },
  broll:      { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.45)', text: '#c4b5fd' },
  voiceover:  { bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.45)',  text: '#fcd34d' },
  'nat-sound':{ bg: 'rgba(134,239,172,0.10)', border: 'rgba(134,239,172,0.35)', text: '#86efac' },
  anchor:     { bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.35)',  text: '#fdba74' },
  unassigned: { bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.25)', text: '#a1a1aa' }
}

// ─── ClipRoleCard ─────────────────────────────────────────────────────────────

function ClipRoleCard({
  asset,
  onRoleChange
}: {
  asset: Asset
  onRoleChange: (assetId: string, role: JournalismClipRole) => void
}) {
  const role: JournalismClipRole = asset.clip_role ?? 'unassigned'
  const colors = ROLE_COLORS[role]

  const typeIcon =
    asset.asset_type === 'audio' ? '🎙' :
    asset.asset_type === 'photo' || asset.asset_type === 'image' ? '🖼' : '🎬'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        borderRadius: 10,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        transition: 'border-color 0.15s'
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
          {asset.probe_status === 'success'
            ? ''
            : ` · probe ${asset.probe_status}`}
        </div>
      </div>

      {/* Role selector */}
      <select
        value={role}
        onChange={(e) => onRoleChange(asset.id, e.target.value as JournalismClipRole)}
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
          minWidth: 120
        }}
      >
        {JOURNALISM_CLIP_ROLES.map((r) => (
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
  const counts: Partial<Record<JournalismClipRole, number>> = {}
  for (const a of assets) {
    const r = a.clip_role ?? 'unassigned'
    counts[r] = (counts[r] ?? 0) + 1
  }
  const entries = (Object.entries(counts) as [JournalismClipRole, number][]).filter(([, n]) => n > 0)
  if (entries.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      {entries.map(([role, count]) => {
        const colors = ROLE_COLORS[role]
        const label = JOURNALISM_CLIP_ROLES.find((r) => r.id === role)?.label ?? role
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

// ─── JournalismIngestPanel ────────────────────────────────────────────────────

export function JournalismIngestPanel(props: {
  projectId: string
  projectTitle: string
  assets: Asset[]
  assetsLoading: boolean
  assetsError: string | null
  supabase: SupabaseClient | null
  userId?: string
  assembling: boolean
  assembleError: string | null
  onUploaded: () => void
  onAssemble: () => void
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
    onUploaded,
    onAssemble
  } = props

  const updateAssetClipRole = useLocalAssetsStore((s) => s.updateAssetClipRole)

  const mediaAssets = assets.filter(
    (a) => a.asset_type === 'video' || a.asset_type === 'audio'
  )

  const unassignedCount = mediaAssets.filter(
    (a) => !a.clip_role || a.clip_role === 'unassigned'
  ).length

  const canAssemble = mediaAssets.length > 0

  async function handleRoleChange(assetId: string, role: JournalismClipRole) {
    // Optimistic local update
    updateAssetClipRole(projectId, assetId, role)

    // Best-effort cloud sync (ignore schema-drift errors gracefully)
    if (supabase) {
      const { error } = await supabase
        .from('assets')
        .update({ clip_role: role })
        .eq('id', assetId)
      if (error) {
        console.warn('[JournalismIngestPanel] clip_role update failed:', error.message)
      }
    }
  }

  return (
    <div>
      {/* Upload zone */}
      <AssetUploadZone
        projectId={projectId}
        projectTitle={projectTitle}
        projectMode="journalism"
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
            Assign clip roles
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
              border: '1px dashed rgba(110,231,197,0.2)',
              color: '#a1a1aa',
              fontSize: 13,
              textAlign: 'center'
            }}
          >
            Import your footage above — interviews (SOT), standup, B-roll, and voiceover.
          </div>
        )}

        {mediaAssets.length > 0 && (
          <>
            <RoleSummaryBar assets={mediaAssets} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mediaAssets.map((a) => (
                <ClipRoleCard key={a.id} asset={a} onRoleChange={handleRoleChange} />
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
              <span style={{ color: ROLE_COLORS.sot.text }}>SOT</span> — interview on camera &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.standup.text }}>Standup</span> — reporter on camera &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.broll.text }}>B-Roll</span> — coverage footage &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.voiceover.text }}>Voiceover</span> — reporter narration &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS['nat-sound'].text }}>Nat Sound</span> — ambient audio
            </div>
          </>
        )}
      </div>

      {/* Assemble CTA */}
      {canAssemble && (
        <div
          style={{
            marginTop: 28,
            padding: '20px 24px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(110,231,197,0.08) 0%, rgba(99,179,237,0.05) 100%)',
            border: '1px solid rgba(110,231,197,0.3)'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f4f4f5', marginBottom: 4 }}>
            Assemble News Package
          </div>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>
            Storyteller will build a rough cut in broadcast order — standup open, SOTs,
            B-roll coverage, and voiceover. You can refine on the timeline.
          </div>

          {unassignedCount > 0 && (
            <div
              style={{
                fontSize: 12,
                color: '#fcd34d',
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
                Assign roles above for the best result.
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
            onClick={onAssemble}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              background: assembling
                ? 'rgba(110,231,197,0.3)'
                : 'linear-gradient(135deg, #6ee7c5 0%, #4fd1a8 100%)',
              color: assembling ? 'rgba(6,18,16,0.5)' : '#061210',
              fontWeight: 700,
              fontSize: 14,
              cursor: assembling ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s'
            }}
          >
            {assembling ? 'Assembling…' : 'Assemble Package →'}
          </button>
        </div>
      )}
    </div>
  )
}
