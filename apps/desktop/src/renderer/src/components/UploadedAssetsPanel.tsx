import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Asset } from '@storyteller/shared'
import { storageBadgeLabel } from '@storyteller/shared'
import { getSignedAssetUrl } from '@renderer/lib/storage-assets'

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
    a.storage_path?.split('/').pop() ??
    a.local_path?.split(/[/\\]/).pop() ??
    a.id
  )
}

function Thumb({ asset, supabase }: { asset: Asset; supabase: SupabaseClient | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    setVideoError(false)
    const isVideo = asset.asset_type === 'video'
    const isImage = asset.asset_type === 'photo' || asset.asset_type === 'image'

    if (isVideo && asset.local_path) {
      // Use the custom media:// scheme so Chromium can seek with Range support
      const mediaUrl = window.storyteller?.toMediaUrl?.(asset.local_path)
      if (mediaUrl) {
        setUrl(mediaUrl)
        return
      }
    }

    if (isImage && asset.local_path) {
      const mediaUrl = window.storyteller?.toMediaUrl?.(asset.local_path)
      if (mediaUrl) {
        setUrl(mediaUrl)
        return
      }
      // Fallback for non-Electron environments
      const p = asset.local_path.replace(/\\/g, '/')
      setUrl(p.startsWith('file:') ? p : `file://${p}`)
      return
    }

    if (!supabase || asset.upload_status !== 'complete' || !asset.storage_path) return
    const isMedia = isVideo || isImage
    if (!isMedia) return

    let cancelled = false
    void (async () => {
      const u = await getSignedAssetUrl(supabase, asset.storage_path)
      if (!cancelled) setUrl(u)
    })()
    return () => {
      cancelled = true
    }
  }, [asset, supabase])

  const thumbStyle: React.CSSProperties = {
    width: 52,
    height: 52,
    objectFit: 'cover',
    borderRadius: 8,
    border: '1px solid var(--border)',
    display: 'block'
  }

  if (url && asset.asset_type === 'video' && !videoError) {
    return (
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          // Seek 1s in for a more representative frame (avoids black openers)
          const v = e.target as HTMLVideoElement
          v.currentTime = Math.min(1, (v.duration || 0) * 0.05)
        }}
        onError={() => setVideoError(true)}
        style={thumbStyle}
      />
    )
  }

  if (url && (asset.asset_type === 'photo' || asset.asset_type === 'image')) {
    return <img src={url} alt="" style={thumbStyle} />
  }

  const label =
    asset.asset_type === 'video'
      ? 'VID'
      : asset.asset_type === 'audio'
        ? 'AUD'
        : asset.asset_type === 'photo' || asset.asset_type === 'image'
          ? 'IMG'
          : 'MED'

  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 8,
        border: '1px solid var(--border)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 11,
        color: 'var(--muted)',
        background: 'var(--bg-panel)'
      }}
    >
      {label}
    </div>
  )
}

const badgeStyle = (kind: 'Local' | 'Cloud' | 'Hybrid'): React.CSSProperties => ({
  fontSize: 10,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  padding: '4px 8px',
  borderRadius: 999,
  border:
    kind === 'Cloud'
      ? '1px solid rgba(120,160,255,0.45)'
      : kind === 'Hybrid'
        ? '1px solid rgba(200,180,120,0.45)'
        : '1px solid rgba(110,231,197,0.35)',
  color: kind === 'Cloud' ? 'rgba(160,190,255,0.95)' : kind === 'Hybrid' ? 'rgba(220,200,140,0.95)' : 'var(--accent)'
})

export function UploadedAssetsPanel(props: {
  assets: Asset[]
  loading: boolean
  error: string | null
  supabase: SupabaseClient | null
}) {
  const { assets, loading, error, supabase } = props

  function revealLocal(asset: Asset) {
    const p = asset.local_path
    if (!p || !window.storyteller?.revealInFolder) return
    void window.storyteller.revealInFolder(p)
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Project assets</h3>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{assets.length} file{assets.length === 1 ? '' : 's'}</span>
      </div>
      {loading && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading assets…</p>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {!loading && !assets.length && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          No files yet — import video, audio, or photos above (local-first; no cloud upload required).
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {assets.map((a) => {
          const meta = (a.metadata_json ?? {}) as { readyForTranscription?: boolean }
          const ready = Boolean(meta.readyForTranscription)
          const mode = storageBadgeLabel(a)
          return (
            <div
              key={a.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '52px 1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: 10,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)'
              }}
            >
              <Thumb asset={a} supabase={supabase} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayName(a)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {a.asset_type} · upload {a.upload_status} · probe {a.probe_status}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {a.width && a.height ? `${a.width}×${a.height}` : '—'} · {formatDuration(a.duration_seconds)} ·{' '}
                  {a.fps ? `${a.fps.toFixed(2)} fps` : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <span style={badgeStyle(mode)}>{mode}</span>
                {a.local_path && (
                  <button
                    type="button"
                    style={miniBtn}
                    onClick={() => revealLocal(a)}
                  >
                    Show in folder
                  </button>
                )}
                {ready && (
                  <span
                    style={{
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--accent)',
                      border: '1px solid rgba(110,231,197,0.35)',
                      padding: '4px 8px',
                      borderRadius: 999
                    }}
                  >
                    Ready for transcription
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  fontSize: 11,
  padding: '4px 8px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer'
}
