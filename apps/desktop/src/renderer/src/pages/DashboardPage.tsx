import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjectWorkflow, type LocalProject } from '@renderer/stores/project-workflow'
import storytellerLogo from '@renderer/assets/storyteller-logo.png'

// ─── Intent-aware display helpers ───────────────────────────────────────────

function gradientForProject(p: LocalProject): string {
  switch (p.intent) {
    case 'brand_intro': return 'linear-gradient(135deg, #3730a3 0%, #1e1b4b 100%)'
    case 'music_video': return 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)'
    case 'commercial': return 'linear-gradient(135deg, #b45309 0%, #78350f 100%)'
    case 'podcast': return 'linear-gradient(135deg, #6d28d9 0%, #2e1065 100%)'
    case 'news_package': return 'linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%)'
    case 'documentary': return 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)'
    case 'social_reel': return 'linear-gradient(135deg, #d97706 0%, #92400e 100%)'
    case 'event_highlight': return 'linear-gradient(135deg, #b45309 0%, #451a03 100%)'
    case 'brand_story': return 'linear-gradient(135deg, #0369a1 0%, #0c4a6e 100%)'
  }
  switch (p.mode) {
    case 'journalism': return 'linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%)'
    case 'creator': return 'linear-gradient(135deg, #d97706 0%, #92400e 100%)'
    case 'music_video': return 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)'
    case 'commercial': return 'linear-gradient(135deg, #b45309 0%, #78350f 100%)'
    case 'documentary': return 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)'
    default: return 'linear-gradient(135deg, #3730a3 0%, #1e1b4b 100%)'
  }
}

function iconForProject(p: LocalProject): string {
  switch (p.intent) {
    case 'brand_intro': return '🎬'
    case 'music_video': return '🎵'
    case 'commercial': return '📢'
    case 'podcast': return '🎙'
    case 'news_package': return '📰'
    case 'documentary': return '🎥'
    case 'social_reel': return '⚡'
    case 'event_highlight': return '🏆'
    case 'brand_story': return '🏢'
  }
  switch (p.mode) {
    case 'journalism': return '📰'
    case 'creator': return '⚡'
    case 'music_video': return '🎵'
    case 'commercial': return '📢'
    case 'documentary': return '🎥'
    default: return '🎬'
  }
}

function labelForProject(p: LocalProject): string {
  switch (p.intent) {
    case 'brand_intro': return 'Brand Intro / Show Open'
    case 'music_video': return 'Music Video'
    case 'commercial': return 'Commercial or Ad'
    case 'podcast': return 'Podcast / Interview'
    case 'news_package': return 'News Package'
    case 'documentary': return 'Documentary'
    case 'social_reel': return 'Social Reel / Creator'
    case 'event_highlight': return 'Event Highlight'
    case 'brand_story': return 'Brand Story / Corporate'
  }
  return p.mode
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function DashboardPage() {
  const navigate = useNavigate()
  const projects = useProjectWorkflow((s) => s.projects)
  const updateProject = useProjectWorkflow((s) => s.updateProject)
  const deleteProject = useProjectWorkflow((s) => s.deleteProject)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null
      const isEditing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
      if (isEditing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const recent = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const at = new Date(a.lastOpenedAt ?? a.updatedAt).getTime()
        const bt = new Date(b.lastOpenedAt ?? b.updatedAt).getTime()
        return bt - at
      }),
    [projects]
  )

  function startRename(p: LocalProject) {
    setRenamingId(p.id)
    setRenameValue(p.title)
  }

  function commitRename(p: LocalProject) {
    const next = renameValue.trim()
    if (next && next !== p.title) {
      updateProject(p.id, { title: next })
    }
    setRenamingId(null)
  }

  function confirmDelete(p: LocalProject) {
    const ok = window.confirm(`Delete "${p.title}"? This removes it from this device.`)
    if (ok) deleteProject(p.id)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={topBar}>
        <img src={storytellerLogo} alt="Storyteller" style={{ height: 56, display: 'block' }} />
        <h1 style={pageTitle}>My Projects</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Link to="/assets" style={libraryBtn}>
          Asset Library
        </Link>
        <Link to="/" style={newStoryBtn}>
          ✦ New Story
        </Link>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '40px 60px', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ marginTop: '8px', display: 'grid', gap: '12px' }}>
          {recent.length === 0 && (
            <div style={emptyCard}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎬</div>
              <div style={{ fontWeight: 600, fontSize: '18px', marginBottom: '8px', color: '#e5e7eb' }}>No projects yet</div>
              <div style={{ color: '#9ca3af', fontSize: '14px', marginBottom: '20px' }}>
                Create a project to start a guided story draft.
              </div>
              <Link to="/" style={emptyStateCta}>
                ✦ Start Your First Story
              </Link>
            </div>
          )}
          {recent.map((p) => (
            <div key={p.id} style={projectCard}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingId === p.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(p)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    style={renameInput}
                  />
                ) : (
                  <Link to={`/project/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '10px',
                          background: gradientForProject(p),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '20px',
                          flexShrink: 0,
                        }}
                      >
                        {iconForProject(p)}
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '16px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: '#e5e7eb',
                          }}
                        >
                          {p.title}
                        </div>
                        <div style={{ color: '#9ca3af', fontSize: '13px', marginTop: '2px' }}>
                          {labelForProject(p)} · {p.status.replace('_', ' ')} · {formatRelative(p.lastOpenedAt ?? p.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </Link>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button type="button" style={iconBtn} onClick={() => startRename(p)} title="Rename">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button type="button" style={iconBtnDanger} onClick={() => confirmDelete(p)} title="Delete">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <Link to={`/project/${p.id}`} style={openBadge}>
                  Open
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: '4px' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

// Styles

const topBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '16px 60px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(10,10,15,0.95)',
  position: 'sticky',
  top: 0,
  zIndex: 10,
  gap: 20,
}

const pageTitle: React.CSSProperties = {
  flex: 1,
  margin: 0,
  fontSize: '28px',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#e5e7eb',
}

const newStoryBtn: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
  transition: 'all 0.15s ease',
  flexShrink: 0,
}

const libraryBtn: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.04)',
  color: '#c4b5fd',
  fontWeight: 600,
  fontSize: '14px',
  textDecoration: 'none',
  border: '1px solid rgba(99,102,241,0.25)',
  flexShrink: 0,
}

const emptyCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px dashed rgba(255,255,255,0.1)',
  borderRadius: '16px',
  padding: '64px 48px',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

const emptyStateCta: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: '10px',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '14px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
}

const projectCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px',
  padding: '16px 20px',
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  transition: 'all 0.15s ease',
}

const iconBtn: React.CSSProperties = {
  padding: '8px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#9ca3af',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.15s ease',
}

const iconBtnDanger: React.CSSProperties = {
  ...iconBtn,
  color: '#f87171',
}

const openBadge: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  background: 'rgba(99,102,241,0.1)',
  color: '#818cf8',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'flex',
  alignItems: 'center',
  border: '1px solid rgba(99,102,241,0.25)',
  transition: 'all 0.15s ease',
}

const renameInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid #6366f1',
  background: 'rgba(255,255,255,0.05)',
  color: '#e5e7eb',
  fontSize: '16px',
  outline: 'none',
  fontWeight: 600,
}
