import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { StoryMode } from '@storyteller/shared'
import { intentToMode } from '@storyteller/shared'
import type { StoryIntent, PrimaryGoal } from '@storyteller/shared'
import { useProjectWorkflow } from '@renderer/stores/project-workflow'
import { IntroSplashScreen } from '@renderer/components/IntroSplashScreen'
import storytellerLogo from '@renderer/assets/storyteller-logo.png'
import brandIntroImg from '@renderer/assets/cards/brand-intro.png'
import musicVideoImg from '@renderer/assets/cards/music-video.png'
import commercialAdImg from '@renderer/assets/cards/commercial-ad.png'
import podcastInterviewImg from '@renderer/assets/cards/podcast-interview.png'
import newsPackageImg from '@renderer/assets/cards/news-package.png'
import documentaryImg from '@renderer/assets/cards/documentary.png'
import socialReelImg from '@renderer/assets/cards/social-reel.png'
import eventHighlightImg from '@renderer/assets/cards/event-highlight.png'
import brandStoryImg from '@renderer/assets/cards/brand-story.png'

// ─── Story type definitions ───────────────────────────────────────────────────

interface StoryType {
  intent: StoryIntent
  title: string
  description: string
  gradient: string
  cardImage: string
  icon: string
  mode: StoryMode
}

const STORY_TYPES: StoryType[] = [
  {
    intent: 'brand_intro',
    title: 'Brand Intro / Show Open',
    description: 'Create opening sequences, YouTube intros, podcast opens, and branded title animations.',
    gradient: 'linear-gradient(135deg, rgba(55,48,163,0.85) 0%, rgba(30,27,75,0.6) 100%)',
    cardImage: brandIntroImg,
    icon: '🎬',
    mode: 'story',
  },
  {
    intent: 'music_video',
    title: 'Music Video',
    description: 'Turn songs, performances, and lyrics into a complete music video with AI-assisted visuals and editing.',
    gradient: 'linear-gradient(135deg, rgba(124,58,237,0.85) 0%, rgba(76,29,149,0.6) 100%)',
    cardImage: musicVideoImg,
    icon: '🎵',
    mode: 'music_video',
  },
  {
    intent: 'commercial',
    title: 'Commercial or Ad',
    description: 'Create ads for businesses, products, services, and social campaigns.',
    gradient: 'linear-gradient(135deg, rgba(180,83,9,0.85) 0%, rgba(120,53,15,0.6) 100%)',
    cardImage: commercialAdImg,
    icon: '📢',
    mode: 'commercial',
  },
  {
    intent: 'podcast',
    title: 'Podcast / Interview',
    description: 'Edit interviews, podcasts, talking-head videos, and conversations into polished episodes.',
    gradient: 'linear-gradient(135deg, rgba(109,40,217,0.85) 0%, rgba(46,16,101,0.6) 100%)',
    cardImage: podcastInterviewImg,
    icon: '🎙',
    mode: 'story',
  },
  {
    intent: 'news_package',
    title: 'News Package',
    description: 'Build broadcast-style news stories with sound bites, B-roll, lower thirds, and narration.',
    gradient: 'linear-gradient(135deg, rgba(29,78,216,0.85) 0%, rgba(30,58,138,0.6) 100%)',
    cardImage: newsPackageImg,
    icon: '📰',
    mode: 'journalism',
  },
  {
    intent: 'documentary',
    title: 'Documentary',
    description: 'Craft long-form stories using interviews, archival footage, narration, and cinematic B-roll.',
    gradient: 'linear-gradient(135deg, rgba(15,118,110,0.85) 0%, rgba(19,78,74,0.6) 100%)',
    cardImage: documentaryImg,
    icon: '🎥',
    mode: 'documentary',
  },
  {
    intent: 'social_reel',
    title: 'Social Reel / Creator Content',
    description: 'Create Shorts, Reels, TikToks, clips, highlights, and creator-first content.',
    gradient: 'linear-gradient(135deg, rgba(217,119,6,0.85) 0%, rgba(146,64,14,0.6) 100%)',
    cardImage: socialReelImg,
    icon: '⚡',
    mode: 'creator',
  },
  {
    intent: 'event_highlight',
    title: 'Event Highlight',
    description: 'Turn conferences, graduations, sports, concerts, and community events into recap videos.',
    gradient: 'linear-gradient(135deg, rgba(180,83,9,0.85) 0%, rgba(69,26,3,0.6) 100%)',
    cardImage: eventHighlightImg,
    icon: '🏆',
    mode: 'creator',
  },
  {
    intent: 'brand_story',
    title: 'Brand Story / Corporate',
    description: 'Create company stories, recruitment videos, testimonials, case studies, and internal communications.',
    gradient: 'linear-gradient(135deg, rgba(3,105,161,0.85) 0%, rgba(12,74,110,0.6) 100%)',
    cardImage: brandStoryImg,
    icon: '🏢',
    mode: 'story',
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectSetupPage() {
  const navigate = useNavigate()
  const loc = useLocation()
  const params = useParams()
  const isNew = loc.pathname === '/' || loc.pathname === '/project/new'
  const projectId = params.projectId
  const projects = useProjectWorkflow((s) => s.projects)
  const createLocalProject = useProjectWorkflow((s) => s.createLocalProject)
  const updateProject = useProjectWorkflow((s) => s.updateProject)

  const [showIntro, setShowIntro] = useState(() => {
    return isNew && !localStorage.getItem('storyteller_intro_seen_v3')
  })

  if (showIntro) {
    return (
      <IntroSplashScreen
        onComplete={() => {
          localStorage.setItem('storyteller_intro_seen_v3', '1')
          setShowIntro(false)
        }}
        onErrorDismiss={() => setShowIntro(false)}
      />
    )
  }

  const existing = useMemo(
    () => (!isNew && projectId ? projects.find((p) => p.id === projectId) : undefined),
    [isNew, projectId, projects]
  )

  const stateIntent = (loc.state as { intent?: StoryIntent; mode?: StoryMode } | null)?.intent

  const [title, setTitle] = useState('Untitled story')
  const [selectedIntent, setSelectedIntent] = useState<StoryIntent>(stateIntent ?? existing?.intent ?? 'brand_intro')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>(existing?.aspectRatio ?? '16:9')
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal>(existing?.primaryGoal ?? 'fast_social')
  const [hoveredIntent, setHoveredIntent] = useState<StoryIntent | null>(null)

  useEffect(() => {
    if (!existing) return
    setTitle(existing.title)
    setSelectedIntent(existing.intent ?? 'brand_intro')
    setAspectRatio(existing.aspectRatio ?? '16:9')
    setPrimaryGoal(existing.primaryGoal ?? 'fast_social')
  }, [existing?.id])

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const mode = intentToMode(selectedIntent)
      if (isNew) {
        const id = createLocalProject(title, mode)
        updateProject(id, { intent: selectedIntent, primaryGoal, aspectRatio })
        navigate(`/project/${id}`)
        return
      }
      if (projectId) {
        updateProject(projectId, { title, mode, intent: selectedIntent, primaryGoal, aspectRatio })
        navigate(`/project/${projectId}`)
      }
    },
    [createLocalProject, isNew, selectedIntent, navigate, projectId, primaryGoal, aspectRatio, title, updateProject]
  )

  if (!isNew && projectId && !existing) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', padding: 40, background: '#0a0a0f' }}>
        <div>
          <h1 style={{ fontSize: 20, color: '#fff' }}>Project not found</h1>
          <p style={{ color: '#6b7280', marginTop: 8 }}>This project may have been removed or the link is invalid.</p>
          <Link
            to="/"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#e5e7eb',
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={pageWrap}>
      {/* Top bar */}
      <header style={topBar}>
        <img src={storytellerLogo} alt="Storyteller" style={{ height: 72, display: 'block' }} />
        <Link to="/projects" style={myProjectsBtn}>
          📁 My Projects
        </Link>
      </header>

      {/* Body: left + right flex row */}
      <div style={bodyWrap}>
        {/* ── Left: intent picker ── */}
        <div style={leftCol}>
          <h1 style={mainHeading}>What's Your Story?</h1>
          <p style={mainSubtitle}>
            Pick what you're creating today. Storyteller will automatically set up the right workflow, timeline, and AI
            tools.
          </p>

          {/* 3×3 grid */}
          <div style={cardGrid}>
            {STORY_TYPES.map((type) => {
              const isSelected = selectedIntent === type.intent
              const isHovered = hoveredIntent === type.intent
              return (
                <button
                  key={type.intent}
                  type="button"
                  onClick={() => setSelectedIntent(type.intent)}
                  onMouseEnter={() => setHoveredIntent(type.intent)}
                  onMouseLeave={() => setHoveredIntent(null)}
                  style={storyCard(type.gradient, type.cardImage, isSelected, isHovered)}
                >
                  {/* Icon */}
                  <div style={cardIconWrap}>
                    <span style={{ fontSize: 16 }}>{type.icon}</span>
                  </div>

                  {/* Selected checkmark */}
                  {isSelected && (
                    <div style={checkBadge}>✓</div>
                  )}

                  {/* Text */}
                  <div style={cardTitle}>{type.title}</div>
                  <div style={cardDesc}>{type.description}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Right: Create panel (sticky sidebar) ── */}
        <aside style={rightPanel}>
          <form onSubmit={onSubmit} style={panelInner}>
            {/* Panel header */}
            <div style={panelHeader}>
              <span style={{ color: '#818cf8' }}>✦</span> Create Your Project
            </div>

            {/* Project Name */}
            <label style={fieldLabel}>Project Name</label>
            <input
              style={fieldInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your project a name..."
              required
            />

            {/* Story Type dropdown */}
            <label style={fieldLabel}>Story Type</label>
            <select
              style={fieldSelect}
              value={selectedIntent}
              onChange={(e) => setSelectedIntent(e.target.value as StoryIntent)}
            >
              {STORY_TYPES.map((t) => (
                <option key={t.intent} value={t.intent}>
                  {t.icon} {t.title}
                </option>
              ))}
            </select>

            {/* Aspect Ratio */}
            <label style={fieldLabel}>Aspect Ratio</label>
            <div style={toggleGroup}>
              {(['16:9', '9:16', '1:1'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAspectRatio(r)}
                  style={toggleBtn(aspectRatio === r)}
                >
                  {r === '16:9' ? '16:9 Landscape' : r === '9:16' ? '9:16 Vertical' : '1:1 Square'}
                </button>
              ))}
            </div>

            {/* Primary Goal */}
            <label style={{ ...fieldLabel, marginTop: 18 }}>Primary Goal</label>
            <div style={goalGroup}>
              <button
                type="button"
                onClick={() => setPrimaryGoal('fast_social')}
                style={goalOption(primaryGoal === 'fast_social')}
              >
                <span style={goalIcon}>✦</span>
                <div>
                  <div style={goalTitle}>Fast Social Content</div>
                  <div style={goalDesc}>Quick turnaround for social platforms and engagement.</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPrimaryGoal('professional')}
                style={goalOption(primaryGoal === 'professional')}
              >
                <span style={goalIcon}>☆</span>
                <div>
                  <div style={goalTitle}>Professional Production</div>
                  <div style={goalDesc}>High-quality videos for clients, brands, and professional use.</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPrimaryGoal('broadcast')}
                style={goalOption(primaryGoal === 'broadcast')}
              >
                <span style={goalIcon}>👑</span>
                <div>
                  <div style={goalTitle}>Broadcast Quality</div>
                  <div style={goalDesc}>Maximum production value for TV and wide audiences.</div>
                </div>
              </button>
            </div>

            {/* Submit */}
            <button type="submit" style={createBtn}>
              ✦ {isNew ? 'Create Story' : 'Save Story'}
            </button>

            {/* Footer hint */}
            <p style={panelFooter}>
              Storyteller will pre-configure your project with the best settings, AI tools, and workflow for your story.
            </p>
          </form>
        </aside>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0a0a0f',
  display: 'flex',
  flexDirection: 'column',
  color: '#e5e7eb',
}

const topBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 32px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  background: 'transparent',
  position: 'sticky',
  top: 0,
  zIndex: 10,
}

const myProjectsBtn: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#e5e7eb',
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
  transition: 'all 0.15s ease',
}

const bodyWrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  flex: 1,
  minHeight: 0,
}

const leftCol: React.CSSProperties = {
  flex: 1,
  padding: '32px 40px',
  overflowY: 'auto',
}

const mainHeading: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 36,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#fff',
}

const mainSubtitle: React.CSSProperties = {
  margin: '0 0 32px',
  fontSize: 15,
  color: '#9ca3af',
  lineHeight: 1.6,
  maxWidth: 620,
}

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
}

function storyCard(gradient: string, cardImage: string, selected: boolean, hovered: boolean): React.CSSProperties {
  return {
    position: 'relative',
    height: 200,
    borderRadius: 14,
    background: `${gradient}, url(${cardImage}) center/cover no-repeat`,
    border: selected
      ? '2px solid #6366f1'
      : '2px solid transparent',
    boxShadow: selected
      ? '0 0 0 1px rgba(99,102,241,0.4), 0 4px 20px rgba(99,102,241,0.2)'
      : 'none',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
    filter: hovered && !selected ? 'brightness(1.1)' : 'none',
    overflow: 'hidden',
  }
}

const cardIconWrap: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 10,
  flexShrink: 0,
}

const checkBadge: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  width: 22,
  height: 22,
  borderRadius: '50%',
  background: '#6366f1',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 700,
}

const cardTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 20,
  color: '#fff',
  marginBottom: 6,
  lineHeight: 1.3,
}

const cardDesc: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.75)',
  lineHeight: 1.5,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
}

const rightPanel: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
  borderLeft: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(13,13,20,0.97)',
  position: 'sticky',
  top: 0,
  height: '100vh',
  overflowY: 'auto',
}

const panelInner: React.CSSProperties = {
  padding: '28px 24px',
  display: 'flex',
  flexDirection: 'column',
}

const panelHeader: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#e5e7eb',
  marginBottom: 24,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#e5e7eb',
  fontSize: 14,
  marginBottom: 18,
  outline: 'none',
  boxSizing: 'border-box',
}

const fieldSelect: React.CSSProperties = {
  ...fieldInput,
  cursor: 'pointer',
  appearance: 'auto',
}

const toggleGroup: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 18,
}

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 4px',
    borderRadius: 8,
    border: active ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
    background: active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? '#818cf8' : '#9ca3af',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  }
}

const goalGroup: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 24,
}

function goalOption(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 10,
    border: active ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
  }
}

const goalIcon: React.CSSProperties = {
  fontSize: 16,
  flexShrink: 0,
  marginTop: 1,
}

const goalTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e5e7eb',
  marginBottom: 2,
}

const goalDesc: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  lineHeight: 1.4,
}

const createBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  letterSpacing: '0.01em',
  boxShadow: '0 4px 14px rgba(79,70,229,0.35)',
  transition: 'all 0.15s ease',
  marginBottom: 12,
}

const panelFooter: React.CSSProperties = {
  fontSize: 11,
  color: '#4b5563',
  textAlign: 'center',
  lineHeight: 1.5,
  margin: '0 0 20px',
}
