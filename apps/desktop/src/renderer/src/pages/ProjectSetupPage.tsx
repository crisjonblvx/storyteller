import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { StoryMode } from '@storyteller/shared'
import { intentToMode } from '@storyteller/shared'
import type { StoryIntent, PrimaryGoal, HighlightSettings } from '@storyteller/shared'
import { useProjectWorkflow } from '@renderer/stores/project-workflow'
import { useAppVersion } from '@renderer/hooks/useAppVersion'
import storytellerLogo from '@renderer/assets/storyteller-logo.png'
import brandIntroImg from '@renderer/assets/cards/brand-intro.png'
import musicVideoImg from '@renderer/assets/cards/music-video.png'
import commercialAdImg from '@renderer/assets/cards/commercial-ad.png'
import podcastInterviewImg from '@renderer/assets/cards/podcast-interview.png'
import newsPackageImg from '@renderer/assets/cards/news-package.png'
import documentaryImg from '@renderer/assets/cards/documentary.png'
import socialReelImg from '@renderer/assets/cards/social-reel.png'
import eventHighlightImg from '@renderer/assets/cards/event-highlight.png'
import sportsHighlightImg from '@renderer/assets/cards/sports-highlight.png'
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
    intent: 'sports_highlight',
    title: 'Sports Highlight Reel',
    description: 'Build your highlight reel. Drop in game footage, plays, and celebrations — Storyteller edits it to music, paced like the pros.',
    gradient: 'linear-gradient(135deg, rgba(14,165,233,0.88) 0%, rgba(2,132,199,0.7) 50%, rgba(8,47,73,0.75) 100%)',
    cardImage: sportsHighlightImg,
    icon: '⚡',
    mode: 'highlight',
  },
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
    title: 'Event Recap',
    description: 'Turn conferences, graduations, concerts, and community events into a polished recap video.',
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

// ─── Sport picker data ────────────────────────────────────────────────────────

interface Sport {
  id: string
  label: string
  emoji: string
}

const SPORTS: Sport[] = [
  { id: 'basketball',  label: 'Basketball',   emoji: '🏀' },
  { id: 'soccer',      label: 'Soccer',        emoji: '⚽' },
  { id: 'football',    label: 'Football',      emoji: '🏈' },
  { id: 'baseball',    label: 'Baseball',      emoji: '⚾' },
  { id: 'volleyball',  label: 'Volleyball',    emoji: '🏐' },
  { id: 'lacrosse',    label: 'Lacrosse',      emoji: '🥍' },
  { id: 'swimming',    label: 'Swimming',      emoji: '🏊' },
  { id: 'track',       label: 'Track & Field', emoji: '🏃' },
  { id: 'tennis',      label: 'Tennis',        emoji: '🎾' },
  { id: 'hockey',      label: 'Hockey',        emoji: '🏒' },
  { id: 'wrestling',   label: 'Wrestling',     emoji: '🤼' },
  { id: 'other',       label: 'Other',         emoji: '🎯' },
]

// ─── Pro Reel template data ───────────────────────────────────────────────────

interface ProReelTemplate {
  id: string
  name: string
  emoji: string
  description: string
  vibe: string
  paceLabel: string
  color: string
}

const PRO_REEL_TEMPLATES: ProReelTemplate[] = [
  {
    id: 'espn',
    name: 'ESPN Broadcast',
    emoji: '📺',
    description: 'Bold cuts, graphic overlays, and broadcast pacing. Built for the big screen.',
    vibe: 'Dramatic · High energy · Broadcast',
    paceLabel: 'Cinematic',
    color: '#ef4444',
  },
  {
    id: 'nba_social',
    name: 'NBA Social',
    emoji: '🏀',
    description: 'Fast cuts, music-driven, vertical-first. Designed for Instagram and TikTok.',
    vibe: 'Punchy · Music-driven · Social',
    paceLabel: 'Fast',
    color: '#3b82f6',
  },
  {
    id: 'nike',
    name: 'Nike / Hype Film',
    emoji: '⚡',
    description: 'Slow-motion hero moments, cinematic B-roll, minimal text. Pure athlete story.',
    vibe: 'Cinematic · Emotional · Aspirational',
    paceLabel: 'Slow-mo',
    color: '#f97316',
  },
  {
    id: 'recruiting',
    name: 'Recruiting Tape',
    emoji: '🎓',
    description: 'Clean, coach-friendly cuts. Stat overlays, full plays visible, professional tone.',
    vibe: 'Clean · Professional · Coach-ready',
    paceLabel: 'Measured',
    color: '#8b5cf6',
  },
  {
    id: 'raw_energy',
    name: 'Raw Energy',
    emoji: '🔥',
    description: 'Unfiltered hype. Fast edits, crowd reactions, celebration-heavy. Made to go viral.',
    vibe: 'Hype · Viral · Crowd-first',
    paceLabel: 'Ultra fast',
    color: '#f59e0b',
  },
]

// ─── Highlight settings helpers ───────────────────────────────────────────────

function buildAiDirectionFromSettings(s: HighlightSettings): string {
  const parts: string[] = [`Sport: ${s.sport}`, `Style: ${s.reelStyle}`]
  if (s.musicTrackName && s.beatSyncEnabled) {
    parts.push(`Beat-sync: enabled. Music track: ${s.musicTrackName}.`)
  }
  return parts.join('. ')
}

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
  const appVersion = useAppVersion()

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
  const [setupStep, setSetupStep] = useState<'type-picker' | 'sport-picker' | 'highlight_template'>('type-picker')
  const [selectedSport, setSelectedSport] = useState<string | null>(null)
  const [hoveredSport, setHoveredSport] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<ProReelTemplate | null>(null)
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null)

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
      if (selectedIntent === 'sports_highlight' && isNew && setupStep === 'type-picker') {
        setSetupStep('sport-picker')
        return
      }
      if (selectedIntent === 'sports_highlight' && isNew && setupStep === 'sport-picker') {
        setSetupStep('highlight_template')
        return
      }
      const mode = intentToMode(selectedIntent)
      if (isNew) {
        const id = createLocalProject(title, mode)

        let highlightSettings: HighlightSettings | undefined
        let aiDirection: string | undefined

        if (selectedIntent === 'sports_highlight' && selectedSport) {
          const sportLabel = selectedSport.charAt(0).toUpperCase() + selectedSport.slice(1)
          highlightSettings = {
            sport: sportLabel,
            reelStyle: selectedTemplate?.id ?? 'espn',
            beatSyncEnabled: false,
          }
          aiDirection = buildAiDirectionFromSettings(highlightSettings)
        }

        updateProject(id, {
          intent: selectedIntent,
          primaryGoal,
          aspectRatio,
          ...(highlightSettings ? { highlightSettings } : {}),
          ...(aiDirection ? { aiDirection } : {}),
        })
        navigate(`/project/${id}`)
        return
      }
      if (projectId) {
        updateProject(projectId, { title, mode, intent: selectedIntent, primaryGoal, aspectRatio })
        navigate(`/project/${projectId}`)
      }
    },
    [createLocalProject, isNew, selectedIntent, navigate, projectId, primaryGoal, aspectRatio, title, updateProject, setupStep, selectedSport, selectedTemplate]
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
        {appVersion && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#71717a', whiteSpace: 'nowrap' }}>
            Storyteller {appVersion}
          </span>
        )}
      </header>

      {/* Body: left + right flex row */}
      <div style={bodyWrap}>
        {/* ── Left: intent picker OR sport picker OR template picker ── */}
        <div style={leftCol}>
          {setupStep === 'type-picker' ? (
            <>
              <h1 style={mainHeading}>What's Your Story?</h1>
              <p style={mainSubtitle}>
                Pick what you're creating today. Storyteller will automatically set up the right workflow, timeline, and
                AI tools.
              </p>

              {/* 3-column grid (sports card spans full width on first row for visual dominance) */}
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
                      style={
                        type.intent === 'sports_highlight'
                          ? sportsHeroCard(type.gradient, type.cardImage, isSelected, isHovered)
                          : storyCard(type.gradient, type.cardImage, isSelected, isHovered)
                      }
                    >
                      {type.intent === 'sports_highlight' ? (
                        /* Hero card: big emoji left, text right */
                        <>
                          <div style={{ fontSize: 56, lineHeight: 1, flexShrink: 0, filter: 'drop-shadow(0 2px 8px rgba(14,165,233,0.5))' }}>
                            ⚡
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={sportsCardTitle}>{type.title}</div>
                            <div style={sportsCardDesc}>{type.description}</div>
                          </div>
                          {isSelected && <div style={sportsCheckBadge}>✓</div>}
                        </>
                      ) : (
                        <>
                          <div style={cardIconWrap}>
                            <span style={{ fontSize: 16 }}>{type.icon}</span>
                          </div>
                          {isSelected && <div style={checkBadge}>✓</div>}
                          <div style={cardTitle}>{type.title}</div>
                          <div style={cardDesc}>{type.description}</div>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          ) : setupStep === 'sport-picker' ? (
            /* ── Sport picker step ── */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => { setSetupStep('type-picker'); setSelectedSport(null) }}
                  style={backBtn}
                >
                  ← Back
                </button>
                <h1 style={{ ...mainHeading, margin: 0 }}>What's Your Sport?</h1>
              </div>
              <p style={{ ...mainSubtitle, marginBottom: 28 }}>
                Storyteller will tune the pacing, energy, and clip-tagging to your sport's rhythm. Pick one to begin.
              </p>

              <div style={sportGrid}>
                {SPORTS.map((sport) => {
                  const isSel = selectedSport === sport.id
                  const isHov = hoveredSport === sport.id
                  return (
                    <button
                      key={sport.id}
                      type="button"
                      onClick={() => setSelectedSport(sport.id)}
                      onMouseEnter={() => setHoveredSport(sport.id)}
                      onMouseLeave={() => setHoveredSport(null)}
                      style={sportChip(isSel, isHov)}
                    >
                      <span style={{ fontSize: 30, lineHeight: 1 }}>{sport.emoji}</span>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        color: isSel ? '#38bdf8' : '#e5e7eb',
                        marginTop: 4,
                      }}>
                        {sport.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            /* ── Pro Reel template picker step ── */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => { setSetupStep('sport-picker'); setSelectedTemplate(null) }}
                  style={backBtn}
                >
                  ← Back to sport picker
                </button>
                <h1 style={{ ...mainHeading, margin: 0 }}>Choose Your Reel Style</h1>
              </div>
              <p style={{ ...mainSubtitle, marginBottom: 28 }}>
                Pick the vibe. Storyteller will match the pacing, cuts, and energy.
              </p>

              <div style={templateList}>
                {PRO_REEL_TEMPLATES.map((tmpl) => {
                  const isSel = selectedTemplate?.id === tmpl.id
                  const isHov = hoveredTemplate === tmpl.id
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => setSelectedTemplate(tmpl)}
                      onMouseEnter={() => setHoveredTemplate(tmpl.id)}
                      onMouseLeave={() => setHoveredTemplate(null)}
                      style={templateCard(tmpl.color, isSel, isHov)}
                    >
                      {/* Emoji */}
                      <div style={{ fontSize: 40, lineHeight: 1, flexShrink: 0, width: 56, textAlign: 'center' }}>
                        {tmpl.emoji}
                      </div>

                      {/* Text body */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={templateName}>{tmpl.name}</span>
                          <span style={templatePaceChip(tmpl.color)}>{tmpl.paceLabel}</span>
                        </div>
                        <div style={templateDesc}>{tmpl.description}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {tmpl.vibe.split(' · ').map((tag) => (
                            <span key={tag} style={templateVibeTag(tmpl.color, isSel)}>{tag}</span>
                          ))}
                        </div>
                      </div>

                      {/* Selected check */}
                      {isSel && (
                        <div style={templateCheckBadge(tmpl.color)}>✓</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
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
            <button
              type="submit"
              style={setupStep === 'sport-picker' || setupStep === 'highlight_template' ? sportsCreateBtn : createBtn}
              disabled={
                (setupStep === 'sport-picker' && !selectedSport) ||
                (setupStep === 'highlight_template' && !selectedTemplate)
              }
            >
              {setupStep === 'highlight_template'
                ? '⚡ Start My Highlight Reel'
                : setupStep === 'sport-picker'
                  ? '→ Choose Your Style'
                  : selectedIntent === 'sports_highlight' && isNew
                    ? '→ Choose Your Sport'
                    : `✦ ${isNew ? 'Create Story' : 'Save Story'}`}
            </button>

            {/* Back hint when in sport picker or template picker */}
            {setupStep === 'sport-picker' && (
              <button
                type="button"
                onClick={() => { setSetupStep('type-picker'); setSelectedSport(null) }}
                style={panelBackLink}
              >
                ← Back to story type
              </button>
            )}
            {setupStep === 'highlight_template' && (
              <button
                type="button"
                onClick={() => { setSetupStep('sport-picker'); setSelectedTemplate(null) }}
                style={panelBackLink}
              >
                ← Back to sport picker
              </button>
            )}

            {/* Selection summary for sports highlight flow */}
            {setupStep === 'highlight_template' && (selectedSport || selectedTemplate) && (
              <div style={selectionSummary}>
                {selectedSport && (
                  <div style={selectionRow}>
                    <span style={selectionLabel}>Sport</span>
                    <span style={selectionValue}>
                      {SPORTS.find((s) => s.id === selectedSport)?.emoji}{' '}
                      {SPORTS.find((s) => s.id === selectedSport)?.label}
                    </span>
                  </div>
                )}
                {selectedTemplate && (
                  <div style={selectionRow}>
                    <span style={selectionLabel}>Style</span>
                    <span style={{ ...selectionValue, color: selectedTemplate.color }}>
                      {selectedTemplate.emoji} {selectedTemplate.name}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Footer hint */}
            <p style={panelFooter}>
              {setupStep === 'highlight_template'
                ? 'Select a reel style to unlock sport-specific pacing and AI direction.'
                : setupStep === 'sport-picker'
                  ? 'Select your sport to unlock sport-specific clip tagging and pacing.'
                  : 'Storyteller will pre-configure your project with the best settings, AI tools, and workflow for your story.'}
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

// ─── Sports hero card (spans full row) ────────────────────────────────────────

function sportsHeroCard(
  gradient: string,
  cardImage: string,
  selected: boolean,
  hovered: boolean
): React.CSSProperties {
  return {
    position: 'relative',
    gridColumn: '1 / -1',
    height: 160,
    borderRadius: 16,
    background: `${gradient}, url(${cardImage}) center/cover no-repeat`,
    border: selected
      ? '2px solid #38bdf8'
      : hovered
        ? '2px solid rgba(56,189,248,0.5)'
        : '2px solid rgba(14,165,233,0.25)',
    boxShadow: selected
      ? '0 0 0 1px rgba(56,189,248,0.3), 0 6px 28px rgba(14,165,233,0.35)'
      : hovered
        ? '0 4px 20px rgba(14,165,233,0.2)'
        : 'none',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
    filter: hovered && !selected ? 'brightness(1.08)' : 'none',
    overflow: 'hidden',
  }
}

const sportsCardTitle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 22,
  color: '#fff',
  marginBottom: 6,
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
  textShadow: '0 2px 12px rgba(0,0,0,0.55)',
}

const sportsCardDesc: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.92)',
  lineHeight: 1.5,
  maxWidth: 520,
  textShadow: '0 1px 8px rgba(0,0,0,0.5)',
}

const sportsCheckBadge: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: '#38bdf8',
  color: '#082f49',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 800,
}

// ─── Sport picker grid ────────────────────────────────────────────────────────

const sportGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 12,
}

function sportChip(selected: boolean, hovered: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '22px 12px 18px',
    borderRadius: 14,
    border: selected
      ? '2px solid #38bdf8'
      : hovered
        ? '2px solid rgba(56,189,248,0.35)'
        : '2px solid rgba(255,255,255,0.07)',
    background: selected
      ? 'rgba(14,165,233,0.15)'
      : hovered
        ? 'rgba(14,165,233,0.07)'
        : 'rgba(255,255,255,0.03)',
    boxShadow: selected
      ? '0 0 0 1px rgba(56,189,248,0.2), 0 4px 18px rgba(14,165,233,0.25)'
      : 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    transform: hovered && !selected ? 'translateY(-2px)' : 'translateY(0)',
  }
}

// ─── Back button / panel back link ────────────────────────────────────────────

const backBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#9ca3af',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'all 0.15s ease',
}

const panelBackLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#6b7280',
  fontSize: 12,
  cursor: 'pointer',
  textAlign: 'center',
  padding: '4px 0 8px',
  transition: 'color 0.15s ease',
}

const sportsCreateBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 50%, #082f49 100%)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  letterSpacing: '0.01em',
  boxShadow: '0 4px 18px rgba(14,165,233,0.4)',
  transition: 'all 0.15s ease',
  marginBottom: 8,
}

// ─── Pro Reel template picker styles ─────────────────────────────────────────

const templateList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

function templateCard(color: string, selected: boolean, hovered: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    padding: '20px 22px',
    borderRadius: 16,
    border: selected
      ? `2px solid ${color}`
      : hovered
        ? `2px solid ${color}55`
        : '2px solid rgba(255,255,255,0.07)',
    background: selected
      ? `${color}18`
      : hovered
        ? `${color}0d`
        : 'rgba(255,255,255,0.025)',
    boxShadow: selected
      ? `0 0 0 1px ${color}33, 0 6px 24px ${color}28`
      : hovered
        ? `0 4px 16px ${color}18`
        : 'none',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s ease',
    transform: hovered && !selected ? 'translateY(-2px)' : 'translateY(0)',
  }
}

const templateName: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#fff',
  letterSpacing: '-0.01em',
}

function templatePaceChip(color: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color,
    background: `${color}22`,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '2px 8px',
    flexShrink: 0,
  }
}

const templateDesc: React.CSSProperties = {
  fontSize: 13,
  color: 'rgba(255,255,255,0.65)',
  lineHeight: 1.5,
}

function templateVibeTag(color: string, selected: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 600,
    color: selected ? color : 'rgba(255,255,255,0.55)',
    background: selected ? `${color}22` : 'rgba(255,255,255,0.05)',
    border: `1px solid ${selected ? color + '44' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 6,
    padding: '3px 8px',
    transition: 'all 0.15s ease',
  }
}

function templateCheckBadge(color: string): React.CSSProperties {
  return {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: color,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    flexShrink: 0,
  }
}

// ─── Right panel selection summary styles ─────────────────────────────────────

const selectionSummary: React.CSSProperties = {
  margin: '-4px 0 12px',
  padding: '12px 14px',
  borderRadius: 10,
  background: 'rgba(14,165,233,0.06)',
  border: '1px solid rgba(14,165,233,0.15)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const selectionRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
}

const selectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const selectionValue: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#38bdf8',
}
