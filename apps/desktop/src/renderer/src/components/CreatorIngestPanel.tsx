import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset, CreatorClipRole } from '@storyteller/shared'
import { CREATOR_CLIP_ROLES } from '@storyteller/shared'
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

const ROLE_COLORS: Record<CreatorClipRole, { bg: string; border: string; text: string }> = {
  hook:        { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.45)',  text: '#fcd34d' },
  hero:        { bg: 'rgba(234,179,8,0.12)',   border: 'rgba(234,179,8,0.45)',   text: '#fde68a' },
  broll:       { bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.45)', text: '#c4b5fd' },
  testimonial: { bg: 'rgba(20,184,166,0.12)',  border: 'rgba(20,184,166,0.45)',  text: '#5eead4' },
  recap:       { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.45)',  text: '#fdba74' },
  transition:  { bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.35)',  text: '#93c5fd' },
  unassigned:  { bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.25)', text: '#a1a1aa' }
}

// ─── CreatorClipCard ──────────────────────────────────────────────────────────

function CreatorClipCard({
  asset,
  onRoleChange
}: {
  asset: Asset
  onRoleChange: (assetId: string, role: CreatorClipRole) => void
}) {
  const role: CreatorClipRole = asset.creator_clip_role ?? 'unassigned'
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
          {asset.probe_status === 'success' ? '' : ` · probe ${asset.probe_status}`}
        </div>
      </div>

      {/* Role selector */}
      <select
        value={role}
        onChange={(e) => onRoleChange(asset.id, e.target.value as CreatorClipRole)}
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
          minWidth: 130
        }}
      >
        {CREATOR_CLIP_ROLES.map((r) => (
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
  const counts: Partial<Record<CreatorClipRole, number>> = {}
  for (const a of assets) {
    const r = a.creator_clip_role ?? 'unassigned'
    counts[r] = (counts[r] ?? 0) + 1
  }
  const entries = (Object.entries(counts) as [CreatorClipRole, number][]).filter(([, n]) => n > 0)
  if (entries.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
      {entries.map(([role, count]) => {
        const colors = ROLE_COLORS[role]
        const label = CREATOR_CLIP_ROLES.find((r) => r.id === role)?.label ?? role
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
        border: '1px solid rgba(245,158,11,0.3)',
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
                ? 'linear-gradient(135deg, rgba(245,158,11,0.25) 0%, rgba(217,119,6,0.2) 100%)'
                : 'transparent',
              color: active ? '#fcd34d' : '#71717a',
              transition: 'all 0.15s'
            }}
          >
            {fmt === 'short' ? '⚡ Short Form' : '🎬 Long Form'}
            <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2, opacity: 0.75 }}>
              {fmt === 'short' ? '≤ 90 s' : 'Full length'}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── CreatorIngestPanel ───────────────────────────────────────────────────────

export function CreatorIngestPanel(props: {
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
    targetFormat,
    onFormatChange,
    onUploaded,
    onAssemble
  } = props

  const updateAssetCreatorClipRole = useLocalAssetsStore((s) => s.updateAssetCreatorClipRole)

  const mediaAssets = assets.filter(
    (a) => a.asset_type === 'video' || a.asset_type === 'audio'
  )

  const unassignedCount = mediaAssets.filter(
    (a) => !a.creator_clip_role || a.creator_clip_role === 'unassigned'
  ).length

  const canAssemble = mediaAssets.length > 0

  async function handleRoleChange(assetId: string, role: CreatorClipRole) {
    updateAssetCreatorClipRole(projectId, assetId, role)

    if (supabase) {
      const { error } = await supabase
        .from('assets')
        .update({ creator_clip_role: role })
        .eq('id', assetId)
      if (error) {
        console.warn('[CreatorIngestPanel] creator_clip_role update failed:', error.message)
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
        projectMode="creator"
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
            Tag your clips
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
              border: '1px dashed rgba(245,158,11,0.25)',
              color: '#a1a1aa',
              fontSize: 13,
              textAlign: 'center'
            }}
          >
            Drop in your footage above — hook clips, hero content, B-roll, and your recap.
          </div>
        )}

        {mediaAssets.length > 0 && (
          <>
            <RoleSummaryBar assets={mediaAssets} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mediaAssets.map((a) => (
                <CreatorClipCard key={a.id} asset={a} onRoleChange={handleRoleChange} />
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
              <span style={{ color: ROLE_COLORS.hook.text }}>Hook</span> — attention-grabbing opener &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.hero.text }}>Hero</span> — your main on-camera delivery &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.broll.text }}>B-Roll</span> — coverage &amp; cutaways &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.testimonial.text }}>Testimonial</span> — another person on camera &nbsp;·&nbsp;{' '}
              <span style={{ color: ROLE_COLORS.recap.text }}>Recap</span> — outro or CTA
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
            background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(217,119,6,0.05) 100%)',
            border: '1px solid rgba(245,158,11,0.3)'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f4f4f5', marginBottom: 4 }}>
            Assemble Creator Cut
          </div>
          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>
            Storyteller AI will scan your footage, build a {targetFormat === 'short' ? 'punchy short-form' : 'full long-form'} cut —
            hook first, then your hero content, and recap at the end. B-roll prompts and overlay
            suggestions will be generated automatically in the next steps.
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
            onClick={onAssemble}
            style={{
              padding: '12px 28px',
              borderRadius: 10,
              border: 'none',
              background: assembling
                ? 'rgba(245,158,11,0.3)'
                : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: assembling ? 'rgba(30,20,0,0.5)' : '#1a1000',
              fontWeight: 700,
              fontSize: 14,
              cursor: assembling ? 'not-allowed' : 'pointer',
              transition: 'opacity 0.15s'
            }}
          >
            {assembling ? 'Building…' : 'Assemble Creator Cut →'}
          </button>
        </div>
      )}
    </div>
  )
}
