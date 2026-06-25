import type { SoundbiteCandidate } from '@storyteller/shared'
import type { BuilderPacing, TimelineSequence } from '@storyteller/timeline'

export type IntroDurationSec = 30 | 45 | 60 | 90 | 120 | 180

const DURATIONS: { v: IntroDurationSec; label: string }[] = [
  { v: 30, label: '30s' },
  { v: 45, label: '45s' },
  { v: 60, label: '60s' },
  { v: 90, label: '90s' },
  { v: 120, label: '2m' },
  { v: 180, label: '3m' }
]

type GoalCardId =
  | 'Viral Moments'
  | 'Topic-Based Clips'
  | 'Emotional Moments'
  | 'Motivational Moments'
  | 'Cinematic Intro / Story'

function copyForGoal(goal: GoalCardId | null | undefined): {
  panelTitle: string
  introText: string
  primaryAction: string
  buildingAction: string
  emptySelectionText: string
  summaryTitle: string
} {
  switch (goal) {
    case 'Viral Moments':
      return {
        panelTitle: 'Viral cut builder',
        introText:
          'Choose a target length, then build from the current viral bucket. Checked moments are prioritized first, and the builder fills the rest with the strongest viral lines.',
        primaryAction: 'Build viral cut',
        buildingAction: 'Building viral cut…',
        emptySelectionText: 'Build pulls from the current viral bucket automatically. Check moments in Step 3 to boost them first, or use Top 3 / Top 5 / Top 7 to seed the timeline.',
        summaryTitle: 'Viral sequence summary'
      }
    case 'Topic-Based Clips':
      return {
        panelTitle: 'Topic cut builder',
        introText:
          'Choose a target length, then build from the current topic bucket. Checked moments are prioritized first, and the builder fills the rest with the strongest topic clips.',
        primaryAction: 'Build topic cut',
        buildingAction: 'Building topic cut…',
        emptySelectionText: 'Build pulls from the current topic bucket automatically. Check moments in Step 3 to boost them first, or use Top 3 / Top 5 / Top 7 to seed the timeline.',
        summaryTitle: 'Topic sequence summary'
      }
    case 'Emotional Moments':
      return {
        panelTitle: 'Emotional cut builder',
        introText:
          'Choose a target length, then build from the current emotional bucket. Checked moments are prioritized first, and the builder fills the rest with the strongest emotional lines.',
        primaryAction: 'Build emotional cut',
        buildingAction: 'Building emotional cut…',
        emptySelectionText: 'Build pulls from the current emotional bucket automatically. Check moments in Step 3 to boost them first, or use Top 3 / Top 5 / Top 7 to seed the timeline.',
        summaryTitle: 'Emotional sequence summary'
      }
    case 'Motivational Moments':
      return {
        panelTitle: 'Motivational cut builder',
        introText:
          'Choose a target length, then build from the current motivational bucket. Checked moments are prioritized first, and the builder fills the rest with the strongest motivational lines.',
        primaryAction: 'Build motivational cut',
        buildingAction: 'Building motivational cut…',
        emptySelectionText: 'Build pulls from the current motivational bucket automatically. Check moments in Step 3 to boost them first, or use Top 3 / Top 5 / Top 7 to seed the timeline.',
        summaryTitle: 'Motivational sequence summary'
      }
    case 'Cinematic Intro / Story':
    default:
      return {
        panelTitle: 'Intro builder',
        introText:
          'Choose a target length (up to 3 minutes), then build from the current bucket into a guided intro (Hook → Tension → Insight → Payoff). Checked moments are prioritized first, and the builder fills the rest automatically.',
        primaryAction: 'Build intro',
        buildingAction: 'Building intro…',
        emptySelectionText: 'Build pulls from the current bucket automatically. Check moments in Step 3 to boost them first, or use Top 3 / Top 5 / Top 7 to seed the timeline.',
        summaryTitle: 'Intro sequence summary'
      }
  }
}

export function IntroBuilderPanel(props: {
  soundbites: SoundbiteCandidate[]
  selectedIds: string[]
  onTop3: () => void
  onTop5: () => void
  onTop7: () => void
  onUseTrailerArc?: () => void
  trailerArcOnTimeline?: boolean
  hasTrailerArc?: boolean
  /**
   * Wipes selection AND any in-flight or persisted timeline. Renderer is
   * expected to confirm with the user before invoking this — the panel
   * just calls it.
   */
  onClearTimeline: () => void
  introDurationSec: IntroDurationSec
  onIntroDuration: (v: IntroDurationSec) => void
  onBuildIntro: () => void
  onSaveTimeline: () => void
  draftIntro: TimelineSequence | null
  activeSequence: TimelineSequence
  buildError: string | null
  saveError: string | null
  saving: boolean
  introBuilding: boolean
  /** True while `onClearTimeline` is awaiting cloud delete. */
  clearing?: boolean
  primaryAssetId: string
  /** Save to cloud (signed in) or local device */
  canSaveTimeline: boolean
  hasAnalyzedSoundbites: boolean
  selectedGoalCard?: GoalCardId | null
  pacing: BuilderPacing
}) {
  const {
    soundbites,
    selectedIds,
    onTop3,
    onTop5,
    onTop7,
    onUseTrailerArc,
    trailerArcOnTimeline = false,
    hasTrailerArc = false,
    onClearTimeline,
    introDurationSec,
    onIntroDuration,
    onBuildIntro,
    onSaveTimeline,
    draftIntro,
    activeSequence,
    buildError,
    saveError,
    saving,
    introBuilding,
    clearing = false,
    primaryAssetId,
    canSaveTimeline,
    hasAnalyzedSoundbites,
    selectedGoalCard = null,
    pacing
  } = props

  const selectedSet = new Set(selectedIds)
  const orderedSelected = soundbites.filter((s) => selectedSet.has(s.id))
  const isIntro = activeSequence.metadata?.builder === 'intro-v1'
  const noMedia = !primaryAssetId
  const noSoundbites = !hasAnalyzedSoundbites || soundbites.length === 0
  const goalCopy = copyForGoal(selectedGoalCard)

  return (
    <div style={{ marginTop: 20, padding: 16, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{goalCopy.panelTitle}</div>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px', lineHeight: 1.45 }}>
        {goalCopy.introText}
      </p>

      {noMedia && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          Import media first — add a video or audio file with a successful probe.
        </p>
      )}
      {!noMedia && noSoundbites && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          {hasAnalyzedSoundbites
            ? 'No moments match the current review bucket yet — switch buckets or generate a new analysis.'
            : <><strong>Analyze</strong> to generate soundbites from your transcript.</>}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Target length</span>
        {DURATIONS.map((d) => (
          <label key={d.v} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input
              type="radio"
              name="intro-dur"
              checked={introDurationSec === d.v}
              onChange={() => onIntroDuration(d.v)}
              disabled={introBuilding}
            />
            {d.label}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" style={btnGhost} onClick={onTop3} disabled={soundbites.length < 1 || introBuilding}>
          Use top 3
        </button>
        <button type="button" style={btnGhost} onClick={onTop5} disabled={soundbites.length < 1 || introBuilding}>
          Use top 5
        </button>
        <button type="button" style={btnGhost} onClick={onTop7} disabled={soundbites.length < 1 || introBuilding}>
          Use top 7
        </button>
        {onUseTrailerArc && (
          <button
            type="button"
            style={{
              ...btnGhost,
              ...(trailerArcOnTimeline
                ? { borderColor: 'rgba(110,231,197,0.4)', color: '#6ee7c5', background: 'rgba(110,231,197,0.08)' }
                : {})
            }}
            onClick={onUseTrailerArc}
            disabled={!hasTrailerArc || introBuilding}
            title="Select all trailer arc beats in story order"
          >
            {trailerArcOnTimeline ? 'Trailer arc on timeline' : 'Use trailer arc'}
          </button>
        )}
        <button
          type="button"
          style={btnGhost}
          onClick={onClearTimeline}
          disabled={introBuilding || clearing}
          title="Wipe the soundbite selection and any saved or in-flight timeline."
        >
          {clearing ? 'Clearing…' : 'Clear timeline'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          style={btnPrimary}
          onClick={onBuildIntro}
          disabled={noMedia || noSoundbites || introBuilding}
        >
          {introBuilding ? goalCopy.buildingAction : goalCopy.primaryAction}
        </button>
        <button
          type="button"
          style={btnGhost}
          onClick={onSaveTimeline}
          disabled={!canSaveTimeline || saving || !isIntro || introBuilding}
        >
          Save timeline
        </button>
        {saving && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Saving…</span>}
        {introBuilding && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Building intro…</span>}
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
        Current pacing: <strong style={{ color: 'var(--text)' }}>{pacing}</strong>.{' '}
        Save timeline stores the intro on this device when offline; uses your Supabase project when signed in.
      </p>

      {orderedSelected.length === 0 && !noSoundbites && !noMedia && (
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>{goalCopy.emptySelectionText}</p>
      )}
      {buildError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{buildError}</p>}
      {saveError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{saveError}</p>}

      {(draftIntro || isIntro) && !introBuilding && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'rgba(110,231,197,0.06)', border: '1px solid rgba(110,231,197,0.2)' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{goalCopy.summaryTitle}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            Estimated duration: <strong style={{ color: 'var(--text)' }}>{activeSequence.durationSeconds.toFixed(1)}s</strong>
            {isIntro && (
              <>
                {' '}
                · target cap {String(activeSequence.metadata?.introTargetSec ?? '—')}s
              </>
            )}
          </div>
          <ol style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
            {activeSequence.videoTracks[0]?.clips.map((c) => {
              const role = (c.metadata as { introRole?: string })?.introRole ?? '—'
              return (
                <li key={c.id}>
                  <strong style={{ textTransform: 'capitalize' }}>{role.replace(/_/g, ' ')}</strong> ·{' '}
                  {c.timelineOutSeconds - c.timelineInSeconds < 0.01
                    ? '—'
                    : `${(c.timelineOutSeconds - c.timelineInSeconds).toFixed(1)}s on timeline`}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
  color: '#061210',
  fontWeight: 600,
  fontSize: 13
}
const btnGhost: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 13
}
