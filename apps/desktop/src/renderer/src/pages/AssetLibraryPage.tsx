import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Asset, AssetType } from '@storyteller/shared'
import { CREATOR_CLIP_ROLES, JOURNALISM_CLIP_ROLES } from '@storyteller/shared'
import storytellerLogo from '@renderer/assets/storyteller-logo.png'
import {
  ASSET_LIBRARY_DRAG_MIME,
  assetDragPayload,
  useAssetLibrary,
  type AssetWithProject
} from '@renderer/hooks/useAssetLibrary'
import { assetThumbnailUrl } from '@renderer/lib/thumbnail-backfill'

const ASSET_TYPES: Array<{ id: AssetType | 'all'; label: string }> = [
  { id: 'all', label: 'All types' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'photo', label: 'Photo' },
  { id: 'image', label: 'Image' }
]

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const t = new Date(iso)
  if (!Number.isFinite(t.getTime())) return ''
  return t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function roleLabel(asset: Asset): string {
  if (asset.clip_role && asset.clip_role !== 'unassigned') {
    return JOURNALISM_CLIP_ROLES.find((r) => r.id === asset.clip_role)?.label ?? asset.clip_role
  }
  if (asset.creator_clip_role && asset.creator_clip_role !== 'unassigned') {
    return CREATOR_CLIP_ROLES.find((r) => r.id === asset.creator_clip_role)?.label ?? asset.creator_clip_role
  }
  return 'Unassigned'
}

function placeholderIcon(asset: Asset): string {
  if (asset.asset_type === 'audio') return '🎵'
  if (asset.asset_type === 'video') return '🎬'
  return '🖼'
}

function AssetThumbnail({
  asset,
  style
}: {
  asset: Asset
  style: CSSProperties
}) {
  const thumb = assetThumbnailUrl(asset)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [asset.id, asset.proxy_path, asset.local_path])

  if (asset.asset_type === 'audio' || !thumb || failed) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, opacity: 0.5 }}>
        {placeholderIcon(asset)}
      </div>
    )
  }

  return (
    <img
      src={thumb}
      alt=""
      style={style}
      onError={() => setFailed(true)}
    />
  )
}

function AssetCard({
  asset,
  selected,
  onSelect
}: {
  asset: AssetWithProject
  selected: boolean
  onSelect: () => void
}) {
  const canDrag = Boolean(asset.local_path?.trim())

  return (
    <button
      type="button"
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return
        e.dataTransfer.setData(ASSET_LIBRARY_DRAG_MIME, assetDragPayload(asset))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onSelect}
      style={{
        ...cardStyle,
        borderColor: selected ? 'rgba(129,140,248,0.75)' : 'rgba(255,255,255,0.08)',
        boxShadow: selected ? '0 0 0 1px rgba(129,140,248,0.35)' : 'none'
      }}
    >
      <div style={thumbWrap}>
        <AssetThumbnail asset={asset} style={thumbImg} />
      </div>
      <div style={cardBody}>
        <div style={cardTitle}>{asset.original_filename ?? 'Untitled asset'}</div>
        <div style={cardMeta}>
          {asset.project?.title ?? 'Unknown project'} · {formatDuration(asset.duration_seconds)}
        </div>
        <div style={rolePill}>{roleLabel(asset)}</div>
      </div>
    </button>
  )
}

export function AssetLibraryPage() {
  const [assetType, setAssetType] = useState<AssetType | 'all'>('all')
  const [projectId, setProjectId] = useState<string | 'all'>('all')
  const [role, setRole] = useState<string | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({ assetType, projectId, role, search: search.trim() || undefined }),
    [assetType, projectId, role, search]
  )

  const { assets, projectOptions, loading, error, refresh } = useAssetLibrary(filters)
  const selected = assets.find((a) => a.id === selectedId) ?? null

  const roleOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const a of assets) {
      if (a.clip_role && a.clip_role !== 'unassigned') ids.add(a.clip_role)
      if (a.creator_clip_role && a.creator_clip_role !== 'unassigned') ids.add(a.creator_clip_role)
    }
    return [...ids]
  }, [assets])

  return (
    <div style={page}>
      <header style={topBar}>
        <Link to="/projects" style={logoLink}>
          <img src={storytellerLogo} alt="Storyteller" style={{ height: 48, display: 'block' }} />
        </Link>
        <h1 style={pageTitle}>Asset Library</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/projects" style={navBtn}>
            Projects
          </Link>
          <Link to="/" style={navBtnPrimary}>
            New Story
          </Link>
        </div>
      </header>

      <div style={layout}>
        <aside style={filterBar}>
          <label style={filterLabel}>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filename or project…"
              style={filterInput}
            />
          </label>
          <label style={filterLabel}>
            Type
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value as AssetType | 'all')}
              style={filterInput}
            >
              {ASSET_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label style={filterLabel}>
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={filterInput}
            >
              <option value="all">All projects</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label style={filterLabel}>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} style={filterInput}>
              <option value="all">All roles</option>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void refresh()} style={refreshBtn}>
            Refresh
          </button>
          <p style={hint}>
            Drag assets with a local file onto a project timeline (B-roll track).
          </p>
        </aside>

        <main style={mainArea}>
          {loading && <p style={statusText}>Loading assets…</p>}
          {error && <p style={{ ...statusText, color: '#f87171' }}>{error}</p>}
          {!loading && assets.length === 0 && (
            <div style={emptyState}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
              <div style={{ fontWeight: 600, color: '#e5e7eb' }}>No assets yet</div>
              <p style={{ color: '#9ca3af', fontSize: 14 }}>
                Import media into a project to see it here.
              </p>
            </div>
          )}
          <div style={grid}>
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selectedId === asset.id}
                onSelect={() => setSelectedId(asset.id)}
              />
            ))}
          </div>
        </main>

        {selected && (
          <aside style={detailSidebar}>
            <h2 style={detailTitle}>Asset details</h2>
            {selected.asset_type !== 'audio' && (
              <AssetThumbnail asset={selected} style={detailThumb} />
            )}
            <dl style={detailList}>
              <dt>Filename</dt>
              <dd>{selected.original_filename ?? '—'}</dd>
              <dt>Project</dt>
              <dd>
                <Link to={`/project/${selected.project_id}`} style={detailLink}>
                  {selected.project?.title ?? selected.project_id.slice(0, 8)}
                </Link>
              </dd>
              <dt>Type</dt>
              <dd>{selected.asset_type}</dd>
              <dt>Role</dt>
              <dd>{roleLabel(selected)}</dd>
              <dt>Duration</dt>
              <dd>{formatDuration(selected.duration_seconds)}</dd>
              <dt>Resolution</dt>
              <dd>
                {selected.width && selected.height
                  ? `${selected.width}×${selected.height}`
                  : '—'}
              </dd>
              <dt>Local path</dt>
              <dd style={pathValue}>{selected.local_path ?? 'Not on this device'}</dd>
              <dt>Imported</dt>
              <dd>{formatDate(selected.created_at)}</dd>
            </dl>
            {selected.local_path && window.storyteller?.revealInFolder && (
              <button
                type="button"
                style={revealBtn}
                onClick={() => void window.storyteller?.revealInFolder?.(selected.local_path!)}
              >
                Reveal in Finder
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

const page: CSSProperties = {
  height: '100%',
  background: '#0a0a0f',
  color: '#e5e7eb',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}

const topBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  padding: '16px 32px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: '#0f1014',
  flexShrink: 0
}

const logoLink: CSSProperties = { textDecoration: 'none' }

const pageTitle: CSSProperties = {
  flex: 1,
  margin: 0,
  fontSize: 20,
  fontWeight: 600
}

const navBtn: CSSProperties = {
  color: '#a1a1aa',
  textDecoration: 'none',
  fontSize: 14,
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)'
}

const navBtnPrimary: CSSProperties = {
  ...navBtn,
  color: '#fff',
  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
  border: 'none'
}

const layout: CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '240px 1fr 300px',
  minHeight: 0
}

const filterBar: CSSProperties = {
  padding: 20,
  borderRight: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minHeight: 0,
  overflowY: 'auto'
}

const filterLabel: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  color: '#a1a1aa',
  fontWeight: 500
}

const filterInput: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#141416',
  color: '#e5e7eb',
  fontSize: 13
}

const refreshBtn: CSSProperties = {
  marginTop: 8,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#141416',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 13
}

const hint: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 11,
  color: '#71717a',
  lineHeight: 1.45
}

const mainArea: CSSProperties = {
  padding: 24,
  minHeight: 0,
  overflow: 'auto'
}

const statusText: CSSProperties = { color: '#a1a1aa', fontSize: 14 }

const emptyState: CSSProperties = {
  textAlign: 'center',
  padding: '80px 24px'
}

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 16
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  textAlign: 'left',
  padding: 0,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#141416',
  overflow: 'hidden',
  cursor: 'grab'
}

const thumbWrap: CSSProperties = {
  aspectRatio: '16 / 9',
  background: '#0a0a0f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const thumbImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover'
}

const cardBody: CSSProperties = {
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4
}

const cardTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e5e7eb',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const cardMeta: CSSProperties = {
  fontSize: 11,
  color: '#71717a'
}

const rolePill: CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(99,102,241,0.15)',
  color: '#a5b4fc'
}

const detailSidebar: CSSProperties = {
  padding: 20,
  borderLeft: '1px solid rgba(255,255,255,0.08)',
  minHeight: 0,
  overflow: 'auto'
}

const detailTitle: CSSProperties = {
  margin: '0 0 16px',
  fontSize: 16,
  fontWeight: 600
}

const detailThumb: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  marginBottom: 16,
  aspectRatio: '16 / 9',
  objectFit: 'cover',
  background: '#0a0a0f'
}

const detailList: CSSProperties = {
  margin: 0,
  fontSize: 13,
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: '8px 12px'
}

const pathValue: CSSProperties = {
  wordBreak: 'break-all',
  fontSize: 11,
  color: '#a1a1aa'
}

const detailLink: CSSProperties = {
  color: '#818cf8',
  textDecoration: 'none'
}

const revealBtn: CSSProperties = {
  marginTop: 16,
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: '#141416',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 13
}
