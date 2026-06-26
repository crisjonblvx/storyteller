import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  dedupeBeatsBySourceWindow,
  generateBrollPromptsFromBeats,
  generateBrollPromptsForTimeline,
  generateStoryPlanDraft,
  inferBrollTone,
  defaultPromptPackId,
  PROMPT_PACKS,
  suggestTextPresetIds,
  tryConcreteFallbackScene,
  type BrollBeat,
  type PromptPackId,
  resolveTopLayerRecommendation,
  topLayerMotionPromptKey,
  topLayerStillPromptKey,
  type TopLayerRecommendation,
  generateTopLayerPromptsFromBeats,
  type TopLayerBeatPrompt,
  type GraphicsStylePreset,
  getPromptsForMode,
  buildThreeDTextPrompts,
  has3DTextSignal,
  type GroundedGraphicsMode,
  AUDIO_DNA,
  type AudioDnaId
} from '@storyteller/analysis'
import { resolveSoundDesignSlots, SOUND_LIBRARY } from '@storyteller/audio'
import {
  addOverlayEvent,
  attachGeneratedGraphicsClip,
  attachGeneratedBrollClip,
  buildBrollSlotsFromPrompts,
  buildGraphicsSlotsFromPrompts,
  buildIntroSequence,
  buildRoughCutSequence,
  buildMusicVideoCut,
  buildJournalismPackage,
  buildCreatorCut,
  ensureBrollVideoTrack,
  ensureGraphicsVideoTrack,
  formatSlotWindowLabel,
  insertPauseGap,
  listPauseGaps,
  overlaysActiveAt,
  removeOverlayEvent,
  removePauseGap,
  sequenceForExportDimensions,
  setGraphicsSlotStatus,
  setSlotStatus,
  updateOverlayEvent,
  DEFAULT_FRAME_POSITION,
  normalizeFramePosition,
  updateClipFramePositionInSequence,
  spineVideoTrackIndex,
  type BeatsPerCut,
  type BuilderPacing,
  type FramePosition,
  type GraphicsSlot,
  type OverlayChartKind,
  type OverlayEvent
} from '@storyteller/timeline'
import type { BrollSlot, TimelineSequence, TimelineClip, ClipTrimEdge } from '@storyteller/timeline'
import { insertAssetClipInSequence } from '@storyteller/timeline'
import {
  exportForNle,
  timelinePathsFromAssets,
  getExportDimensions,
  type ExportQualityPreset,
  type NleTarget
} from '@storyteller/exporters'
import {
  isTranscribableMediaAsset,
  type Asset,
  type BrollPrompt,
  type TranscriptSegment,
  type TimelineSegment,
  type GamePhase,
  type HighlightClipRole,
  type HighlightSettings,
} from '@storyteller/shared'
import { TEXT_PRESET_PACKS } from '@storyteller/text-fx'
import { getProjectFormat, isTemplateBrollIdea, isTemplateBrollPrompt, pickRecommendedOffer } from '@storyteller/shared'
import type { ProductionPackage } from '@storyteller/shared'
import { useProjectWorkflow, type PromptPackSelection } from '@renderer/stores/project-workflow'
import { useAuthStore } from '@renderer/stores/auth'
import { useAppVersion } from '@renderer/hooks/useAppVersion'
import { supabase, supabaseConfigured } from '@renderer/lib/supabase'
import { getGatewayAccessToken } from '@renderer/lib/gateway-auth'
import { normalizeGatewayErrorForDisplay } from '@renderer/lib/display-errors'
import { persistSoundbiteBrollIdeas } from '@renderer/lib/soundbite-ai-review'
import { ProductionPanel, type ProductionPanelAi } from '@renderer/components/ProductionPanel'
import { productionOffersForSoundbite } from '@renderer/lib/production-slot'
import { useGatewayCredits } from '@renderer/lib/gateway-account'
import { formatAiJobStatus } from '@renderer/lib/ai-job-status'
import {
  formatMediaProgressStatus,
  generateConceptFrame,
  generateVideoClip,
  hasMediaGenerationBridge,
  storytellerAiGenerationLabel,
  subscribeMediaGenerationProgress,
  type BrollRatio
} from '@renderer/lib/media-generation'
import {
  getSignedAssetUrl,
  uploadReferenceImageToStorage
} from '@renderer/lib/storage-assets'
import { useProjectAssets } from '@renderer/hooks/useProjectAssets'
import { useSoundbiteCandidates, useTranscriptSegments } from '@renderer/hooks/useProjectAnalysis'
import { useProjectTimeline } from '@renderer/hooks/useProjectTimeline'
import type { AssetDragPayload } from '@renderer/hooks/useAssetLibrary'
import {
  refreshSoundbitesFromExistingTranscript,
  runTranscriptionAnalysis
} from '@renderer/lib/transcription-pipeline'
import {
  analyzeBlockedReason,
  mapTranscriptionErrorForUser,
  pickPrimaryTranscribableAsset,
  sourceMediaStatus
} from '@renderer/lib/analysis-readiness'
import { AssetUploadZone } from '@renderer/components/AssetUploadZone'
import { UploadedAssetsPanel } from '@renderer/components/UploadedAssetsPanel'
import { JournalismIngestPanel } from '@renderer/components/JournalismIngestPanel'
import { CreatorIngestPanel } from '@renderer/components/CreatorIngestPanel'
import { HighlightIngestPanel, type BeatSyncConfig } from '@renderer/components/HighlightIngestPanel'
import { HighlightTimeline } from '@renderer/components/HighlightTimeline'
import { MusicVideoIngestPanel } from '@renderer/components/MusicVideoIngestPanel'
import { IntroBuilderPanel, type IntroDurationSec } from '@renderer/components/IntroBuilderPanel'
import { TimelineEditor } from '@renderer/components/TimelineEditor'
import { ClipPreviewModal } from '@renderer/components/ClipPreviewModal'
import { ExpandableImagePreview } from '@renderer/components/ExpandableImagePreview'
import { InlineClipPlayer } from '@renderer/components/InlineClipPlayer'
import { OverlayLayer, type KineticAnimation } from '@renderer/components/overlays/OverlayLayer'
import { BrollPromptBody } from '@renderer/components/broll/BrollPromptBody'
import {
  AddHookOverlayPanel,
  AddPausePanel,
  AddStatOverlayPanel,
  AddTextOverlayPanel
} from '@renderer/components/overlays/EnhancePanels'
import { useLocalAssetsStore } from '@renderer/stores/local-assets'
import { useLocalTimelineStore } from '@renderer/stores/local-timeline'
import { getIntentColors } from '@renderer/lib/intent-colors'
import { SoundDesignerPanel } from '@renderer/components/SoundDesignerPanel'

type StepId = 'upload' | 'goal' | 'review' | 'timeline' | 'enhance' | 'audio' | 'export'

const WORKFLOW_STEPS: { id: StepId; label: string; description: string }[] = [
  { id: 'upload', label: '1. Upload', description: 'Add media' },
  { id: 'goal', label: '2. Goal', description: 'Direct story' },
  { id: 'review', label: '3. Review', description: 'Moments' },
  { id: 'timeline', label: '4. Timeline', description: 'Build cut' },
  { id: 'enhance', label: '5. Enhance', description: 'B-roll & Top Layer' },
  { id: 'audio', label: '6. Audio Director', description: 'Sound design' },
  { id: 'export', label: '7. Export', description: 'Deliver' }
]

const GROUNDED_REVIEW_VERSION = 23

const NARRATIVE_ROLE_LABELS: Record<string, string> = {
  'cold-open': 'Cold open',
  transformation: 'Transformation reveal',
  teaser: 'Teaser',
  'emotional-low': 'Emotional low point',
  'gut-punch': 'Gut-punch',
  'viral-hook': 'Viral hook',
  'quotable-shift': 'Quotable shift',
  'tension-setup': 'Tension setup',
  payoff: 'Payoff',
  'mission-close': 'Mission close',
  context: 'Context'
}

const GOAL_CARDS = [
  { id: 'Viral Moments', label: 'Viral Moments' },
  { id: 'Topic-Based Clips', label: 'Topic-Based Clips' },
  { id: 'Emotional Moments', label: 'Emotional Moments' },
  { id: 'Motivational Moments', label: 'Motivational Moments' },
  { id: 'Cinematic Intro / Story', label: 'Cinematic Intro / Story' }
]

type GoalCardId = (typeof GOAL_CARDS)[number]['id']
type GraphicsPromptKind = 'graph-image' | 'text-image' | 'motion-overlay'
type GraphicsStyleCue = NonNullable<
  NonNullable<ReturnType<typeof readSoundbiteAiReview>>['graphicsPackage']
>['style']
type SoundbiteFilter =
  | 'All'
  | 'Viral'
  | 'Topic'
  | 'Emotional'
  | 'Motivational'
  | 'Hook'
  | 'Explainer'
  | 'Data'
  | 'Culture'
  | 'CTA'
  | 'Question'
  | 'Payoff'

const MAX_TIMELINE_HISTORY = 50

function cloneSequenceForHistory(sequence: TimelineSequence): TimelineSequence {
  return structuredClone(sequence)
}

function sequenceHistoryKey(sequence: TimelineSequence): string {
  return JSON.stringify(sequence)
}

function timelineStepCopy(goal: GoalCardId | null): { title: string; description: string; jsonSummary: string } {
  switch (goal) {
    case 'Viral Moments':
      return {
        title: '4. Build Viral Cut',
        description: 'Generate a rough cut from your selected soundbites, optimized for hooks and high-retention moments.',
        jsonSummary: 'Viral rough cut — assembled from top-ranked soundbites with scroll-stopping moments prioritized.'
      }
    case 'Topic-Based Clips':
      return {
        title: '4. Build Topic Cut',
        description: 'Generate a rough cut centered on your selected topic-based soundbites.',
        jsonSummary: 'Topic-based rough cut — assembled from soundbites filtered toward the selected topic.'
      }
    case 'Emotional Moments':
      return {
        title: '4. Build Emotional Cut',
        description: 'Generate a rough cut from your selected emotional moments.',
        jsonSummary: 'Emotional rough cut — assembled from moments with stronger feeling and narrative tension.'
      }
    case 'Motivational Moments':
      return {
        title: '4. Build Motivational Cut',
        description: 'Generate a rough cut from your selected motivational moments.',
        jsonSummary: 'Motivational rough cut — assembled from challenge, encouragement, and action-driving moments.'
      }
    case 'Cinematic Intro / Story':
    default:
      return {
        title: '4. Build Timeline',
        description: 'Generate a rough cut from your selected soundbites.',
        jsonSummary: 'Intro rough cut — guided Hook / Tension / Insight / Payoff structure.'
      }
  }
}

const SOUNDBITE_FILTERS: SoundbiteFilter[] = [
  'All', 'Viral', 'Topic', 'Emotional', 'Motivational', 'Hook', 
  'Explainer', 'Data', 'Culture', 'CTA', 'Question', 'Payoff'
]

const GOAL_TO_FILTER_STRATEGY: Record<
  GoalCardId,
  {
    defaultFilter: SoundbiteFilter
    associatedFilters: SoundbiteFilter[]
    reviewHint: string
  }
> = {
  'Viral Moments': {
    defaultFilter: 'Viral',
    associatedFilters: ['Viral', 'Hook', 'Payoff', 'Emotional'],
    reviewHint: 'For Viral Moments, start with Viral, Hook, and Payoff to review the strongest scroll-stopping clips first.'
  },
  'Topic-Based Clips': {
    defaultFilter: 'Topic',
    associatedFilters: ['Topic', 'Data', 'Explainer', 'Question'],
    reviewHint: 'For Topic-Based Clips, start with Topic, Data, and Explainer to review the clearest clips tied to your subject.'
  },
  'Emotional Moments': {
    defaultFilter: 'Emotional',
    associatedFilters: ['Emotional', 'Hook', 'Culture', 'Payoff'],
    reviewHint: 'For Emotional Moments, start with Emotional, Hook, and Culture to review clips with feeling and tension.'
  },
  'Motivational Moments': {
    defaultFilter: 'Motivational',
    associatedFilters: ['Motivational', 'Hook', 'Payoff', 'Culture'],
    reviewHint: 'For Motivational Moments, start with Motivational, Hook, and Payoff to review challenge, encouragement, and action-driving clips.'
  },
  'Cinematic Intro / Story': {
    defaultFilter: 'Hook',
    associatedFilters: ['Hook', 'Payoff', 'Emotional', 'Culture'],
    reviewHint: 'For Cinematic Intro / Story, start with Hook and Payoff to shape the strongest story arc.'
  }
}

function orderedSoundbiteFilters(goal: GoalCardId | null): SoundbiteFilter[] {
  if (!goal) return SOUNDBITE_FILTERS
  const ordered: SoundbiteFilter[] = ['All', ...GOAL_TO_FILTER_STRATEGY[goal].associatedFilters]
  for (const filter of SOUNDBITE_FILTERS) {
    if (!ordered.includes(filter)) ordered.push(filter)
  }
  return ordered
}

function soundbiteMatchesFilter(
  candidate: {
    transcript_text: string
    score_social: number | null
    score_emotional: number | null
    tags_json: Record<string, unknown> | null
  },
  filter: string
): boolean {
  if (filter === 'All') return true

  const tags = (candidate.tags_json ?? {}) as Record<string, any>
  const clipType = String(tags.clipType ?? tags.type ?? '').toUpperCase()
  const secondaryTags = Array.isArray(tags.secondaryTags)
    ? tags.secondaryTags.map((tag: unknown) => String(tag).toLowerCase())
    : []
  const editorial = (tags.editorialScores ?? {}) as Record<string, number>
  const viralPriority =
    typeof tags.viralPriority === 'number'
      ? tags.viralPriority
      : typeof candidate.score_social === 'number'
        ? candidate.score_social
        : 0
  const emotionalIntensity =
    typeof editorial.emotionalIntensity === 'number'
      ? editorial.emotionalIntensity
      : typeof candidate.score_emotional === 'number'
        ? candidate.score_emotional
        : 0
  const dataAuthority = typeof editorial.dataAuthority === 'number' ? editorial.dataAuthority : 0
  const consequence = typeof editorial.consequence === 'number' ? editorial.consequence : 0
  const tension = typeof editorial.narrativeTension === 'number' ? editorial.narrativeTension : 0
  const text = (candidate.transcript_text ?? '').toLowerCase()

  switch (filter) {
    case 'Viral':
      return tags.viral === true || viralPriority >= 0.68 || secondaryTags.includes('viral')
    case 'Topic':
      return clipType === 'DATA' || clipType === 'EXPLAINER' || dataAuthority >= 0.5 || secondaryTags.includes('data')
    case 'Emotional':
      return emotionalIntensity >= 0.28 || tension >= 0.45 || secondaryTags.includes('emotional')
    case 'Motivational':
      return (
        secondaryTags.includes('motivational') ||
        /change your life|future|results|gifted|you can|get out of that trap|steals from your future|income should be tied|don\'t need/i.test(
          text
        ) ||
        consequence >= 0.24
      )
    case 'Hook':
    case 'Explainer':
    case 'Data':
    case 'Culture':
    case 'CTA':
    case 'Question':
    case 'Payoff':
      return clipType === filter.toUpperCase()
    default:
      return true
  }
}

function soundbiteClipKey(s: { start_time: number; end_time: number; transcript_text: string | null }): string {
  const text = (s.transcript_text ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
  return `${s.start_time.toFixed(1)}:${s.end_time.toFixed(1)}:${text}`
}

function dedupeSoundbiteReviewRows<
  T extends { soundbite: { start_time: number; end_time: number; transcript_text: string | null } }
>(rows: T[]): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const row of rows) {
    const key = soundbiteClipKey(row.soundbite)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  return kept
}

function readSoundbiteAiReview(candidate: {
  id?: string
  transcript_text?: string | null
  tags_json: Record<string, unknown> | null
}): {
  version: number
  overallScore: number
  viralScore: number
  emotionalScore: number
  introScore: number
  graphScore: number
  labels: string[]
  narrativeRole?: string
  narrativeRoleLabel?: string
  purpose?: string
  rationale?: string
  whyBullets: string[]
  sectionReasons?: { viral?: string; intro?: string; graph?: string }
  placements: { ranked: number | null; viral: number | null; intro: number | null; graph: number | null; arc: number | null }
  graphicsPackage?: {
    graphImagePrompt?: string
    overlayTextImagePrompt?: string
    motionPromptFromImage?: string
    styleTags: string[]
    style?: {
      referenceStyle?: string
      palette?: string[]
      typography?: string
      layout?: string
      tone?: string
      durationSeconds?: number
    }
  }
  brollIdeas: Array<{
    style: 'literal' | 'emotional' | 'symbolic'
    prompt: string
    stillImagePrompt?: string
    motionPrompt?: string
    why?: string
  }>
  productionOffers: import('@storyteller/shared').ProductionPackage[]
  graphIdea?: {
    chartType: 'bar' | 'line' | 'counter' | 'comparison' | 'text'
    title: string
    why?: string
    dataText?: string
    visualTreatment?: string
  }
  source?: 'ai' | 'fallback'
} | null {
  const raw = ((candidate.tags_json ?? {}) as Record<string, any>).aiReview
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, any>
  const soundbiteId = typeof (candidate as { id?: string }).id === 'string' ? (candidate as { id: string }).id : ''
  const labels = Array.isArray(row.labels) ? row.labels.map((label) => String(label)) : []
  const brollIdeas = Array.isArray(row.brollIdeas)
    ? row.brollIdeas
        .filter((idea: unknown) => idea && typeof idea === 'object')
        .map((idea: any) => ({
          style:
            idea.style === 'emotional' || idea.style === 'symbolic'
              ? idea.style
              : ('literal' as const),
          prompt: typeof idea.prompt === 'string' ? idea.prompt : '',
          stillImagePrompt:
            typeof idea.stillImagePrompt === 'string' ? idea.stillImagePrompt : undefined,
          motionPrompt: typeof idea.motionPrompt === 'string' ? idea.motionPrompt : undefined,
          why: typeof idea.why === 'string' ? idea.why : undefined
        }))
        .filter((idea: { prompt: string }) => idea.prompt.trim().length > 0)
    : []
  const graphIdea =
    row.graphIdea && typeof row.graphIdea === 'object' && typeof row.graphIdea.title === 'string'
      ? {
          chartType:
            row.graphIdea.chartType === 'bar' ||
            row.graphIdea.chartType === 'line' ||
            row.graphIdea.chartType === 'counter' ||
            row.graphIdea.chartType === 'comparison'
              ? row.graphIdea.chartType
              : ('text' as const),
          title: row.graphIdea.title,
          why: typeof row.graphIdea.why === 'string' ? row.graphIdea.why : undefined,
          dataText: typeof row.graphIdea.dataText === 'string' ? row.graphIdea.dataText : undefined,
          visualTreatment:
            typeof row.graphIdea.visualTreatment === 'string' ? row.graphIdea.visualTreatment : undefined
        }
      : undefined
  const source = row.source === 'fallback' ? 'fallback' : row.source === 'ai' ? 'ai' : undefined
  const rawRationale = typeof row.rationale === 'string' ? row.rationale : undefined
  const rationale =
    rawRationale &&
    !/^filled from grounded heuristic fallback/i.test(rawRationale) &&
    !/^heuristic fallback:/i.test(rawRationale)
      ? rawRationale
      : undefined
  const whyBullets = Array.isArray(row.whyBullets)
    ? row.whyBullets
        .map((bullet: unknown) => String(bullet ?? '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : []
  const sectionReasons =
    row.sectionReasons && typeof row.sectionReasons === 'object'
      ? {
          viral:
            typeof row.sectionReasons.viral === 'string' && row.sectionReasons.viral.trim()
              ? row.sectionReasons.viral.trim()
              : undefined,
          intro:
            typeof row.sectionReasons.intro === 'string' && row.sectionReasons.intro.trim()
              ? row.sectionReasons.intro.trim()
              : undefined,
          graph:
            typeof row.sectionReasons.graph === 'string' && row.sectionReasons.graph.trim()
              ? row.sectionReasons.graph.trim()
              : undefined
        }
      : undefined
  const rawPlacements = row.placements && typeof row.placements === 'object' ? row.placements : {}
  const placements = {
    ranked: typeof rawPlacements.ranked === 'number' ? rawPlacements.ranked : null,
    viral: typeof rawPlacements.viral === 'number' ? rawPlacements.viral : null,
    intro: typeof rawPlacements.intro === 'number' ? rawPlacements.intro : null,
    graph: typeof rawPlacements.graph === 'number' ? rawPlacements.graph : null,
    arc: typeof rawPlacements.arc === 'number' ? rawPlacements.arc : null
  }
  const narrativeRole =
    typeof row.narrativeRole === 'string' && NARRATIVE_ROLE_LABELS[row.narrativeRole]
      ? row.narrativeRole
      : undefined
  const purpose = typeof row.purpose === 'string' && row.purpose.trim() ? row.purpose.trim() : undefined
  const graphicsPackage =
    row.graphicsPackage && typeof row.graphicsPackage === 'object'
      ? {
          graphImagePrompt:
            typeof row.graphicsPackage.graphImagePrompt === 'string' &&
            row.graphicsPackage.graphImagePrompt.trim()
              ? row.graphicsPackage.graphImagePrompt.trim()
              : undefined,
          overlayTextImagePrompt:
            typeof row.graphicsPackage.overlayTextImagePrompt === 'string' &&
            row.graphicsPackage.overlayTextImagePrompt.trim()
              ? row.graphicsPackage.overlayTextImagePrompt.trim()
              : undefined,
          motionPromptFromImage:
            typeof row.graphicsPackage.motionPromptFromImage === 'string' &&
            row.graphicsPackage.motionPromptFromImage.trim()
              ? row.graphicsPackage.motionPromptFromImage.trim()
              : undefined,
          styleTags: Array.isArray(row.graphicsPackage.styleTags)
            ? row.graphicsPackage.styleTags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean).slice(0, 8)
            : [],
          style:
            row.graphicsPackage.style && typeof row.graphicsPackage.style === 'object'
              ? {
                  referenceStyle:
                    typeof row.graphicsPackage.style.referenceStyle === 'string'
                      ? row.graphicsPackage.style.referenceStyle.trim()
                      : undefined,
                  palette: Array.isArray(row.graphicsPackage.style.palette)
                    ? row.graphicsPackage.style.palette
                        .map((color: unknown) => String(color ?? '').trim())
                        .filter(Boolean)
                        .slice(0, 6)
                    : undefined,
                  typography:
                    typeof row.graphicsPackage.style.typography === 'string'
                      ? row.graphicsPackage.style.typography.trim()
                      : undefined,
                  layout:
                    typeof row.graphicsPackage.style.layout === 'string'
                      ? row.graphicsPackage.style.layout.trim()
                      : undefined,
                  tone:
                    typeof row.graphicsPackage.style.tone === 'string'
                      ? row.graphicsPackage.style.tone.trim()
                      : undefined,
                  durationSeconds:
                    typeof row.graphicsPackage.style.durationSeconds === 'number'
                      ? row.graphicsPackage.style.durationSeconds
                      : undefined
                }
              : undefined
        }
      : undefined
  const productionOffers = productionOffersForSoundbite({
    soundbiteId,
    transcriptText:
      typeof (candidate as { transcript_text?: string | null }).transcript_text === 'string'
        ? (candidate as { transcript_text: string }).transcript_text
        : null,
    storedOffers: Array.isArray(row.productionOffers) ? (row.productionOffers as import('@storyteller/shared').ProductionPackage[]) : undefined,
    brollIdeas,
    graphicsPackage,
    graphScore: typeof row.graphScore === 'number' ? row.graphScore : 0,
    hasGraphIdea: Boolean(graphIdea)
  })
  return {
    version: typeof row.version === 'number' ? row.version : 0,
    overallScore: typeof row.overallScore === 'number' ? row.overallScore : 0,
    viralScore: typeof row.viralScore === 'number' ? row.viralScore : 0,
    emotionalScore: typeof row.emotionalScore === 'number' ? row.emotionalScore : 0,
    introScore: typeof row.introScore === 'number' ? row.introScore : 0,
    graphScore: typeof row.graphScore === 'number' ? row.graphScore : 0,
    labels,
    narrativeRole,
    narrativeRoleLabel: narrativeRole ? NARRATIVE_ROLE_LABELS[narrativeRole] : undefined,
    purpose,
    rationale,
    whyBullets,
    sectionReasons,
    placements,
    graphicsPackage,
    brollIdeas,
    productionOffers,
    graphIdea,
    source
  }
}

type SoundbiteAiReview = NonNullable<ReturnType<typeof readSoundbiteAiReview>>

type EnhanceTopLayerRow = {
  soundbite: {
    id: string
    start_time: number
    end_time: number
    transcript_text: string
  }
  timelineLabel?: string
  reviewAi: SoundbiteAiReview
  recommendation: TopLayerRecommendation
}

type DiversifiableRow = {
  soundbite: { transcript_text?: string | null }
  ai: ProductionPanelAi
}

/**
 * Episode-level de-duplication. Topics recur across an episode (space, finance, …) and
 * isolated per-soundbite generation can hand two different lines the exact same scene.
 * This pass walks the cards in order; whenever a card's opening-frame prompt was already
 * used by an earlier card, it rotates that card to a distinct starter variant for the same
 * topic so every card reads differently. Non-colliding prompts are left untouched, so
 * genuine per-line AI output is preserved.
 */
function diversifyProductionRows<T extends DiversifiableRow>(
  rows: T[],
  shotDurationSeconds?: number
): T[] {
  const usedStill = new Set<string>()
  const norm = (s: string | undefined): string =>
    (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

  return rows.map((row) => {
    const offers = row.ai.productionOffers
    if (!offers || offers.length === 0) return row
    const recommended = pickRecommendedOffer(offers) ?? offers[0]!
    const transcript = row.soundbite.transcript_text ?? ''
    const activeKey = norm(recommended.stillImagePrompt)

    if (activeKey && usedStill.has(activeKey) && transcript.trim()) {
      const tried = new Set<string>()
      for (let v = 0; v < 12; v++) {
        const scene = tryConcreteFallbackScene(transcript, shotDurationSeconds, v)
        if (!scene) break
        const sceneKey = norm(scene.stillImagePrompt)
        if (tried.has(sceneKey)) break // cycled through every variant for this topic
        tried.add(sceneKey)
        if (!usedStill.has(sceneKey)) {
          const replaced: ProductionPackage = {
            ...recommended,
            stillImagePrompt: scene.stillImagePrompt,
            motionPrompt: scene.motionPrompt,
            style: scene.style ?? recommended.style,
            why: scene.why ?? recommended.why,
            conceptSummary:
              scene.stillImagePrompt.slice(0, 120) +
              (scene.stillImagePrompt.length > 120 ? '…' : ''),
            isStarterIdea: true
          }
          const nextOffers = offers.map((o) => (o.id === recommended.id ? replaced : o))
          usedStill.add(sceneKey)
          return { ...row, ai: { ...row.ai, productionOffers: nextOffers } }
        }
      }
    }

    if (activeKey) usedStill.add(activeKey)
    return row
  })
}

function formatBrollIdeaDisplay(idea: {
  prompt: string
  stillImagePrompt?: string
  motionPrompt?: string
}): string {
  const still = idea.stillImagePrompt?.trim()
  const motion = idea.motionPrompt?.trim()
  if (still && motion) return `${still} ${motion}`
  return idea.prompt.trim()
}

function reviewBrollIdeasForDisplay(
  ai: SoundbiteAiReview,
  mode: 'cinematic' | 'practical'
): [{ style: 'literal' | 'emotional' | 'symbolic'; prompt: string; why?: string }] | [] {
  // Cinematic mode prefers metaphor/atmosphere (symbolic/emotional first).
  // Practical mode prefers direct coverage (literal first).
  const ordered =
    mode === 'practical'
      ? [
          ai.brollIdeas.find((idea) => idea.style === 'literal'),
          ...ai.brollIdeas.filter((idea) => idea.style !== 'literal')
        ]
      : [
          ...ai.brollIdeas.filter((idea) => idea.style !== 'literal'),
          ai.brollIdeas.find((idea) => idea.style === 'literal')
        ]

  for (const idea of ordered) {
    if (!idea || isTemplateBrollIdea(idea)) continue
    return [{ ...idea, prompt: formatBrollIdeaDisplay(idea) }]
  }

  // Last resort: any concrete idea with both still + motion fields.
  const explicit = ai.brollIdeas.find(
    (idea) =>
      idea.stillImagePrompt?.trim() &&
      idea.motionPrompt?.trim() &&
      !isTemplateBrollPrompt(idea.stillImagePrompt) &&
      !isTemplateBrollPrompt(idea.motionPrompt)
  )
  if (explicit) return [{ ...explicit, prompt: formatBrollIdeaDisplay(explicit) }]

  return []
}

function preferredBrollIdea(
  ai: SoundbiteAiReview,
  mode: 'cinematic' | 'practical'
): { style: 'literal' | 'emotional' | 'symbolic'; prompt: string; why?: string } | undefined {
  return reviewBrollIdeasForDisplay(ai, mode)[0]
}

const EXPORT_PRESETS = [
  { id: 'horizontal-1080p', label: 'Horizontal 1080p', icon: '🖥️', desc: '1920×1080 MP4' },
  { id: 'horizontal-4k', label: 'Horizontal 4K', icon: '🖥️', desc: '3840×2160 MP4' },
  { id: 'vertical-1080p', label: 'Vertical 1080p', icon: '📱', desc: '1080×1920 MP4' },
  { id: 'vertical-4k', label: 'Vertical 4K', icon: '📱', desc: '2160×3840 MP4' },
  { id: 'nle', label: 'NLE Rough Cut', icon: '🎬', desc: 'FCPXML + manifest + media' }
] as const

function StepRail({ steps, activeStep, onStepClick, intentColors }: { 
  steps: typeof WORKFLOW_STEPS, 
  activeStep: StepId, 
  onStepClick: (step: StepId) => void,
  intentColors: { border: string; glow: string; text: string; gradient: string }
}) {
  return (
    <div style={{ 
      display: 'flex', 
      gap: 8, 
      padding: '16px 28px', 
      borderBottom: `1px solid ${intentColors.border}`,
      background: 'linear-gradient(180deg, #16181e 0%, #0d0e12 100%)',
      overflowX: 'auto',
      scrollbarWidth: 'none'
    }}>
      {steps.map((step, i) => {
        const isActive = activeStep === step.id;
        const isPast = steps.findIndex(s => s.id === activeStep) > i;
        return (
          <button
            key={step.id}
            onClick={() => onStepClick(step.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              padding: '12px 16px',
              borderRadius: 12,
              border: isActive ? `1px solid ${intentColors.border}` : '1px solid rgba(255,255,255,0.06)',
              background: isActive ? intentColors.gradient : '#141416',
              boxShadow: isActive ? `0 0 12px ${intentColors.glow}` : 'none',
              cursor: 'pointer',
              minWidth: 140,
              flex: 1,
              opacity: isActive || isPast ? 1 : 0.5,
              transition: 'all 0.2s ease',
              textAlign: 'left'
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? intentColors.text : isPast ? 'rgba(255,255,255,0.7)' : '#f4f4f5', marginBottom: 4 }}>
              {step.label}
            </div>
            <div style={{ fontSize: 12, color: '#a1a1aa' }}>
              {step.description}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function assetLabel(assetId: string, names: Record<string, string>): string {
  return names[assetId] ?? assetId.slice(0, 8)
}

function formatDurationClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')} duration`
  return `${m}:${String(sec).padStart(2, '0')} duration`
}

/** Folder name inside the user-chosen parent directory: `{slug}-{nle}-{timestamp}`. */
function buildNlePackageFolderName(projectTitle: string, target: NleTarget): string {
  const slug =
    projectTitle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'storyteller'
  const t =
    target === 'final-cut-pro' ? 'fcpx' :
    target === 'premiere-pro' ? 'premiere' :
    target === 'davinci-resolve' ? 'resolve' :
    'otio'
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${slug}-${t}-${ts}`
}

/**
 * Decode a local absolute path from a `file://` URI.
 * Returns null for non-file URIs and keeps behavior forgiving on malformed input.
 */
function decodeLocalPathFromFileUri(uri: string): string | null {
  if (!/^file:\/\//i.test(uri)) return null
  try {
    const body = uri.replace(/^file:\/\//i, '')
    // Windows-style file URI: file:///C:/...
    if (/^\/[A-Za-z]:\//.test(body)) return decodeURIComponent(body.slice(1))
    return decodeURIComponent(body)
  } catch {
    return null
  }
}

function inferAssetMediaKindFromPath(path: string | null | undefined): 'image' | 'video' | null {
  if (!path) return null
  const lower = path.toLowerCase()
  if (/\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(lower)) return 'image'
  if (/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(lower)) return 'video'
  return null
}

function isImageAsset(asset: Asset): boolean {
  if (asset.asset_type === 'image' || asset.asset_type === 'photo') return true
  if (asset.mime_type?.startsWith('image/')) return true
  return inferAssetMediaKindFromPath(asset.local_path ?? asset.storage_path ?? asset.original_filename) === 'image'
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

export function ProjectWorkspacePage() {
  const { projectId = '' } = useParams()
  const projects = useProjectWorkflow((s) => s.projects)
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId])
  const intentColors = getIntentColors(project?.intent)
  const updateProject = useProjectWorkflow((s) => s.updateProject)
  const appVersion = useAppVersion()
  const setTimeline = useLocalTimelineStore((s) => s.setTimeline)
  const saveHighlightSettingsDebounced = useMemo(
    () =>
      debounce((pid: string, settings: HighlightSettings) => {
        updateProject(pid, { highlightSettings: settings })
      }, 800),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const touchProject = useProjectWorkflow((s) => s.touchProject)
  /** Stamp `lastOpenedAt` once on mount so the dashboard "Recent" sort stays accurate. */
  useEffect(() => {
    if (projectId) touchProject(projectId)
  }, [projectId, touchProject])
  const user = useAuthStore((s) => s.user)
  const demo = useAuthStore((s) => s.demo)
  const signOut = useAuthStore((s) => s.signOut)
  const navigate = useNavigate()
  /**
   * Only consider Supabase "live" when there's a real (non-demo) signed-in
   * user. Demo mode keeps Supabase off so non-UUID ids never reach the API.
   */
  const supabaseWhenSignedIn = user && !demo && supabase ? supabase : null
  const { assets, loading: assetsLoading, error: assetsError, refresh: refreshAssets } = useProjectAssets(
    projectId,
    supabaseWhenSignedIn
  )
  const {
    segments: dbSegments,
    loading: transcriptLoading,
    error: transcriptError,
    refresh: refreshTranscript
  } = useTranscriptSegments(projectId, supabaseWhenSignedIn)
  const {
    candidates: soundbites,
    loading: soundbitesLoading,
    error: soundbitesError,
    refresh: refreshSoundbites
  } = useSoundbiteCandidates(projectId, supabaseWhenSignedIn)

  const {
    timeline: savedTimeline,
    loading: timelineLoading,
    save: saveTimelineToDb,
    clear: clearPersistedTimeline,
    error: timelineLoadError
  } = useProjectTimeline(projectId, supabaseWhenSignedIn)

  /** True when Electron preload exposed `transcribeMedia` (not available in a plain browser tab). */
  const [transcriptionBridgeReady, setTranscriptionBridgeReady] = useState(false)
  useEffect(() => {
    setTranscriptionBridgeReady(typeof window.storyteller?.transcribeMedia === 'function')
  }, [])
  const [pathVerify, setPathVerify] = useState<'idle' | 'checking' | 'ok' | 'missing'>('idle')

  const [activeStep, setActiveStep] = useState<StepId>('upload')
  const [journalismAssembling, setJournalismAssembling] = useState(false)
  const [journalismAssembleError, setJournalismAssembleError] = useState<string | null>(null)
  const [creatorAssembling, setCreatorAssembling] = useState(false)
  const [creatorAssembleError, setCreatorAssembleError] = useState<string | null>(null)
  const [creatorTargetFormat, setCreatorTargetFormat] = useState<'short' | 'long'>('long')
  const [timelineSegments, setTimelineSegments] = useState<TimelineSegment[]>(
    () => project?.highlightSettings?.timelineSegments ?? project?.timelineSegments ?? []
  )
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [autoAssignError, setAutoAssignError] = useState<string | null>(null)
  const [reviewTab, setReviewTab] = useState<'soundbites' | 'transcript' | 'story'>('soundbites')
  const [activeFilter, setActiveFilter] = useState<SoundbiteFilter>('All')
  const [nleTarget, setNleTarget] = useState<NleTarget>('davinci-resolve')
  const [exportQuality, setExportQuality] = useState<ExportQualityPreset>('1080p')
  const [exportMode, setExportMode] = useState<'mp4' | 'nle'>('mp4')
  const [exportPreview, setExportPreview] = useState<string | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisMsg, setAnalysisMsg] = useState<string | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [selectedSoundbiteId, setSelectedSoundbiteId] = useState<string | null>(null)
  const [selectedSoundbiteIds, setSelectedSoundbiteIds] = useState<string[]>([])
  const [previewClip, setPreviewClip] = useState<{
    sourcePath: string | null
    sourceUrl: string | null
    startTime: number
    endTime: number
    title: string
    caption: string
  } | null>(null)
  /** Selected timeline clip — drives the inline Live Preview in the right rail. */
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null)
  const [timelinePlayheadSeconds, setTimelinePlayheadSeconds] = useState(0)
  const [previewSeekRequestId, setPreviewSeekRequestId] = useState(0)
  const [livePreviewPlaybackState, setLivePreviewPlaybackState] = useState<'playing' | 'paused' | 'stopped'>('stopped')
  const [introDurationSec, setIntroDurationSec] = useState<IntroDurationSec>(60)
  const [timelinePacing, setTimelinePacing] = useState<BuilderPacing>('Balanced')
  const [draftIntro, setDraftIntro] = useState<TimelineSequence | null>(null)
  /** In-flight trim drag sequence — replaces draftIntro/savedTimeline for rendering only, never persisted directly. */
  const [trimDraftSequence, setTrimDraftSequence] = useState<TimelineSequence | null>(null)
  /** Which clip edge is currently being trimmed, for locking the live-preview seek target. */
  const [activeTrimState, setActiveTrimState] = useState<{ clipId: string; edge: ClipTrimEdge; trackIndex: number } | null>(null)
  const [timelineUndoStack, setTimelineUndoStack] = useState<TimelineSequence[]>([])
  const [timelineRedoStack, setTimelineRedoStack] = useState<TimelineSequence[]>([])
  const [introBuildError, setIntroBuildError] = useState<string | null>(null)
  const [saveTimelineError, setSaveTimelineError] = useState<string | null>(null)
  const [saveTimelineBusy, setSaveTimelineBusy] = useState(false)
  const [introBuildBusy, setIntroBuildBusy] = useState(false)
  const [clearingTimeline, setClearingTimeline] = useState(false)
  const [directionDraft, setDirectionDraft] = useState('')
  const [selectedGoalCard, setSelectedGoalCard] = useState<GoalCardId | null>(null)
  const [topicInput, setTopicInput] = useState('')
  const [brollProvider, setBrollProvider] = useState<'runway' | 'kling' | 'higgsfield'>('runway')
  const [mediaGatewayEnabled, setMediaGatewayEnabled] = useState(false)
  /** Active capability-media job (hosted gateway); replaces per-provider slot ids when enabled. */
  const [mediaGenSlotId, setMediaGenSlotId] = useState<string | null>(null)
  const [productionBusySoundbiteId, setProductionBusySoundbiteId] = useState<string | null>(null)
  const [customProductionLinkId, setCustomProductionLinkId] = useState(() => `custom-${crypto.randomUUID()}`)
  const [generatingBrollPromptSoundbiteId, setGeneratingBrollPromptSoundbiteId] = useState<string | null>(null)
  const [aiMediaLineStatus, setAiMediaLineStatus] = useState<string | null>(null)
  const [enableKlingUi, setEnableKlingUi] = useState(false)
  const [enableByokUi, setEnableByokUi] = useState(false)
  const [reviewBrollMode, setReviewBrollMode] = useState<'cinematic' | 'practical'>('cinematic')
  /**
   * Higgsfield BYOK state — the renderer never holds the secret itself; the
   * main process keeps it in the OS keychain and just tells us whether one is
   * saved (`configured`). The model selector is fine in component state since
   * it isn't sensitive.
   */
  const [higgsfieldConfigured, setHiggsfieldConfigured] = useState<boolean | null>(null)
  const [higgsfieldModelId, setHiggsfieldModelId] = useState<string>(
    'bytedance/seedance/v1/pro/image-to-video'
  )
  const [higgsfieldPanelOpen, setHiggsfieldPanelOpen] = useState(false)
  const [higgsfieldKeyDraft, setHiggsfieldKeyDraft] = useState('')
  const [higgsfieldSecretDraft, setHiggsfieldSecretDraft] = useState('')
  const [higgsfieldStatusMsg, setHiggsfieldStatusMsg] = useState<string | null>(null)
  /**
   * Reference image attached to each B-roll slot for Higgsfield runs.
   * Keyed by slot id → { assetId, signedUrl }. Memory-only on purpose: we
   * don't want a stale signed URL from yesterday's session sitting in
   * localStorage. The user re-attaches per session if they restart mid-edit.
   * `assetId` is also written to the slot's `referenceImageAssetId` so the
   * canonical timeline state remembers which asset was used.
   */
  const [higgsfieldRefImages, setHiggsfieldRefImages] = useState<
    Record<string, { assetId: string; signedUrl: string; thumbnailUrl?: string } | undefined>
  >({})
  const [higgsfieldSlotId, setHiggsfieldSlotId] = useState<string | null>(null)
  const [higgsfieldLineStatus, setHiggsfieldLineStatus] = useState<string | null>(null)
  const [aiBrollPrompts, setAiBrollPrompts] = useState<Omit<BrollPrompt, 'id' | 'created_at'>[] | null>(null)
  /**
   * Beat-anchored prompts: one per intro clip / saved soundbite / saved-timeline V1 clip.
   * When set, these win over `aiBrollPrompts` and the heuristic episode-wide list.
   * Default null → user lands in the same view they had before until they hit Generate.
   */
  const [beatBrollPrompts, setBeatBrollPrompts] = useState<Omit<BrollPrompt, 'id' | 'created_at'>[] | null>(null)
  const [beatBrollSource, setBeatBrollSource] = useState<'ai' | 'deterministic' | null>(null)
  /**
   * "Clear AI prompts" was previously broken because the deterministic
   * fallbacks (`deterministicBeatBroll`, `heuristicBroll`) are useMemo-derived
   * from beats / segments — clearing the AI buckets just let the deterministic
   * lists slide back into view. This flag explicitly suppresses the cards
   * until the user does something that should re-show them (regenerate, change
   * pack, change source, or extend the underlying beats).
   */
  const [promptsCleared, setPromptsCleared] = useState(false)
  /**
   * When the gateway falls back from AI → deterministic (key missing, 429,
   * malformed JSON, etc.), we surface the reason in a *persistent neutral*
   * banner separate from `brollGenError` so the user never wonders why their
   * cards don't have the AI badge. Cleared on the next successful AI run.
   */
  const [beatBrollFallbackReason, setBeatBrollFallbackReason] = useState<string | null>(null)
  /**
   * Beat-anchored Top Layer prompts: one per timeline beat, written locally (no API).
   * Peer to `beatBrollPrompts` — users choose per clip whether to use B-roll or Top Layer.
   */
  const [beatTopLayerPrompts, setBeatTopLayerPrompts] = useState<TopLayerBeatPrompt[] | null>(null)
  /** Per-beat mode overrides: user can opt-in to '3d-text' (or any mode) on individual beat cards. */
  const [beatModeOverrides, setBeatModeOverrides] = useState<Record<string, GroundedGraphicsMode>>({})
  const [topLayerBeatBusy, setTopLayerBeatBusy] = useState(false)
  const [topLayerBeatError, setTopLayerBeatError] = useState<string | null>(null)
  const [topLayerStylePreset, setTopLayerStylePreset] = useState<GraphicsStylePreset>('premium')
  /** Per-card status messages keyed by beatId — shown below the action buttons. */
  const [beatCardStatus, setBeatCardStatus] = useState<Record<string, string>>({})
  /** Track whether graphicsActionBusyKey was ever non-null so the completion effect ignores the initial mount. */
  const wasEverBusyRef = useRef(false)
  /**
   * UI mode for the B-roll Prompts list:
   *  - 'beats'   → one prompt per real beat (intro + soundbites + saved timeline). Default.
   *  - 'episode' → legacy heuristic that walks the whole transcript in 30s windows.
   */
  const [brollPromptSource, setBrollPromptSource] = useState<'beats' | 'episode'>('beats')
  /**
   * Index of the prompt card currently in edit mode, or null when none. Only
   * one card can be edited at a time so the user can't accidentally lose an
   * in-flight draft by clicking on a second card.
   */
  const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null)
  const [brollGenBusy, setBrollGenBusy] = useState(false)
  const [brollGenError, setBrollGenError] = useState<string | null>(null)
  const [brollGenStatus, setBrollGenStatus] = useState<string | null>(null)
  // --- Music Video beat analysis state ---
  const [beatAnalyzing, setBeatAnalyzing] = useState(false)
  const [beatAnalysisError, setBeatAnalysisError] = useState<string | null>(null)
  const [beatTimestamps, setBeatTimestamps] = useState<number[]>([])
  const [detectedBpm, setDetectedBpm] = useState<number | null>(null)
  const [directorPackageJson, setDirectorPackageJson] = useState<unknown>(null)
  const [mp4Busy, setMp4Busy] = useState(false)
  const [mp4Status, setMp4Status] = useState<string | null>(null)
  const [mp4Error, setMp4Error] = useState<string | null>(null)
  const [mp4OutputPath, setMp4OutputPath] = useState<string | null>(null)
  const [burnCaptions, setBurnCaptions] = useState(false)
  const [nleExportBusy, setNleExportBusy] = useState(false)
  const [nleExportStatus, setNleExportStatus] = useState<string | null>(null)
  const [nleExportError, setNleExportError] = useState<string | null>(null)
  const [nleExportFolderPath, setNleExportFolderPath] = useState<string | null>(null)
  const [brollMapBusy, setBrollMapBusy] = useState(false)
  const [graphicsMapBusy, setGraphicsMapBusy] = useState(false)
  const [graphicsStatus, setGraphicsStatus] = useState<string | null>(null)
  const [graphicsError, setGraphicsError] = useState<string | null>(null)
  const [graphicsActionBusyKey, setGraphicsActionBusyKey] = useState<string | null>(null)
  const [imageStyleMode, setImageStyleMode] = useState<'visual' | 'text'>('visual')
  const [selectedGraphicsRefAssetId, setSelectedGraphicsRefAssetId] = useState<string | null>(null)
  const [graphicsReferenceImage, setGraphicsReferenceImage] = useState<{
    assetId: string
    signedUrl: string
    label: string
  } | null>(null)
  /** Per-row motion reference for Top Layer Animate (uploaded this session). */
  const [topLayerRowRefUploads, setTopLayerRowRefUploads] = useState<
    Record<string, { assetId: string; signedUrl: string; label: string }>
  >({})
  /** Per-row motion reference picked from project image assets. */
  const [topLayerRowRefAssetIds, setTopLayerRowRefAssetIds] = useState<Record<string, string | null>>({})
  /** User-edited still/motion prompts keyed by soundbite id. */
  const [topLayerPromptOverrides, setTopLayerPromptOverrides] = useState<
    Record<string, { stillPrompt?: string; motionPrompt?: string }>
  >({})
  const [editingTopLayerRowId, setEditingTopLayerRowId] = useState<string | null>(null)
  const [topLayerEditDraft, setTopLayerEditDraft] = useState<{ stillPrompt: string; motionPrompt: string }>({
    stillPrompt: '',
    motionPrompt: ''
  })
  const [runwaySlotId, setRunwaySlotId] = useState<string | null>(null)
  const [runwayLineStatus, setRunwayLineStatus] = useState<string | null>(null)
  const [klingSlotId, setKlingSlotId] = useState<string | null>(null)
  const [klingLineStatus, setKlingLineStatus] = useState<string | null>(null)
  const [transcriptCopyStatus, setTranscriptCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const addLocalAssets = useLocalAssetsStore((s) => s.addAssets)

  function handleExportPresetClick(preset: 'horizontal-1080p' | 'horizontal-4k' | 'vertical-1080p' | 'vertical-4k' | 'nle') {
    if (preset === 'nle') {
      setExportMode('nle')
    } else {
      setExportMode('mp4')
      const [orientation, quality] = preset.split('-') as ['horizontal' | 'vertical', '1080p' | '4k']
      setExportQuality(quality)
      if (editFormat !== orientation) {
        updateProject(projectId, { format: getProjectFormat(orientation, project?.format?.qualityPreset, project?.format?.fps) })
      }
    }
  }

  function handleGoalCardClick(goal: GoalCardId) {
    setSelectedGoalCard(goal)
    let newDirection = goal
    if (goal === 'Topic-Based Clips') {
      newDirection = `Topic-Based Clips: ${topicInput}`
    }
    setDirectionDraft(newDirection)
    if (project) updateProject(projectId, { aiDirection: newDirection })
  }

  function handleTopicInputChange(val: string) {
    setTopicInput(val)
    const newDirection = `Topic-Based Clips: ${val}`
    setDirectionDraft(newDirection)
    if (project) updateProject(projectId, { aiDirection: newDirection })
  }

  useEffect(() => {
    const unsub = window.storyteller?.onBrollProgress?.((p) => {
      if (p.phase === 'extracting') {
        const shards =
          p.chunk != null && p.chunkTotal != null ? ` · shards ${p.chunk}/${p.chunkTotal}` : ''
        setBrollGenStatus((p.detail ?? 'Stage 1: extracting clip candidates…') + shards)
      } else if (p.phase === 'director') {
        setBrollGenStatus(p.detail ?? 'Stage 2: creative director (one API call)…')
      } else if (p.phase === 'generating') {
        setBrollGenStatus(p.detail ?? 'Generating with AI…')
      }
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    const unsub = window.storyteller?.onNleExportProgress?.((p) => {
      if (p.phase === 'preparing') setNleExportStatus(p.detail ?? 'Preparing NLE package…')
      if (p.phase === 'writing_timeline') setNleExportStatus(p.detail ?? 'Writing timeline file…')
      if (p.phase === 'writing_additional') setNleExportStatus(p.detail ?? 'Writing additional timeline…')
      if (p.phase === 'writing_manifest') setNleExportStatus('Writing manifest…')
      if (p.phase === 'writing_readme') setNleExportStatus('Writing README…')
      if (p.phase === 'complete') {
        setNleExportStatus(`Export complete — ${p.folderPath}`)
        setNleExportFolderPath(p.folderPath)
      }
      if (p.phase === 'failed') {
        setNleExportError(p.error)
        setNleExportStatus('Export failed')
      }
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    const unsub = window.storyteller?.onExportProgress?.((p) => {
      if (p.phase === 'preparing') setMp4Status(p.detail ?? 'Preparing export…')
      if (p.phase === 'encoding_clip')
        setMp4Status(`Rendering MP4 — clip ${p.clipIndex} of ${p.clipTotal}…`)
      if (p.phase === 'concatenating') setMp4Status('Finalizing output…')
      if (p.phase === 'overlaying_broll')
        setMp4Status(`Compositing B-roll — ${p.clipIndex} of ${p.clipTotal}…`)
      if (p.phase === 'burning_captions') setMp4Status(p.detail ?? 'Burning captions…')
      if (p.phase === 'complete') {
        setMp4Status(`Export complete — ${p.outputPath}`)
        setMp4OutputPath(p.outputPath)
      }
      if (p.phase === 'failed') {
        setMp4Error(p.error)
        setMp4Status('Export failed')
        setMp4Busy(false)
      }
    })
    return () => unsub?.()
  }, [])

  // Bug 4: Watch graphicsActionBusyKey transitions to update per-beat-card status messages.
  useEffect(() => {
    if (graphicsActionBusyKey !== null) {
      wasEverBusyRef.current = true
      return
    }
    if (!wasEverBusyRef.current) return
    // A generation just completed — advance any in-progress card messages to done
    setBeatCardStatus((prev) => {
      const next: Record<string, string> = {}
      for (const [id, msg] of Object.entries(prev)) {
        if (msg === 'Generating still…') next[id] = 'Still ready on timeline'
        else if (msg === 'Animating…') next[id] = 'Animation ready on timeline'
        else next[id] = msg
      }
      return next
    })
  }, [graphicsActionBusyKey])

  useEffect(() => {
    if (mediaGatewayEnabled) return
    const unsub = window.storyteller?.onRunwayBrollProgress?.((p) => {
      setRunwayLineStatus(formatAiJobStatus(p))
    })
    return () => unsub?.()
  }, [mediaGatewayEnabled])

  useEffect(() => {
    if (mediaGatewayEnabled) return
    const unsub = window.storyteller?.onKlingBrollProgress?.((p) => {
      setKlingLineStatus(formatAiJobStatus(p))
    })
    return () => unsub?.()
  }, [mediaGatewayEnabled])

  useEffect(() => {
    if (!mediaGatewayEnabled) return
    const unsub = subscribeMediaGenerationProgress((p) => {
      const msg = formatMediaProgressStatus(p)
      setAiMediaLineStatus(msg)
    })
    return () => unsub?.()
  }, [mediaGatewayEnabled])

  useEffect(() => {
    if (!project) return
    let dir = project.aiDirection ?? ''
    if (project.intent === 'brand_intro' && !dir.trim()) {
      dir = 'Cinematic Intro / Story'
      updateProject(projectId, { aiDirection: dir })
    }
    setDirectionDraft(dir)
    if (dir === 'Viral Moments') setSelectedGoalCard('Viral Moments')
    else if (dir === 'Emotional Moments') setSelectedGoalCard('Emotional Moments')
    else if (dir === 'Motivational Moments') setSelectedGoalCard('Motivational Moments')
    else if (dir === 'Cinematic Intro / Story') setSelectedGoalCard('Cinematic Intro / Story')
    else if (dir.startsWith('Topic-Based Clips')) {
      setSelectedGoalCard('Topic-Based Clips')
      setTopicInput(dir.replace('Topic-Based Clips:', '').trim())
    }
  }, [project?.id, project?.aiDirection, project?.intent, projectId, updateProject])

  /**
   * On mount (and whenever the user changes provider) ask main whether
   * Higgsfield credentials are saved. We re-check on provider switch so
   * the panel can show "configured" vs "needs setup" without a refresh.
   */
  useEffect(() => {
    let cancelled = false
    void window.storyteller?.getAppStatus?.().then((s) => {
      if (cancelled || !s?.ok) return
      setMediaGatewayEnabled(Boolean(s.ai.mediaGatewayEnabled ?? s.ai.gatewayUrl))
      setEnableKlingUi(Boolean(s.ai.enableKling))
      setEnableByokUi(Boolean(s.ai.enableByok))
    })
    const bridge = window.storyteller?.getHiggsfieldStatus
    if (!bridge) {
      setHiggsfieldConfigured(false)
      return () => {
        cancelled = true
      }
    }
    void bridge().then((s) => {
      if (!cancelled) setHiggsfieldConfigured(Boolean(s.configured))
    })
    return () => {
      cancelled = true
    }
  }, [brollProvider])

  useEffect(() => {
    if (!enableKlingUi && brollProvider === 'kling') {
      setBrollProvider('runway')
    }
  }, [enableKlingUi, brollProvider])

  /** Dev-only provider picker — hidden when Storyteller AI (hosted gateway) is active. */
  const showDevProviderControls = !mediaGatewayEnabled && (enableByokUi || enableKlingUi)
  const { available: aiAvailableCredits, outOfCredits: aiOutOfCredits } = useGatewayCredits(mediaGatewayEnabled)

  const editFormat = project?.format?.orientation ?? 'horizontal'
  const seqDims = useMemo(
    () =>
      editFormat === 'vertical'
        ? { w: 1080, h: 1920, aspect: '9:16' as const }
        : { w: 1920, h: 1080, aspect: '16:9' as const },
    [editFormat]
  )

  const assetNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of assets) {
      m[a.id] =
        a.original_filename ??
        a.storage_path?.split('/').pop() ??
        a.local_path?.split(/[/\\]/).pop() ??
        a.id
    }
    return m
  }, [assets])

  const groupedTranscript = useMemo(() => {
    const groups = new Map<string, TranscriptSegment[]>()
    for (const s of dbSegments) {
      const list = groups.get(s.asset_id) ?? []
      list.push(s)
      groups.set(s.asset_id, list)
    }
    return groups
  }, [dbSegments])

  const fullTranscriptText = useMemo(() => {
    return Array.from(groupedTranscript.entries())
      .map(([assetId, segs]) => {
        const header = assetLabel(assetId, assetNameById)
        const body = segs
          .map((s) => `[${s.start_time.toFixed(2)}s - ${s.end_time.toFixed(2)}s] ${s.text}`)
          .join('\n')
        return `${header}\n${body}`
      })
      .join('\n\n')
      .trim()
  }, [groupedTranscript, assetNameById])

  const copyFullTranscript = useCallback(async () => {
    if (!fullTranscriptText) return
    try {
      await navigator.clipboard.writeText(fullTranscriptText)
      setTranscriptCopyStatus('copied')
      window.setTimeout(() => setTranscriptCopyStatus('idle'), 1800)
    } catch {
      setTranscriptCopyStatus('error')
      window.setTimeout(() => setTranscriptCopyStatus('idle'), 2200)
    }
  }, [fullTranscriptText])

  const plan = useMemo(
    () =>
      generateStoryPlanDraft(
        project?.mode ?? 'story',
        (project?.aiDirection?.trim() || project?.title || 'Your story').slice(0, 200)
      ),
    [project?.mode, project?.title, project?.aiDirection]
  )

  const brollTone = useMemo(() => inferBrollTone(project?.aiDirection), [project?.aiDirection])

  const brollSegmentHints = useMemo(() => {
    if (dbSegments.length >= 1) {
      return [...dbSegments]
        .sort((a, b) => a.start_time - b.start_time)
        .map((s) => ({
          start: s.start_time,
          end: s.end_time,
          summary: s.text
        }))
    }
    return [
      { start: 0, end: 30, summary: plan.outline[0] ?? 'scene' },
      { start: 30, end: 60, summary: plan.outline[1] ?? 'scene' }
    ]
  }, [dbSegments, plan.outline])

  const heuristicBroll = useMemo(() => {
    const maxEnd = dbSegments.length ? Math.max(...dbSegments.map((s) => s.end_time)) : 120
    return generateBrollPromptsForTimeline(projectId, Math.max(120, maxEnd + 30), brollSegmentHints, {
      tone: brollTone,
      mode: project?.mode ?? 'story',
      directionText: project?.aiDirection,
      shotDurationSeconds: project?.brollShotDurationSeconds
    })
  }, [
    brollSegmentHints,
    brollTone,
    dbSegments,
    project?.aiDirection,
    project?.brollShotDurationSeconds,
    project?.mode,
    projectId
  ])

  const effectivePromptPack = useMemo(() => {
    const sel = project?.promptPackId ?? 'auto'
    if (sel === 'auto') {
      return PROMPT_PACKS[defaultPromptPackId(project?.mode ?? 'story', project?.aiDirection, project?.primaryGoal)]
    }
    return PROMPT_PACKS[sel] ?? PROMPT_PACKS.cinematic_documentary
  }, [project?.aiDirection, project?.mode, project?.promptPackId, project?.primaryGoal])
  const groundedReviewUpgradeRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!projectId || !project) return
    if (transcriptLoading || soundbitesLoading || analysisBusy) return
    if (dbSegments.length === 0 || soundbites.length === 0) return
    const needsUpgrade = soundbites.some((soundbite) => {
      const aiReview = (soundbite.tags_json as Record<string, any> | null)?.aiReview
      return !aiReview || typeof aiReview !== 'object' || (aiReview.version ?? 0) < GROUNDED_REVIEW_VERSION
    })
    if (!needsUpgrade) return
    if (groundedReviewUpgradeRef.current.has(projectId)) return
    groundedReviewUpgradeRef.current.add(projectId)

    void (async () => {
      setAnalysisMsg('Refreshing this project with grounded AI review…')
      const res = await refreshSoundbitesFromExistingTranscript({
        supabase: supabaseWhenSignedIn,
        projectId,
        projectMode: project.mode,
        segments: dbSegments,
        directionText: directionDraft.trim() || project.aiDirection,
        subjectProfile: project.subjectProfile,
        promptPack: effectivePromptPack,
        onProgress: (p) => setAnalysisMsg(formatAnalysisProgress(p))
      })
      if (!res.ok) {
        groundedReviewUpgradeRef.current.delete(projectId)
        setAnalysisError(mapTranscriptionErrorForUser(res.error))
        return
      }
      await refreshSoundbites()
      setAnalysisMsg('Grounded AI review is ready.')
    })()
  }, [
    analysisBusy,
    dbSegments,
    directionDraft,
    effectivePromptPack,
    project,
    projectId,
    refreshSoundbites,
    soundbites,
    soundbitesLoading,
    supabaseWhenSignedIn,
    transcriptLoading
  ])

  /**
   * The "beats" the B-roll writer should anchor to:
   *   1. Every V1 clip in the in-flight intro draft (`draftIntro`)
   *   2. Every V1 clip in the saved timeline (so saved cuts get covered too)
   *   3. Every soundbite the user explicitly selected for the rough-cut
   *
   * De-duped by overlapping source-time window so the same line never produces
   * two cards. Ordered by source_start so the cards read in episode order.
   *
   * `transcript_text` is pulled by overlapping the clip's source range with
   * the dbSegments — this is what makes the prompt content-aware (instead of
   * the boilerplate "Cinematic shot:" wall the user complained about).
   */
  const transcriptLineForRange = useCallback(
    (assetId: string | undefined, start: number, end: number, maxChars = 600): string => {
      const overlapping = dbSegments
        .filter((s) => (!assetId || s.asset_id === assetId) && s.start_time < end && s.end_time > start)
        .sort((a, b) => a.start_time - b.start_time)
      if (overlapping.length === 0) return ''
      return overlapping
        .map((s) => s.text.trim())
        .filter((t) => t.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, maxChars)
    },
    [dbSegments]
  )

  const beatsFromTimeline = useMemo<BrollBeat[]>(() => {
    const beats: BrollBeat[] = []
    const seq = draftIntro ?? savedTimeline
    if (seq) {
      const spineIdx = spineVideoTrackIndex(seq.videoTracks ?? [])
      const spineClips = seq.videoTracks?.[spineIdx]?.clips ?? []

      for (const clip of spineClips) {
        if (clip.role === 'pause-gap') continue
        const start = clip.sourceInSeconds ?? 0
        const end = clip.sourceOutSeconds ?? start
        if (end - start <= 0.5) continue
        const bySoundbite = clip.soundbiteId
          ? soundbites.find((s) => s.id === clip.soundbiteId)?.transcript_text?.trim()
          : undefined
        const text = bySoundbite ?? transcriptLineForRange(clip.assetId, start, end)
        if (!text) continue
        beats.push({
          id: `timeline:${clip.id}`,
          source_start: start,
          source_end: end,
          transcript_text: text,
          score: null,
          origin: 'saved-timeline'
        })
      }
    }

    for (const id of selectedSoundbiteIds) {
      const sb = soundbites.find((s) => s.id === id)
      if (!sb) continue
      const text = (sb.transcript_text ?? transcriptLineForRange(undefined, sb.start_time, sb.end_time)).trim()
      if (!text) continue
      const composite =
        (sb.tags_json as { composite?: number } | null)?.composite ??
        ((sb.score_social ?? 0) + (sb.score_emotional ?? 0) + (sb.score_clarity ?? 0)) / 3
      beats.push({
        id: `soundbite:${sb.id}`,
        source_start: sb.start_time,
        source_end: sb.end_time,
        transcript_text: text,
        score: typeof composite === 'number' ? Math.min(1, Math.max(0, composite)) : null,
        origin: 'soundbite'
      })
    }

    return dedupeBeatsBySourceWindow(beats)
  }, [draftIntro, savedTimeline, selectedSoundbiteIds, soundbites, transcriptLineForRange])

  /**
   * Resolve a minimal soundbite-shaped object from a BrollBeat so beat-based
   * Top Layer cards can call the same `onGenerateGraphicsImagePrompt` /
   * `onGenerateMotionFromImagePrompt` functions used by AI-review rows.
   *
   * Priority: real soundbite from DB → clip's soundbiteId → synthetic from beat data.
   */
  const resolveSoundbiteForBeat = useCallback(
    (beat: BrollBeat): { id: string; start_time: number; end_time: number; transcript_text: string } => {
      if (beat.id.startsWith('soundbite:')) {
        const id = beat.id.slice('soundbite:'.length)
        const found = soundbites.find((s) => s.id === id)
        if (found) return found
        return { id, start_time: beat.source_start, end_time: beat.source_end, transcript_text: beat.transcript_text }
      }
      if (beat.id.startsWith('timeline:')) {
        const clipId = beat.id.slice('timeline:'.length)
        const seq = draftIntro ?? savedTimeline
        const allClips = (seq?.videoTracks ?? []).flatMap((t) => t.clips ?? [])
        const clip = allClips.find((c) => c.id === clipId)
        if (clip?.soundbiteId) {
          const found = soundbites.find((s) => s.id === clip.soundbiteId)
          if (found) return found
          return { id: clip.soundbiteId, start_time: beat.source_start, end_time: beat.source_end, transcript_text: beat.transcript_text }
        }
        return { id: clipId, start_time: beat.source_start, end_time: beat.source_end, transcript_text: beat.transcript_text }
      }
      return { id: beat.id, start_time: beat.source_start, end_time: beat.source_end, transcript_text: beat.transcript_text }
    },
    [soundbites, draftIntro, savedTimeline]
  )

  /**
   * Deterministic beat prompts the user can see *immediately* (no API call) the
   * moment they've selected soundbites or built an intro. The AI variant runs
   * on demand via "Generate beat prompts" and replaces these.
   */
  const deterministicBeatBroll = useMemo(() => {
    if (beatsFromTimeline.length === 0) return [] as Omit<BrollPrompt, 'id' | 'created_at'>[]
    return generateBrollPromptsFromBeats(projectId, beatsFromTimeline, {
      tone: brollTone,
      mode: project?.mode ?? 'story',
      directionText: project?.aiDirection,
      subjectProfile: project?.subjectProfile,
      shotDurationSeconds: project?.brollShotDurationSeconds,
      // Pack-aware: switching between cinematic_documentary / viral_social /
      // podcast_premium / journalism / motivational re-rolls the lighting,
      // lens, movement, and styleNote pools so the user sees a real
      // difference *before* hitting "Generate with AI".
      promptPack: effectivePromptPack
    })
  }, [
    beatsFromTimeline,
    brollTone,
    effectivePromptPack,
    project?.aiDirection,
    project?.brollShotDurationSeconds,
    project?.mode,
    project?.subjectProfile,
    projectId
  ])

  /**
   * Card-list precedence:
   *  - episode mode → legacy ai → legacy heuristic
   *  - beats mode   → AI beat prompts (if generated) → deterministic beat prompts
   *                   → falls back to heuristic only when there are zero beats
   */
  const displayBrolls = useMemo(() => {
    if (promptsCleared) return [] as Omit<BrollPrompt, 'id' | 'created_at'>[]
    if (brollPromptSource === 'episode') {
      return aiBrollPrompts ?? (mediaGatewayEnabled ? [] : heuristicBroll)
    }
    if (beatBrollPrompts && beatBrollPrompts.length > 0) return beatBrollPrompts
    if (mediaGatewayEnabled && brollPromptSource === 'beats') return []
    if (deterministicBeatBroll.length > 0) return deterministicBeatBroll
    return mediaGatewayEnabled ? [] : heuristicBroll
  }, [
    promptsCleared,
    brollPromptSource,
    aiBrollPrompts,
    heuristicBroll,
    beatBrollPrompts,
    deterministicBeatBroll,
    mediaGatewayEnabled
  ])

  /**
   * Auto-clear the "cleared" flag the moment the user does something that
   * means they want to see prompts again — switching prompt source, picking a
   * different pack, or extending the underlying beats / transcript that the
   * deterministic generators feed off. Without this the UI would feel "stuck"
   * after a clear.
   */
  useEffect(() => {
    if (promptsCleared) setPromptsCleared(false)
    // We intentionally only watch these inputs, not `promptsCleared` itself,
    // so a new clear doesn't immediately undo itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brollPromptSource, project?.promptPackId, beatsFromTimeline.length, dbSegments.length])

  /**
   * When the prompt pack changes, the user expects the visible cards to
   * reflect the new pack's signature style — but `beatBrollPrompts` (whether
   * from a previous AI run or a previous deterministic snapshot) wins over
   * the now pack-aware `deterministicBeatBroll` memo. So drop those stale
   * prompts on pack change *unless* the user has edited any of them. Edits
   * are deliberate human authorship and should never be silently destroyed
   * by a setting flip.
   */
  const lastSeenPackIdRef = useRef<string | undefined>(project?.promptPackId)
  useEffect(() => {
    const currentPackId = project?.promptPackId
    if (currentPackId === lastSeenPackIdRef.current) return
    lastSeenPackIdRef.current = currentPackId
    if (!beatBrollPrompts || beatBrollPrompts.length === 0) return
    const hasUserEdits = beatBrollPrompts.some(
      (p) => (p.metadata_json as { userEdited?: boolean } | undefined)?.userEdited === true
    )
    if (hasUserEdits) return
    setBeatBrollPrompts(null)
    setBeatBrollSource(null)
    setBeatBrollFallbackReason(null)
  }, [project?.promptPackId, beatBrollPrompts])

  /**
   * Same idea for episode-mode `aiBrollPrompts`: a fresh pack should produce
   * fresh deterministic prompts unless the user explicitly edited the AI
   * results.
   */
  useEffect(() => {
    if (!aiBrollPrompts || aiBrollPrompts.length === 0) return
    const hasUserEdits = aiBrollPrompts.some(
      (p) => (p.metadata_json as { userEdited?: boolean } | undefined)?.userEdited === true
    )
    if (hasUserEdits) return
    setAiBrollPrompts(null)
    // We intentionally only re-run on pack change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.promptPackId])

  /**
   * Apply an in-place patch to one prompt card. The active source list
   * (heuristicBroll / deterministicBeatBroll) is computed from a memo, so when
   * the user edits one of those we *promote* the current list into the matching
   * stateful bucket (`aiBrollPrompts` for episode mode, `beatBrollPrompts` for
   * beats mode) before mutating. This keeps the edit sticky across re-renders
   * without forcing a full regeneration.
   *
   * Slots that were already mapped on the timeline are NOT auto-remapped — the
   * user must re-click "Map prompts to timeline slots" to push timing changes
   * downstream. That avoids silently destroying a generated/ready slot when
   * someone is just tweaking text.
   */
  function updatePromptAt(
    index: number,
    patch: Partial<Pick<Omit<BrollPrompt, 'id' | 'created_at'>, 'prompt_text' | 'segment_start' | 'segment_end'>>
  ) {
    const apply = (
      list: Omit<BrollPrompt, 'id' | 'created_at'>[]
    ): Omit<BrollPrompt, 'id' | 'created_at'>[] =>
      list.map((p, i) => {
        if (i !== index) return p
        const next: Omit<BrollPrompt, 'id' | 'created_at'> = { ...p, ...patch }
        /**
         * Critical: the card's view body reads from
         * `metadata_json.providerPrompts.runway` (or `.kling`) when the
         * user has those provider tabs active — those strings are baked in
         * at generation time. If we patch only `prompt_text` here, the
         * view shows the *cached* provider string and the edit appears to
         * "revert". Propagate the new prompt text into both provider
         * variants so the canonical edit is what's displayed regardless
         * of provider tab.
         */
        if (typeof patch.prompt_text === 'string') {
          const prevMeta = (p.metadata_json ?? {}) as Record<string, unknown> & {
            providerPrompts?: { runway?: string; kling?: string; primary?: string }
          }
          next.metadata_json = {
            ...prevMeta,
            providerPrompts: {
              ...(prevMeta.providerPrompts ?? {}),
              primary: patch.prompt_text,
              runway: patch.prompt_text,
              kling: patch.prompt_text
            },
            userEdited: true
          }
        }
        return next
      })

    if (brollPromptSource === 'episode') {
      const base = aiBrollPrompts ?? heuristicBroll
      const patched = apply(base)
      setAiBrollPrompts(patched)
      const patchedItem = patched[index]
      if (patchedItem) {
        void persistEditedPrompt(index, {
          prompt_text: patchedItem.prompt_text,
          segment_start: patchedItem.segment_start,
          segment_end: patchedItem.segment_end
        })
      }
      return
    }
    if (beatBrollPrompts && beatBrollPrompts.length > 0) {
      const patched = apply(beatBrollPrompts)
      setBeatBrollPrompts(patched)
      const patchedItem = patched[index]
      if (patchedItem) {
        void persistEditedPrompt(index, {
          prompt_text: patchedItem.prompt_text,
          segment_start: patchedItem.segment_start,
          segment_end: patchedItem.segment_end
        })
      }
      return
    }
    if (deterministicBeatBroll.length > 0) {
      const patched = apply(deterministicBeatBroll)
      setBeatBrollPrompts(patched)
      if (!beatBrollSource) setBeatBrollSource('deterministic')
      const patchedItem = patched[index]
      if (patchedItem) {
        void persistEditedPrompt(index, {
          prompt_text: patchedItem.prompt_text,
          segment_start: patchedItem.segment_start,
          segment_end: patchedItem.segment_end
        })
      }
      return
    }
    const patched = apply(heuristicBroll)
    setBeatBrollPrompts(patched)
    if (!beatBrollSource) setBeatBrollSource('deterministic')
    const patchedItem = patched[index]
    if (patchedItem) {
      void persistEditedPrompt(index, {
        prompt_text: patchedItem.prompt_text,
        segment_start: patchedItem.segment_start,
        segment_end: patchedItem.segment_end
      })
    }
  }

  const primarySourceAsset = useMemo(() => pickPrimaryTranscribableAsset(assets), [assets])

  const primaryMediaStatus = useMemo(() => sourceMediaStatus(primarySourceAsset), [primarySourceAsset])

  const analyzeBlocked = useMemo(() => analyzeBlockedReason(primaryMediaStatus), [primaryMediaStatus])

  useEffect(() => {
    const asset = primarySourceAsset
    if (!asset) {
      setPathVerify('idle')
      return
    }
    const lp = asset.local_path?.trim()
    if (!lp) {
      if (asset.storage_path && asset.is_uploaded && supabaseWhenSignedIn) {
        setPathVerify('ok')
      } else {
        setPathVerify(primaryMediaStatus === 'missing_local_path' ? 'missing' : 'idle')
      }
      return
    }
    const bridge = window.storyteller?.verifyLocalMediaPath
    if (!bridge) {
      setPathVerify('ok')
      return
    }
    let cancelled = false
    setPathVerify('checking')
    void bridge(lp).then((r) => {
      if (!cancelled) setPathVerify(r.exists ? 'ok' : 'missing')
    })
    return () => {
      cancelled = true
    }
  }, [primarySourceAsset, supabaseWhenSignedIn, primaryMediaStatus])

  const canAnalyze =
    transcriptionBridgeReady &&
    primarySourceAsset != null &&
    pathVerify === 'ok' &&
    analyzeBlocked == null

  const primaryAssetId = primarySourceAsset?.id ?? ''

  const fallbackRoughCut = useMemo(() => {
    /**
     * Honor only the user's explicit checkbox selection. When nothing is
     * selected, Step 4 should stay visually empty instead of silently
     * re-populating itself from the top-ranked soundbites. That keeps
     * "Clear timeline" truthful and makes the builder feel deterministic.
     *
     * Clips with degenerate windows (end_time ≤ start_time, or spanning
     * effectively the whole file) are always filtered: they were the source
     * of the "FCPXML imports the entire episode" bug.
     */
    const sourcePool = selectedSoundbiteIds
      .map((id) => soundbites.find((s) => s.id === id))
      .filter((s): s is (typeof soundbites)[number] => Boolean(s))
    const validSelection = sourcePool.filter((c) => {
      if (!Number.isFinite(c.start_time) || !Number.isFinite(c.end_time)) return false
      const dur = c.end_time - c.start_time
      return dur > 0.05 && dur < 600
    })
    const top = validSelection.map((c) => ({
      id: c.id,
      start_time: c.start_time,
      end_time: c.end_time,
      transcript_text: c.transcript_text
    }))
    const pid = primaryAssetId || 'primary-asset'
    return buildRoughCutSequence({
      projectId,
      mode: project?.mode ?? 'story',
      format: project?.format ?? getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal'),
      primaryAssetId: pid,
      soundbites: top,
      silenceRegions: [],
      silencePreset: project?.silencePreset,
      pacingMode: timelinePacing
    })
  }, [
    project?.mode,
    project?.format,
    project?.silencePreset,
    projectId,
    primaryAssetId,
    seqDims.h,
    seqDims.w,
    soundbites,
    selectedSoundbiteIds,
    editFormat,
    timelinePacing
  ])

  const sequence = useMemo(() => {
    // trimDraftSequence takes priority during an active trim drag so the visual
    // timeline and live-preview both update in real-time without a DB round-trip.
    const base = trimDraftSequence ?? draftIntro ?? savedTimeline ?? fallbackRoughCut
    const withDims = {
      ...base,
      format: {
        ...(base.format || getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal')),
        width: seqDims.w,
        height: seqDims.h,
        aspectRatio: seqDims.aspect
      },
      exportMetadata: {
        ...base.exportMetadata,
        aspectRatio: seqDims.aspect
      }
    }
    if (
      (trimDraftSequence ?? draftIntro) &&
      ((savedTimeline?.brollSlots?.length && !withDims.brollSlots?.length) ||
        (savedTimeline?.graphicsSlots?.length && !withDims.graphicsSlots?.length))
    ) {
      return {
        ...withDims,
        ...(savedTimeline?.brollSlots?.length ? { brollSlots: savedTimeline.brollSlots } : {}),
        ...(savedTimeline?.graphicsSlots?.length ? { graphicsSlots: savedTimeline.graphicsSlots } : {})
      }
    }
    return withDims
  }, [trimDraftSequence, draftIntro, fallbackRoughCut, savedTimeline, seqDims.aspect, seqDims.h, seqDims.w, editFormat])

  async function persistEditedPrompt(
    index: number,
    patch: { prompt_text: string; segment_start: number; segment_end: number }
  ) {
    const nextMeta = {
      ...(sequence.metadata ?? {}),
      editedBrollPrompts: {
        ...((sequence.metadata as Record<string, unknown> & { editedBrollPrompts?: Record<string, unknown> })?.editedBrollPrompts ?? {}),
        [String(index)]: patch
      }
    }
    await persistSequenceUpdate({ ...sequence, metadata: nextMeta })
  }

  const restoredForSeqIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (restoredForSeqIdRef.current === sequence.id) return
    const stored = (sequence.metadata as Record<string, unknown> & {
      editedBrollPrompts?: Record<string, { prompt_text: string; segment_start: number; segment_end: number }>
    } | undefined)?.editedBrollPrompts
    if (!stored || Object.keys(stored).length === 0) {
      restoredForSeqIdRef.current = sequence.id
      return
    }
    const activeSource =
      brollPromptSource === 'episode'
        ? (aiBrollPrompts ?? heuristicBroll)
        : beatBrollPrompts && beatBrollPrompts.length > 0
          ? beatBrollPrompts
          : deterministicBeatBroll.length > 0
            ? deterministicBeatBroll
            : heuristicBroll
    if (activeSource.length === 0) return
    restoredForSeqIdRef.current = sequence.id
    const restored = activeSource.map((p, i) => {
      const edit = stored[String(i)]
      if (!edit) return p
      return {
        ...p,
        prompt_text: edit.prompt_text,
        segment_start: edit.segment_start,
        segment_end: edit.segment_end,
        metadata_json: {
          ...(p.metadata_json ?? {}),
          providerPrompts: {
            ...((p.metadata_json as Record<string, unknown> & { providerPrompts?: Record<string, string> })?.providerPrompts ?? {}),
            primary: edit.prompt_text,
            runway: edit.prompt_text,
            kling: edit.prompt_text
          },
          userEdited: true
        }
      }
    })
    if (brollPromptSource === 'episode') {
      setAiBrollPrompts(restored)
    } else {
      setBeatBrollPrompts(restored)
      if (!beatBrollSource) setBeatBrollSource('deterministic')
    }
  }, [
    sequence.id,
    sequence.metadata,
    brollPromptSource,
    aiBrollPrompts,
    beatBrollPrompts,
    heuristicBroll,
    deterministicBeatBroll,
    beatBrollSource
  ])

  const canUndoTimeline = timelineUndoStack.length > 0
  const canRedoTimeline = timelineRedoStack.length > 0

  const workingFormat = editFormat === 'vertical' ? 'vertical' : 'horizontal'

  const exportDims = useMemo(
    () => getExportDimensions(workingFormat, exportQuality),
    [exportQuality, workingFormat]
  )

  /** Delivery dimensions (1080p or 4K) — editing stays 1080p-class; export scales for MP4 + NLE. */
  const sequenceForExport = useMemo(
    () => sequenceForExportDimensions(sequence, exportDims.width, exportDims.height),
    [exportDims.height, exportDims.width, sequence]
  )

  const introColdOpenLine = useMemo(() => {
    const m = sequence.metadata as { builder?: string } | undefined
    if (m?.builder !== 'intro-v1') return null
    return sequence.markers.map((x) => x.label).join(' ')
  }, [sequence])

  const assetPathsForTimeline = useMemo(() => timelinePathsFromAssets(assets, projectId), [assets, projectId])

  /**
   * Audit which spine clips will actually make it into the FCPXML/XMEML output.
   * Mirrors the filter inside `timelineToFcpxml` so the user can see — *before*
   * launching the export — which assets are unreferenced (cloud-only) or live
   * on a path the exporter will skip. Without this preview, FCP just shows
   * "Invalid edit with no respective media" on import and the user has to guess
   * which clip is broken.
   */
  const exportReadiness = useMemo(() => {
    const spine = sequenceForExport.videoTracks[0]?.clips ?? []
    const cloudOnlyAssetIds = new Set<string>()
    const missingAssetIds = new Set<string>()
    let exportable = 0
    for (const clip of spine) {
      if (clip.role === 'pause-gap') continue
      const path = assetPathsForTimeline[clip.assetId]
      if (!path) {
        missingAssetIds.add(clip.assetId)
        continue
      }
      if (/^file:\/\/\/StorytellerRelink\//i.test(path)) {
        cloudOnlyAssetIds.add(clip.assetId)
        continue
      }
      exportable += 1
    }
    const cloudNames = [...cloudOnlyAssetIds].map((id) => {
      const a = assets.find((x) => x.id === id)
      return a?.original_filename || a?.local_path?.split(/[/\\]/).pop() || id
    })
    const missingNames = [...missingAssetIds].map((id) => {
      const a = assets.find((x) => x.id === id)
      return a?.original_filename || a?.local_path?.split(/[/\\]/).pop() || id
    })
    return {
      totalSpineClips: spine.filter((c) => c.role !== 'pause-gap').length,
      exportableClipCount: exportable,
      cloudOnlyAssetCount: cloudOnlyAssetIds.size,
      missingAssetCount: missingAssetIds.size,
      cloudOnlyAssetNames: cloudNames,
      missingAssetNames: missingNames
    }
  }, [assets, assetPathsForTimeline, sequenceForExport])

  const previewableTimelineClips = useMemo(
    () => {
      const spineIdx = spineVideoTrackIndex(sequence.videoTracks)
      const spineClips = sequence.videoTracks[spineIdx]?.clips ?? []
      return spineClips
        .filter((c) => c.assetId && c.role !== 'pause-gap')
        .sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
    },
    [sequence]
  )

  const livePreviewBrollClip = useMemo(() => {
    const brollTrack = sequence.videoTracks.find((t) => t.id === 'v-broll')
    if (!brollTrack) return null
    return (
      brollTrack.clips.find(
        (c) =>
          c.role === 'b-roll' &&
          timelinePlayheadSeconds >= c.timelineInSeconds &&
          timelinePlayheadSeconds < c.timelineOutSeconds
      ) ?? null
    )
  }, [sequence.videoTracks, timelinePlayheadSeconds])

  useEffect(() => {
    setTimelinePlayheadSeconds((seconds) =>
      Math.min(Math.max(0, seconds), Math.max(sequence.durationSeconds, 0))
    )
  }, [sequence.durationSeconds])

  /**
   * The active preview clip is primarily driven by the shared timeline playhead.
   * If the playhead is between clips (or there are no playable clips at that
   * position yet), we fall back to the selected clip and finally the first clip.
   */
  const livePreviewClip = useMemo(() => {
    if (previewableTimelineClips.length === 0) return null
    const playheadHit = previewableTimelineClips.find(
      (c) =>
        timelinePlayheadSeconds >= c.timelineInSeconds &&
        timelinePlayheadSeconds < c.timelineOutSeconds
    )
    if (playheadHit) return playheadHit
    const found = selectedTimelineClipId
      ? previewableTimelineClips.find((c) => c.id === selectedTimelineClipId)
      : null
    return found ?? previewableTimelineClips[0] ?? null
  }, [previewableTimelineClips, selectedTimelineClipId, timelinePlayheadSeconds])

  const selectedClipForFraming = useMemo(() => {
    if (!selectedTimelineClipId) return null
    return previewableTimelineClips.find((c) => c.id === selectedTimelineClipId) ?? null
  }, [selectedTimelineClipId, previewableTimelineClips])

  const handleFramePositionChange = useCallback(
    (position: FramePosition) => {
      if (!selectedTimelineClipId) return
      const next = updateClipFramePositionInSequence(sequence, 0, selectedTimelineClipId, position)
      if (next !== sequence) void persistSequenceUpdate(next)
    },
    [sequence, selectedTimelineClipId]
  )

  const livePreviewSourcePath = useMemo(() => {
    if (!livePreviewClip) return null
    /**
     * `assetPathsForTimeline` is keyed for NLE export — every value is a
     * `file://` URI, plus a `file:///StorytellerRelink/...` placeholder
     * for cloud-only assets. The Live Preview wants a real absolute disk
     * path that `ensurePreviewProxy` (Node `fs.existsSync`) can read, so
     * we re-derive from the asset row's `local_path`. The export map is
     * intentionally left untouched.
     */
    const asset = assets.find((a) => a.id === livePreviewClip.assetId)
    const local = asset?.local_path?.trim() ?? ''
    if (!local) return null
    return local
  }, [livePreviewClip, assets])

  const livePreviewBrollSourcePath = useMemo(() => {
    if (!livePreviewBrollClip) return null
    const asset = assets.find((a) => a.id === livePreviewBrollClip.assetId)
    const local = asset?.local_path?.trim() ?? ''
    return local || null
  }, [livePreviewBrollClip, assets])

  /**
   * Stable cover-video props — `sourceInSeconds` is anchored at seek / B-roll
   * clip changes only. During playback, InlineClipPlayer derives B-roll time
   * from main-video delta so we don't recreate this object every playhead tick.
   */
  const livePreviewCoverVideo = useMemo(() => {
    if (!livePreviewBrollSourcePath || !livePreviewBrollClip) return undefined
    return {
      sourcePath: livePreviewBrollSourcePath,
      sourceInSeconds:
        livePreviewBrollClip.sourceInSeconds +
        Math.max(0, timelinePlayheadSeconds - livePreviewBrollClip.timelineInSeconds)
    }
  }, [livePreviewBrollSourcePath, livePreviewBrollClip, previewSeekRequestId])

  /**
   * Source-time (seconds) the Live Preview <video> is currently on. Updated
   * on every `timeupdate` event from the player. We need this so the overlay
   * layer can show the right text/hook/stat for the moment under the playhead,
   * AND so the Add-at-Playhead handlers know where to anchor a new overlay.
   */
  const [previewSourceSeconds, setPreviewSourceSeconds] = useState<number>(0)

  const livePreviewSeekSourceSeconds = useMemo(() => {
    if (!livePreviewClip) return undefined

    // During a trim drag on the currently-previewed clip, lock the seek target
    // to the edge being dragged so the preview shows the frame at the cut
    // point instead of jumping around as the playhead falls outside the window.
    if (activeTrimState && activeTrimState.clipId === livePreviewClip.id) {
      return activeTrimState.edge === 'in'
        ? livePreviewClip.sourceInSeconds
        : livePreviewClip.sourceOutSeconds
    }

    const playheadInsideClip =
      timelinePlayheadSeconds >= livePreviewClip.timelineInSeconds &&
      timelinePlayheadSeconds <= livePreviewClip.timelineOutSeconds
    if (!playheadInsideClip) return livePreviewClip.sourceInSeconds
    const clipSourceDuration =
      livePreviewClip.sourceOutSeconds - livePreviewClip.sourceInSeconds
    const offsetIntoClip = Math.max(
      0,
      Math.min(
        timelinePlayheadSeconds - livePreviewClip.timelineInSeconds,
        clipSourceDuration
      )
    )
    return Math.min(
      livePreviewClip.sourceOutSeconds,
      livePreviewClip.sourceInSeconds + offsetIntoClip
    )
  }, [activeTrimState, livePreviewClip, timelinePlayheadSeconds])

  const customProductionSoundbite = useMemo(() => {
    if (livePreviewClip) {
      const start = livePreviewSeekSourceSeconds ?? livePreviewClip.sourceInSeconds
      const clipEnd = livePreviewClip.sourceOutSeconds
      const end = Math.min(clipEnd, start + 8)
      return {
        id: customProductionLinkId,
        start_time: start,
        end_time: Math.max(end, start + 4),
        transcript_text: 'Custom B-roll'
      }
    }
    const start = previewSourceSeconds > 0 ? previewSourceSeconds : 0
    return {
      id: customProductionLinkId,
      start_time: start,
      end_time: start + 8,
      transcript_text: 'Custom B-roll'
    }
  }, [customProductionLinkId, livePreviewClip, livePreviewSeekSourceSeconds, previewSourceSeconds])

  const customProductionAi = useMemo(
    (): ProductionPanelAi => ({
      productionOffers: [],
      brollIdeas: []
    }),
    []
  )

  const canControlLivePreview = Boolean(livePreviewClip && livePreviewSourcePath)

  const requestLivePreviewSeek = useCallback((timelineSeconds: number) => {
    setTimelinePlayheadSeconds(timelineSeconds)
    setPreviewSeekRequestId((id) => id + 1)
  }, [])

  const livePreviewPlaybackStateRef = useRef(livePreviewPlaybackState)
  const pendingPlayheadRef = useRef<number | null>(null)
  const playheadRafRef = useRef<number | null>(null)

  useEffect(() => {
    livePreviewPlaybackStateRef.current = livePreviewPlaybackState
  }, [livePreviewPlaybackState])

  const flushPendingPlayhead = useCallback(() => {
    playheadRafRef.current = null
    const next = pendingPlayheadRef.current
    if (next == null) return
    pendingPlayheadRef.current = null
    setTimelinePlayheadSeconds(next)
  }, [])

  const handleLivePreviewTimeUpdate = useCallback(
    (sourceSeconds: number) => {
      setPreviewSourceSeconds(sourceSeconds)
      if (!livePreviewClip) return
      const offsetIntoClip = Math.max(
        0,
        Math.min(
          sourceSeconds - livePreviewClip.sourceInSeconds,
          livePreviewClip.sourceOutSeconds - livePreviewClip.sourceInSeconds
        )
      )
      const nextPlayhead = livePreviewClip.timelineInSeconds + offsetIntoClip

      if (livePreviewPlaybackStateRef.current === 'playing') {
        pendingPlayheadRef.current = nextPlayhead
        if (playheadRafRef.current == null) {
          playheadRafRef.current = requestAnimationFrame(flushPendingPlayhead)
        }
        return
      }

      if (playheadRafRef.current != null) {
        cancelAnimationFrame(playheadRafRef.current)
        playheadRafRef.current = null
      }
      pendingPlayheadRef.current = null
      setTimelinePlayheadSeconds(nextPlayhead)
    },
    [livePreviewClip, flushPendingPlayhead]
  )

  const handleLivePreviewWindowEnd = useCallback(() => {
    if (!livePreviewClip) return
    const idx = previewableTimelineClips.findIndex((c) => c.id === livePreviewClip.id)
    const next = idx >= 0 ? previewableTimelineClips[idx + 1] : null
    if (next) {
      requestLivePreviewSeek(next.timelineInSeconds)
      return
    }
    setLivePreviewPlaybackState('stopped')
  }, [livePreviewClip, previewableTimelineClips, requestLivePreviewSeek])

  /**
   * Shared timeline playhead for both editor interactions and preview playback.
   * The player updates it during playback; clicks in the timeline update it
   * immediately so preview starts from the right spoken moment.
   */
  const previewSequenceSeconds = timelinePlayheadSeconds

  const livePreviewTranscriptText = useMemo(() => {
    if (!livePreviewClip) return ''
    const nearbyPlayheadText =
      previewSourceSeconds > 0
        ? transcriptLineForRange(
            livePreviewClip.assetId,
            Math.max(livePreviewClip.sourceInSeconds, previewSourceSeconds - 1.5),
            Math.min(livePreviewClip.sourceOutSeconds, previewSourceSeconds + 2.5),
            260
          )
        : ''
    if (nearbyPlayheadText) return nearbyPlayheadText

    const bySoundbite = livePreviewClip.soundbiteId
      ? soundbites.find((s) => s.id === livePreviewClip.soundbiteId)?.transcript_text?.trim() ?? ''
      : ''
    if (bySoundbite) return bySoundbite

    const bySegmentIds = (livePreviewClip.transcriptSegmentIds ?? [])
      .map((id) => dbSegments.find((segment) => segment.id === id)?.text?.trim() ?? '')
      .filter((text) => text.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (bySegmentIds) return bySegmentIds

    return transcriptLineForRange(
      livePreviewClip.assetId,
      livePreviewClip.sourceInSeconds,
      livePreviewClip.sourceOutSeconds,
      320
    )
  }, [livePreviewClip, previewSourceSeconds, soundbites, dbSegments, transcriptLineForRange])

  /**
   * Real-data overlay refs for the NLE manifest. Replaces the previous
   * single-element stub. The NLE exporter only needs preset_id + window
   * to satisfy the legacy schema; we additionally carry the kind, content,
   * subtitle and full stat payload so editors looking at the manifest can
   * re-create the title (hook headline, stat counter, etc.) directly in
   * Premiere/FCP/Resolve without bouncing back into Storyteller.
   *
   * Stats fall back to the `journalism_clean` preset id for editors that
   * still expect one — a future commit can add a real `stat_card` preset
   * once the burned-in chart visual ships.
   */
  const textOverlayRefs = useMemo(() => {
    const events = sequence.overlayEvents ?? []
    const eventRefs = events.map((e) => ({
      textEventId: e.id,
      presetId: 'journalism_clean',
      startSeconds: e.timelineInSeconds,
      endSeconds: e.timelineOutSeconds,
      renderMode: 'burnin' as const,
      kind: e.kind,
      content: e.content,
      subtitle: e.subtitle,
      stat: e.stat
    }))
    const graphicRefs = (sequence.graphicsSlots ?? []).map((slot) => ({
      textEventId: slot.id,
      presetId: 'graphics_overlay',
      startSeconds: slot.timelineStart,
      endSeconds: slot.timelineEnd,
      renderMode: 'burnin' as const,
      kind: 'graphic' as const,
      content: slot.promptText,
      graphicsSlotId: slot.id,
      graphicsKind: slot.kind,
      generatedAssetId: slot.generatedAssetId
    }))
    return [...eventRefs, ...graphicRefs]
  }, [sequence])

  /**
   * Overlay events visible at the current preview playhead. The OverlayLayer
   * inside the Live Preview reads this. We deliberately keep it in a memo
   * so we don't re-render the player's overlay tree at every <video> tick
   * unless the active set actually changes.
   */
  const activeOverlays = useMemo(
    () => overlaysActiveAt(sequence, previewSequenceSeconds),
    [sequence, previewSequenceSeconds]
  )
  const activeGraphicsSlots = useMemo(
    () =>
      (sequence.graphicsSlots ?? []).filter(
        (slot) => previewSequenceSeconds >= slot.timelineStart && previewSequenceSeconds < slot.timelineEnd
      ),
    [sequence.graphicsSlots, previewSequenceSeconds]
  )

  const mediaUrlForAssetId = useCallback(
    (assetId?: string): { url?: string; kind?: 'image' | 'video' } => {
      if (!assetId) return {}
      const asset = assets.find((a) => a.id === assetId)
      if (!asset) return {}
      const path = asset.local_path ?? null
      const kind = inferAssetMediaKindFromPath(path)
      if (!path || !kind) return kind ? { kind } : {}
      const url = window.storyteller?.toMediaUrl ? window.storyteller.toMediaUrl(path) : undefined
      return { url, kind }
    },
    [assets]
  )

  const activeGraphicsOverlays = useMemo(
    () =>
      activeGraphicsSlots.map((slot) => {
        const slotMeta = slot.metadata as { mediaKind?: string; kineticAnimation?: string } | undefined
        if (slotMeta?.mediaKind === 'kinetic-text') {
          return {
            slot,
            mediaKind: 'kinetic-text' as const,
            kineticAnimation: (slotMeta.kineticAnimation ?? 'slam') as KineticAnimation
          }
        }
        const { url, kind } = mediaUrlForAssetId(slot.generatedAssetId)
        return { slot, mediaUrl: url, mediaKind: kind }
      }),
    [activeGraphicsSlots, mediaUrlForAssetId]
  )

  /**
   * Per-kind overlay slices for the four Enhance panels. We don't gate this
   * by step — the cost of three filter passes over (usually <50) overlays is
   * negligible and it keeps the panels source-of-truth-aligned at all times.
   */
  const textOverlays = useMemo(
    () => (sequence.overlayEvents ?? []).filter((e) => e.kind === 'text'),
    [sequence.overlayEvents]
  )
  const hookOverlays = useMemo(
    () => (sequence.overlayEvents ?? []).filter((e) => e.kind === 'hook'),
    [sequence.overlayEvents]
  )
  const statOverlays = useMemo(
    () => (sequence.overlayEvents ?? []).filter((e) => e.kind === 'stat'),
    [sequence.overlayEvents]
  )
  const graphicsSlots = useMemo(() => sequence.graphicsSlots ?? [], [sequence.graphicsSlots])
  const pauseGapsList = useMemo(() => listPauseGaps(sequence), [sequence])

  const soundDesignPayload = useMemo(() => {
    const slots = sequence.soundDesignSlots ?? []
    const acceptedSlots = slots.filter((s) => s.status === 'accepted')
    if (acceptedSlots.length === 0) return undefined
    const audioDnaId = (project?.audioDnaId ?? 'netflix_documentary') as AudioDnaId
    const audioDna = AUDIO_DNA[audioDnaId] ?? AUDIO_DNA.netflix_documentary
    const resolutions = resolveSoundDesignSlots({
      slots: acceptedSlots,
      audioDnaId,
      library: SOUND_LIBRARY
    })
    return { slots: acceptedSlots, resolutions, audioDna }
  }, [sequence.soundDesignSlots, project?.audioDnaId])

  const nleExport = useMemo(
    () =>
      exportForNle(nleTarget, {
        projectTitle: project?.title,
        sequence: sequenceForExport,
        assetPathsById: assetPathsForTimeline,
        assets,
        textOverlayRefs,
        soundDesign: soundDesignPayload
      }),
    [assetPathsForTimeline, assets, nleTarget, project?.title, sequenceForExport, textOverlayRefs, soundDesignPayload]
  )

  const nleHandoffButtonLabel = useMemo(() => {
    switch (nleTarget) {
      case 'final-cut-pro':
        return 'Export Final Cut Rough Cut…'
      case 'premiere-pro':
        return 'Export for Premiere…'
      case 'davinci-resolve':
        return 'Export for Resolve…'
      case 'otio':
        return 'Export OTIO Package…'
      default:
        return 'Export handoff package…'
    }
  }, [nleTarget])

  const canPersistTimeline = !demo
  const hasAnalyzedSoundbites = soundbites.length > 0
  const timelineCopy = useMemo(() => timelineStepCopy(selectedGoalCard), [selectedGoalCard])
  const reviewFilterStrategy = useMemo(
    () => (selectedGoalCard ? GOAL_TO_FILTER_STRATEGY[selectedGoalCard] : null),
    [selectedGoalCard]
  )
  const visibleSoundbiteFilters = useMemo(
    () => orderedSoundbiteFilters(selectedGoalCard),
    [selectedGoalCard]
  )
  const suggestedTextPresets = useMemo(() => suggestTextPresetIds(project?.aiDirection), [project?.aiDirection])
  const textFxList = useMemo(() => {
    const hit = TEXT_PRESET_PACKS.filter((p) => suggestedTextPresets.includes(p.id))
    return hit.length ? hit : TEXT_PRESET_PACKS
  }, [suggestedTextPresets])

  const filteredSoundbites = useMemo(() => {
    const matched = soundbites.filter((c) => soundbiteMatchesFilter(c, activeFilter))
    const seen = new Set<string>()
    return matched.filter((c) => {
      const key = soundbiteClipKey(c)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [soundbites, activeFilter])

  const reviewAiPicks = useMemo(() => {
    const rows = soundbites
      .map((soundbite) => ({
        soundbite,
        ai: readSoundbiteAiReview(soundbite as { tags_json: Record<string, unknown> | null })
      }))
      .filter(
        (
          row
        ): row is {
          soundbite: (typeof soundbites)[number]
          ai: NonNullable<ReturnType<typeof readSoundbiteAiReview>>
        } => Boolean(row.ai)
      )
    if (rows.length === 0) return null
    const sortByPlacement = (key: 'viral' | 'intro' | 'graph') =>
      [...rows]
        .filter((row) => row.ai.placements[key] != null)
        .sort((a, b) => {
          const aPlacement = a.ai.placements[key] ?? Number.MAX_SAFE_INTEGER
          const bPlacement = b.ai.placements[key] ?? Number.MAX_SAFE_INTEGER
          if (aPlacement !== bPlacement) return aPlacement - bPlacement
          const scoreKey = key === 'viral' ? 'viralScore' : key === 'intro' ? 'introScore' : 'graphScore'
          return b.ai[scoreKey] - a.ai[scoreKey]
        })
        .slice(0, 3)
    const overall = [...rows]
      .sort((a, b) => {
        const aPlacement = a.ai.placements.ranked ?? Number.MAX_SAFE_INTEGER
        const bPlacement = b.ai.placements.ranked ?? Number.MAX_SAFE_INTEGER
        if (aPlacement !== bPlacement) return aPlacement - bPlacement
        return b.ai.overallScore - a.ai.overallScore
      })
      .slice(0, 3)
    const arc = dedupeSoundbiteReviewRows(
      [...rows]
        .filter((row) => row.ai.placements.arc != null)
        .sort((a, b) => (a.ai.placements.arc ?? 0) - (b.ai.placements.arc ?? 0))
    )
    return {
      arc,
      viral: dedupeSoundbiteReviewRows(sortByPlacement('viral')),
      intro: dedupeSoundbiteReviewRows(sortByPlacement('intro')),
      graph: sortByPlacement('graph'),
      overall
    }
  }, [soundbites])

  const groundedColdOpenLine = useMemo(() => {
    if (!reviewAiPicks) return null
    const coldOpen =
      reviewAiPicks.arc.find((row) => row.ai.narrativeRole === 'cold-open') ??
      reviewAiPicks.arc[0] ??
      reviewAiPicks.intro[0] ??
      reviewAiPicks.overall[0]
    return coldOpen?.soundbite.transcript_text?.trim() || null
  }, [reviewAiPicks])

  const enhanceAiIdeas = useMemo(() => {
    const rows = soundbites
      .filter((soundbite) => selectedSoundbiteIds.length === 0 || selectedSoundbiteIds.includes(soundbite.id))
      .map((soundbite) => ({
        soundbite,
        ai: readSoundbiteAiReview(soundbite as { tags_json: Record<string, unknown> | null })
      }))
      .filter(
        (
          row
        ): row is {
          soundbite: (typeof soundbites)[number]
          ai: NonNullable<ReturnType<typeof readSoundbiteAiReview>>
        } => Boolean(row.ai)
      )
      .sort((a, b) => (b.ai.overallScore ?? 0) - (a.ai.overallScore ?? 0))
      .slice(0, 4)
    return rows
  }, [selectedSoundbiteIds, soundbites])

  const enhanceTimelineProduction = useMemo(() => {
    const spine = sequence.videoTracks?.[0]?.clips ?? []
    const seen = new Set<string>()
    const items: Array<{
      soundbite: { id: string; start_time: number; end_time: number; transcript_text: string }
      ai: ProductionPanelAi
      timelineLabel: string
      clipId: string
      reviewAi?: SoundbiteAiReview
    }> = []

    for (const clip of spine) {
      if (clip.role === 'pause-gap') continue
      const start = clip.sourceInSeconds ?? 0
      const end = clip.sourceOutSeconds ?? start
      if (end - start <= 0.5) continue

      let soundbite = clip.soundbiteId ? soundbites.find((s) => s.id === clip.soundbiteId) : undefined
      if (!soundbite) {
        soundbite = soundbites.find((s) => s.start_time < end && s.end_time > start)
      }

      const transcript = (
        soundbite?.transcript_text ?? transcriptLineForRange(clip.assetId, start, end)
      )?.trim()
      if (!transcript) continue

      const linkId = soundbite?.id ?? `timeline-clip:${clip.id}`
      if (seen.has(linkId)) continue
      seen.add(linkId)

      const review = soundbite
        ? readSoundbiteAiReview(soundbite as { tags_json: Record<string, unknown> | null })
        : null
      const ai: ProductionPanelAi = review
        ? {
            productionOffers: review.productionOffers,
            brollIdeas: review.brollIdeas,
            graphScore: review.graphScore,
            graphIdea: review.graphIdea
          }
        : {
            productionOffers: productionOffersForSoundbite({
              soundbiteId: linkId,
              transcriptText: transcript,
              brollIdeas: [],
              shotDurationSeconds: project?.brollShotDurationSeconds
            }),
            brollIdeas: []
          }

      items.push({
        soundbite: {
          id: linkId,
          start_time: soundbite?.start_time ?? start,
          end_time: soundbite?.end_time ?? end,
          transcript_text: transcript
        },
        ai,
        timelineLabel: `${(clip.timelineInSeconds ?? 0).toFixed(1)}s on timeline`,
        clipId: clip.id
      })
    }
    return items
  }, [sequence, soundbites, transcriptLineForRange, project?.brollShotDurationSeconds])

  const enhanceProductionRows = useMemo(() => {
    if (mediaGatewayEnabled && enhanceTimelineProduction.length > 0) {
      return diversifyProductionRows(enhanceTimelineProduction, project?.brollShotDurationSeconds)
    }
    const mapped = enhanceAiIdeas.map(({ soundbite, ai }) => ({
      soundbite: {
        id: soundbite.id,
        start_time: soundbite.start_time,
        end_time: soundbite.end_time,
        transcript_text: soundbite.transcript_text ?? ''
      },
      ai: {
        productionOffers: ai.productionOffers,
        brollIdeas: ai.brollIdeas,
        graphScore: ai.graphScore,
        graphIdea: ai.graphIdea
      } satisfies ProductionPanelAi,
      timelineLabel: undefined as string | undefined,
      clipId: undefined as string | undefined,
      reviewAi: ai
    }))
    return diversifyProductionRows(mapped, project?.brollShotDurationSeconds)
  }, [mediaGatewayEnabled, enhanceTimelineProduction, enhanceAiIdeas, project?.brollShotDurationSeconds])

  const enhanceTopLayerRows = useMemo((): EnhanceTopLayerRow[] => {
    const rows: EnhanceTopLayerRow[] = []

    for (const row of enhanceProductionRows) {
      const reviewAi =
        row.reviewAi ??
        (() => {
          const full = soundbites.find((s) => s.id === row.soundbite.id)
          return full
            ? readSoundbiteAiReview(full as { tags_json: Record<string, unknown> | null })
            : null
        })()
      if (!reviewAi?.graphicsPackage) continue
      const recommendation = resolveTopLayerRecommendation(
        row.soundbite.transcript_text,
        reviewAi.graphicsPackage,
        reviewAi.graphIdea
      )
      if (!recommendation) continue
      rows.push({
        soundbite: row.soundbite,
        timelineLabel: row.timelineLabel,
        reviewAi,
        recommendation
      })
    }
    return rows
  }, [enhanceProductionRows, soundbites])

  const builderCandidates = useMemo(() => {
    const boostedIds = new Set(selectedSoundbiteIds)
    const boosted = selectedSoundbiteIds
      .map((id) => filteredSoundbites.find((s) => s.id === id))
      .filter((s): s is (typeof filteredSoundbites)[number] => Boolean(s))
    const ranked = filteredSoundbites.filter((c) => !boostedIds.has(c.id))
    return [...boosted, ...ranked]
  }, [filteredSoundbites, selectedSoundbiteIds])

  const trailerArcSoundbiteIds = useMemo(
    () => (reviewAiPicks?.arc ?? []).map(({ soundbite }) => soundbite.id),
    [reviewAiPicks]
  )

  const isTrailerArcOnTimeline = useMemo(() => {
    if (trailerArcSoundbiteIds.length === 0) return false
    const selectedSet = new Set(selectedSoundbiteIds)
    return trailerArcSoundbiteIds.every((id) => selectedSet.has(id))
  }, [selectedSoundbiteIds, trailerArcSoundbiteIds])

  useEffect(() => {
    if (!selectedGoalCard) return
    setActiveFilter(GOAL_TO_FILTER_STRATEGY[selectedGoalCard].defaultFilter)
  }, [selectedGoalCard])

  useEffect(() => {
    setTimelineUndoStack([])
    setTimelineRedoStack([])
  }, [projectId])

  function toggleSoundbiteSelect(id: string) {
    setSelectedSoundbiteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function pushTimelineHistoryEntry(previous: TimelineSequence, next: TimelineSequence) {
    const previousKey = sequenceHistoryKey(previous)
    const nextKey = sequenceHistoryKey(next)
    if (previousKey === nextKey) return
    setTimelineUndoStack((stack) => {
      const headKey = stack[stack.length - 1] ? sequenceHistoryKey(stack[stack.length - 1]!) : null
      if (headKey === previousKey) return stack
      const nextStack = [...stack, cloneSequenceForHistory(previous)]
      return nextStack.slice(-MAX_TIMELINE_HISTORY)
    })
    setTimelineRedoStack([])
  }

  async function applySequenceState(
    next: TimelineSequence,
    options?: { recordHistory?: boolean; clearRedo?: boolean; persist?: boolean }
  ) {
    const recordHistory = options?.recordHistory ?? true
    const clearRedo = options?.clearRedo ?? true
    const persist = options?.persist ?? true
    if (recordHistory) {
      pushTimelineHistoryEntry(sequence, next)
    } else if (clearRedo) {
      setTimelineRedoStack([])
    }
    if (persist) {
      if (draftIntro) {
        setDraftIntro(next)
      } else {
        const res = await saveTimelineToDb(next)
        if (!res.ok) {
          console.error('Timeline save failed', res.error)
        }
      }
    } else {
      setDraftIntro(next)
    }
  }

  async function undoTimelineEdit() {
    const previous = timelineUndoStack[timelineUndoStack.length - 1]
    if (!previous) return
    setTimelineUndoStack((stack) => stack.slice(0, -1))
    setTimelineRedoStack((stack) => [...stack, cloneSequenceForHistory(sequence)].slice(-MAX_TIMELINE_HISTORY))
    setDraftIntro(previous)
    setSelectedTimelineClipId(null)
    setLivePreviewPlaybackState('stopped')
  }

  async function redoTimelineEdit() {
    const next = timelineRedoStack[timelineRedoStack.length - 1]
    if (!next) return
    setTimelineRedoStack((stack) => stack.slice(0, -1))
    setTimelineUndoStack((stack) => [...stack, cloneSequenceForHistory(sequence)].slice(-MAX_TIMELINE_HISTORY))
    setDraftIntro(next)
    setSelectedTimelineClipId(null)
    setLivePreviewPlaybackState('stopped')
  }

  function applyTopBuilderSelection(count: number) {
    setIntroBuildError(null)
    const ids = builderCandidates.slice(0, count).map((s) => s.id)
    setSelectedSoundbiteIds(ids)
    setSelectedTimelineClipId(null)
  }

  function toggleTrailerArcOnTimeline() {
    setIntroBuildError(null)
    const arcSet = new Set(trailerArcSoundbiteIds)
    if (isTrailerArcOnTimeline) {
      setSelectedSoundbiteIds((prev) => prev.filter((id) => !arcSet.has(id)))
      setSelectedTimelineClipId(null)
      setLivePreviewPlaybackState('stopped')
      return
    }
    setSelectedSoundbiteIds(trailerArcSoundbiteIds)
    setSelectedTimelineClipId(null)
    setLivePreviewPlaybackState('stopped')
    setActiveStep('timeline')
  }

  async function onAssembleJournalismPackage() {
    if (!project) return
    setJournalismAssembleError(null)
    setJournalismAssembling(true)
    try {
      const mediaAssets = assets.filter(
        (a) => a.asset_type === 'video' || a.asset_type === 'audio'
      )
      if (mediaAssets.length === 0) {
        setJournalismAssembleError('Add at least one video or audio clip first.')
        return
      }
      const journalismAssets = mediaAssets.map((a) => ({
        asset: a,
        clipRole: a.clip_role ?? 'unassigned' as const
      }))
      const seq = buildJournalismPackage({
        projectId,
        format: project.format ?? getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal'),
        assets: journalismAssets
      })
      const res = await saveTimelineToDb(seq)
      if (!res.ok) {
        setJournalismAssembleError(res.error ?? 'Could not save the assembled package.')
        return
      }
      setDraftIntro(null)
      setActiveStep('timeline')
    } catch (e) {
      setJournalismAssembleError(e instanceof Error ? e.message : 'Assembly failed.')
    } finally {
      setJournalismAssembling(false)
    }
  }

  async function onAssembleCreatorCut() {
    if (!project) return
    setCreatorAssembleError(null)
    setCreatorAssembling(true)
    try {
      const mediaAssets = assets.filter(
        (a) => a.asset_type === 'video' || a.asset_type === 'audio'
      )
      if (mediaAssets.length === 0) {
        setCreatorAssembleError('Add at least one video or audio clip first.')
        return
      }
      const creatorAssets = mediaAssets.map((a) => ({
        asset: a,
        clipRole: a.creator_clip_role ?? 'unassigned' as const
      }))
      const seq = buildCreatorCut({
        projectId,
        format: project.format ?? getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal'),
        assets: creatorAssets,
        targetFormat: creatorTargetFormat,
        brollTransitionsEnabled: project.brollTransitionsEnabled !== false
      })
      const res = await saveTimelineToDb(seq)
      if (!res.ok) {
        setCreatorAssembleError(res.error ?? 'Could not save the creator cut.')
        return
      }
      setDraftIntro(null)
      setActiveStep('timeline')
    } catch (e) {
      setCreatorAssembleError(e instanceof Error ? e.message : 'Assembly failed.')
    } finally {
      setCreatorAssembling(false)
    }
  }

  async function onAssembleHighlightReel(config?: BeatSyncConfig) {
    if (!project) return

    // Persist beat-sync metadata into the project before assembly so
    // downstream AI steps can read it from project state.
    if (config?.musicTrackName) {
      const beatSyncLine = config.beatSyncEnabled
        ? `Beat-sync: enabled. Music track: ${config.musicTrackName}.`
        : undefined
      const baseDir = (project.aiDirection ?? '').replace(/Beat-sync:[^.]*\./g, '').trim()
      updateProject(projectId, {
        highlightMusicTrackName: config.musicTrackName,
        highlightBeatSyncEnabled: config.beatSyncEnabled,
        ...(beatSyncLine
          ? { aiDirection: [baseDir, beatSyncLine].filter(Boolean).join(' ') }
          : {})
      })
    }

    // TODO: replace with buildHighlightReel() once the highlight-specific
    // assembly function is implemented; currently delegates to the creator-cut
    // builder which shares the same timeline pipeline.
    return onAssembleCreatorCut()
  }

  /**
   * Auto-assign all tagged (non-unassigned) clips that don't yet have a
   * TimelineSegment, using AI to pick the best game phase for each.
   */
  async function handleAutoAssign() {
    if (!project) return
    setAutoAssigning(true)
    setAutoAssignError(null)
    try {
      const clipsToAssign = assets.filter(
        (a) =>
          (a.asset_type === 'video' || a.asset_type === 'audio') &&
          a.highlight_clip_role &&
          a.highlight_clip_role !== 'unassigned' &&
          !timelineSegments.some((s) => s.assetId === a.id)
      )
      if (clipsToAssign.length === 0) {
        setAutoAssignError(
          'All tagged clips are already on the timeline. Remove segments or tag more clips first.'
        )
        return
      }

      const sport = project.highlightSettings?.sport ?? 'Basketball'
      const res = await window.storyteller?.autoAssignHighlightClips?.({
        clips: clipsToAssign.map((a) => ({
          id: a.id,
          role: a.highlight_clip_role ?? 'unassigned',
          file_name:
            a.original_filename ??
            a.local_path?.split(/[/\\]/).pop() ??
            a.storage_path?.split('/').pop() ??
            a.id,
          duration_seconds: a.duration_seconds,
        })),
        sport,
      })

      if (!res || !res.ok) {
        setAutoAssignError(res?.error ?? 'Auto-assign failed. Try again.')
        return
      }

      const newSegments: TimelineSegment[] = res.assignments.map((a, i) => ({
        id: crypto.randomUUID(),
        assetId: a.assetId,
        role: a.role as HighlightClipRole,
        phase: a.phase as GamePhase,
        highlightScore: a.highlightScore,
        confidence: a.confidence,
        orderInPhase: a.orderInPhase ?? i + 1,
        durationSeconds:
          assets.find((asset) => asset.id === a.assetId)?.duration_seconds ?? undefined,
      }))

      const assignedSegments = [
        ...timelineSegments.filter((s) => !newSegments.some((ns) => ns.assetId === s.assetId)),
        ...newSegments,
      ]
      setTimelineSegments(assignedSegments)
      updateProject(projectId, {
        highlightSettings: {
          ...project.highlightSettings,
          timelineSegments: assignedSegments,
        } as HighlightSettings,
      })
    } catch (e) {
      setAutoAssignError(e instanceof Error ? e.message : 'Auto-assign failed.')
    } finally {
      setAutoAssigning(false)
    }
  }

  /**
   * Handle a clip dragged from HighlightIngestPanel and dropped onto a
   * phase lane in HighlightTimeline.
   */
  function handleClipDrop(assetId: string, role: HighlightClipRole, phase: GamePhase) {
    const existing = timelineSegments.find((s) => s.assetId === assetId)
    let nextSegments: TimelineSegment[]
    if (existing) {
      nextSegments = timelineSegments.map((s) => (s.assetId === assetId ? { ...s, phase } : s))
    } else {
      const asset = assets.find((a) => a.id === assetId)
      const orderInPhase = timelineSegments.filter((s) => s.phase === phase).length + 1
      const newSegment: TimelineSegment = {
        id: crypto.randomUUID(),
        assetId,
        role,
        phase,
        highlightScore: 0,
        orderInPhase,
        durationSeconds: asset?.duration_seconds ?? undefined,
      }
      nextSegments = [...timelineSegments, newSegment]
    }
    setTimelineSegments(nextSegments)
    if (project) {
      saveHighlightSettingsDebounced(project.id, {
        ...project.highlightSettings,
        timelineSegments: nextSegments,
      } as HighlightSettings)
    }
  }

  async function onAnalyzeMusicBeat(filePath: string) {
    setBeatAnalyzing(true)
    setBeatAnalysisError(null)
    try {
      const result = await window.storyteller?.analyzeBeat?.(filePath)
      if (!result?.ok) {
        setBeatAnalysisError(result?.error ?? 'Beat analysis unavailable')
        return
      }
      setBeatTimestamps(result.beats)
      setDetectedBpm(result.bpm)
      updateProject(projectId, { musicLocalPath: filePath })
    } catch (e) {
      setBeatAnalysisError(e instanceof Error ? e.message : 'Beat analysis failed.')
    } finally {
      setBeatAnalyzing(false)
    }
  }

  async function onAssembleMusicVideoCut() {
    if (!project || !primaryAssetId) return
    if (beatTimestamps.length < 2) {
      setBeatAnalysisError('Add a music track and wait for beat analysis to complete first.')
      return
    }
    setBeatAnalysisError(null)
    const beatsPerCut: BeatsPerCut = project.beatsPerCut ?? 4
    const primaryAsset = assets.find((a) => a.id === primaryAssetId)
    const musicAsset = project.musicLocalPath
      ? assets.find((a) => a.local_path === project.musicLocalPath)
      : undefined

    const seq = buildMusicVideoCut({
      projectId,
      format: project.format ?? getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal'),
      primaryAssetId,
      primaryDurationSeconds: primaryAsset?.duration_seconds ?? 300,
      beatTimestamps,
      beatsPerCut,
      soundbites: selectedSoundbiteIds.length > 0
        ? soundbites
            .filter((s) => selectedSoundbiteIds.includes(s.id))
            .map((s) => ({ id: s.id, start_time: s.start_time, end_time: s.end_time }))
        : undefined,
      musicAssetId: musicAsset?.id,
      musicDurationSeconds: musicAsset?.duration_seconds ?? undefined
    })

    const res = await saveTimelineToDb(seq)
    if (!res.ok) {
      setBeatAnalysisError(res.error ?? 'Could not save the music video cut.')
      return
    }
    setDraftIntro(null)
    setActiveStep('timeline')
  }

  function onBuildIntro() {
    setIntroBuildError(null)
    if (!primaryAssetId) {
      setIntroBuildError('Add a video or audio asset with a successful probe.')
      return
    }
    if (builderCandidates.length === 0) {
      setIntroBuildError(`No soundbites match the "${activeFilter}" bucket.`)
      return
    }
    setIntroBuildBusy(true)
    try {
      const seq = buildIntroSequence({
        projectId,
        mode: project?.mode ?? 'story',
        format: project?.format ?? getProjectFormat(editFormat === 'vertical' ? 'vertical' : 'horizontal'),
        primaryAssetId,
        targetDurationSec: introDurationSec,
        soundbites: builderCandidates,
        silenceRegions: [],
        silencePreset: project?.silencePreset,
        pacingMode: timelinePacing
      })
      const usedIds = [
        ...new Set(
          (seq.videoTracks[0]?.clips ?? [])
            .map((clip) => clip.soundbiteId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
      ]
      setSelectedSoundbiteIds(usedIds)
      setSelectedTimelineClipId(seq.videoTracks[0]?.clips[0]?.id ?? null)
      requestLivePreviewSeek(seq.videoTracks[0]?.clips[0]?.timelineInSeconds ?? 0)
      setLivePreviewPlaybackState('stopped')
      pushTimelineHistoryEntry(sequence, seq)
      setDraftIntro(seq)
      setTimelineRedoStack([])
      setActiveStep('timeline')
    } catch (e) {
      setIntroBuildError(e instanceof Error ? e.message : 'Could not build intro')
    } finally {
      setIntroBuildBusy(false)
    }
  }

  async function onSaveTimeline() {
    if (!canPersistTimeline) return
    const seq = sequence as TimelineSequence
    if (seq.metadata?.builder !== 'intro-v1') {
      setSaveTimelineError('Build an intro first — nothing to save.')
      return
    }
    setSaveTimelineError(null)
    setSaveTimelineBusy(true)
    try {
      const res = await saveTimelineToDb(seq)
      if (!res.ok) {
        setSaveTimelineError(res.error ?? 'Save failed')
        return
      }
      setDraftIntro(null)
    } finally {
      setSaveTimelineBusy(false)
    }
  }

  /**
   * "Clear timeline" button. Wipes:
   *   - the soundbite checkbox selection
   *   - the in-flight `draftIntro` (built but not saved)
   *   - the persisted timeline rows in Supabase + the local-store snapshot
   *
   * The persisted clear is needed because `useProjectTimeline` re-hydrates
   * `savedTimeline` from storage on every project load — without deleting,
   * the user would refresh and see the old timeline reappear.
   */
  async function onClearTimeline() {
    const hasDraft = draftIntro != null
    const hasSaved = savedTimeline != null
    const hasSelection = selectedSoundbiteIds.length > 0
    if (!hasDraft && !hasSaved && !hasSelection) {
      // Nothing to clear; quietly no-op so the button is forgiving.
      return
    }
    const message =
      hasSaved || hasDraft
        ? 'This wipes the current timeline (selected clips + saved intro). You can rebuild from soundbites at any time. Continue?'
        : 'Clear the soundbite selection?'
    if (!window.confirm(message)) return

    setClearingTimeline(true)
    setIntroBuildError(null)
    setSaveTimelineError(null)
    try {
      if (draftIntro || savedTimeline) {
        setTimelineUndoStack((stack) => [...stack, cloneSequenceForHistory(sequence)].slice(-MAX_TIMELINE_HISTORY))
        setTimelineRedoStack([])
      }
      setSelectedSoundbiteIds([])
      setSelectedTimelineClipId(null)
      requestLivePreviewSeek(0)
      setLivePreviewPlaybackState('stopped')
      setDraftIntro(null)
      const res = await clearPersistedTimeline()
      if (!res.ok) {
        setSaveTimelineError(`Cleared locally, but cloud delete failed: ${res.error}`)
      }
    } finally {
      setClearingTimeline(false)
    }
  }

  async function onExportMp4() {
    const bridge = window.storyteller
    if (!bridge?.saveVideoDialog || !bridge?.exportMp4) {
      setMp4Error('MP4 export requires the Storyteller desktop app.')
      return
    }
    setMp4Error(null)
    setMp4OutputPath(null)
    const dlg = await bridge.saveVideoDialog()
    if (!dlg.ok) return
    const outputPath = 'path' in dlg ? dlg.path : ''
    if (!outputPath) return
    setMp4Busy(true)
    setMp4Status('Preparing export…')
    try {
      /**
       * Group transcript segments by asset so the main process can re-time
       * them against each timeline clip's source-window.
       */
      let segmentsByAsset: Record<string, unknown[]> | undefined
      if (burnCaptions && dbSegments.length) {
        segmentsByAsset = {}
        for (const s of dbSegments) {
          const list = segmentsByAsset[s.asset_id] ?? []
          list.push(s)
          segmentsByAsset[s.asset_id] = list
        }
      }
      const res = await bridge.exportMp4({
        outputPath,
        sequence: sequenceForExport,
        assetPathsById: assetPathsForTimeline,
        captions: burnCaptions
          ? { burn: true, segmentsByAsset: segmentsByAsset ?? {} }
          : undefined,
        soundDesign: soundDesignPayload
      })
      if (!res.ok) {
        setMp4Error(res.error)
        setMp4Status('Export failed')
      }
    } finally {
      setMp4Busy(false)
    }
  }

  async function onExportNlePackage() {
    const bridge = window.storyteller
    if (!bridge?.pickExportFolder || !bridge?.exportNlePackage) {
      setNleExportError('NLE package export requires the Storyteller desktop app.')
      return
    }
    setNleExportError(null)
    setNleExportFolderPath(null)
    const dlg = await bridge.pickExportFolder()
    if (!dlg.ok) return
    const rootPath = 'path' in dlg ? dlg.path : ''
    if (!rootPath) return
    setNleExportBusy(true)
    setNleExportStatus('Preparing NLE package…')
    const packageFolderName = project
      ? buildNlePackageFolderName(project.title, nleTarget)
      : buildNlePackageFolderName('storyteller', nleTarget)
    const checkedAssetPathsById: Record<string, string> = { ...assetPathsForTimeline }
    const missingOnDiskAssetIds = new Set<string>()
    if (bridge.verifyLocalMediaPath) {
      const checks = Object.entries(assetPathsForTimeline).map(async ([assetId, rawPath]) => {
        if (!rawPath || rawPath === 'MISSING_MEDIA') return
        if (/^file:\/\/\/StorytellerRelink\//i.test(rawPath)) return
        const decodedPath = decodeLocalPathFromFileUri(rawPath)
        if (!decodedPath) return
        const verify = await bridge.verifyLocalMediaPath(decodedPath)
        if (!verify.exists) {
          checkedAssetPathsById[assetId] = 'MISSING_MEDIA'
          missingOnDiskAssetIds.add(assetId)
        }
      })
      await Promise.all(checks)
    }
    const nleExportForWrite = exportForNle(nleTarget, {
      projectTitle: project?.title,
      sequence: sequenceForExport,
      assetPathsById: checkedAssetPathsById,
      assets,
      textOverlayRefs,
      soundDesign: soundDesignPayload
    })
    if (missingOnDiskAssetIds.size > 0) {
      const labels = [...missingOnDiskAssetIds]
        .slice(0, 3)
        .map((id) => {
          const a = assets.find((x) => x.id === id)
          return a?.original_filename || a?.local_path?.split(/[/\\]/).pop() || id.slice(0, 8)
        })
      setNleExportStatus(
        `Preparing NLE package… skipped ${
          missingOnDiskAssetIds.size
        } clip asset${missingOnDiskAssetIds.size === 1 ? '' : 's'} missing on disk (${labels.join(', ')}${
          missingOnDiskAssetIds.size > labels.length ? ', …' : ''
        })`
      )
    }
    const mediaUrisByAssetId: Record<string, string> = {}
    for (const [assetId, rawPath] of Object.entries(checkedAssetPathsById)) {
      if (!rawPath || rawPath === 'MISSING_MEDIA') continue
      if (/^file:\/\/\/StorytellerRelink\//i.test(rawPath)) continue
      mediaUrisByAssetId[assetId] = rawPath
    }
    const pkg = {
      bundleName: nleExportForWrite.bundleName,
      primaryTimeline: {
        filename: nleExportForWrite.primaryTimeline.filename,
        content: nleExportForWrite.primaryTimeline.content,
        format: nleExportForWrite.primaryTimeline.format
      },
      additionalFiles: nleExportForWrite.additionalFiles?.map((f) => ({
        filename: f.filename,
        content: f.content,
        format: f.format
      })),
      manifest: nleExportForWrite.manifest,
      readme: nleExportForWrite.readme,
      exportSummaryText: nleExportForWrite.exportSummaryText,
      mediaUrisByAssetId
    }
    try {
      const res = await bridge.exportNlePackage({ rootPath, packageFolderName, pkg })
      if (!res.ok) {
        setNleExportError(res.error)
        setNleExportStatus('Export failed')
      }
    } finally {
      setNleExportBusy(false)
    }
  }

  async function persistSequenceUpdate(
    next: TimelineSequence,
    options?: { recordHistory?: boolean; clearRedo?: boolean; persist?: boolean }
  ) {
    await applySequenceState(next, options)
  }

  async function handleAssetLibraryDrop(payload: AssetDragPayload, atSeconds: number) {
    if (!projectId || !payload.localPath?.trim()) return

    const known = assets.some((a) => a.id === payload.assetId)
    if (!known) {
      addLocalAssets(projectId, [
        {
          id: payload.assetId,
          project_id: projectId,
          asset_type: payload.assetType,
          storage_mode: 'local',
          local_path: payload.localPath,
          storage_path: null,
          proxy_path: null,
          media_hash: null,
          is_uploaded: false,
          original_filename: payload.filename,
          mime_type: null,
          upload_status: 'not_uploaded',
          probe_status: 'success',
          duration_seconds: payload.durationSeconds,
          width: null,
          height: null,
          fps: null,
          metadata_json: { borrowedFromLibrary: true, sourceProjectId: payload.projectId },
          sort_order: assets.length,
          clip_role: null,
          creator_clip_role: null,
          created_at: new Date().toISOString()
        }
      ])
    }

    const durationSeconds = payload.durationSeconds ?? 8
    const next = insertAssetClipInSequence(sequence, {
      assetId: payload.assetId,
      durationSeconds,
      atSeconds,
      role: payload.assetType === 'audio' ? 'music' : 'b-roll',
      assetType: payload.assetType
    })
    await persistSequenceUpdate(next)
  }

  /**
   * Add Text / Hook / Stat / Pause — quick-add at playhead.
   *
   * Each handler captures the current `previewSequenceSeconds`, calls the
   * timeline helper, persists the new sequence, and (for non-pause kinds)
   * remembers the just-added overlay id so the inline panel can scroll to /
   * highlight it for an immediate edit.
   *
   * If the user is on the Timeline step (no overlay panels visible yet), the
   * outer button onClicks navigate to `5. Enhance` first; the form section is
   * always visible there. We deliberately don't auto-open the form here —
   * letting the user see the new pill in the list first reads as "it worked."
   */
  async function handleAddTextOverlay(input: { content: string; subtitle?: string; durationSeconds: number; position?: OverlayEvent['position'] }): Promise<OverlayEvent | null> {
    if (!input.content.trim()) return null
    const { sequence: nextSeq, event } = addOverlayEvent(sequence, {
      kind: 'text',
      timelineInSeconds: previewSequenceSeconds,
      durationSeconds: input.durationSeconds,
      content: input.content.trim(),
      subtitle: input.subtitle?.trim() || undefined,
      position: input.position
    })
    await persistSequenceUpdate(nextSeq)
    return event
  }

  async function handleAddHookOverlay(input: { content: string; subtitle?: string; durationSeconds: number }): Promise<OverlayEvent | null> {
    if (!input.content.trim()) return null
    const { sequence: nextSeq, event } = addOverlayEvent(sequence, {
      kind: 'hook',
      timelineInSeconds: previewSequenceSeconds,
      durationSeconds: input.durationSeconds,
      content: input.content.trim(),
      subtitle: input.subtitle?.trim() || undefined,
      position: 'top'
    })
    await persistSequenceUpdate(nextSeq)
    return event
  }

  async function handleAddStatOverlay(input: {
    chart: OverlayChartKind
    value: number
    target?: number
    prefix?: string
    suffix?: string
    label?: string
    durationSeconds: number
  }): Promise<OverlayEvent | null> {
    if (!Number.isFinite(input.value)) return null
    const { sequence: nextSeq, event } = addOverlayEvent(sequence, {
      kind: 'stat',
      timelineInSeconds: previewSequenceSeconds,
      durationSeconds: input.durationSeconds,
      content: input.label?.trim() || `${input.prefix ?? ''}${input.value}${input.suffix ?? ''}`,
      stat: {
        chart: input.chart,
        value: input.value,
        target: input.target,
        prefix: input.prefix?.trim() || undefined,
        suffix: input.suffix?.trim() || undefined,
        label: input.label?.trim() || undefined
      },
      position: 'middle'
    })
    await persistSequenceUpdate(nextSeq)
    return event
  }

  async function handleUpdateOverlay(eventId: string, patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>) {
    const next = updateOverlayEvent(sequence, eventId, patch)
    if (next === sequence) return
    await persistSequenceUpdate(next)
  }

  async function handleRemoveOverlay(eventId: string) {
    const next = removeOverlayEvent(sequence, eventId)
    if (next === sequence) return
    await persistSequenceUpdate(next)
  }

  async function handleInsertPause(input: { atSeconds: number; durationSeconds: number; note?: string }): Promise<{ insertedAt: number; durationSec: number; snapped: boolean } | null> {
    const result = insertPauseGap(sequence, {
      atSeconds: input.atSeconds,
      durationSeconds: input.durationSeconds,
      note: input.note?.trim() || undefined
    })
    await persistSequenceUpdate(result.sequence)
    return { insertedAt: result.insertedAtSeconds, durationSec: result.durationSeconds, snapped: result.snapped }
  }

  async function handleRemovePause(pauseClipId: string) {
    const next = removePauseGap(sequence, pauseClipId)
    if (next === sequence) return
    await persistSequenceUpdate(next)
  }

  /**
   * Click handler for the four header buttons in 5. Enhance. Each one
   * scrolls smoothly to the matching panel and (when the user is mid-typing
   * elsewhere) gives the panel input a brief focus ring via :target. We
   * also use this same handler when the user is on the Timeline step and
   * jumps over with one click — the parent step state already changes via
   * the normal sidebar nav; here we just scroll once they're on Enhance.
   */
  function scrollToEnhanceSection(
    sectionId: 'enhance-text' | 'enhance-hook' | 'enhance-stat' | 'enhance-pause' | 'enhance-graphics'
  ) {
    setActiveStep('enhance')
    if (sectionId === 'enhance-text' || sectionId === 'enhance-hook' || sectionId === 'enhance-stat') {
      const details = document.getElementById('enhance-custom-overlays') as HTMLDetailsElement | null
      if (details) details.open = true
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  /**
   * Map *any* prompt list (typed loosely on purpose — both `BrollPrompt` and the
   * "row-shape" returned by the writer satisfy it) to timeline slots and persist.
   * Used by both the manual "Map all to timeline" button and the auto-map step
   * after generating beat prompts.
   */
  async function autoMapPromptsToTimeline(
    prompts: Omit<BrollPrompt, 'id' | 'created_at'>[]
  ): Promise<number> {
    if (prompts.length === 0) return 0
    const rows = prompts.map((b) => ({
      segment_start: b.segment_start,
      segment_end: b.segment_end,
      prompt_type: b.prompt_type,
      metadata_json: b.metadata_json ?? undefined
    }))
    const slots = buildBrollSlotsFromPrompts(sequence, rows, projectId)
    if (slots.length === 0) return 0
    const withTrack = ensureBrollVideoTrack(sequence)
    await persistSequenceUpdate({ ...withTrack, brollSlots: slots })
    return slots.length
  }

  function buildGraphicsPromptRowsFromAiIdeas(): Array<{
    segment_start: number
    segment_end: number
    kind: 'graph-image' | 'text-image' | 'motion-overlay'
    promptText?: string
    metadata_json?: Record<string, unknown>
  }> {
    const rows: Array<{
      segment_start: number
      segment_end: number
      kind: 'graph-image' | 'text-image' | 'motion-overlay'
      promptText?: string
      metadata_json?: Record<string, unknown>
    }> = []
    for (const row of enhanceTopLayerRows) {
      const fullSoundbite = soundbites.find((s) => s.id === row.soundbite.id) ?? row.soundbite
      const effectivePrompts = getEffectiveTopLayerPrompts(row.soundbite.id, row.recommendation)
      const baseMeta: Record<string, unknown> = {
        sourceSegmentId: ((fullSoundbite as { tags_json?: Record<string, unknown> | null }).tags_json?.segment_id ??
          null) as string | null,
        soundbiteId: row.soundbite.id,
        promptKey: topLayerStillPromptKey(row.soundbite.id),
        topLayerMode: row.recommendation.mode,
        styleTags: row.recommendation.styleTags ?? [],
        style: row.recommendation.style
      }
      rows.push({
        segment_start: row.soundbite.start_time,
        segment_end: row.soundbite.end_time,
        kind: row.recommendation.primaryKind,
        promptText: effectivePrompts.stillPrompt,
        metadata_json: baseMeta
      })
    }
    return rows
  }

  async function onMapGraphicsSlotsToTimeline() {
    setGraphicsMapBusy(true)
    setGraphicsError(null)
    setGraphicsStatus(null)
    try {
      const rows = buildGraphicsPromptRowsFromAiIdeas()
      if (rows.length === 0) {
        setGraphicsError('No grounded graphics prompts are available yet. Re-run Review analysis first.')
        return
      }
      const slots = buildGraphicsSlotsFromPrompts(sequence, rows, projectId)
      if (slots.length === 0) {
        setGraphicsError('Could not map graphics prompts to timeline windows.')
        return
      }
      const withTrack = ensureGraphicsVideoTrack(sequence)
      await persistSequenceUpdate({
        ...withTrack,
        graphicsSlots: slots.map((slot) => ({
          ...slot,
          referenceImageAssetId:
            slot.kind === 'motion-overlay'
              ? resolveStillReferenceAssetId(
                  String((slot.metadata as { soundbiteId?: string } | undefined)?.soundbiteId ?? '')
                ) ?? slot.referenceImageAssetId
              : slot.referenceImageAssetId
        }))
      })
      setGraphicsStatus(`Mapped ${slots.length} graphics slot(s) onto the top graphics layer.`)
    } finally {
      setGraphicsMapBusy(false)
    }
  }

  function existingGraphicsSlotByPromptKey(promptKey: string): GraphicsSlot | null {
    return (
      sequence.graphicsSlots?.find(
        (slot) => (slot.metadata as { promptKey?: string } | undefined)?.promptKey === promptKey
      ) ?? null
    )
  }

  function stillSlotForSoundbite(soundbiteId: string): GraphicsSlot | null {
    return existingGraphicsSlotByPromptKey(topLayerStillPromptKey(soundbiteId))
  }

  function motionSlotForSoundbite(soundbiteId: string): GraphicsSlot | null {
    return existingGraphicsSlotByPromptKey(topLayerMotionPromptKey(soundbiteId))
  }

  function getEffectiveTopLayerPrompts(
    soundbiteId: string,
    recommendation: TopLayerRecommendation
  ): { stillPrompt: string; motionPrompt: string | undefined } {
    const override = topLayerPromptOverrides[soundbiteId]
    return {
      stillPrompt: override?.stillPrompt ?? recommendation.stillPrompt,
      motionPrompt: override?.motionPrompt ?? recommendation.motionPrompt
    }
  }

  function startEditingTopLayerPrompts(soundbiteId: string, recommendation: TopLayerRecommendation): void {
    const effective = getEffectiveTopLayerPrompts(soundbiteId, recommendation)
    setTopLayerEditDraft({
      stillPrompt: effective.stillPrompt,
      motionPrompt: effective.motionPrompt ?? ''
    })
    setEditingTopLayerRowId(soundbiteId)
  }

  function saveTopLayerPromptEdits(soundbiteId: string): void {
    const stillPrompt = topLayerEditDraft.stillPrompt.trim()
    if (!stillPrompt) {
      setGraphicsError('Still prompt text is required.')
      return
    }
    setTopLayerPromptOverrides((prev) => ({
      ...prev,
      [soundbiteId]: {
        stillPrompt,
        motionPrompt: topLayerEditDraft.motionPrompt.trim() || undefined
      }
    }))
    setEditingTopLayerRowId(null)
    setGraphicsError(null)
  }

  function resolveStillReferenceAssetId(soundbiteId: string): string | undefined {
    const rowUpload = topLayerRowRefUploads[soundbiteId]
    if (rowUpload?.assetId) return rowUpload.assetId
    const rowAssetId = topLayerRowRefAssetIds[soundbiteId]
    if (rowAssetId) return rowAssetId
    const stillSlot = stillSlotForSoundbite(soundbiteId)
    if (stillSlot?.generatedAssetId) return stillSlot.generatedAssetId
    return activeGraphicsReferenceAssetId()
  }

  async function resolveStillReferenceImageUrl(
    soundbiteId: string
  ): Promise<{ url: string; assetId: string } | null> {
    const rowUpload = topLayerRowRefUploads[soundbiteId]
    if (rowUpload) {
      return { url: rowUpload.signedUrl, assetId: rowUpload.assetId }
    }
    const rowAssetId = topLayerRowRefAssetIds[soundbiteId]
    if (rowAssetId) {
      if (graphicsReferenceImage?.assetId === rowAssetId) {
        return { url: graphicsReferenceImage.signedUrl, assetId: rowAssetId }
      }
      const rowRefAsset = assets.find((a) => a.id === rowAssetId)
      if (rowRefAsset?.storage_path && supabaseWhenSignedIn) {
        const signed = await getSignedAssetUrl(supabaseWhenSignedIn, rowRefAsset.storage_path, 60 * 60)
        if (signed) return { url: signed, assetId: rowAssetId }
      }
    }

    const stillSlot = stillSlotForSoundbite(soundbiteId)
    const assetId = stillSlot?.generatedAssetId ?? activeGraphicsReferenceAssetId()
    if (!assetId) return null

    if (stillSlot?.generatedAssetId) {
      const stillAsset = assets.find((a) => a.id === stillSlot.generatedAssetId)
      if (!stillAsset) return null
      if (stillAsset.storage_path && supabaseWhenSignedIn) {
        const signed = await getSignedAssetUrl(supabaseWhenSignedIn, stillAsset.storage_path, 60 * 60)
        if (signed) return { url: signed, assetId: stillAsset.id }
      }
      if (stillAsset.local_path && supabaseWhenSignedIn) {
        const read = await window.storyteller?.readLocalFile?.(stillAsset.local_path)
        if (read?.ok && read.bytes) {
          const ext = stillAsset.local_path.split('.').pop()?.toLowerCase() || 'png'
          const mime =
            ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
          const uploadAssetId = crypto.randomUUID()
          const upload = await uploadReferenceImageToStorage(supabaseWhenSignedIn, {
            projectId,
            file: new File([read.bytes], `still-${uploadAssetId}.${ext}`, { type: mime }),
            assetId: uploadAssetId
          })
          if (upload.storagePath) {
            const signed = await getSignedAssetUrl(supabaseWhenSignedIn, upload.storagePath, 60 * 60)
            if (signed) return { url: signed, assetId: uploadAssetId }
          }
        }
      }
    }

    if (graphicsReferenceImage?.assetId === assetId) {
      return { url: graphicsReferenceImage.signedUrl, assetId }
    }
    const refAsset = assets.find((a) => a.id === assetId)
    if (refAsset?.storage_path && supabaseWhenSignedIn) {
      const signed = await getSignedAssetUrl(supabaseWhenSignedIn, refAsset.storage_path, 60 * 60)
      if (signed) return { url: signed, assetId }
    }
    return null
  }

  function activeGraphicsReferenceAssetId(): string | undefined {
    return graphicsReferenceImage?.assetId ?? selectedGraphicsRefAssetId ?? undefined
  }

  async function onAttachGraphicsReferenceImage(file: File) {
    if (!project) return
    if (!supabaseWhenSignedIn) {
      setGraphicsError('Reference images need a signed-in Supabase session so Storyteller can create a URL for motion generation.')
      return
    }
    setGraphicsError(null)
    setGraphicsStatus('Uploading graphics reference image…')
    const assetId = crypto.randomUUID()
    const upload = await uploadReferenceImageToStorage(supabaseWhenSignedIn, {
      projectId,
      file,
      assetId
    })
    if (upload.error || !upload.storagePath) {
      setGraphicsError(`Reference image upload failed: ${upload.error ?? 'unknown error'}`)
      setGraphicsStatus(null)
      return
    }
    const signedUrl = await getSignedAssetUrl(supabaseWhenSignedIn, upload.storagePath, 60 * 60)
    if (!signedUrl) {
      setGraphicsError('Reference image uploaded, but Storyteller could not create a signed URL for generation.')
      setGraphicsStatus(null)
      return
    }
    setSelectedGraphicsRefAssetId(null)
    setGraphicsReferenceImage({ assetId, signedUrl, label: file.name || 'Uploaded reference image' })
    setGraphicsStatus('Graphics reference image attached.')
  }

  async function onAttachTopLayerRowReferenceImage(soundbiteId: string, file: File) {
    if (!project) return
    if (!supabaseWhenSignedIn) {
      setGraphicsError('Reference images need a signed-in Supabase session so Storyteller can create a URL for motion generation.')
      return
    }
    setGraphicsError(null)
    setGraphicsStatus('Uploading motion reference image…')
    const assetId = crypto.randomUUID()
    const upload = await uploadReferenceImageToStorage(supabaseWhenSignedIn, {
      projectId,
      file,
      assetId
    })
    if (upload.error || !upload.storagePath) {
      setGraphicsError(`Reference image upload failed: ${upload.error ?? 'unknown error'}`)
      setGraphicsStatus(null)
      return
    }
    const signedUrl = await getSignedAssetUrl(supabaseWhenSignedIn, upload.storagePath, 60 * 60)
    if (!signedUrl) {
      setGraphicsError('Reference image uploaded, but Storyteller could not create a signed URL for generation.')
      setGraphicsStatus(null)
      return
    }
    setTopLayerRowRefAssetIds((prev) => ({ ...prev, [soundbiteId]: null }))
    setTopLayerRowRefUploads((prev) => ({
      ...prev,
      [soundbiteId]: { assetId, signedUrl, label: file.name || 'Uploaded reference image' }
    }))
    setGraphicsStatus('Motion reference image attached for this soundbite.')
  }

  async function mapSingleGraphicsPromptToTimeline(input: {
    soundbite: (typeof soundbites)[number] | EnhanceTopLayerRow['soundbite']
    kind: GraphicsPromptKind
    promptText: string
    styleTags?: string[]
    style?: GraphicsStyleCue
    promptKey?: string
    topLayerMode?: TopLayerRecommendation['mode']
  }): Promise<{ slot: GraphicsSlot; sequence: TimelineSequence } | null> {
    const promptKey =
      input.promptKey ??
      (input.kind === 'motion-overlay'
        ? topLayerMotionPromptKey(input.soundbite.id)
        : topLayerStillPromptKey(input.soundbite.id))
    const existing = existingGraphicsSlotByPromptKey(promptKey)
    if (existing) {
      // Slot already exists — update promptText if it changed, then return
      if (existing.promptText === input.promptText) {
        return { slot: existing, sequence }
      }
      const updatedSlots = (sequence.graphicsSlots ?? []).map((s) =>
        s.id === existing.id ? { ...s, promptText: input.promptText } : s
      )
      const nextSeq = { ...sequence, graphicsSlots: updatedSlots }
      await persistSequenceUpdate(nextSeq)
      return { slot: { ...existing, promptText: input.promptText }, sequence: nextSeq }
    }
    const sourceSegmentId = String(
      ((input.soundbite as { tags_json?: Record<string, unknown> | null }).tags_json?.segment_id ?? '') || ''
    ).trim()
    const referenceForMotion =
      input.kind === 'motion-overlay' ? resolveStillReferenceAssetId(input.soundbite.id) : undefined
    const rows = [
      {
        id: promptKey,
        segment_start: input.soundbite.start_time,
        segment_end: input.soundbite.end_time,
        kind: input.kind,
        promptText: input.promptText,
        metadata_json: {
          sourceSegmentId: sourceSegmentId || undefined,
          soundbiteId: input.soundbite.id,
          promptKey,
          topLayerMode: input.topLayerMode,
          styleTags: input.styleTags ?? [],
          style: input.style,
          referenceImageAssetId: referenceForMotion
        }
      }
    ] as const
    const built = buildGraphicsSlotsFromPrompts(sequence, rows as any, projectId)
    if (built.length === 0) return null
    const slot = built[0]!
    // Filter by BOTH slot ID and promptKey to prevent duplicates when the same
    // soundbite ID was used with a different prompt key in another section.
    const merged = [
      ...(sequence.graphicsSlots ?? []).filter(
        (s) =>
          s.id !== slot.id &&
          (s.metadata as { promptKey?: string } | undefined)?.promptKey !== promptKey
      ),
      {
        ...slot,
        referenceImageAssetId:
          slot.kind === 'motion-overlay'
            ? resolveStillReferenceAssetId(input.soundbite.id) ?? slot.referenceImageAssetId
            : slot.referenceImageAssetId
      }
    ]
    const withTrack = ensureGraphicsVideoTrack(sequence)
    const nextSequence = { ...withTrack, graphicsSlots: merged }
    await persistSequenceUpdate(nextSequence)
    return { slot: merged.find((s) => s.id === slot.id) ?? slot, sequence: nextSequence }
  }

  async function onAddGraphicsPromptToTimeline(input: {
    soundbite: (typeof soundbites)[number] | EnhanceTopLayerRow['soundbite']
    kind: GraphicsPromptKind
    promptText: string
    styleTags?: string[]
    style?: GraphicsStyleCue
    topLayerMode?: TopLayerRecommendation['mode']
  }) {
    setGraphicsError(null)
    const mapped = await mapSingleGraphicsPromptToTimeline(input)
    if (!mapped) {
      setGraphicsError('Could not place this graphics prompt on timeline.')
      return
    }
    setGraphicsStatus('Graphics prompt placed on timeline layer.')
  }

  async function onGenerateGraphicsImagePrompt(input: {
    soundbite: (typeof soundbites)[number] | EnhanceTopLayerRow['soundbite']
    kind: Extract<GraphicsPromptKind, 'graph-image' | 'text-image'>
    promptText: string
    styleTags?: string[]
    style?: GraphicsStyleCue
    topLayerMode?: TopLayerRecommendation['mode']
    imageStyle?: 'visual' | 'text'
  }) {
    const busyKey = `still:${input.soundbite.id}`
    setGraphicsActionBusyKey(busyKey)
    setGraphicsError(null)
    setGraphicsStatus(null)
    try {
      if (!project) return
      const mapped = await mapSingleGraphicsPromptToTimeline(input)
      if (!mapped) {
        setGraphicsError('Could not place this prompt on timeline before generation.')
        return
      }
      const slot = mapped.slot
      const ratio: BrollRatio = editFormat === 'vertical' ? '720:1280' : '1280:720'

      if (mediaGatewayEnabled && hasMediaGenerationBridge({ hostedGateway: true, localProvider: 'higgsfield' })) {
        const seqForJob = setGraphicsSlotStatus(mapped.sequence, slot.id, {
          status: 'generating',
          promptText: input.promptText
        })
        await persistSequenceUpdate(seqForJob)
        if (mediaGatewayEnabled) setMediaGenSlotId(slot.id)
        const accessToken = await getGatewayAccessToken()
        const res = await generateConceptFrame({
          projectId,
          slotId: slot.id,
          promptText: input.promptText,
          ratio,
          imageStyle: input.imageStyle,
          accessToken,
          topLayerMode: input.topLayerMode,
          style: input.style,
          styleTags: input.styleTags,
          audit: {
            stylePackId: effectivePromptPack.id,
            promptCategory:
              input.topLayerMode === 'typography'
                ? 'typography-still'
                : input.topLayerMode === 'stat'
                  ? 'stat-still'
                  : input.topLayerMode === 'empire'
                    ? 'empire-still'
                    : 'graphics-still'
          }
        })
        if (!res.ok) {
          await persistSequenceUpdate(
            setGraphicsSlotStatus(seqForJob, slot.id, { status: 'failed', errorMessage: res.error })
          )
          setGraphicsError(res.error)
          return
        }
        const asset = res.asset
        addLocalAssets(projectId, [asset])
        const dur = asset.duration_seconds ?? slot.suggestedDurationSeconds ?? 4
        const next = attachGeneratedGraphicsClip(
          setGraphicsSlotStatus(seqForJob, slot.id, {
            status: 'ready',
            generatedAssetId: asset.id,
            errorMessage: undefined
          }),
          slot.id,
          asset.id,
          dur
        )
        await persistSequenceUpdate(next)
        setGraphicsStatus('Top Layer still generated and attached to timeline.')
        return
      }

      await persistSequenceUpdate(
        setGraphicsSlotStatus(mapped.sequence, slot.id, {
          status: 'queued',
          promptText: input.promptText
        })
      )
      await navigator.clipboard.writeText(input.promptText)
      setGraphicsStatus('Still prompt copied. Paste into your image provider, then use Animate when ready.')
    } catch (e) {
      setGraphicsError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mediaGatewayEnabled) setMediaGenSlotId(null)
      setGraphicsActionBusyKey(null)
    }
  }

  async function onGenerateMotionFromImagePrompt(input: {
    soundbite: (typeof soundbites)[number] | EnhanceTopLayerRow['soundbite']
    promptText: string
    styleTags?: string[]
    style?: GraphicsStyleCue
  }) {
    const busyKey = `motion:${input.soundbite.id}`
    setGraphicsActionBusyKey(busyKey)
    setGraphicsError(null)
    setGraphicsStatus(null)
    try {
      if (!project) return
      if (!hasMediaGenerationBridge({ hostedGateway: mediaGatewayEnabled, localProvider: 'higgsfield' })) {
        setGraphicsError('Motion generation requires the Storyteller desktop app.')
        return
      }
      if (!mediaGatewayEnabled && !higgsfieldConfigured) {
        setGraphicsError('Sign in for hosted motion generation, or enable internal BYOK for local dev.')
        return
      }
      const mapped = await mapSingleGraphicsPromptToTimeline({
        soundbite: input.soundbite,
        kind: 'motion-overlay',
        promptText: input.promptText,
        styleTags: input.styleTags,
        style: input.style
      })
      if (!mapped) {
        setGraphicsError('Could not place motion prompt on timeline.')
        return
      }
      const slot = mapped.slot
      const dur = slot.suggestedDurationSeconds || 5
      const stillRef = await resolveStillReferenceImageUrl(input.soundbite.id)
      const referenceImageUrl = stillRef?.url
      const referenceAssetId = stillRef?.assetId
      const seqForJob = setGraphicsSlotStatus(mapped.sequence, slot.id, {
        status: 'generating',
        referenceImageAssetId: referenceAssetId,
        promptText: input.promptText
      })
      await persistSequenceUpdate(seqForJob)
      const ratio: BrollRatio = editFormat === 'vertical' ? '720:1280' : '1280:720'
      const accessToken = await getGatewayAccessToken()
      if (mediaGatewayEnabled) setMediaGenSlotId(slot.id)
      const res = await generateVideoClip({
        hostedGateway: mediaGatewayEnabled,
        localProvider: 'higgsfield',
        projectId,
        slotId: slot.id,
        promptText: input.promptText,
        ratio,
        durationSeconds: dur,
        referenceImageUrl,
        higgsfieldModelId,
        accessToken,
        audit: {
          stylePackId: effectivePromptPack.id,
          promptCategory: 'graphics-motion'
        }
      })
      if (!res.ok) {
        await persistSequenceUpdate(
          setGraphicsSlotStatus(seqForJob, slot.id, { status: 'failed', errorMessage: res.error })
        )
        setGraphicsError(res.error)
        return
      }
      const asset = res.asset
      addLocalAssets(projectId, [asset])
      const next = attachGeneratedGraphicsClip(
        setGraphicsSlotStatus(seqForJob, slot.id, {
          status: 'ready',
          generatedAssetId: asset.id,
          errorMessage: undefined
        }),
        slot.id,
        asset.id,
        asset.duration_seconds ?? dur
      )
      await persistSequenceUpdate(next)
      setGraphicsStatus('Top Layer motion generated and attached to timeline.')
    } catch (e) {
      setGraphicsError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mediaGatewayEnabled) setMediaGenSlotId(null)
      setGraphicsActionBusyKey(null)
    }
  }

  async function onResetGraphicsSlot(slotId: string) {
    const next = setGraphicsSlotStatus(sequence, slotId, {
      status: 'empty',
      generatedAssetId: undefined,
      errorMessage: undefined
    })
    await persistSequenceUpdate(next)
  }

  async function deleteGraphicsSlot(slotId: string) {
    // Remove slot from graphicsSlots and the linked clip from v-graphics
    const nextSlots = (sequence.graphicsSlots ?? []).filter((s) => s.id !== slotId)
    const videoTracks = sequence.videoTracks.map((track) => {
      if (track.id !== 'v-graphics') return track
      return {
        ...track,
        clips: track.clips.filter(
          (c) => (c.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId !== slotId
        )
      }
    })
    await persistSequenceUpdate({ ...sequence, graphicsSlots: nextSlots, videoTracks })
  }

  async function onMapBrollSlotsToTimeline() {
    if (!project) return
    setBrollMapBusy(true)
    try {
      const mapped = await autoMapPromptsToTimeline(displayBrolls)
      if (mapped === 0) {
        setBrollGenError('Could not map prompts to the current timeline — build an intro (or rough cut) first.')
        return
      }
      setBrollGenError(null)
      setBrollGenStatus(`Mapped ${mapped} B-roll slot(s) to the timeline.`)
    } finally {
      setBrollMapBusy(false)
    }
  }

  /**
   * Flip a slot back to `empty` so the user can re-generate it. Useful when a
   * prior session crashed mid-Runway and persisted the slot as `generating`
   * forever, or when the user wants to throw away a generated clip and try
   * again. We deliberately keep `generatedAssetId` null so the next
   * generation creates a fresh asset instead of overwriting a clip that
   * might still be referenced elsewhere.
   */
  async function onResetSlot(slotId: string) {
    if (!project) return
    const next = setSlotStatus(sequence, slotId, {
      status: 'empty',
      errorMessage: undefined,
      runwayTaskId: undefined,
      higgsfieldRequestId: undefined
    })
    await persistSequenceUpdate(next)
    if (runwaySlotId === slotId) setRunwaySlotId(null)
    if (higgsfieldSlotId === slotId) setHiggsfieldSlotId(null)
  }

  /**
   * Save the user's Higgsfield BYOK credentials. The renderer never sees
   * what's already stored — we just hand the new values to main, which
   * encrypts via OS keychain and re-checks `:status`.
   */
  async function onSaveHiggsfieldCredentials() {
    setHiggsfieldStatusMsg('Saving…')
    const bridge = window.storyteller?.saveHiggsfieldCredentials
    if (!bridge) {
      setHiggsfieldStatusMsg('Higgsfield BYOK requires the Storyteller desktop app.')
      return
    }
    const res = await bridge({
      apiKey: higgsfieldKeyDraft.trim(),
      apiSecret: higgsfieldSecretDraft.trim()
    })
    if (!res.ok) {
      setHiggsfieldStatusMsg(`Save failed: ${res.error}`)
      return
    }
    setHiggsfieldKeyDraft('')
    setHiggsfieldSecretDraft('')
    setHiggsfieldStatusMsg('Credentials saved to OS keychain.')
    const status = await window.storyteller?.getHiggsfieldStatus?.()
    setHiggsfieldConfigured(Boolean(status?.configured))
  }

  async function onClearHiggsfieldCredentials() {
    const bridge = window.storyteller?.clearHiggsfieldCredentials
    if (!bridge) return
    const res = await bridge()
    if (!res.ok) {
      setHiggsfieldStatusMsg(`Clear failed: ${res.error}`)
      return
    }
    setHiggsfieldStatusMsg('Credentials cleared.')
    setHiggsfieldConfigured(false)
  }

  async function onTestHiggsfieldCredentials() {
    setHiggsfieldStatusMsg('Testing connection…')
    const bridge = window.storyteller?.testHiggsfieldCredentials
    if (!bridge) {
      setHiggsfieldStatusMsg('Test bridge unavailable.')
      return
    }
    const res = await bridge()
    setHiggsfieldStatusMsg(res.ok ? 'Higgsfield credentials look good.' : `Test failed: ${res.error}`)
  }

  /**
   * Pick a still image from disk and upload it to Supabase Storage, then
   * sign a long-TTL URL Higgsfield can fetch and stash both on the slot
   * (canonical) and in component state (memory-only signed URL).
   */
  async function onAttachReferenceImageForSlot(slotId: string, file: File) {
    if (!project) return
    if (!supabaseWhenSignedIn) {
      setBrollGenError(
        'Reference images need a Supabase session — sign in or run the desktop app online to attach an image.'
      )
      return
    }
    setHiggsfieldStatusMsg('Uploading reference image…')
    const assetId = crypto.randomUUID()
    const upload = await uploadReferenceImageToStorage(supabaseWhenSignedIn, {
      projectId,
      file,
      assetId
    })
    if (upload.error || !upload.storagePath) {
      setHiggsfieldStatusMsg(`Upload failed: ${upload.error ?? 'unknown error'}`)
      return
    }
    /**
     * Higgsfield's queue can take 5+ min in worst case. Sign for 1 hour to
     * give plenty of headroom; we don't refresh signed URLs mid-job, so
     * if we ever raise the timeout we should raise this too.
     */
    const signedUrl = await getSignedAssetUrl(supabaseWhenSignedIn, upload.storagePath, 60 * 60)
    if (!signedUrl) {
      setHiggsfieldStatusMsg('Image uploaded but signing the URL failed — try again.')
      return
    }
    setHiggsfieldRefImages((prev) => ({
      ...prev,
      [slotId]: { assetId, signedUrl, thumbnailUrl: signedUrl }
    }))
    const next = setSlotStatus(sequence, slotId, {
      referenceImageAssetId: assetId,
      providerTarget: 'higgsfield'
    })
    await persistSequenceUpdate(next)
    setHiggsfieldStatusMsg('Reference image attached.')
  }

  async function onGenerateHiggsfieldForSlot(
    slotId: string,
    promptBody: string,
    /**
     * Optional sequence override. When the caller just-mapped a new slot
     * onto the timeline (per-prompt flow), the React `sequence` closure is
     * still stale until the next render — passing the freshly-built
     * sequence here keeps the slot-status patch from operating on a
     * snapshot that doesn't contain the new slot.
     */
    baseSequence?: TimelineSequence
  ) {
    if (!hasMediaGenerationBridge({ hostedGateway: mediaGatewayEnabled, localProvider: 'higgsfield' })) {
      setBrollGenError('Video generation requires the Storyteller desktop app.')
      return
    }
    if (!project) return
    if (!mediaGatewayEnabled && !higgsfieldConfigured) {
      setBrollGenError('Sign in for hosted video generation, or enable internal BYOK for local dev.')
      return
    }
    /**
     * Reference image is now optional. When attached → image-to-video; when
     * absent → text-to-video. Make sure the user picked a model id that
     * matches their intent (we don't auto-switch models because Higgsfield
     * SKUs are not interchangeable).
     */
    const ref = higgsfieldRefImages[slotId]
    if (mediaGatewayEnabled) setMediaGenSlotId(slotId)
    else setHiggsfieldSlotId(slotId)
    setHiggsfieldLineStatus(ref ? 'Starting (image-to-video)…' : 'Starting (text-to-video)…')
    setBrollGenError(null)
    try {
      const seqForJob = baseSequence ?? sequence
      const genSeq = setSlotStatus(seqForJob, slotId, {
        status: 'generating',
        providerTarget: 'higgsfield'
      })
      await persistSequenceUpdate(genSeq)
      const ratio: BrollRatio = editFormat === 'vertical' ? '720:1280' : '1280:720'
      const slot = genSeq.brollSlots?.find((s) => s.id === slotId)
      const dur = slot?.suggestedDurationSeconds ?? 5
      const accessToken = await getGatewayAccessToken()
      const res = await generateVideoClip({
        hostedGateway: mediaGatewayEnabled,
        localProvider: 'higgsfield',
        projectId,
        slotId,
        promptText: promptBody,
        referenceImageUrl: ref?.signedUrl,
        higgsfieldModelId,
        ratio,
        durationSeconds: dur,
        accessToken,
        audit: {
          stylePackId: effectivePromptPack.id,
          promptCategory: slot?.context
        }
      })
      if (!res.ok) {
        await persistSequenceUpdate(
          setSlotStatus(genSeq, slotId, { status: 'failed', errorMessage: res.error })
        )
        setBrollGenError(res.error)
        return
      }
      const asset = res.asset
      addLocalAssets(projectId, [asset])
      const durSec = asset.duration_seconds ?? dur
      const next = attachGeneratedBrollClip(genSeq, slotId, asset.id, durSec)
      await persistSequenceUpdate(
        setSlotStatus(next, slotId, { higgsfieldRequestId: res.jobId })
      )
      setHiggsfieldLineStatus('Ready — attached to timeline')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await persistSequenceUpdate(
        setSlotStatus(baseSequence ?? sequence, slotId, { status: 'failed', errorMessage: msg })
      )
      setBrollGenError(msg)
    } finally {
      if (mediaGatewayEnabled) setMediaGenSlotId(null)
      else setHiggsfieldSlotId(null)
    }
  }

  async function onGenerateRunwayForSlot(
    slotId: string,
    promptBody: string,
    /**
     * Optional sequence override — see comment on the Higgsfield variant.
     * Per-prompt callers pass the freshly-mapped sequence so the
     * slot-status patch operates on a snapshot that already contains the
     * new slot.
     */
    baseSequence?: TimelineSequence
  ) {
    if (!hasMediaGenerationBridge({ hostedGateway: mediaGatewayEnabled, localProvider: 'runway' })) {
      setBrollGenError('Video generation requires the Storyteller desktop app.')
      return
    }
    if (!project) return
    if (mediaGatewayEnabled) setMediaGenSlotId(slotId)
    else setRunwaySlotId(slotId)
    setRunwayLineStatus('Starting…')
    setBrollGenError(null)
    try {
      const seqForJob = baseSequence ?? sequence
      const genSeq = setSlotStatus(seqForJob, slotId, { status: 'generating' })
      await persistSequenceUpdate(genSeq)
      const ratio: BrollRatio = editFormat === 'vertical' ? '720:1280' : '1280:720'
      const slot = genSeq.brollSlots?.find((s) => s.id === slotId)
      const dur = slot?.suggestedDurationSeconds ?? 5
      const accessToken = await getGatewayAccessToken()
      const res = await generateVideoClip({
        hostedGateway: mediaGatewayEnabled,
        localProvider: 'runway',
        projectId,
        slotId,
        promptText: promptBody,
        ratio,
        durationSeconds: dur,
        accessToken,
        audit: {
          stylePackId: effectivePromptPack.id,
          promptCategory: slot?.context
        }
      })
      if (!res.ok) {
        await persistSequenceUpdate(setSlotStatus(genSeq, slotId, { status: 'failed', errorMessage: res.error }))
        setBrollGenError(res.error)
        return
      }
      const asset = res.asset
      addLocalAssets(projectId, [asset])
      const durSec = asset.duration_seconds ?? dur
      const next = attachGeneratedBrollClip(genSeq, slotId, asset.id, durSec)
      await persistSequenceUpdate(next)
      setRunwayLineStatus('Ready — attached to timeline')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await persistSequenceUpdate(setSlotStatus(baseSequence ?? sequence, slotId, { status: 'failed', errorMessage: msg }))
      setBrollGenError(msg)
    } finally {
      if (mediaGatewayEnabled) setMediaGenSlotId(null)
      else setRunwaySlotId(null)
    }
  }

  /**
   * Native Kling API slot generation (similar to Runway).
   */
  async function onGenerateKlingForSlot(
    slotId: string,
    promptBody: string,
    baseSequence?: TimelineSequence
  ) {
    if (!hasMediaGenerationBridge({ hostedGateway: mediaGatewayEnabled, localProvider: 'kling' })) {
      setBrollGenError('Video generation requires the Storyteller desktop app.')
      return
    }
    if (!project) return
    if (mediaGatewayEnabled) setMediaGenSlotId(slotId)
    else setKlingSlotId(slotId)
    setKlingLineStatus('Starting…')
    setBrollGenError(null)
    try {
      const seqForJob = baseSequence ?? sequence
      const genSeq = setSlotStatus(seqForJob, slotId, { status: 'generating' })
      await persistSequenceUpdate(genSeq)
      const ratio: BrollRatio = editFormat === 'vertical' ? '9:16' : '16:9'
      const slot = genSeq.brollSlots?.find((s) => s.id === slotId)
      const dur = slot?.suggestedDurationSeconds ?? 5
      const accessToken = await getGatewayAccessToken()
      const res = await generateVideoClip({
        hostedGateway: mediaGatewayEnabled,
        localProvider: 'kling',
        projectId,
        slotId,
        promptText: promptBody,
        ratio,
        durationSeconds: dur,
        accessToken,
        audit: {
          stylePackId: effectivePromptPack.id,
          promptCategory: slot?.context
        }
      })
      if (!res.ok) {
        await persistSequenceUpdate(setSlotStatus(genSeq, slotId, { status: 'failed', errorMessage: res.error }))
        setBrollGenError(res.error)
        return
      }
      const asset = res.asset
      addLocalAssets(projectId, [asset])
      const durSec = asset.duration_seconds ?? dur
      const next = attachGeneratedBrollClip(genSeq, slotId, asset.id, durSec)
      await persistSequenceUpdate(next)
      setKlingLineStatus('Ready — attached to timeline')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await persistSequenceUpdate(setSlotStatus(baseSequence ?? sequence, slotId, { status: 'failed', errorMessage: msg }))
      setBrollGenError(msg)
    } finally {
      if (mediaGatewayEnabled) setMediaGenSlotId(null)
      else setKlingSlotId(null)
    }
  }

  /**
   * Map a single prompt to a B-roll slot on the timeline (without
   * touching any other already-mapped slots), persist the change, and
   * return the freshly built slot plus the post-merge sequence so a
   * follow-up generate call can run against a snapshot that already
   * contains the new slot.
   *
   * Used by the per-card "Generate with Runway / Kling / Higgsfield" buttons so
   * users can render B-roll one prompt at a time without first batch-
   * mapping every prompt to the timeline.
   */
  async function mapSinglePromptToTimeline(
    promptIndex: number
  ): Promise<{ slot: BrollSlot; sequence: TimelineSequence } | null> {
    const prompt = displayBrolls[promptIndex]
    if (!prompt) return null
    const row: Omit<BrollPrompt, 'id' | 'created_at'> = {
      project_id: prompt.project_id ?? projectId,
      segment_start: prompt.segment_start,
      segment_end: prompt.segment_end,
      prompt_type: prompt.prompt_type,
      prompt_text: prompt.prompt_text,
      priority_score: prompt.priority_score ?? null,
      metadata_json: prompt.metadata_json ?? null
    }
    const built = buildBrollSlotsFromPrompts(sequence, [row], projectId, promptIndex)
    if (built.length === 0) return null
    const newSlot = built[0]!
    const existing = sequence.brollSlots ?? []
    const merged = [...existing.filter((s) => s.id !== newSlot.id), newSlot]
    const withTrack = ensureBrollVideoTrack(sequence)
    const nextSequence: TimelineSequence = { ...withTrack, brollSlots: merged }
    await persistSequenceUpdate(nextSequence)
    return { slot: newSlot, sequence: nextSequence }
  }

  /**
   * Per-card Runway entry point. If the prompt already has a mapped
   * slot, reuse it; otherwise map this single prompt first and then
   * fire Runway. Lets the user generate B-roll one prompt at a time.
   */
  async function onGenerateRunwayForPrompt(promptIndex: number, promptBody: string) {
    if (!project) return
    const existingSlot = sequence.brollSlots?.find(
      (s) => (s.metadata as { promptIndex?: number } | undefined)?.promptIndex === promptIndex
    )
    if (existingSlot) {
      void onGenerateRunwayForSlot(existingSlot.id, promptBody)
      return
    }
    const mapped = await mapSinglePromptToTimeline(promptIndex)
    if (!mapped) {
      setBrollGenError(
        'Could not place this prompt — build an intro or rough cut first so this beat has somewhere to land.'
      )
      return
    }
    void onGenerateRunwayForSlot(mapped.slot.id, promptBody, mapped.sequence)
  }

  /**
   * Per-card Kling entry point. Same mapping-first flow as Runway.
   */
  async function onGenerateKlingForPrompt(promptIndex: number, promptBody: string) {
    if (!project) return
    const existingSlot = sequence.brollSlots?.find(
      (s) => (s.metadata as { promptIndex?: number } | undefined)?.promptIndex === promptIndex
    )
    if (existingSlot) {
      void onGenerateKlingForSlot(existingSlot.id, promptBody)
      return
    }
    const mapped = await mapSinglePromptToTimeline(promptIndex)
    if (!mapped) {
      setBrollGenError(
        'Could not place this prompt — build an intro or rough cut first so this beat has somewhere to land.'
      )
      return
    }
    void onGenerateKlingForSlot(mapped.slot.id, promptBody, mapped.sequence)
  }

  /**
   * Per-card Higgsfield entry point. Same mapping-first flow as Runway.
   */
  async function onGenerateHiggsfieldForPrompt(promptIndex: number, promptBody: string) {
    if (!project) return
    const existingSlot = sequence.brollSlots?.find(
      (s) => (s.metadata as { promptIndex?: number } | undefined)?.promptIndex === promptIndex
    )
    if (existingSlot) {
      void onGenerateHiggsfieldForSlot(existingSlot.id, promptBody)
      return
    }
    const mapped = await mapSinglePromptToTimeline(promptIndex)
    if (!mapped) {
      setBrollGenError(
        'Could not place this prompt — build an intro or rough cut first so this beat has somewhere to land.'
      )
      return
    }
    void onGenerateHiggsfieldForSlot(mapped.slot.id, promptBody, mapped.sequence)
  }

  async function onGenerateBrollAi() {
    if (!project) return
    if (brollPromptSource === 'beats') {
      await onGenerateBrollFromBeats()
      return
    }

    const bridge = window.storyteller?.generateBrollPrompts
    if (!bridge) {
      setBrollGenError('AI B-roll requires the Storyteller desktop app.')
      return
    }
    if (!dbSegments.length) {
      setBrollGenError('Import media and run Analyze to get transcript segments first.')
      return
    }
    const accessToken = await getGatewayAccessToken()
    if (mediaGatewayEnabled && !accessToken) {
      setBrollGenError('Sign in to Storyteller to generate prompts through the hosted gateway.')
      return
    }
    setBrollGenBusy(true)
    setBrollGenError(null)
    setDirectorPackageJson(null)
    setBrollGenStatus('Starting…')
    setPromptsCleared(false)
    try {
      const segments = dbSegments.map((s) => ({
        id: s.id,
        start: s.start_time,
        end: s.end_time,
        text: s.text
      }))
      const res = await bridge({
        projectId,
        segments,
        subjectProfile: project.subjectProfile,
        promptPack: effectivePromptPack,
        aiDirection: project.aiDirection ?? '',
        mode: project.mode,
        shotDurationSeconds: project.brollShotDurationSeconds,
        accessToken: accessToken ?? undefined
      })
      if (!res.ok) {
        setBrollGenError(res.error)
        return
      }
      if ('creativePackage' in res && res.creativePackage != null) {
        setDirectorPackageJson(res.creativePackage)
      }
      const prompts = res.prompts as Omit<BrollPrompt, 'id' | 'created_at'>[]
      const enriched = prompts.map((p) => {
        const mid = p.metadata_json as { sourceSegmentId?: string } | undefined
        const segId = mid?.sourceSegmentId
        const seg = segId ? dbSegments.find((s) => s.id === segId) : undefined
        return {
          ...p,
          metadata_json: {
            ...p.metadata_json,
            ...(seg ? { transcriptExcerpt: seg.text } : {})
          }
        }
      })
      setAiBrollPrompts(enriched)
      setBrollGenStatus('Prompts ready — generate video one prompt at a time below.')
    } finally {
      setBrollGenBusy(false)
    }
  }

  /**
   * Clear generated prompt artifacts regardless of current prompt mode.
   *
   * Why: the "Clear AI prompts" button previously only reset `aiBrollPrompts`,
   * so in beats mode (`beatBrollPrompts`) it appeared broken. This unified
   * reset clears both buckets + related generation UI state.
   */
  function onClearGeneratedPrompts() {
    setAiBrollPrompts(null)
    setBeatBrollPrompts(null)
    setBeatBrollSource(null)
    setDirectorPackageJson(null)
    setBeatBrollFallbackReason(null)
    setBrollGenError(null)
    setBrollGenStatus(null)
    setCustomProductionLinkId(`custom-${crypto.randomUUID()}`)
    setPromptsCleared(true)
  }

  async function onGenerateSoundbiteBroll(
    soundbite: { id: string; transcript_text: string | null; tags_json: Record<string, unknown> | null }
  ) {
    if (!project) return
    const line = soundbite.transcript_text?.trim()
    if (!line) {
      setBrollGenError('This soundbite has no transcript text to ground a prompt on.')
      return
    }
    const bridge = window.storyteller?.generateBrollForSoundbite
    if (!bridge) {
      setBrollGenError('B-roll prompt generation requires the Storyteller desktop app.')
      return
    }
    setGeneratingBrollPromptSoundbiteId(soundbite.id)
    setBrollGenError(null)
    try {
      const accessToken = await getGatewayAccessToken()
      const existingAi = readSoundbiteAiReview(soundbite)
      const previousIdeas = existingAi?.brollIdeas
        ?.map((b) => b.stillImagePrompt || b.prompt)
        .filter(Boolean) as string[] | undefined
      const res = await bridge({
        projectId,
        soundbiteId: soundbite.id,
        transcriptText: line,
        subjectProfile: project.subjectProfile,
        promptPack: effectivePromptPack,
        aiDirection: project.aiDirection ?? '',
        mode: project.mode,
        shotDurationSeconds: project.brollShotDurationSeconds,
        accessToken: accessToken ?? undefined,
        previousIdeas: previousIdeas?.length ? previousIdeas : undefined
      })
      if (!res.ok) {
        setBrollGenError(res.error)
        return
      }
      const ai = readSoundbiteAiReview(soundbite)
      const persisted = await persistSoundbiteBrollIdeas({
        supabase: supabaseWhenSignedIn,
        projectId,
        soundbiteId: soundbite.id,
        brollIdeas: res.brollIdeas,
        existingTags: soundbite.tags_json,
        graphScore: ai?.graphScore,
        hasGraphIdea: Boolean(ai?.graphIdea),
        graphicsPackage: ai?.graphicsPackage ?? null
      })
      if (!persisted.ok) {
        setBrollGenError(persisted.error)
        return
      }
      await refreshSoundbites()
    } catch (e) {
      setBrollGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingBrollPromptSoundbiteId(null)
    }
  }

  /**
   * Generate one prompt per real beat (intro V1 + saved-timeline V1 + selected
   * soundbites). Uses the AI gateway when available (with a deterministic local
   * fallback baked into the gateway implementation), then auto-maps the result
   * to the timeline so the user goes from "build intro" → "watch the slots
   * appear" without an extra click.
   */
  async function onGenerateBrollFromBeats() {
    if (!project) return
    if (beatsFromTimeline.length === 0) {
      setBrollGenError(
        'Add clips to your timeline first — prompts are generated from each spine clip on your cut.'
      )
      return
    }
    setBrollPromptSource('beats')
    setBrollGenBusy(true)
    setBrollGenError(null)
    setBrollGenStatus(`Writing ${beatsFromTimeline.length} beat prompt(s)…`)
    setPromptsCleared(false)
    try {
      const bridge = window.storyteller?.generateBrollPromptsFromBeats
      let prompts: Omit<BrollPrompt, 'id' | 'created_at'>[] = []
      let source: 'ai' | 'deterministic' = 'deterministic'
      let fallbackReason: string | null = null
      let fallbackDiagnostic: string | null = null

      if (bridge) {
        try {
          const accessToken = await getGatewayAccessToken()
          const res = await bridge({
            projectId,
            beats: beatsFromTimeline.map((b) => ({
              id: b.id,
              source_start: b.source_start,
              source_end: b.source_end,
              transcript_text: b.transcript_text,
              score: b.score ?? null,
              origin: b.origin
            })),
            subjectProfile: project.subjectProfile,
            promptPack: effectivePromptPack,
            aiDirection: project.aiDirection ?? '',
            mode: project.mode,
            shotDurationSeconds: project.brollShotDurationSeconds,
            accessToken: accessToken ?? undefined
          })
          if (res.ok) {
            prompts = res.prompts as Omit<BrollPrompt, 'id' | 'created_at'>[]
            source = res.source ?? 'ai'
            if (source === 'deterministic') {
              fallbackReason = 'Using resilient local writer fallback.'
              fallbackDiagnostic =
                res.reason ?? 'Gateway returned the deterministic writer (no reason given).'
            }
          } else {
            setBrollGenError(res.error)
            fallbackReason = 'Using resilient local writer fallback.'
            fallbackDiagnostic = `Gateway error: ${res.error}`
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setBrollGenError(msg)
          fallbackReason = 'Using resilient local writer fallback.'
          fallbackDiagnostic = `Bridge threw: ${msg}`
        }
      } else {
        fallbackReason = 'Using resilient local writer fallback.'
        fallbackDiagnostic =
          'Desktop AI bridge not available (window.storyteller.generateBrollPromptsFromBeats undefined) — used local writer.'
      }

      // Bridge missing or AI failed → use the deterministic writer client-side
      // so the user always gets specific, content-aware prompts.
      if (prompts.length === 0) {
        prompts = generateBrollPromptsFromBeats(projectId, beatsFromTimeline, {
          tone: brollTone,
          mode: project.mode,
          directionText: project.aiDirection,
          subjectProfile: project.subjectProfile,
          shotDurationSeconds: project.brollShotDurationSeconds
        })
        source = 'deterministic'
      }

      setBeatBrollPrompts(prompts)
      setBeatBrollSource(source)
      setBeatBrollFallbackReason(source === 'ai' ? null : fallbackReason)
      // Mirror to terminal so dev debugging is one ⌘K away from the answer.
      if (source === 'ai') {
        // eslint-disable-next-line no-console
        console.log(`[broll/beats] AI wrote ${prompts.length} prompt(s)`)
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[broll/beats] Used deterministic writer. ${fallbackDiagnostic ?? '(no reason recorded)'}`
        )
      }

      const mapped = await autoMapPromptsToTimeline(prompts)
      const sourceLabel = source === 'ai' ? 'AI' : 'local writer'
      setBrollGenStatus(
        mapped > 0
          ? `Wrote ${prompts.length} ${sourceLabel} prompt(s) and mapped ${mapped} to the timeline.`
          : `Wrote ${prompts.length} ${sourceLabel} prompt(s). Build an intro to map them onto the edit timeline.`
      )
    } finally {
      setBrollGenBusy(false)
    }
  }

  /**
   * Generate one Top Layer treatment per timeline beat using the deterministic
   * local writer — no API call, no credits consumed.
   */
  function onGenerateTopLayerFromBeats() {
    if (beatsFromTimeline.length === 0) {
      setTopLayerBeatError(
        'Add clips to your timeline first — Top Layer prompts are generated from each beat on your cut.'
      )
      return
    }
    setTopLayerBeatBusy(true)
    setTopLayerBeatError(null)
    try {
      const results = generateTopLayerPromptsFromBeats(beatsFromTimeline, {
        subjectProfile: project?.subjectProfile ?? undefined,
        mode: project?.mode,
        stylePreset: topLayerStylePreset
      })
      setBeatTopLayerPrompts(results)
    } catch (err) {
      setTopLayerBeatError(err instanceof Error ? err.message : 'Unknown error generating Top Layer prompts.')
    } finally {
      setTopLayerBeatBusy(false)
    }
  }

  /**
   * Add a Kinetic Type slot for a beat — no credits, no generation.
   * Creates a graphics slot with status 'ready' and mediaKind 'kinetic-text'
   * so the preview overlay renders the KineticTextCard immediately.
   */
  async function onAddKineticTypeForBeat(tlp: TopLayerBeatPrompt, kineticAnimation: KineticAnimation = 'slam') {
    const beat = beatsFromTimeline.find((b) => b.id === tlp.beatId)
    if (!beat) return
    const synthSoundbite = resolveSoundbiteForBeat(beat)
    const promptKey = `${synthSoundbite.id}:kinetic-text`
    // Trim transcript to a punchy short phrase for display
    const words = tlp.transcript.trim().split(/\s+/)
    const displayText = words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '')
    const rows = [
      {
        id: promptKey,
        segment_start: synthSoundbite.start_time,
        segment_end: synthSoundbite.end_time,
        kind: 'text-image' as const,
        promptText: displayText,
        metadata_json: {
          soundbiteId: synthSoundbite.id,
          promptKey,
          mediaKind: 'kinetic-text',
          kineticAnimation
        }
      }
    ]
    const built = buildGraphicsSlotsFromPrompts(sequence, rows as any, projectId)
    if (built.length === 0) return
    const slot = { ...built[0]!, status: 'ready' as const }
    const merged = [
      ...(sequence.graphicsSlots ?? []).filter((s) => s.id !== slot.id),
      slot
    ]
    const withTrack = ensureGraphicsVideoTrack(sequence)
    // Inject a placeholder clip into v-graphics so the timeline drag handler can find it.
    // assetId is 'kinetic-text' — the overlay renderer reads mediaKind from metadata, not the asset.
    const kineticClip: TimelineClip = {
      id: `gfx-${slot.id}`,
      role: 'quote-card',
      assetId: 'kinetic-text',
      sourceInSeconds: 0,
      sourceOutSeconds: slot.suggestedDurationSeconds,
      timelineInSeconds: slot.timelineStart,
      timelineOutSeconds: slot.timelineEnd,
      metadata: {
        graphicsSlotId: slot.id,
        graphicsKind: 'text-image',
        mediaKind: 'kinetic-text',
        kineticAnimation
      }
    }
    const videoTracks = withTrack.videoTracks.map((track) => {
      if (track.id !== 'v-graphics') return track
      const remaining = track.clips.filter(
        (c) => (c.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId !== slot.id
      )
      return { ...track, clips: [...remaining, kineticClip].sort((a, b) => a.timelineInSeconds - b.timelineInSeconds) }
    })
    await persistSequenceUpdate({ ...withTrack, graphicsSlots: merged, videoTracks })
    // Bug 3: notify user and seek preview to the slot's time window
    const startLabel = synthSoundbite.start_time.toFixed(1)
    const endLabel = synthSoundbite.end_time.toFixed(1)
    setBeatCardStatus((prev) => ({
      ...prev,
      [tlp.beatId]: `Kinetic type added to timeline at ${startLabel}s–${endLabel}s`
    }))
    requestLivePreviewSeek(synthSoundbite.start_time + 0.1)
  }

  function formatAnalysisProgress(p: { phase: string; detail?: string }): string {
    const d = p.detail ?? ''
    if (p.phase === 'clearing') return d || 'Clearing previous analysis…'
    if (p.phase === 'preparing_audio') return d || 'Preparing audio…'
    if (p.phase === 'chunking_audio') return d || 'Chunking…'
    if (p.phase === 'transcribing_chunk') return d || 'Transcribing…'
    if (p.phase === 'merging_transcript') return d || 'Merging transcript…'
    if (p.phase === 'scoring') return d || 'Generating soundbites…'
    if (p.phase === 'done') return 'Done.'
    return d || p.phase
  }

  async function onAnalyze() {
    if (!project) return
    if (!canAnalyze) {
      setAnalysisError(
        analyzeBlocked ??
          "We can't run analysis yet — confirm your media file is available (see Selected media below)."
      )
      return
    }
    setAnalysisBusy(true)
    setAnalysisError(null)
    setAnalysisMsg(null)
    try {
      const res = await runTranscriptionAnalysis({
        supabase: supabaseWhenSignedIn,
        projectId,
        projectTitle: project.title,
        projectMode: project.mode,
        assets,
        directionText: directionDraft.trim() || project.aiDirection,
        subjectProfile: project.subjectProfile,
        promptPack: effectivePromptPack,
        onProgress: (p) => setAnalysisMsg(formatAnalysisProgress(p))
      })
      if (!res.ok) {
        setAnalysisError(mapTranscriptionErrorForUser(res.error))
        return
      }
      await refreshTranscript()
      await refreshSoundbites()
      setAnalysisMsg('Done — transcript and soundbites are ready.')
      setActiveStep('review'); setReviewTab('soundbites')
    } catch (e) {
      setAnalysisError(mapTranscriptionErrorForUser(e instanceof Error ? e.message : 'Analysis failed'))
    } finally {
      setAnalysisBusy(false)
    }
  }

  if (!project) {
    return (
      <div style={{ padding: 40, background: '#141416', color: '#f4f4f5', minHeight: '100vh' }}>
        <p>Project not found.</p>
        <Link to="/projects" style={{ color: '#818cf8' }}>Back</Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#141416', color: '#f4f4f5', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header
          style={{
            padding: '16px 28px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            borderTop: `2px solid ${intentColors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, #1c1c1f 100%), ${intentColors.gradient}`
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Link to="/projects" style={{ color: '#a1a1aa', textDecoration: 'none', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              ← Dashboard
            </Link>
            <Link to="/assets" style={{ color: '#a1a1aa', textDecoration: 'none', fontSize: 14 }}>
              Assets
            </Link>
            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />
            <div>
              <div style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Project</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{project.title}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', background: '#141416', borderRadius: 8, padding: 4, border: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                onClick={() => updateProject(projectId, { format: getProjectFormat('horizontal', project.format?.qualityPreset, project.format?.fps) })}
                style={formatToggleBtn(editFormat === 'horizontal')}
              >
                16:9
              </button>
              <button
                type="button"
                onClick={() => updateProject(projectId, { format: getProjectFormat('vertical', project.format?.qualityPreset, project.format?.fps) })}
                style={formatToggleBtn(editFormat === 'vertical')}
              >
                9:16
              </button>
            </div>
            <span style={badge}>{project.status.replace('_', ' ')}</span>
            {appVersion && (
              <span style={{ fontSize: 12, color: '#71717a', whiteSpace: 'nowrap' }}>
                Storyteller {appVersion}
              </span>
            )}
            <button
              type="button"
              onClick={async () => { await signOut(); navigate('/login') }}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                background: 'transparent',
                color: '#9ca3af',
                fontWeight: 600,
                fontSize: 13,
                border: '1px solid rgba(255,255,255,0.12)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <StepRail steps={WORKFLOW_STEPS} activeStep={activeStep} onStepClick={setActiveStep} intentColors={intentColors} />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <main style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
            <div style={{ maxWidth: 1000, margin: '0 auto' }}>
              {activeStep === 'upload' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>
                      {project?.intent === 'brand_intro'
                        ? '1. Upload Show Footage'
                        : project?.mode === 'journalism'
                        ? '1. Import Field Footage'
                        : project?.mode === 'highlight'
                          ? '1. Add Your Game Footage'
                          : project?.mode === 'creator'
                            ? '1. Add Your Footage'
                            : project?.mode === 'music_video'
                              ? '1. Add Your Footage & Music'
                              : project?.mode === 'commercial'
                                ? '1. Add Your Assets'
                                : project?.mode === 'documentary'
                                  ? '1. Import Your Footage'
                                  : '1. Upload Video & Audio'}
                    </h2>
                    <p style={stepDesc}>
                      {project?.intent === 'brand_intro'
                        ? 'Upload your show or podcast recording. On the next step, Storyteller will analyze it so you can pick the best soundbites for a cinematic intro.'
                        : project?.mode === 'journalism'
                        ? 'Import your field footage — interviews, standup, B-roll, and voiceover. Assign clip roles, then assemble.'
                        : project?.mode === 'highlight'
                          ? 'Drop in your game footage — hype moments, plays, reactions, and crowd shots. Tag each clip, then let Storyteller build your highlight reel.'
                          : project?.mode === 'creator'
                            ? 'Drop in your raw clips — hook moments, hero content, B-roll, and your recap. Tag each clip, then let Storyteller AI build your cut.'
                            : project?.mode === 'music_video'
                              ? 'Add your performance footage, B-roll, and audio tracks. Storyteller will sync visuals to your music.'
                              : project?.mode === 'commercial'
                                ? 'Import your product footage, testimonials, and brand assets. Storyteller will structure your ad narrative.'
                                : project?.mode === 'documentary'
                                  ? 'Import your interviews, archival footage, and narration. Storyteller will help you craft the long-form story.'
                                  : 'Add your raw media. Local import keeps large files on your device.'}
                    </p>
                  </div>
                  {project && !supabaseConfigured && (
                    <div style={{ padding: '12px 16px', color: '#a1a1aa', fontSize: 13, background: '#1c1c1f', borderRadius: 8, marginBottom: 20 }}>
                      Optional: configure cloud sync to save transcripts and project metadata across devices.
                    </div>
                  )}

                  {project?.mode === 'journalism' ? (
                    <JournalismIngestPanel
                      projectId={projectId}
                      projectTitle={project.title}
                      assets={assets}
                      assetsLoading={assetsLoading}
                      assetsError={assetsError}
                      supabase={supabaseWhenSignedIn}
                      userId={user?.id}
                      assembling={journalismAssembling}
                      assembleError={journalismAssembleError}
                      onUploaded={() => void refreshAssets()}
                      onAssemble={() => void onAssembleJournalismPackage()}
                    />
                  ) : project?.mode === 'creator' ? (
                    <CreatorIngestPanel
                      projectId={projectId}
                      projectTitle={project.title}
                      assets={assets}
                      assetsLoading={assetsLoading}
                      assetsError={assetsError}
                      supabase={supabaseWhenSignedIn}
                      userId={user?.id}
                      assembling={creatorAssembling}
                      assembleError={creatorAssembleError}
                      targetFormat={creatorTargetFormat}
                      onFormatChange={setCreatorTargetFormat}
                      onUploaded={() => void refreshAssets()}
                      onAssemble={() => void onAssembleCreatorCut()}
                    />
                  ) : project?.mode === 'highlight' ? (
                    <>
                      <HighlightIngestPanel
                        projectId={projectId}
                        projectTitle={project.title}
                        assets={assets}
                        assetsLoading={assetsLoading}
                        assetsError={assetsError}
                        supabase={supabaseWhenSignedIn}
                        userId={user?.id}
                        assembling={creatorAssembling}
                        assembleError={creatorAssembleError}
                        targetFormat={creatorTargetFormat}
                        onFormatChange={setCreatorTargetFormat}
                        onUploaded={() => void refreshAssets()}
                        onAssemble={(config) => void onAssembleHighlightReel(config)}
                      />
                      <div style={{ marginTop: 32 }}>
                        {autoAssignError && (
                          <div
                            style={{
                              marginBottom: 12,
                              padding: '10px 14px',
                              borderRadius: 8,
                              background: 'rgba(239,68,68,0.1)',
                              border: '1px solid rgba(239,68,68,0.3)',
                              fontSize: 12,
                              color: '#fca5a5',
                            }}
                          >
                            {autoAssignError}
                          </div>
                        )}
                        <HighlightTimeline
                          project={project}
                          assets={assets}
                          segments={timelineSegments}
                          isAutoAssigning={autoAssigning}
                          onSegmentUpdate={(segmentId, updates) => {
                            setTimelineSegments((prev) =>
                              prev.map((s) => (s.id === segmentId ? { ...s, ...updates } : s))
                            )
                          }}
                          onSegmentReorder={(segmentId, newPhase, newOrder) => {
                            setTimelineSegments((prev) =>
                              prev.map((s) =>
                                s.id === segmentId
                                  ? { ...s, phase: newPhase, orderInPhase: newOrder }
                                  : s
                              )
                            )
                          }}
                          onAutoAssign={() => void handleAutoAssign()}
                          onClipDrop={handleClipDrop}
                        />
                      </div>
                    </>
                  ) : project?.mode === 'music_video' ? (
                    <MusicVideoIngestPanel
                      projectId={projectId}
                      projectTitle={project.title}
                      assets={assets}
                      assetsLoading={assetsLoading}
                      assetsError={assetsError}
                      supabase={supabaseWhenSignedIn}
                      userId={user?.id}
                      vibeVision={project.vibeVision ?? ''}
                      musicLocalPath={project.musicLocalPath}
                      beatsPerCut={project.beatsPerCut ?? 4}
                      beatTimestamps={beatTimestamps}
                      detectedBpm={detectedBpm}
                      beatAnalyzing={beatAnalyzing}
                      beatAnalysisError={beatAnalysisError}
                      assembling={false}
                      onVibeVisionChange={(v) => updateProject(projectId, { vibeVision: v })}
                      onBeatsPerCutChange={(n) => updateProject(projectId, { beatsPerCut: n })}
                      onUploaded={() => void refreshAssets()}
                      onMusicFilePicked={(path) => void onAnalyzeMusicBeat(path)}
                      onAssemble={() => void onAssembleMusicVideoCut()}
                    />
                  ) : (
                    <>
                      <AssetUploadZone
                        projectId={projectId}
                        projectTitle={project.title}
                        projectMode={project.mode}
                        supabaseClient={supabaseWhenSignedIn}
                        userId={user?.id}
                        onUploaded={() => void refreshAssets()}
                      />
                      <div style={{ marginTop: 32 }}>
                        <UploadedAssetsPanel
                          assets={assets}
                          loading={assetsLoading}
                          error={assetsError}
                          supabase={supabaseWhenSignedIn}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeStep === 'goal' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>2. Choose Goal</h2>
                    <p style={stepDesc}>Select the type of story or clips you want to create.</p>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                    {GOAL_CARDS.map(cardItem => {
                      const isSelected = selectedGoalCard === cardItem.id
                      return (
                        <button
                          key={cardItem.id}
                          type="button"
                          onClick={() => handleGoalCardClick(cardItem.id)}
                          style={{
                            ...card,
                            padding: 24,
                            textAlign: 'center',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(110,231,197,0.08)' : '#1c1c1f',
                            border: isSelected ? '1px solid #6ee7c5' : '1px solid rgba(255,255,255,0.08)',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: 100
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 16, color: isSelected ? '#6ee7c5' : '#f4f4f5' }}>
                            {cardItem.label}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {selectedGoalCard === 'Topic-Based Clips' && (
                    <div style={{ marginTop: 24, ...card, padding: 24 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>What topic are you looking for?</div>
                      <input
                        type="text"
                        value={topicInput}
                        onChange={(e) => handleTopicInputChange(e.target.value)}
                        placeholder="e.g. money, relationships, leadership, discipline, faith..."
                        style={{
                          width: '100%',
                          padding: 16,
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: '#141416',
                          color: '#f4f4f5',
                          fontSize: 15,
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}

                  <div style={{ ...card, padding: 24, marginTop: 32, border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          Selected media for analysis
                        </div>
                        {!primarySourceAsset && (
                          <p style={{ margin: 0, color: '#e4e4e7', fontSize: 15 }}>
                            No video or audio is ready yet. Go to <strong style={{ color: '#6ee7c5' }}>step 1 · Upload</strong> and import a file using{' '}
                            <strong>Select files</strong> or drag-and-drop into this app window (so the real disk path is saved).
                          </p>
                        )}
                        {primarySourceAsset && (
                          <>
                            <div style={{ fontWeight: 600, fontSize: 17, color: '#f4f4f5', marginBottom: 6 }}>
                              {primarySourceAsset.original_filename ??
                                primarySourceAsset.local_path?.split(/[/\\]/).pop() ??
                                'Media'}
                            </div>
                            <div style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>
                              {pathVerify === 'checking' && (
                                <span style={{ color: '#fbbf24' }}>Checking file on disk…</span>
                              )}
                              {pathVerify === 'ok' && primarySourceAsset.local_path?.trim() && (
                                <span style={{ color: '#6ee7c5' }}>Ready for analysis</span>
                              )}
                              {pathVerify === 'ok' && !primarySourceAsset.local_path?.trim() && supabaseWhenSignedIn && (
                                <span style={{ color: '#6ee7c5' }}>Will download from cloud for transcription</span>
                              )}
                              {pathVerify === 'missing' && (
                                <span style={{ color: '#f87171' }}>
                                  File not found on this computer — it may have been moved or deleted.
                                </span>
                              )}
                              {pathVerify === 'idle' && primarySourceAsset && (
                                <span>Confirm upload on step 1 if analysis stays disabled.</span>
                              )}
                            </div>
                            {(primarySourceAsset.duration_seconds != null ||
                              primarySourceAsset.width != null ||
                              primarySourceAsset.height != null) && (
                              <div style={{ fontSize: 13, color: '#71717a', marginTop: 10 }}>
                                {primarySourceAsset.width != null && primarySourceAsset.height != null
                                  ? `${primarySourceAsset.width}×${primarySourceAsset.height}`
                                  : ''}
                                {primarySourceAsset.duration_seconds != null
                                  ? `${primarySourceAsset.width != null ? ' · ' : ''}${formatDurationClock(primarySourceAsset.duration_seconds)}`
                                  : ''}
                                {primarySourceAsset.fps != null ? ` · ${primarySourceAsset.fps.toFixed(2)} fps` : ''}
                              </div>
                            )}
                            {analyzeBlocked && pathVerify !== 'missing' && (
                              <p style={{ margin: '12px 0 0', fontSize: 13, color: '#fbbf24' }}>{analyzeBlocked}</p>
                            )}
                          </>
                        )}
                      </div>
                      <button type="button" style={ghost} onClick={() => setActiveStep('upload')}>
                        Change file (step 1)
                      </button>
                    </div>
                  </div>

                  <div style={{ ...card, padding: 32, marginTop: 24, textAlign: 'center', background: 'linear-gradient(180deg, #1c1c1f 0%, #141416 100%)' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Analyze Media</h3>
                    <p style={{ color: '#a1a1aa', fontSize: 14, margin: '0 0 24px' }}>
                      Run AI transcription and extract the best soundbites based on your direction.
                    </p>
                    <button
                      type="button"
                      style={{
                        ...primaryBtn,
                        fontSize: 16,
                        padding: '14px 32px',
                        background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`,
                        color: '#ffffff',
                        boxShadow: `0 0 10px ${intentColors.glow}`,
                        opacity: canAnalyze && !analysisBusy ? 1 : 0.5
                      }}
                      disabled={!canAnalyze || analysisBusy}
                      onClick={() => void onAnalyze()}
                    >
                      {analysisBusy ? 'Analyzing…' : 'Analyze & Transcribe'}
                    </button>
                    
                    {analysisMsg && <div style={{ marginTop: 16, fontSize: 14, color: '#a1a1aa' }}>{analysisMsg}</div>}
                    {analysisError && (
                      <div style={{ marginTop: 16, fontSize: 14, color: '#f87171', lineHeight: 1.5 }}>
                        {analysisError}{' '}
                        <button type="button" style={linkBtn} onClick={() => void onAnalyze()} disabled={!canAnalyze}>
                          Retry
                        </button>
                      </div>
                    )}
                    {!transcriptionBridgeReady && (
                      <div style={{ marginTop: 16, fontSize: 13, color: '#a1a1aa', maxWidth: 600, margin: '16px auto 0' }}>
                        <strong style={{ color: '#f4f4f5' }}>Analyze needs the desktop app.</strong> The transcription bridge only
                        exists in the Electron window.
                      </div>
                    )}
                    {transcriptionBridgeReady && !canAnalyze && !analysisBusy && (
                      <div style={{ marginTop: 16, fontSize: 13, color: '#a1a1aa', maxWidth: 640, margin: '16px auto 0', lineHeight: 1.55 }}>
                        {pathVerify === 'missing' && (
                          <span>
                            <strong style={{ color: '#fca5a5' }}>We couldn’t locate your video on disk.</strong> Use{' '}
                            <strong style={{ color: '#f4f4f5' }}>Change file (step 1)</strong> to import it again from the folder where it lives now.
                          </span>
                        )}
                        {pathVerify === 'checking' && <span>Verifying your file…</span>}
                        {pathVerify !== 'missing' && pathVerify !== 'checking' && analyzeBlocked && <span>{analyzeBlocked}</span>}
                      </div>
                    )}
                  </div>

                  <details style={{ marginTop: 32 }}>
                    <summary style={{ color: '#a1a1aa', cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>Advanced Settings</summary>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                      <div style={card}>
                        <div style={{ fontWeight: 600 }}>Sync Clips</div>
                        <p style={{ color: '#a1a1aa', fontSize: 13, margin: '8px 0 0' }}>Waveform / timecode / manual offset when multiple sources are detected.</p>
                        <button type="button" style={{ ...ghost, marginTop: 12 }} disabled>Configure sync</button>
                      </div>
                      <div style={card}>
                        <div style={{ fontWeight: 600 }}>Pacing Edit</div>
                        <p style={{ color: '#a1a1aa', fontSize: 13, margin: '8px 0 0' }}>Preset: {project.silencePreset.replace('_', ' ')}</p>
                        <Link to={`/project/${projectId}/setup`} style={{ ...ghost, marginTop: 12, display: 'inline-block', textDecoration: 'none' }}>Adjust pacing</Link>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              {activeStep === 'review' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>3. Review Moments</h2>
                    <p style={stepDesc}>
                      {selectedGoalCard
                        ? `Review the best clips for ${selectedGoalCard.toLowerCase()}, or review the full transcript.`
                        : 'Select the best soundbites for your intro, or review the full transcript.'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 16 }}>
                    <button onClick={() => setReviewTab('soundbites')} style={tabBtn(reviewTab === 'soundbites')}>Top Soundbites</button>
                    <button onClick={() => setReviewTab('transcript')} style={tabBtn(reviewTab === 'transcript')}>Full Transcript</button>
                    <button onClick={() => setReviewTab('story')} style={tabBtn(reviewTab === 'story')}>Story Plan</button>
                  </div>

                  {reviewTab === 'soundbites' && (
                    <div>
                      <div style={{ 
                        display: 'flex', 
                        gap: 8, 
                        overflowX: 'auto', 
                        paddingBottom: 16, 
                        marginBottom: 16,
                        scrollbarWidth: 'none' 
                      }}>
                        {visibleSoundbiteFilters.map(f => (
                          <button
                            key={f}
                            onClick={() => setActiveFilter(f)}
                            style={{
                              padding: '6px 16px',
                              borderRadius: 999,
                              border: activeFilter === f ? '1px solid #6ee7c5' : '1px solid rgba(255,255,255,0.1)',
                              background: activeFilter === f ? 'rgba(110,231,197,0.1)' : '#1c1c1f',
                              color: activeFilter === f ? '#6ee7c5' : '#a1a1aa',
                              fontSize: 13,
                              fontWeight: activeFilter === f ? 600 : 400,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              transition: 'all 0.2s'
                            }}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      {reviewFilterStrategy && (
                        <p style={{ color: '#a1a1aa', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
                          {reviewFilterStrategy.reviewHint}
                        </p>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 12,
                          alignItems: 'center',
                          marginBottom: 16
                        }}
                      >
                        <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                          AI feedback style should read like your ChatGPT editorial pass. B-roll preview can stay more creative or switch to a more practical coverage angle.
                        </span>
                        <div
                          style={{
                            marginLeft: 'auto',
                            display: 'inline-flex',
                            background: 'rgba(0,0,0,0.25)',
                            borderRadius: 999,
                            padding: 3
                          }}
                        >
                          {(
                            [
                              { id: 'cinematic', label: 'Cinematic B-roll' },
                              { id: 'practical', label: 'Practical B-roll' }
                            ] as const
                          ).map((opt) => {
                            const active = reviewBrollMode === opt.id
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setReviewBrollMode(opt.id)}
                                style={{
                                  padding: '6px 12px',
                                  fontSize: 12,
                                  fontWeight: 500,
                                  borderRadius: 999,
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: active ? '#0b1014' : '#a1a1aa',
                                  background: active ? '#6ee7c5' : 'transparent'
                                }}
                              >
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      {reviewAiPicks && reviewAiPicks.arc.length > 0 && (
                        <div
                          style={{
                            ...card,
                            padding: 16,
                            marginBottom: 16,
                            background: 'rgba(110,231,197,0.03)',
                            border: '1px solid rgba(110,231,197,0.12)'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: 12,
                              flexWrap: 'wrap',
                              marginBottom: 12
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 12,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.08em',
                                  color: '#6ee7c5',
                                  marginBottom: 4
                                }}
                              >
                                Trailer Arc — Best Sound Bites in Story Order
                              </div>
                              <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                                Sequenced like a real intro/trailer: cold open first, mission-statement close last.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={toggleTrailerArcOnTimeline}
                              style={{
                                ...primaryBtn,
                                padding: '6px 12px',
                                fontSize: 13,
                                flexShrink: 0,
                                background: isTrailerArcOnTimeline ? 'rgba(110,231,197,0.2)' : '#6ee7c5',
                                color: isTrailerArcOnTimeline ? '#6ee7c5' : '#061210',
                                border: isTrailerArcOnTimeline ? '1px solid rgba(110,231,197,0.4)' : '1px solid transparent',
                                boxShadow: isTrailerArcOnTimeline ? 'none' : '0 2px 8px rgba(110,231,197,0.2)'
                              }}
                            >
                              {isTrailerArcOnTimeline ? '✓ Arc on Timeline' : '+ Add Arc to Timeline'}
                            </button>
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {reviewAiPicks.arc.map(({ soundbite, ai }, index) => {
                              const arcBeatOnTimeline = selectedSoundbiteIds.includes(soundbite.id)
                              return (
                              <button
                                key={`arc-${soundbite.id}`}
                                type="button"
                                onClick={() => {
                                  setSelectedSoundbiteId(soundbite.id)
                                  setSelectedSegmentId(
                                    ((soundbite.tags_json as any)?.segment_id ?? null) as string | null
                                  )
                                  setPreviewClip({
                                    sourcePath: primarySourceAsset?.local_path ?? null,
                                    sourceUrl: null,
                                    startTime: soundbite.start_time,
                                    endTime: soundbite.end_time,
                                    title: `Trailer beat #${index + 1}`,
                                    caption: soundbite.transcript_text ?? ''
                                  })
                                }}
                                style={{
                                  textAlign: 'left',
                                  display: 'grid',
                                  gridTemplateColumns: '28px 1fr',
                                  gap: 12,
                                  alignItems: 'start',
                                  background: arcBeatOnTimeline ? 'rgba(110,231,197,0.05)' : 'rgba(255,255,255,0.03)',
                                  border: arcBeatOnTimeline
                                    ? '1px solid rgba(110,231,197,0.4)'
                                    : '1px solid rgba(255,255,255,0.06)',
                                  borderRadius: 10,
                                  padding: 12,
                                  color: '#f4f4f5',
                                  cursor: 'pointer'
                                }}
                              >
                                <span
                                  style={{
                                    minWidth: 28,
                                    height: 28,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 999,
                                    background: 'rgba(110,231,197,0.12)',
                                    color: '#6ee7c5',
                                    fontSize: 13,
                                    fontWeight: 700
                                  }}
                                >
                                  {index + 1}
                                </span>
                                <span>
                                  <span
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      flexWrap: 'wrap',
                                      marginBottom: 6
                                    }}
                                  >
                                    {ai.narrativeRoleLabel && (
                                      <span
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.06em',
                                          color: '#fbbf24',
                                          background: 'rgba(251,191,36,0.12)',
                                          border: '1px solid rgba(251,191,36,0.25)',
                                          borderRadius: 999,
                                          padding: '2px 8px'
                                        }}
                                      >
                                        {ai.narrativeRoleLabel}
                                      </span>
                                    )}
                                    <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                                      {(soundbite.start_time ?? 0).toFixed(1)}s - {(soundbite.end_time ?? 0).toFixed(1)}s
                                    </span>
                                  </span>
                                  <span style={{ display: 'block', fontSize: 14, lineHeight: 1.45, marginBottom: 6 }}>
                                    "{soundbite.transcript_text}"
                                  </span>
                                  {(ai.purpose || ai.rationale) && (
                                    <span style={{ display: 'block', fontSize: 12, lineHeight: 1.5, color: '#cbd5e1' }}>
                                      {ai.purpose ?? ai.rationale}
                                    </span>
                                  )}
                                </span>
                              </button>
                            )})}
                          </div>
                        </div>
                      )}
                      {reviewAiPicks && (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: 12,
                            marginBottom: 20
                          }}
                        >
                          {(
                            [
                              { key: 'viral', title: 'Most Viral Sound Bites' },
                              { key: 'intro', title: 'Best Intro Pulls' },
                              { key: 'graph', title: 'Graph / Motion Graphic Moments' }
                            ] as const
                          )
                            .filter((section) => reviewAiPicks[section.key].length > 0)
                            .map((section) => (
                            <div
                              key={section.key}
                              style={{
                                ...card,
                                padding: 16,
                                background: 'rgba(110,231,197,0.03)',
                                border: '1px solid rgba(110,231,197,0.12)'
                              }}
                            >
                              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6ee7c5', marginBottom: 10 }}>
                                {section.title}
                              </div>
                              <div style={{ display: 'grid', gap: 10 }}>
                                {reviewAiPicks[section.key].map(({ soundbite, ai }, index) => (
                                  <button
                                    key={soundbite.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedSoundbiteId(soundbite.id)
                                      setSelectedSegmentId(((soundbite.tags_json as any)?.segment_id ?? null) as string | null)
                                      setPreviewClip({
                                        sourcePath: primarySourceAsset?.local_path ?? null,
                                        sourceUrl: null,
                                        startTime: soundbite.start_time,
                                        endTime: soundbite.end_time,
                                        title: `${section.title} #${index + 1}`,
                                        caption: soundbite.transcript_text ?? ''
                                      })
                                    }}
                                    style={{
                                      textAlign: 'left',
                                      background: 'rgba(255,255,255,0.03)',
                                      border: '1px solid rgba(255,255,255,0.06)',
                                      borderRadius: 10,
                                      padding: 12,
                                      color: '#f4f4f5',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                      <span
                                        style={{
                                          minWidth: 24,
                                          height: 24,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          borderRadius: 999,
                                          background: 'rgba(110,231,197,0.12)',
                                          color: '#6ee7c5',
                                          fontSize: 12,
                                          fontWeight: 700
                                        }}
                                      >
                                        {ai.placements[section.key] ?? index + 1}
                                      </span>
                                      <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                                        {(soundbite.start_time ?? 0).toFixed(1)}s - {(soundbite.end_time ?? 0).toFixed(1)}s
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 8 }}>
                                      "{soundbite.transcript_text}"
                                    </div>
                                    {(ai.sectionReasons?.[section.key] || ai.rationale) && (
                                      <div style={{ fontSize: 12, lineHeight: 1.5, color: '#cbd5e1' }}>
                                        {ai.sectionReasons?.[section.key] ?? ai.rationale}
                                      </div>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {soundbitesLoading && <p style={{ color: '#a1a1aa' }}>Loading soundbites…</p>}
                      {soundbitesError && <p style={{ color: '#f87171' }}>{soundbitesError}</p>}
                      {!soundbitesLoading && soundbites.length === 0 && (
                        <div style={{ ...card, padding: 32, textAlign: 'center' }}>
                          <p style={{ color: '#a1a1aa', margin: 0 }}>No soundbites yet — run Analyze in the Goal step first.</p>
                        </div>
                      )}
                      
                      <div style={{ display: 'grid', gap: 16 }}>
                        {filteredSoundbites.length === 0 && !soundbitesLoading && soundbites.length > 0 && (
                          <div style={{ ...card, padding: 32, textAlign: 'center' }}>
                            <p style={{ color: '#a1a1aa', margin: 0 }}>No moments match the "{activeFilter}" filter.</p>
                          </div>
                        )}
                        {filteredSoundbites.slice(0, 24).map((c, idx) => {
                          const tags = c.tags_json as any
                          const ai = readSoundbiteAiReview(c as { tags_json: Record<string, unknown> | null })
                          const displayedBrollIdeas = ai ? reviewBrollIdeasForDisplay(ai, reviewBrollMode) : []
                          const displayedGraphIdea =
                            ai && (ai.placements.graph != null || ai.graphScore >= 0.6) ? ai.graphIdea : undefined
                          const comp = tags?.composite
                          const segId = tags?.segment_id
                          const label = tags?.label || `Moment #${idx + 1}`
                          const score = ai?.overallScore ?? tags?.viralPriority ?? c.score_social ?? comp ?? 0
                          
                          const transcriptActive = selectedSoundbiteId === c.id
                          const selectedForIntro = selectedSoundbiteIds.includes(c.id)
                          
                          return (
                            <div
                              key={c.id}
                              style={{
                                ...card,
                                width: '100%',
                                textAlign: 'left' as const,
                                background: selectedForIntro ? 'rgba(110,231,197,0.05)' : '#1c1c1f',
                                border: selectedForIntro ? '1px solid rgba(110,231,197,0.4)' : '1px solid rgba(255,255,255,0.08)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                    <span style={{ fontWeight: 600, fontSize: 16, color: '#f4f4f5' }}>{label}</span>
                                  </div>
                                  <div style={{ fontSize: 13, color: '#a1a1aa', fontVariantNumeric: 'tabular-nums' }}>
                                    {c.start_time.toFixed(2)}s – {c.end_time.toFixed(2)}s
                                    <span style={{ margin: '0 8px', opacity: 0.5 }}>|</span>
                                    Score: <span style={{ color: '#6ee7c5' }}>{score.toFixed(1)}</span>
                                  </div>
                                </div>
                                
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const localPath = primarySourceAsset?.local_path ?? null
                                      if (!localPath) {
                                        setAnalysisError(
                                          'No local source file is attached to this project — re-import the original video to enable preview.'
                                        )
                                        return
                                      }
                                      console.log('[preview] clicked soundbite', {
                                        id: c.id,
                                        start_time: c.start_time,
                                        end_time: c.end_time,
                                        duration: c.end_time - c.start_time,
                                        transcript_text_preview: (c.transcript_text ?? '').slice(0, 80),
                                        sourceLocalPath: localPath
                                      })
                                      setPreviewClip({
                                        sourcePath: localPath,
                                        sourceUrl: null,
                                        startTime: c.start_time,
                                        endTime: c.end_time,
                                        title: label,
                                        caption: c.transcript_text ?? ''
                                      })
                                    }}
                                    style={{
                                      ...ghost,
                                      padding: '6px 12px',
                                      fontSize: 13,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                  >
                                    ▶ Preview
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleSoundbiteSelect(c.id)}
                                    style={{
                                      ...primaryBtn,
                                      padding: '6px 12px',
                                      fontSize: 13,
                                      background: selectedForIntro ? 'rgba(110,231,197,0.2)' : '#6ee7c5',
                                      color: selectedForIntro ? '#6ee7c5' : '#061210',
                                      border: selectedForIntro ? '1px solid rgba(110,231,197,0.4)' : '1px solid transparent',
                                      boxShadow: selectedForIntro ? 'none' : '0 2px 8px rgba(110,231,197,0.2)'
                                    }}
                                  >
                                    {selectedForIntro ? '✓ Added' : '+ Add to Timeline'}
                                  </button>
                                </div>
                              </div>
                              
                              <p style={{ margin: 0, lineHeight: 1.5, color: '#e4e4e7', fontSize: 15 }}>
                                "{c.transcript_text}"
                              </p>

                              {ai && (
                                <div
                                  style={{
                                    display: 'grid',
                                    gap: 10,
                                    padding: 12,
                                    borderRadius: 12,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)'
                                  }}
                                >
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                    {ai.narrativeRoleLabel && (
                                      <span
                                        style={{
                                          padding: '4px 10px',
                                          borderRadius: 999,
                                          background: 'rgba(251,191,36,0.12)',
                                          border: '1px solid rgba(251,191,36,0.25)',
                                          color: '#fbbf24',
                                          fontSize: 12,
                                          fontWeight: 700,
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.05em'
                                        }}
                                      >
                                        {ai.narrativeRoleLabel}
                                        {ai.placements.arc != null ? ` · arc #${ai.placements.arc}` : ''}
                                      </span>
                                    )}
                                    {(
                                      [
                                        { key: 'viral', label: 'Viral' },
                                        { key: 'intro', label: 'Intro' },
                                        { key: 'graph', label: 'Graph' }
                                      ] as const
                                    )
                                      .filter((section) => ai.placements[section.key] != null)
                                      .map((section) => (
                                        <span
                                          key={section.key}
                                          style={{
                                            padding: '4px 10px',
                                            borderRadius: 999,
                                            background: 'rgba(59,130,246,0.12)',
                                            border: '1px solid rgba(59,130,246,0.18)',
                                            color: '#93c5fd',
                                            fontSize: 12
                                          }}
                                        >
                                          {section.label} #{ai.placements[section.key]}
                                        </span>
                                      ))}
                                    {ai.labels.slice(0, 6).map((tag) => (
                                      <span
                                        key={tag}
                                        style={{
                                          padding: '4px 10px',
                                          borderRadius: 999,
                                          background: 'rgba(110,231,197,0.08)',
                                          border: '1px solid rgba(110,231,197,0.16)',
                                          color: '#6ee7c5',
                                          fontSize: 12
                                        }}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                    {ai.source === 'ai' && (
                                      <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                                        AI review
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#a1a1aa' }}>
                                    <span>Overall {ai.overallScore.toFixed(2)}</span>
                                    <span>Viral {ai.viralScore.toFixed(2)}</span>
                                    <span>Intro {ai.introScore.toFixed(2)}</span>
                                    <span>Graph {ai.graphScore.toFixed(2)}</span>
                                  </div>
                                  {ai.purpose && (
                                    <div>
                                      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa', marginBottom: 4 }}>
                                        Purpose
                                      </div>
                                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#fcd34d' }}>
                                        {ai.purpose}
                                      </p>
                                    </div>
                                  )}
                                  {ai.rationale && (
                                    <div>
                                      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa', marginBottom: 4 }}>
                                        Why it stands out
                                      </div>
                                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#d4d4d8' }}>
                                        {ai.rationale}
                                      </p>
                                    </div>
                                  )}
                                  {ai.whyBullets.length > 0 && (
                                    <div>
                                      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa', marginBottom: 6 }}>
                                        Why it works
                                      </div>
                                      <div style={{ display: 'grid', gap: 6 }}>
                                        {ai.whyBullets.map((bullet, bulletIdx) => (
                                          <div
                                            key={`${c.id}-why-${bulletIdx}`}
                                            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#d4d4d8', fontSize: 13, lineHeight: 1.5 }}
                                          >
                                            <span style={{ color: '#6ee7c5' }}>•</span>
                                            <span>{bullet}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(
                                    [
                                      { key: 'viral', label: 'Why it lands as viral' },
                                      { key: 'intro', label: 'Why it works as an intro' },
                                      { key: 'graph', label: 'Why it deserves a graph beat' }
                                    ] as const
                                  )
                                    .filter((section) => Boolean(ai.sectionReasons?.[section.key]))
                                    .map((section) => (
                                      <div key={`${c.id}-${section.key}`}>
                                        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa', marginBottom: 4 }}>
                                          {section.label}
                                        </div>
                                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#d4d4d8' }}>
                                          {ai.sectionReasons?.[section.key]}
                                        </p>
                                      </div>
                                    ))}
                                  {(displayedBrollIdeas.length > 0 || displayedGraphIdea) && (
                                    <div style={{ display: 'grid', gap: 8 }}>
                                      {displayedBrollIdeas.length > 0 && (() => {
                                        const idea = displayedBrollIdeas[0]!
                                        const isRegenerating = generatingBrollPromptSoundbiteId === c.id
                                        return (
                                          <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa' }}>
                                                  {reviewBrollMode === 'cinematic' ? 'Cinematic B-roll' : 'Practical B-roll'}
                                                </span>
                                                <span style={{ fontSize: 10, color: '#52525b', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                  {idea.style}
                                                </span>
                                              </div>
                                              <button
                                                type="button"
                                                disabled={isRegenerating || !window.storyteller?.generateBrollForSoundbite}
                                                onClick={async () => {
                                                  const full = soundbites.find((s) => s.id === c.id)
                                                  if (full) await onGenerateSoundbiteBroll(full)
                                                }}
                                                style={{
                                                  background: 'none',
                                                  border: '1px solid rgba(255,255,255,0.1)',
                                                  color: isRegenerating ? '#52525b' : '#a1a1aa',
                                                  padding: '3px 10px',
                                                  borderRadius: 6,
                                                  fontSize: 11,
                                                  cursor: isRegenerating ? 'default' : 'pointer',
                                                  letterSpacing: '0.04em'
                                                }}
                                                title="Generate a fresh B-roll prompt for this soundbite"
                                              >
                                                {isRegenerating ? 'Generating…' : 'Regenerate'}
                                              </button>
                                            </div>
                                            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#e4e4e7' }}>
                                              {idea.prompt}
                                            </p>
                                            {idea.why && (
                                              <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: '#a1a1aa' }}>
                                                {idea.why}
                                              </p>
                                            )}
                                          </div>
                                        )
                                      })()}
                                      {displayedGraphIdea && (
                                        <div>
                                          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a1a1aa', marginBottom: 4 }}>
                                            Graph / Stat Moment
                                          </div>
                                          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#e4e4e7' }}>
                                            {displayedGraphIdea.title}
                                            {displayedGraphIdea.why ? ` — ${displayedGraphIdea.why}` : ''}
                                          </p>
                                          {displayedGraphIdea.dataText && (
                                            <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: '#93c5fd' }}>
                                              <strong style={{ color: '#bfdbfe' }}>Data:</strong> {displayedGraphIdea.dataText}
                                            </p>
                                          )}
                                          {displayedGraphIdea.visualTreatment && (
                                            <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.5, color: '#a1a1aa' }}>
                                              <strong style={{ color: '#cbd5e1' }}>Treatment:</strong> {displayedGraphIdea.visualTreatment}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                <button
                                  type="button"
                                  style={linkBtn}
                                  onClick={() => {
                                    setSelectedSoundbiteId(c.id)
                                    setSelectedSegmentId(segId ?? null)
                                    setReviewTab('transcript')
                                  }}
                                >
                                  Locate in transcript
                                </button>
                                {transcriptActive && (
                                  <div style={{ fontSize: 11, color: '#6ee7c5' }}>Shown in Transcript tab</div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {reviewTab === 'transcript' && (
                    <div>
                      {dbSegments.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#a1a1aa' }}>
                            Review the full transcript below, or copy the entire transcript to paste into notes, docs, or another editor.
                          </p>
                          <button
                            type="button"
                            style={ghost}
                            onClick={() => void copyFullTranscript()}
                            disabled={!fullTranscriptText}
                          >
                            {transcriptCopyStatus === 'copied'
                              ? 'Copied full transcript'
                              : transcriptCopyStatus === 'error'
                                ? 'Copy failed'
                                : 'Copy full transcript'}
                          </button>
                        </div>
                      )}
                      {transcriptLoading && <p style={{ color: '#a1a1aa' }}>Loading transcript…</p>}
                      {transcriptError && <p style={{ color: '#f87171' }}>{transcriptError}</p>}
                      {!transcriptLoading && dbSegments.length === 0 && (
                        <div style={{ ...card, padding: 32, textAlign: 'center' }}>
                          <p style={{ color: '#a1a1aa', margin: 0 }}>No transcript yet — run Analyze in the Goal step first.</p>
                        </div>
                      )}
                      {Array.from(groupedTranscript.entries()).map(([assetId, segs]) => (
                        <div key={assetId} style={{ marginBottom: 24 }}>
                          <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {assetLabel(assetId, assetNameById)}
                          </div>
                          <div style={{ background: '#1c1c1f', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                            {segs.map((s, i) => {
                              const active = selectedSegmentId === s.id
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSegmentId(s.id)
                                    setSelectedSoundbiteId(null)
                                  }}
                                  style={{
                                    width: '100%',
                                    textAlign: 'left' as const,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    gap: 16,
                                    alignItems: 'flex-start',
                                    padding: '12px 16px',
                                    border: 'none',
                                    borderBottom: i < segs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                    fontSize: 15,
                                    lineHeight: 1.6,
                                    color: active ? '#f4f4f5' : '#d4d4d8',
                                    background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
                                    transition: 'background 0.2s'
                                  }}
                                >
                                  <span
                                    style={{
                                      color: active ? '#6ee7c5' : '#a1a1aa',
                                      fontSize: 12,
                                      minWidth: 100,
                                      fontVariantNumeric: 'tabular-nums',
                                      flexShrink: 0,
                                      paddingTop: 3
                                    }}
                                  >
                                    {s.start_time.toFixed(2)}s – {s.end_time.toFixed(2)}s
                                  </span>
                                  <span style={{ flex: 1, minWidth: 0 }}>{s.text}</span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {reviewTab === 'story' && (
                    <div style={{ ...card, padding: 24 }}>
                      <h3 style={{ marginTop: 0, fontSize: 18 }}>Story plan</h3>
                      <p style={{ color: '#a1a1aa', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
                        This tab is the app&apos;s narrative scaffold. It summarizes the story shape the review and timeline steps are aiming for, so you can sense-check whether the cut should open, develop, and close the way you expect.
                      </p>
                      <div style={{ marginBottom: 16, padding: 14, background: 'rgba(110,231,197,0.06)', border: '1px solid rgba(110,231,197,0.14)', borderRadius: 10, fontSize: 13, color: '#d4d4d8', lineHeight: 1.6 }}>
                        It does not directly edit the timeline yet. Think of it as guidance for what the strongest clips should be doing before you build the cut in Step 4.
                      </div>
                      <ul style={{ color: '#e4e4e7', lineHeight: 1.6, paddingLeft: 20 }}>
                        {plan.outline.map((o) => (
                          <li key={o} style={{ marginBottom: 8 }}>{o}</li>
                        ))}
                      </ul>
                      {plan.journalism && (
                        <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                          <strong style={{ color: '#f4f4f5' }}>Headline:</strong> <span style={{ color: '#e4e4e7' }}>{plan.journalism.headline_working}</span>
                          <br />
                          <strong style={{ color: '#f4f4f5', display: 'inline-block', marginTop: 8 }}>Slug:</strong> <span style={{ color: '#e4e4e7' }}>{plan.journalism.slug}</span>
                        </div>
                      )}
                      {plan.creator && (
                        <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                          <strong style={{ color: '#f4f4f5' }}>Aspect hint:</strong> <span style={{ color: '#e4e4e7' }}>{plan.creator.aspect_hint}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeStep === 'timeline' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>{timelineCopy.title}</h2>
                    <p style={stepDesc}>{timelineCopy.description}</p>
                  </div>

                  {timelineLoadError && <p style={{ color: '#f87171', fontSize: 14 }}>Timeline load: {timelineLoadError}</p>}
                  {timelineLoading && <p style={{ color: '#a1a1aa', fontSize: 14 }}>Loading saved timeline…</p>}

                  {project?.mode === 'music_video' && (
                    <div style={{ ...card, padding: 24, marginBottom: 24, border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                        <span style={{ fontSize: 16 }}>🎵</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>Beat-Synced Cut</div>
                          {detectedBpm
                            ? <div style={{ fontSize: 12, color: '#a855f7', marginTop: 2 }}>{detectedBpm} BPM detected · {beatTimestamps.length} beats</div>
                            : <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>Add a music track in step 1 to enable beat-synced cutting</div>
                          }
                        </div>
                      </div>

                      {detectedBpm && (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <span style={{ fontSize: 12, color: '#a1a1aa', whiteSpace: 'nowrap' }}>Cut every</span>
                            {([1, 2, 4, 8] as BeatsPerCut[]).map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => updateProject(projectId, { beatsPerCut: n })}
                                style={{
                                  padding: '5px 12px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  background: (project.beatsPerCut ?? 4) === n ? '#a855f7' : 'transparent',
                                  color: (project.beatsPerCut ?? 4) === n ? '#fff' : '#a1a1aa',
                                  border: (project.beatsPerCut ?? 4) === n ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)'
                                }}
                              >{n === 1 ? '1 beat' : `${n} beats`}</button>
                            ))}
                            <span style={{ fontSize: 11, color: '#52525b', marginLeft: 4 }}>
                              ≈ {((60 / (detectedBpm || 120)) * (project.beatsPerCut ?? 4)).toFixed(1)}s per clip
                            </span>
                          </div>

                          {beatAnalysisError && (
                            <p style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{beatAnalysisError}</p>
                          )}

                          <button
                            type="button"
                            onClick={() => void onAssembleMusicVideoCut()}
                            style={{
                              padding: '8px 20px',
                              borderRadius: 8,
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: '#a855f7',
                              color: '#fff',
                              border: 'none'
                            }}
                          >
                            Build Beat-Synced Cut
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div style={{ ...card, padding: 24, marginBottom: 32 }}>
                    <IntroBuilderPanel
                      soundbites={builderCandidates}
                      selectedIds={selectedSoundbiteIds}
                      onTop3={() => applyTopBuilderSelection(3)}
                      onTop5={() => applyTopBuilderSelection(5)}
                      onTop7={() => applyTopBuilderSelection(7)}
                      onUseTrailerArc={toggleTrailerArcOnTimeline}
                      trailerArcOnTimeline={isTrailerArcOnTimeline}
                      hasTrailerArc={trailerArcSoundbiteIds.length > 0}
                      onClearTimeline={() => void onClearTimeline()}
                      clearing={clearingTimeline}
                      introDurationSec={introDurationSec}
                      onIntroDuration={setIntroDurationSec}
                      onBuildIntro={onBuildIntro}
                      onSaveTimeline={() => void onSaveTimeline()}
                      draftIntro={draftIntro}
                      activeSequence={sequence}
                      buildError={introBuildError}
                      saveError={saveTimelineError}
                      saving={saveTimelineBusy}
                      introBuilding={introBuildBusy}
                      primaryAssetId={primaryAssetId}
                      canSaveTimeline={canPersistTimeline}
                      hasAnalyzedSoundbites={hasAnalyzedSoundbites}
                      selectedGoalCard={selectedGoalCard}
                      pacing={timelinePacing}
                    />
                  </div>

                  <div style={{ marginTop: 32 }}>
                    <TimelineEditor
                      sequence={sequence}
                      pacing={timelinePacing}
                      onPacingChange={setTimelinePacing}
                      playheadSeconds={timelinePlayheadSeconds}
                      onPlayheadChange={requestLivePreviewSeek}
                      playbackState={livePreviewPlaybackState}
                      canControlPlayback={canControlLivePreview}
                      onPlay={() => setLivePreviewPlaybackState('playing')}
                      onPause={() => setLivePreviewPlaybackState('paused')}
                      onStop={() => setLivePreviewPlaybackState('stopped')}
                      onUndo={() => void undoTimelineEdit()}
                      onRedo={() => void redoTimelineEdit()}
                      canUndo={canUndoTimeline}
                      canRedo={canRedoTimeline}
                      selectedClipId={selectedTimelineClipId}
                      onSelectedClipChange={setSelectedTimelineClipId}
                      onSequenceChange={(next, opts) => {
                        if (opts?.isDraft) {
                          // During trim drag: update display state only — no DB
                          // write, no undo-stack push. One commit comes on mouse-up.
                          setTrimDraftSequence(next)
                        } else {
                          // Committed change (mouse-up or any non-trim edit):
                          // clear the draft overlay and persist normally.
                          setTrimDraftSequence(null)
                          void persistSequenceUpdate(next)
                        }
                      }}
                      onTrimActiveChange={setActiveTrimState}
                      onAssetLibraryDrop={(payload, atSeconds) => {
                        void handleAssetLibraryDrop(payload, atSeconds)
                      }}
                    />
                    {editFormat === 'vertical' && selectedClipForFraming && (
                      <div
                        style={{
                          marginTop: 16,
                          padding: '14px 16px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: '#141416',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontSize: 12, color: '#e4e4e7', fontWeight: 600 }}>Frame position</span>
                          <button
                            type="button"
                            onClick={() => handleFramePositionChange(DEFAULT_FRAME_POSITION)}
                            style={{
                              background: 'transparent',
                              color: '#a1a1aa',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 6,
                              padding: '4px 10px',
                              fontSize: 12,
                              cursor: 'pointer'
                            }}
                          >
                            Reset to center
                          </button>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: '#71717a' }}>
                          Drag the live preview or use sliders to reframe this clip.
                        </p>
                        {(() => {
                          const pos = normalizeFramePosition(selectedClipForFraming.framePosition)
                          return (
                            <div
                              style={{
                                display: 'grid',
                                gap: 10,
                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'
                              }}
                            >
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#a1a1aa' }}>
                                Horizontal
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={pos.x}
                                  onChange={(e) =>
                                    handleFramePositionChange({ ...pos, x: Number(e.target.value) })
                                  }
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#a1a1aa' }}>
                                Vertical
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  step={1}
                                  value={pos.y}
                                  onChange={(e) =>
                                    handleFramePositionChange({ ...pos, y: Number(e.target.value) })
                                  }
                                />
                              </label>
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>

                  <details style={{ marginTop: 32 }}>
                    <summary style={{ color: '#a1a1aa', cursor: 'pointer', fontSize: 14, userSelect: 'none' }}>View Canonical Timeline (JSON)</summary>
                    <div style={{ marginTop: 16 }}>
                      <p style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 12 }}>
                        {(sequence.metadata as { builder?: string })?.builder === 'intro-v1'
                          ? `${timelineCopy.jsonSummary} Save from Soundbites, then export for Final Cut, Premiere, or Resolve.`
                          : `Auto rough cut from top ranked soundbites — the Step 4 builder adapts to your selected goal instead of assuming every workflow is an intro.`}{' '}
                        Pacing uses your project silence preset.
                      </p>
                      <pre style={pre}>{JSON.stringify(sequence, null, 2)}</pre>
                    </div>
                  </details>
                </div>
              )}

              {activeStep === 'enhance' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>5. Enhance</h2>
                    <p style={stepDesc}>Add B-roll, Top Layer graphics, and optional overlays to your timeline.</p>
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginBottom: 40, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={actionBtn}
                      onClick={() => document.getElementById('enhance-broll')?.scrollIntoView({ behavior: 'smooth' })}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#6ee7c5'; e.currentTarget.style.background = 'rgba(110,231,197,0.05)' }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = '#1c1c1f' }}
                    >
                      <span style={{ fontSize: 20, marginBottom: 8 }}>🎞️</span>
                      Add B-roll
                    </button>
                    <button
                      type="button"
                      style={actionBtn}
                      onClick={() => scrollToEnhanceSection('enhance-graphics')}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#6ee7c5'; e.currentTarget.style.background = 'rgba(110,231,197,0.05)' }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = '#1c1c1f' }}
                    >
                      <span style={{ fontSize: 20, marginBottom: 8 }}>🖼️</span>
                      Top Layer
                    </button>
                    <button
                      type="button"
                      style={actionBtn}
                      onClick={() => scrollToEnhanceSection('enhance-pause')}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#6ee7c5'; e.currentTarget.style.background = 'rgba(110,231,197,0.05)' }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = '#1c1c1f' }}
                    >
                      <span style={{ fontSize: 20, marginBottom: 8 }}>⏱️</span>
                      Add Pause / Breathing Room
                    </button>
                  </div>

                  <div
                    style={{
                      ...card,
                      marginBottom: 32,
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 16,
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div style={{ fontWeight: 600 }}>Transition clips</div>
                      <p style={{ color: '#a1a1aa', fontSize: 13, margin: '8px 0 0' }}>
                        Generate AI clips that bridge between narrative segments. Disable to use only standard B-roll.
                      </p>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={project.brollTransitionsEnabled !== false}
                        onChange={(e) => updateProject(projectId, { brollTransitionsEnabled: e.target.checked })}
                        style={{ accentColor: '#6ee7c5', width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: 13, color: '#d4d4d8' }}>
                        {project.brollTransitionsEnabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
                    {project && (
                      <div id="enhance-broll">
                        <h3 style={{ fontSize: 20, fontWeight: 600, color: '#f4f4f5', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ color: '#6ee7c5' }}>🎞️</span> B-roll Prompts
                        </h3>
                        <div>
                          {enhanceProductionRows.length > 0 && (
                            <div
                              style={{
                                ...card,
                                marginBottom: 16,
                                padding: 16,
                                background: 'rgba(110,231,197,0.03)',
                                border: '1px solid rgba(110,231,197,0.12)'
                              }}
                            >
                              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6ee7c5', marginBottom: 10 }}>
                                {mediaGatewayEnabled && enhanceTimelineProduction.length > 0
                                  ? 'On your timeline'
                                  : mediaGatewayEnabled
                                    ? 'From your soundbites'
                                    : 'Grounded AI ideas from review'}
                              </div>
                              <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 10 }}>
                                {mediaGatewayEnabled
                                  ? enhanceTimelineProduction.length > 0
                                    ? 'Each clip on your cut gets the same preview → image → video flow. Credits are charged only when you click generate.'
                                    : 'Each soundbite shows the proposed B-roll prompt. Create a preview image, pick length (6–15s), then generate video. Credits are charged only when you click generate.'
                                  : `Showing the ${reviewBrollMode === 'cinematic' ? 'more cinematic' : 'more practical'} version of the grounded B-roll idea from your review pass.`}
                              </div>
                              <div style={{ display: 'grid', gap: 12 }}>
                                {enhanceProductionRows.map(({ soundbite, ai, timelineLabel, reviewAi }) => {
                                  const reviewBrollIdeas =
                                    !mediaGatewayEnabled && reviewAi ? reviewBrollIdeasForDisplay(reviewAi, reviewBrollMode) : []
                                  return (
                                    <div
                                      key={soundbite.id}
                                      style={{
                                        padding: 12,
                                        borderRadius: 10,
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid rgba(255,255,255,0.06)'
                                      }}
                                    >
                                      {timelineLabel && (
                                        <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6 }}>
                                          {timelineLabel}
                                        </div>
                                      )}
                                      <div style={{ fontSize: 13, color: '#f4f4f5', lineHeight: 1.45, marginBottom: 6 }}>
                                        "{soundbite.transcript_text}"
                                      </div>
                                      {!mediaGatewayEnabled && reviewAi && reviewBrollIdeas.length > 0 && (
                                        <div style={{ display: 'grid', gap: 8, marginBottom: reviewAi.graphIdea ? 8 : 0 }}>
                                          <strong style={{ color: '#f4f4f5', fontSize: 13 }}>
                                            {reviewBrollMode === 'cinematic' ? 'Cinematic B-roll ideas:' : 'Practical B-roll ideas:'}
                                          </strong>
                                          {reviewBrollIdeas.map((idea, ideaIdx) => (
                                            <div key={`${soundbite.id}-${idea.style}-${ideaIdx}`} style={{ fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>
                                              <span style={{ color: ideaIdx === 0 ? '#6ee7c5' : '#a1a1aa' }}>
                                                {ideaIdx === 0 ? 'Primary' : `Alt ${ideaIdx}`} · {idea.style}
                                              </span>{' '}
                                              {idea.prompt}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {!mediaGatewayEnabled && reviewAi?.graphIdea && (
                                        <div style={{ fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>
                                          <strong style={{ color: '#f4f4f5' }}>Graph:</strong> {reviewAi.graphIdea.title}
                                          {reviewAi.graphIdea.why ? ` — ${reviewAi.graphIdea.why}` : ''}
                                        </div>
                                      )}
                                      {mediaGatewayEnabled && project && (
                                        <ProductionPanel
                                          soundbite={soundbite}
                                          ai={ai}
                                          projectId={projectId}
                                          editFormat={editFormat}
                                          sequence={sequence}
                                          assets={assets}
                                          accessToken={null}
                                          supabase={supabaseWhenSignedIn}
                                          busySoundbiteId={productionBusySoundbiteId}
                                          onBusyChange={setProductionBusySoundbiteId}
                                          onPersistSequence={persistSequenceUpdate}
                                          onAddAssets={(nextAssets) => addLocalAssets(projectId, nextAssets)}
                                          onError={setBrollGenError}
                                          availableCredits={aiAvailableCredits}
                                          outOfCredits={aiOutOfCredits}
                                          generatingBrollPrompt={generatingBrollPromptSoundbiteId === soundbite.id}
                                          onGenerateBrollPrompt={async () => {
                                            const full = soundbites.find((s) => s.id === soundbite.id)
                                            if (full) await onGenerateSoundbiteBroll(full)
                                          }}
                                        />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {mediaGatewayEnabled ? (
                            <div
                              style={{
                                marginTop: 32,
                                marginBottom: 24,
                                paddingTop: 28,
                                borderTop: '1px solid rgba(255,255,255,0.1)'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                                <h4 style={{ fontSize: 16, fontWeight: 600, color: '#f4f4f5', margin: 0 }}>
                                  Your prompts
                                </h4>
                                <button
                                  type="button"
                                  onClick={() => setCustomProductionLinkId(`custom-${crypto.randomUUID()}`)}
                                  style={{
                                    background: 'none',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    color: '#a1a1aa',
                                    padding: '4px 12px',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    flexShrink: 0
                                  }}
                                  title="Clear current prompt and start a new one"
                                >
                                  New prompt
                                </button>
                              </div>
                              <p style={{ color: '#71717a', fontSize: 13, margin: '0 0 16px 0', lineHeight: 1.5 }}>
                                Write your own motion prompt and either upload an opening frame (free) or generate
                                one with AI — then animate to video. B-roll maps near the playhead
                                {livePreviewClip ? ' on your current clip' : ''}.
                              </p>
                              {project && (
                                <div
                                  style={{
                                    padding: 12,
                                    borderRadius: 10,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)'
                                  }}
                                >
                                  <ProductionPanel
                                    key={customProductionLinkId}
                                    manualMode
                                    soundbite={customProductionSoundbite}
                                    ai={customProductionAi}
                                    projectId={projectId}
                                    editFormat={editFormat}
                                    sequence={sequence}
                                    assets={assets}
                                    accessToken={null}
                                    supabase={supabaseWhenSignedIn}
                                    busySoundbiteId={productionBusySoundbiteId}
                                    onBusyChange={setProductionBusySoundbiteId}
                                    onPersistSequence={persistSequenceUpdate}
                                    onAddAssets={(nextAssets) => addLocalAssets(projectId, nextAssets)}
                                    onError={setBrollGenError}
                                    availableCredits={aiAvailableCredits}
                                    outOfCredits={aiOutOfCredits}
                                  />
                                </div>
                              )}
                            </div>
                          ) : (
                            <p style={{ color: '#a1a1aa', fontSize: 14, marginTop: 0, lineHeight: 1.6, marginBottom: 16 }}>
                              <strong>From your story</strong> writes one specific prompt per real beat (intro shots, saved
                              soundbites) and drops it on the timeline automatically. Switch to{' '}
                              <strong>Cover entire episode</strong> for the legacy heuristic that walks the full transcript
                              in 30s windows. Set subject defaults below so generations match your cast — we never invent
                              ethnicity if you leave fields blank. Generate video <strong>one prompt at a time</strong> so
                              credits are never spent automatically.
                            </p>
                          )}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 12,
                              alignItems: 'center',
                              marginBottom: 24,
                              padding: 12,
                              background: 'rgba(255,255,255,0.02)',
                              borderRadius: 12
                            }}
                          >
                            <div
                              role="tablist"
                              aria-label="B-roll prompt source"
                              style={{
                                display: 'inline-flex',
                                background: 'rgba(0,0,0,0.25)',
                                borderRadius: 999,
                                padding: 3
                              }}
                            >
                              {(
                                [
                                  { id: 'beats', label: 'From your story' },
                                  { id: 'episode', label: 'Cover entire episode' }
                                ] as const
                              ).map((opt) => {
                                const active = brollPromptSource === opt.id
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setBrollPromptSource(opt.id)}
                                    style={{
                                      padding: '6px 14px',
                                      fontSize: 13,
                                      fontWeight: 500,
                                      borderRadius: 999,
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: active ? '#0b1014' : '#a1a1aa',
                                      background: active ? '#6ee7c5' : 'transparent',
                                      transition: 'background 120ms ease, color 120ms ease'
                                    }}
                                  >
                                    {opt.label}
                                  </button>
                                )
                              })}
                            </div>
                            {brollPromptSource === 'beats' ? (
                              <>
                                <button
                                  type="button"
                                  style={{ ...primaryBtn, background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`, color: '#ffffff', boxShadow: `0 0 10px ${intentColors.glow}`, opacity: brollGenBusy ? 0.75 : 1 }}
                                  disabled={brollGenBusy || beatsFromTimeline.length === 0}
                                  onClick={() => void onGenerateBrollFromBeats()}
                                  title={
                                    beatsFromTimeline.length === 0
                                      ? 'Pick a few soundbites or build an intro to enable this.'
                                      : 'Write one specific prompt per beat and auto-map to the timeline.'
                                  }
                                >
                                  {brollGenBusy
                                    ? 'Writing…'
                                    : beatBrollPrompts && beatBrollPrompts.length > 0
                                      ? 'Refresh beat prompts'
                                      : `Write ${beatsFromTimeline.length || ''} beat prompt${beatsFromTimeline.length === 1 ? '' : 's'}`.trim()}
                                </button>
                                <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                                  <strong style={{ color: '#f4f4f5' }}>{beatsFromTimeline.length}</strong> beat
                                  {beatsFromTimeline.length === 1 ? '' : 's'}
                                  {beatBrollSource === 'ai'
                                    ? ' · written by AI'
                                    : beatBrollSource === 'deterministic'
                                      ? ' · written locally'
                                      : ''}
                                </span>
                                {beatBrollPrompts && beatBrollPrompts.length > 0 && (
                                  <button
                                    type="button"
                                    style={ghost}
                                    onClick={() => {
                                      setBeatBrollPrompts(null)
                                      setBeatBrollSource(null)
                                    }}
                                  >
                                    Clear beat prompts
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                style={{ ...primaryBtn, opacity: brollMapBusy ? 0.75 : 1 }}
                                disabled={brollMapBusy}
                                onClick={() => void onMapBrollSlotsToTimeline()}
                              >
                                {brollMapBusy ? 'Mapping…' : 'Map prompts to timeline slots'}
                              </button>
                            )}
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                              Slots on timeline: <strong style={{ color: '#f4f4f5' }}>{sequence.brollSlots?.length ?? 0}</strong> · Ready:{' '}
                              <strong style={{ color: '#6ee7c5' }}>{sequence.brollSlots?.filter((s) => s.status === 'ready').length ?? 0}</strong>
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 24, background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12 }}>
                            <label style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 14 }}>
                              <span style={{ color: '#a1a1aa' }}>Prompt pack</span>
                              <select
                                value={project.promptPackId}
                                onChange={(e) =>
                                  updateProject(projectId, {
                                    promptPackId: e.target.value as PromptPackSelection
                                  })
                                }
                                style={{ ...inputStyle, minWidth: 220 }}
                              >
                                <option value="auto">Auto (from AI Direction)</option>
                                {(Object.keys(PROMPT_PACKS) as PromptPackId[]).map((id) => (
                                  <option key={id} value={id}>
                                    {PROMPT_PACKS[id].label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                              Active: <strong style={{ color: '#6ee7c5' }}>{effectivePromptPack.label}</strong>
                            </span>
                            <div style={{ flex: 1 }} />
                            <button
                              type="button"
                              style={{ ...primaryBtn, background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`, color: '#ffffff', boxShadow: `0 0 10px ${intentColors.glow}`, opacity: brollGenBusy ? 0.75 : 1 }}
                              disabled={brollGenBusy || (brollPromptSource === 'beats' && beatsFromTimeline.length === 0)}
                              onClick={() => void onGenerateBrollAi()}
                              title={
                                brollPromptSource === 'beats' && beatsFromTimeline.length === 0
                                  ? 'Build a timeline cut first — prompts are generated from your spine clips.'
                                  : brollPromptSource === 'beats'
                                    ? 'Generate one AI prompt per clip on your timeline.'
                                    : 'Generate episode-wide B-roll ideas from the full transcript.'
                              }
                            >
                              {brollGenBusy ? 'Generating…' : 'Generate with AI'}
                            </button>
                            <button
                              type="button"
                              style={ghost}
                              disabled={!aiBrollPrompts && !beatBrollPrompts && !directorPackageJson && !brollGenError && !brollGenStatus}
                              onClick={onClearGeneratedPrompts}
                            >
                              Clear AI prompts
                            </button>
                          </div>
                          
                          {brollGenStatus && (
                            <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 16 }}>{brollGenStatus}</div>
                          )}
                          {brollGenError && (
                            <div style={{ fontSize: 14, color: '#f87171', marginBottom: 16 }}>{brollGenError}</div>
                          )}
                          {beatBrollFallbackReason && brollPromptSource === 'beats' && (
                            <div
                              style={{
                                fontSize: 13,
                                color: '#fbbf24',
                                marginBottom: 16,
                                padding: '10px 14px',
                                background: 'rgba(251,191,36,0.08)',
                                border: '1px solid rgba(251,191,36,0.2)',
                                borderRadius: 8,
                                display: 'flex',
                                gap: 12,
                                alignItems: 'flex-start'
                              }}
                            >
                              <span style={{ flex: 1, lineHeight: 1.5 }}>
                                <strong style={{ color: '#fbbf24' }}>AI writer didn&apos;t run.</strong>{' '}
                                {beatBrollFallbackReason} The cards below were written by the local writer instead.
                              </span>
                              <button
                                type="button"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#a1a1aa',
                                  cursor: 'pointer',
                                  fontSize: 13
                                }}
                                onClick={() => setBeatBrollFallbackReason(null)}
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                          {directorPackageJson != null && (
                            <details style={{ marginBottom: 24, fontSize: 14 }}>
                              <summary style={{ cursor: 'pointer', color: '#f4f4f5' }}>
                                Creative director output (intro, sound bites, hooks, cliffhangers, visuals)
                              </summary>
                              <pre style={{ ...pre, marginTop: 12, maxHeight: 300 }}>
                                {JSON.stringify(directorPackageJson, null, 2)}
                              </pre>
                            </details>
                          )}
                          {(mediaGatewayEnabled ? aiMediaLineStatus : runwayLineStatus) && (
                            <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 16 }}>
                              {mediaGatewayEnabled ? aiMediaLineStatus : runwayLineStatus}
                            </div>
                          )}

                          {mediaGatewayEnabled && aiOutOfCredits && (
                            <div
                              style={{
                                fontSize: 13,
                                color: '#fcd34d',
                                marginBottom: 12,
                                padding: '10px 14px',
                                borderRadius: 8,
                                border: '1px solid rgba(251,191,36,0.25)',
                                background: 'rgba(251,191,36,0.08)'
                              }}
                            >
                              You&apos;re out of Storyteller AI credits. Upgrade your plan from the dashboard to
                              generate more video.
                            </div>
                          )}
                          {mediaGatewayEnabled && (
                            <div
                              style={{
                                fontSize: 13,
                                color: '#a7f3d0',
                                marginBottom: 12,
                                padding: '10px 14px',
                                borderRadius: 8,
                                border: '1px solid rgba(110,231,197,0.25)',
                                background: 'rgba(110,231,197,0.06)'
                              }}
                            >
                              Beat prompts generate through Storyteller AI. Credits apply when you click Generate.
                            </div>
                          )}
                          {showDevProviderControls && (
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                            <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Dev provider
                            </span>
                            <label
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                fontSize: 14,
                                cursor: 'pointer'
                              }}
                            >
                              <input
                                type="radio"
                                name="broll-provider"
                                checked={brollProvider === 'runway'}
                                onChange={() => setBrollProvider('runway')}
                                style={{ accentColor: '#6ee7c5' }}
                              />
                              Runway
                            </label>
                            <label
                              style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'center',
                                fontSize: 14,
                                cursor: 'pointer'
                              }}
                            >
                              <input
                                type="radio"
                                name="broll-provider"
                                checked={brollProvider === 'higgsfield'}
                                onChange={() => setBrollProvider('higgsfield')}
                                style={{ accentColor: '#a78bfa' }}
                              />
                              Higgsfield
                              {brollProvider === 'higgsfield' && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    background: higgsfieldConfigured
                                      ? 'rgba(167,139,250,0.15)'
                                      : 'rgba(251,191,36,0.15)',
                                    color: higgsfieldConfigured ? '#c4b5fd' : '#fbbf24',
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: `1px solid ${higgsfieldConfigured ? 'rgba(167,139,250,0.3)' : 'rgba(251,191,36,0.3)'}`
                                  }}
                                >
                                  {higgsfieldConfigured == null
                                    ? 'checking…'
                                    : higgsfieldConfigured
                                      ? 'configured'
                                      : 'needs setup'}
                                </span>
                              )}
                            </label>
                            {enableKlingUi && (
                              <label
                                style={{
                                  display: 'flex',
                                  gap: 8,
                                  alignItems: 'center',
                                  fontSize: 14,
                                  cursor: 'pointer'
                                }}
                              >
                                <input
                                  type="radio"
                                  name="broll-provider"
                                  checked={brollProvider === 'kling'}
                                  onChange={() => setBrollProvider('kling')}
                                  style={{ accentColor: '#60a5fa' }}
                                />
                                Kling (dev)
                              </label>
                            )}
                          </div>
                          )}

                          {!mediaGatewayEnabled && brollProvider === 'higgsfield' && (
                            <div
                              style={{
                                marginBottom: 20,
                                border: '1px solid rgba(167,139,250,0.25)',
                                background: 'rgba(167,139,250,0.04)',
                                borderRadius: 12,
                                padding: 16
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <strong style={{ color: '#e9d5ff', fontSize: 14 }}>Higgsfield</strong>
                                  <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                                    Image-to-video. Attach a reference image for best results.
                                  </span>
                                </div>
                                {enableByokUi && (
                                  <button
                                    type="button"
                                    style={{ ...ghost, fontSize: 12 }}
                                    onClick={() => setHiggsfieldPanelOpen((o) => !o)}
                                  >
                                    {higgsfieldPanelOpen ? 'Hide settings' : 'Settings'}
                                  </button>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#a1a1aa' }}>
                                  Model
                                  <select
                                    value={higgsfieldModelId}
                                    onChange={(e) => setHiggsfieldModelId(e.target.value)}
                                    style={{
                                      background: '#18181b',
                                      color: '#f4f4f5',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6,
                                      padding: '6px 8px',
                                      fontSize: 13,
                                      minWidth: 320
                                    }}
                                  >
                                    <option value="bytedance/seedance/v1/pro/image-to-video">
                                      bytedance/seedance/v1/pro/image-to-video — photoreal, default
                                    </option>
                                    <option value="higgsfield-ai/dop/standard">
                                      higgsfield-ai/dop/standard — stylized motion
                                    </option>
                                    <option value="kling-video/v2.1/pro/image-to-video">
                                      kling-video/v2.1/pro/image-to-video — cinematic camera moves
                                    </option>
                                  </select>
                                </label>
                              </div>

                              {enableByokUi && higgsfieldPanelOpen && (
                                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                                    Internal dev BYOK only. Normal users generate through the Storyteller AI Gateway.
                                  </div>
                                  <input
                                    type="text"
                                    placeholder="API key"
                                    value={higgsfieldKeyDraft}
                                    onChange={(e) => setHiggsfieldKeyDraft(e.target.value)}
                                    style={{
                                      background: '#18181b',
                                      color: '#f4f4f5',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6,
                                      padding: '8px 10px',
                                      fontSize: 13,
                                      fontFamily: 'monospace'
                                    }}
                                  />
                                  <input
                                    type="password"
                                    placeholder="API secret"
                                    value={higgsfieldSecretDraft}
                                    onChange={(e) => setHiggsfieldSecretDraft(e.target.value)}
                                    style={{
                                      background: '#18181b',
                                      color: '#f4f4f5',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      borderRadius: 6,
                                      padding: '8px 10px',
                                      fontSize: 13,
                                      fontFamily: 'monospace'
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      style={primaryBtn}
                                      disabled={!higgsfieldKeyDraft.trim() || !higgsfieldSecretDraft.trim()}
                                      onClick={() => void onSaveHiggsfieldCredentials()}
                                    >
                                      Save credentials
                                    </button>
                                    <button
                                      type="button"
                                      style={ghost}
                                      onClick={() => void onTestHiggsfieldCredentials()}
                                      disabled={!higgsfieldConfigured}
                                      title={!higgsfieldConfigured ? 'Save credentials first.' : 'Send a tiny request to confirm the key + secret are valid.'}
                                    >
                                      Test connection
                                    </button>
                                    {higgsfieldConfigured && (
                                      <button
                                        type="button"
                                        style={ghost}
                                        onClick={() => void onClearHiggsfieldCredentials()}
                                      >
                                        Clear saved credentials
                                      </button>
                                    )}
                                  </div>
                                  {higgsfieldStatusMsg && (
                                    <div style={{ fontSize: 12, color: '#a1a1aa' }}>{higgsfieldStatusMsg}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          
                          {mediaGatewayEnabled &&
                            brollPromptSource === 'beats' &&
                            displayBrolls.length === 0 &&
                            !brollGenBusy && (
                              <div
                                style={{
                                  padding: 16,
                                  borderRadius: 12,
                                  background: 'rgba(255,255,255,0.02)',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  marginBottom: 16
                                }}
                              >
                                <p style={{ margin: 0, fontSize: 14, color: '#a1a1aa', lineHeight: 1.6 }}>
                                  Custom prompts — click <strong style={{ color: '#f4f4f5' }}>Write beat prompts</strong>{' '}
                                  to generate AI prompts for timeline beats.
                                </p>
                              </div>
                            )}

                          <div style={{ display: 'grid', gap: 16 }}>
                            {displayBrolls.map((b, i) => {
                              const meta = b.metadata_json as
                                | {
                                    providerPrompts?: { runway?: string; kling?: string }
                                    transcriptExcerpt?: string
                                    stylePack?: string
                                    aiGenerated?: boolean
                                    promptSource?: string
                                    beatOrigin?: string
                                  }
                                | undefined
                              const body =
                                brollProvider === 'runway' && meta?.providerPrompts?.runway
                                  ? meta.providerPrompts.runway
                                  : brollProvider === 'kling' && meta?.providerPrompts?.kling
                                    ? meta.providerPrompts.kling
                                    : b.prompt_text
                              const runwayPrompt = meta?.providerPrompts?.runway ?? b.prompt_text
                              const slot = sequence.brollSlots?.find(
                                (s) => (s.metadata as { promptIndex?: number } | undefined)?.promptIndex === i
                              )
                              const sourceLabel =
                                meta?.promptSource === 'beats-ai'
                                  ? 'AI · beat'
                                  : meta?.promptSource === 'beats-deterministic'
                                    ? 'beat'
                                    : meta?.aiGenerated
                                      ? 'AI'
                                      : 'heuristic'
                              return (
                                <div key={i} style={card}>
                                  <div style={{ fontSize: 12, color: '#a1a1aa', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>{b.prompt_type}</span>
                                    <span>{b.segment_start.toFixed(1)}s–{b.segment_end.toFixed(1)}s</span>
                                    <span>score {b.priority_score?.toFixed(2) ?? '—'}</span>
                                    {meta?.stylePack ? <span>· {meta.stylePack}</span> : null}
                                    <span>· {sourceLabel}</span>
                                    {meta?.beatOrigin && meta.beatOrigin !== 'beat' ? (
                                      <span>· {meta.beatOrigin}</span>
                                    ) : null}
                                    {showDevProviderControls && (
                                    <span>
                                      ·{' '}
                                      {brollProvider === 'runway'
                                        ? 'Runway'
                                        : brollProvider === 'higgsfield'
                                          ? 'Higgsfield'
                                          : 'Kling'}
                                    </span>
                                    )}
                                  </div>
                                  <BrollPromptBody
                                    index={i}
                                    body={body}
                                    isEditing={editingPromptIndex === i}
                                    initialText={b.prompt_text}
                                    initialStart={b.segment_start}
                                    initialEnd={b.segment_end}
                                    onStartEdit={() => setEditingPromptIndex(i)}
                                    onCancel={() => setEditingPromptIndex(null)}
                                    onSave={(patch) => {
                                      updatePromptAt(i, patch)
                                      setEditingPromptIndex(null)
                                    }}
                                  />
                                  
                                  {slot ? (() => {
                                    const placement = (slot.metadata as { placement?: string } | undefined)?.placement
                                    const placementLabel =
                                      placement === 'pickup-queue'
                                        ? ' · pickup (drag to place)'
                                        : placement === 'nearest-source'
                                          ? ' · nearest A-roll moment'
                                          : placement === 'overlap'
                                            ? ' · over A-roll'
                                            : ''
                                    const generatedAsset =
                                      slot.status === 'ready' && slot.generatedAssetId
                                        ? assets.find((a) => a.id === slot.generatedAssetId)
                                        : undefined
                                    const generatedPath = generatedAsset?.local_path?.trim() || null
                                    const generatedDur = generatedAsset?.duration_seconds ?? slot.suggestedDurationSeconds ?? 5
                                    return (
                                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div style={{ fontSize: 13, color: '#6ee7c5', background: 'rgba(110,231,197,0.08)', padding: '8px 12px', borderRadius: 8 }}>
                                          {formatSlotWindowLabel(slot)} · {slot.status}{placementLabel}
                                          {slot.status === 'ready' && generatedAsset
                                            ? ' · ▶ generated clip ready'
                                            : slot.generatedAssetId
                                              ? ` · clip registered (${slot.generatedAssetId.slice(0, 8)}…)`
                                              : ''}
                                          {slot.status === 'failed' && slot.errorMessage ? (
                                            <div style={{ marginTop: 6, color: '#fca5a5' }}>
                                              {normalizeGatewayErrorForDisplay(slot.errorMessage)}
                                            </div>
                                          ) : null}
                                        </div>
                                        {slot.status === 'generating' && (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: '#a1a1aa',
                                              padding: '8px 12px',
                                              borderRadius: 8,
                                              border: '1px dashed rgba(255,255,255,0.12)'
                                            }}
                                          >
                                            Storyteller AI is generating this shot — usually 30–90s. The preview will appear here when it lands.
                                          </div>
                                        )}
                                        {generatedAsset && generatedPath && (
                                          <InlineClipPlayer
                                            sourcePath={generatedPath}
                                            startTime={0}
                                            endTime={generatedDur}
                                            aspectRatio={editFormat === 'vertical' ? '9 / 16' : '16 / 9'}
                                            maxHeight={editFormat === 'vertical' ? 360 : 200}
                                            objectFit={editFormat === 'vertical' ? 'cover' : 'contain'}
                                            autoPlay={false}
                                          />
                                        )}
                                        {generatedAsset && !generatedPath && (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: '#fbbf24',
                                              background: 'rgba(251,191,36,0.08)',
                                              border: '1px solid rgba(251,191,36,0.25)',
                                              padding: '8px 12px',
                                              borderRadius: 8
                                            }}
                                          >
                                            Clip is registered to this slot, but the local file path is missing. Re-run generation or check{' '}
                                            <code style={{ background: 'rgba(0,0,0,0.35)', padding: '1px 4px', borderRadius: 3 }}>
                                              {generatedAsset.id.slice(0, 8)}
                                            </code>{' '}
                                            in your downloads.
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })() : brollPromptSource === 'beats' ? null : (
                                    <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 12 }}>
                                      Map prompts to timeline slots to place this idea on the edit timeline.
                                    </div>
                                  )}
                                  
                                  {!mediaGatewayEnabled && brollProvider === 'runway' && (() => {
                                    const bridgeMissing = !hasMediaGenerationBridge({
                                      hostedGateway: mediaGatewayEnabled,
                                      localProvider: 'runway'
                                    })
                                    const noSlot = !slot
                                    const activeJobSlotId = mediaGatewayEnabled ? mediaGenSlotId : runwaySlotId
                                    const otherJobBusy =
                                      activeJobSlotId !== null && activeJobSlotId !== slot?.id
                                    const isThisJob = slot != null && activeJobSlotId === slot.id
                                    /**
                                     * If the persisted slot says `generating` but no live job is
                                     * tracked in this renderer session, it's a leftover from a
                                     * prior session that crashed mid-flight.
                                     */
                                    const stuckGenerating =
                                      slot?.status === 'generating' && activeJobSlotId !== slot.id
                                    const canReset =
                                      slot != null &&
                                      !isThisJob &&
                                      (slot.status === 'generating' ||
                                        slot.status === 'failed' ||
                                        slot.status === 'ready')
                                    /**
                                     * `noSlot` no longer disables the button. The per-card
                                     * handler maps just this prompt onto the timeline before
                                     * starting Runway, so users can render B-roll one prompt
                                     * at a time without the batch "Map all to timeline" step.
                                     */
                                    const buttonDisabled =
                                      bridgeMissing || otherJobBusy || isThisJob || stuckGenerating
                                    const disabledReason = bridgeMissing
                                      ? 'AI media bridge not available — open Storyteller in the desktop app.'
                                      : otherJobBusy
                                        ? 'Another generation is in flight — wait for it to finish.'
                                        : stuckGenerating
                                          ? 'This slot is stuck in a generating state from a previous session. Hit Reset to clear it.'
                                          : ''
                                    const genLabel = storytellerAiGenerationLabel({
                                      hostedGateway: mediaGatewayEnabled,
                                      showDevProviderControls,
                                      localProvider: 'runway'
                                    })
                                    return (
                                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
                                        <button
                                          type="button"
                                          style={{
                                            ...primaryBtn,
                                            opacity: buttonDisabled ? 0.45 : 1,
                                            cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                                            filter: buttonDisabled ? 'grayscale(0.6)' : 'none'
                                          }}
                                          disabled={buttonDisabled}
                                          title={
                                            disabledReason ||
                                            (noSlot
                                              ? `Place this prompt on the timeline and generate with ${genLabel}.`
                                              : `Generate with ${genLabel} and attach the result to the slot.`)
                                          }
                                          onClick={() => void onGenerateRunwayForPrompt(i, runwayPrompt)}
                                        >
                                          {isThisJob
                                            ? `Generating with ${genLabel}…`
                                            : slot?.status === 'ready'
                                              ? `Re-generate with ${genLabel}`
                                              : noSlot
                                                ? `Generate this with ${genLabel}`
                                                : `Generate with ${genLabel}`}
                                        </button>
                                        {canReset && (
                                          <button
                                            type="button"
                                            style={ghost}
                                            title={
                                              slot.status === 'generating'
                                                ? 'Clear the stuck "generating" state so this slot can be re-generated.'
                                                : slot.status === 'failed'
                                                  ? 'Clear the failure and reset the slot so you can try again.'
                                                  : 'Discard the generated clip from this slot.'
                                            }
                                            onClick={() => void onResetSlot(slot.id)}
                                          >
                                            Reset slot
                                          </button>
                                        )}
                                        <button type="button" style={ghost} onClick={() => void navigator.clipboard.writeText(body)}>
                                          Copy prompt
                                        </button>
                                        {disabledReason && (
                                          <span style={{ fontSize: 12, color: '#a1a1aa' }}>{disabledReason}</span>
                                        )}
                                      </div>
                                    )
                                  })()}

                                  {( !mediaGatewayEnabled && brollProvider === 'higgsfield') && (() => {
                                    const bridgeMissing = !hasMediaGenerationBridge({
                                      hostedGateway: mediaGatewayEnabled,
                                      localProvider: 'higgsfield'
                                    })
                                    const noSlot = !slot
                                    const noCreds = !mediaGatewayEnabled && !higgsfieldConfigured
                                    const ref = slot ? higgsfieldRefImages[slot.id] : undefined
                                    const activeJobSlotId = mediaGatewayEnabled ? mediaGenSlotId : higgsfieldSlotId
                                    const otherJobBusy =
                                      activeJobSlotId !== null && activeJobSlotId !== slot?.id
                                    const isThisJob = slot != null && activeJobSlotId === slot.id
                                    const stuckGenerating =
                                      slot?.status === 'generating' && activeJobSlotId !== slot.id
                                    const canReset =
                                      slot != null &&
                                      !isThisJob &&
                                      (slot.status === 'generating' ||
                                        slot.status === 'failed' ||
                                        slot.status === 'ready')
                                    /**
                                     * Reference image is no longer required — when missing, we fall
                                     * through to text-to-video mode. The user is responsible for
                                     * picking a Higgsfield model id that matches their intent
                                     * (T2V vs I2V SKU). We keep the button enabled in both cases.
                                     *
                                     * `noSlot` no longer disables the button. The per-card
                                     * handler maps just this prompt to the timeline before
                                     * firing Higgsfield, so single-prompt generation works
                                     * without first running the batch "Map all to timeline".
                                     */
                                    const buttonDisabled =
                                      bridgeMissing ||
                                      noCreds ||
                                      otherJobBusy ||
                                      isThisJob ||
                                      stuckGenerating ||
                                      (mediaGatewayEnabled && aiOutOfCredits)
                                    const disabledReason = bridgeMissing
                                      ? 'AI media bridge not available — open Storyteller in the desktop app.'
                                      : mediaGatewayEnabled && aiOutOfCredits
                                        ? 'You’re out of Storyteller AI credits. Upgrade your plan to generate more video.'
                                        : noCreds
                                        ? 'Sign in for hosted generation, or save BYOK credentials (internal dev only).'
                                        : otherJobBusy
                                          ? 'Another generation is in flight — wait for it to finish.'
                                          : stuckGenerating
                                            ? 'This slot is stuck in a generating state from a previous session. Hit Reset to clear it.'
                                            : ''
                                    const genLabel = storytellerAiGenerationLabel({
                                      hostedGateway: mediaGatewayEnabled,
                                      showDevProviderControls,
                                      localProvider: 'higgsfield'
                                    })
                                    const modeLabel = ref ? 'image-to-video' : 'text-to-video'
                                    return (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
                                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                          {ref?.thumbnailUrl ? (
                                            <img
                                              src={ref.thumbnailUrl}
                                              alt="reference"
                                              style={{
                                                width: 64,
                                                height: 64,
                                                objectFit: 'cover',
                                                borderRadius: 8,
                                                border: '1px solid rgba(167,139,250,0.4)'
                                              }}
                                            />
                                          ) : (
                                            <div
                                              style={{
                                                width: 64,
                                                height: 64,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: 8,
                                                border: '1px dashed rgba(255,255,255,0.15)',
                                                color: '#71717a',
                                                fontSize: 10,
                                                textAlign: 'center',
                                                padding: 4,
                                                lineHeight: 1.25
                                              }}
                                              title="No reference image — generation runs as text-to-video. Attach an image for image-to-video."
                                            >
                                              <span>{modeLabel}</span>
                                              <span style={{ fontSize: 9, color: '#52525b' }}>(no image)</span>
                                            </div>
                                          )}
                                          <label
                                            style={{
                                              ...ghost,
                                              cursor: slot ? 'pointer' : 'not-allowed',
                                              opacity: slot ? 1 : 0.5,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 6
                                            }}
                                            title={
                                              slot
                                                ? 'Optional. JPG/PNG up to ~8MB. Attaching one switches to image-to-video.'
                                                : 'Map a slot first.'
                                            }
                                          >
                                            {ref ? 'Replace reference image' : 'Attach reference image (optional)'}
                                            <input
                                              type="file"
                                              accept="image/jpeg,image/png,image/webp"
                                              style={{ display: 'none' }}
                                              disabled={!slot}
                                              onChange={(e) => {
                                                const f = e.target.files?.[0]
                                                if (slot && f) void onAttachReferenceImageForSlot(slot.id, f)
                                                /* clear so the same file can be re-picked after a clear */
                                                e.target.value = ''
                                              }}
                                            />
                                          </label>
                                        </div>
                                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                          <button
                                            type="button"
                                            style={{
                                              ...primaryBtn,
                                              background: '#a78bfa',
                                              color: '#1f0f3d',
                                              opacity: buttonDisabled ? 0.45 : 1,
                                              cursor: buttonDisabled ? 'not-allowed' : 'pointer',
                                              filter: buttonDisabled ? 'grayscale(0.6)' : 'none'
                                            }}
                                            disabled={buttonDisabled}
                                            title={
                                              disabledReason ||
                                              (noSlot
                                                ? `Place this prompt on the timeline and generate with ${genLabel}.`
                                                : ref
                                                  ? `Generate with ${genLabel} using your reference image.`
                                                  : `Generate with ${genLabel} from text only.`)
                                            }
                                            onClick={() => void onGenerateHiggsfieldForPrompt(i, runwayPrompt)}
                                          >
                                            {isThisJob
                                              ? `Generating with ${genLabel}…`
                                              : slot?.status === 'ready'
                                                ? ref
                                                  ? `Re-generate with ${genLabel} (image-to-video)`
                                                  : `Re-generate with ${genLabel} (text-to-video)`
                                                : noSlot
                                                  ? ref
                                                    ? `Generate with ${genLabel} (image-to-video)`
                                                    : `Generate with ${genLabel} (text-to-video)`
                                                  : ref
                                                    ? `Generate with ${genLabel} (image-to-video)`
                                                    : `Generate with ${genLabel} (text-to-video)`}
                                          </button>
                                          {canReset && (
                                            <button
                                              type="button"
                                              style={ghost}
                                              title={
                                                slot.status === 'generating'
                                                  ? 'Clear the stuck "generating" state so this slot can be re-generated.'
                                                  : slot.status === 'failed'
                                                    ? 'Clear the failure and reset the slot so you can try again.'
                                                    : 'Discard the generated clip from this slot.'
                                              }
                                              onClick={() => void onResetSlot(slot.id)}
                                            >
                                              Reset slot
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            style={ghost}
                                            onClick={() => void navigator.clipboard.writeText(body)}
                                          >
                                            Copy prompt
                                          </button>
                                          {disabledReason && (
                                            <span style={{ fontSize: 12, color: '#a1a1aa' }}>{disabledReason}</span>
                                          )}
                                        </div>
                                        {(mediaGatewayEnabled ? aiMediaLineStatus : higgsfieldLineStatus) && isThisJob && (
                                          <div style={{ fontSize: 12, color: '#c4b5fd' }}>
                                            {mediaGatewayEnabled ? aiMediaLineStatus : higgsfieldLineStatus}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}

                                  {!mediaGatewayEnabled && brollProvider === 'kling' && (() => {
                                    const bridgeMissing = !hasMediaGenerationBridge({
                                      hostedGateway: mediaGatewayEnabled,
                                      localProvider: 'kling'
                                    })
                                    const noSlot = !slot
                                    const activeJobSlotId = mediaGatewayEnabled ? mediaGenSlotId : klingSlotId
                                    const otherJobBusy =
                                      activeJobSlotId !== null && activeJobSlotId !== slot?.id
                                    const isThisJob = slot != null && activeJobSlotId === slot.id
                                    const disabled = bridgeMissing || (!noSlot && otherJobBusy && !isThisJob)
                                    const klingPrompt = meta?.providerPrompts?.kling ?? b.prompt_text
                                    const canReset = slot && (slot.status === 'generating' || slot.status === 'ready' || slot.status === 'failed')
                                    const disabledReason = bridgeMissing
                                      ? 'AI media bridge not available — open Storyteller in the desktop app.'
                                      : otherJobBusy
                                        ? 'Another generation is in flight — wait for it to finish.'
                                        : null
                                    const genLabel = storytellerAiGenerationLabel({
                                      hostedGateway: mediaGatewayEnabled,
                                      showDevProviderControls,
                                      localProvider: 'kling'
                                    })

                                    return (
                                      <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <button
                                          type="button"
                                          style={{
                                            ...primaryBtn,
                                            opacity: disabled ? 0.6 : 1,
                                            cursor: disabled ? 'not-allowed' : 'pointer'
                                          }}
                                          disabled={disabled}
                                          title={
                                            disabledReason ||
                                            (noSlot
                                              ? `Place this prompt on the timeline and generate with ${genLabel}.`
                                              : `Generate with ${genLabel} and attach the result to the slot.`)
                                          }
                                          onClick={() => void onGenerateKlingForPrompt(i, klingPrompt)}
                                        >
                                          {isThisJob
                                            ? `Generating with ${genLabel}…`
                                            : slot?.status === 'ready'
                                              ? `Re-generate with ${genLabel}`
                                              : noSlot
                                                ? `Generate this with ${genLabel}`
                                                : `Generate with ${genLabel}`}
                                        </button>
                                        {canReset && (
                                          <button
                                            type="button"
                                            style={ghost}
                                            title={
                                              slot.status === 'generating'
                                                ? 'Clear the stuck "generating" state so this slot can be re-generated.'
                                                : slot.status === 'failed'
                                                  ? 'Clear the failure and reset the slot so you can try again.'
                                                  : 'Discard the generated clip from this slot.'
                                            }
                                            onClick={() => void onResetSlot(slot.id)}
                                          >
                                            Reset slot
                                          </button>
                                        )}
                                        <button type="button" style={ghost} onClick={() => void navigator.clipboard.writeText(klingPrompt)}>
                                          Copy prompt
                                        </button>
                                        {disabledReason && (
                                          <span style={{ fontSize: 12, color: '#a1a1aa' }}>{disabledReason}</span>
                                        )}
                                      </div>
                                    )
                                  })()}
                                  
                                  {meta?.transcriptExcerpt ? (
                                    <div
                                      style={{
                                        marginTop: 16,
                                        fontSize: 13,
                                        color: '#a1a1aa',
                                        borderTop: '1px solid rgba(255,255,255,0.06)',
                                        paddingTop: 12,
                                        lineHeight: 1.5
                                      }}
                                    >
                                      From transcript: {meta.transcriptExcerpt.slice(0, 220)}
                                      {meta.transcriptExcerpt.length > 220 ? '…' : ''}
                                    </div>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    <div id="enhance-graphics">
                      <h3 style={{ fontSize: 20, fontWeight: 600, color: '#f4f4f5', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#c4b5fd' }}>🖼️</span> Top Layer Graphics
                      </h3>

                      {/* ── Beat-anchored Top Layer prompts (deterministic, no credits) ── */}
                      <div
                        style={{
                          ...card,
                          marginBottom: 16,
                          padding: 16,
                          background: 'rgba(196,181,253,0.03)',
                          border: '1px solid rgba(196,181,253,0.12)'
                        }}
                      >
                        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c4b5fd', marginBottom: 10 }}>
                          Beat prompts
                        </div>
                        <p style={{ marginTop: 0, color: '#a1a1aa', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                          One Top Layer graphic per timeline beat — empire map, stat infographic, or typography.
                          Generated locally, no credits required. Each card can then Generate still or Animate.
                        </p>
                        {/* ── Style preset segmented control ── */}
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717a', marginBottom: 6 }}>
                            Style preset
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              background: 'rgba(0,0,0,0.25)',
                              borderRadius: 14,
                              padding: 3,
                              gap: 2
                            }}
                          >
                            {(
                              [
                                { id: 'premium', label: 'Premium' },
                                { id: 'dynamic', label: 'Dynamic' },
                                { id: 'modern', label: 'Modern' },
                                { id: 'traditional', label: 'Traditional' },
                                { id: 'cinematic', label: 'Cinematic' },
                                { id: 'social', label: 'Social' },
                                { id: 'street', label: 'Street' },
                                { id: 'luxury', label: 'Luxury' },
                                { id: 'tech', label: 'Tech' },
                                { id: 'noir', label: 'Noir' },
                                { id: 'pop', label: 'Pop' }
                              ] as const
                            ).map((opt) => {
                              const active = topLayerStylePreset === opt.id
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  role="tab"
                                  aria-selected={active}
                                  onClick={() => setTopLayerStylePreset(opt.id)}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: 12,
                                    fontWeight: 500,
                                    borderRadius: 999,
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: active ? '#0b1014' : '#a1a1aa',
                                    background: active ? '#c4b5fd' : 'transparent',
                                    transition: 'background 120ms ease, color 120ms ease'
                                  }}
                                >
                                  {opt.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
                          <button
                            type="button"
                            style={{
                              ...primaryBtn,
                              background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`,
                              color: '#ffffff',
                              boxShadow: `0 0 10px ${intentColors.glow}`,
                              opacity: topLayerBeatBusy ? 0.75 : 1
                            }}
                            disabled={topLayerBeatBusy || beatsFromTimeline.length === 0}
                            title={
                              beatsFromTimeline.length === 0
                                ? 'Pick a few soundbites or build an intro to enable this.'
                                : 'Write one Top Layer treatment per beat, locally — no API call.'
                            }
                            onClick={() => onGenerateTopLayerFromBeats()}
                          >
                            {topLayerBeatBusy
                              ? 'Writing…'
                              : beatTopLayerPrompts && beatTopLayerPrompts.length > 0
                                ? 'Refresh Top Layer prompts'
                                : `Write ${beatsFromTimeline.length || ''} Top Layer prompt${beatsFromTimeline.length === 1 ? '' : 's'}`.trim()}
                          </button>
                          <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                            <strong style={{ color: '#f4f4f5' }}>{beatsFromTimeline.length}</strong> beat{beatsFromTimeline.length === 1 ? '' : 's'} · written locally
                          </span>
                          {beatTopLayerPrompts && beatTopLayerPrompts.length > 0 && (
                            <button
                              type="button"
                              style={ghost}
                              onClick={() => setBeatTopLayerPrompts(null)}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {topLayerBeatError && (
                          <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{topLayerBeatError}</div>
                        )}
                        {beatTopLayerPrompts && beatTopLayerPrompts.length > 0 && (
                          <div style={{ display: 'grid', gap: 12 }}>
                            {beatTopLayerPrompts.map((tlp) => {
                              const beat = beatsFromTimeline.find((b) => b.id === tlp.beatId)
                              if (!beat) return null
                              const synthSoundbite = resolveSoundbiteForBeat(beat)
                              const modeOverride = beatModeOverrides[tlp.beatId]
                              const effectiveMode = modeOverride ?? tlp.mode
                              const effectivePrompts = modeOverride
                                ? getPromptsForMode(tlp, modeOverride)
                                : { stillPrompt: tlp.stillPrompt, motionPrompt: tlp.motionPrompt }
                              const effectiveTreatmentLabel = effectiveMode === '3d-text' ? '3D Text'
                                : effectiveMode === 'empire' ? 'Empire map'
                                : effectiveMode === 'stat' ? 'Stat infographic'
                                : 'Typography'
                              const stillBusy = graphicsActionBusyKey === `still:${synthSoundbite.id}`
                              const motionBusy = graphicsActionBusyKey === `motion:${synthSoundbite.id}`
                              const stillSlot = stillSlotForSoundbite(synthSoundbite.id)
                              const motionSlot = motionSlotForSoundbite(synthSoundbite.id)
                              return (
                                <div
                                  key={tlp.beatId}
                                  style={{
                                    padding: 12,
                                    borderRadius: 10,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)'
                                  }}
                                >
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        color: '#c4b5fd',
                                        background: 'rgba(196,181,253,0.12)',
                                        border: '1px solid rgba(196,181,253,0.25)',
                                        borderRadius: 999,
                                        padding: '3px 10px',
                                        fontWeight: 600
                                      }}
                                    >
                                      {effectiveTreatmentLabel}
                                    </span>
                                    <span style={{ fontSize: 11, color: '#71717a' }}>
                                      {synthSoundbite.start_time.toFixed(1)}s–{synthSoundbite.end_time.toFixed(1)}s · beat
                                    </span>
                                    {effectiveMode !== '3d-text' && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, fontSize: 10, padding: '2px 8px', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)' }}
                                        title="Switch this beat's treatment to 3D Text (opt-in)"
                                        onClick={() => setBeatModeOverrides((prev) => ({ ...prev, [tlp.beatId]: '3d-text' }))}
                                      >
                                        Switch to 3D Text
                                      </button>
                                    )}
                                    {modeOverride && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, fontSize: 10, padding: '2px 8px' }}
                                        title="Reset to auto-detected treatment"
                                        onClick={() => setBeatModeOverrides((prev) => { const next = { ...prev }; delete next[tlp.beatId]; return next })}
                                      >
                                        Reset mode
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 13, color: '#f4f4f5', lineHeight: 1.45, marginBottom: 10 }}>
                                    "{tlp.transcript.length > 120 ? `${tlp.transcript.slice(0, 120)}…` : tlp.transcript}"
                                  </div>
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a1a1aa', marginBottom: 4 }}>
                                      Still prompt
                                    </div>
                                    <p style={{ margin: 0, fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>{effectivePrompts.stillPrompt}</p>
                                  </div>
                                  <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a1a1aa', marginBottom: 4 }}>
                                      Motion prompt
                                    </div>
                                    <p style={{ margin: 0, fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>{effectivePrompts.motionPrompt}</p>
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                                    <button
                                      type="button"
                                      style={primaryBtn}
                                      disabled={stillBusy}
                                      onClick={() => {
                                        setBeatCardStatus((prev) => ({ ...prev, [tlp.beatId]: 'Generating still…' }))
                                        void onGenerateGraphicsImagePrompt({
                                          soundbite: synthSoundbite as (typeof soundbites)[number],
                                          kind: effectiveMode === '3d-text' ? 'text-image' : tlp.primaryKind,
                                          promptText: effectivePrompts.stillPrompt,
                                          topLayerMode: effectiveMode,
                                          imageStyle: imageStyleMode
                                        })
                                      }}
                                    >
                                      {stillBusy ? 'Generating still…' : stillSlot ? 'Regenerate still' : 'Generate still'}
                                    </button>
                                    <button
                                      type="button"
                                      style={primaryBtn}
                                      disabled={motionBusy}
                                      title="Uses generated still, project reference, or text-to-video"
                                      onClick={() => {
                                        setBeatCardStatus((prev) => ({ ...prev, [tlp.beatId]: 'Animating…' }))
                                        void onGenerateMotionFromImagePrompt({
                                          soundbite: synthSoundbite as (typeof soundbites)[number],
                                          promptText: effectivePrompts.motionPrompt
                                        })
                                      }}
                                    >
                                      {motionBusy ? 'Animating…' : motionSlot ? 'Regenerate motion' : 'Animate'}
                                    </button>
                                    <button
                                      type="button"
                                      style={{
                                        ...ghost,
                                        color: '#a78bfa',
                                        border: '1px solid rgba(167,139,250,0.35)'
                                      }}
                                      title="Add a CSS-animated kinetic text overlay — no credits required"
                                      onClick={() => void onAddKineticTypeForBeat(tlp)}
                                    >
                                      Kinetic Type
                                    </button>
                                    <button
                                      type="button"
                                      style={ghost}
                                      onClick={() => void navigator.clipboard.writeText(tlp.stillPrompt)}
                                    >
                                      Copy still
                                    </button>
                                    <button
                                      type="button"
                                      style={ghost}
                                      onClick={() => void navigator.clipboard.writeText(tlp.motionPrompt)}
                                    >
                                      Copy motion
                                    </button>
                                    {stillSlot && (
                                      <button type="button" style={ghost} onClick={() => void onResetGraphicsSlot(stillSlot.id)}>
                                        Reset still
                                      </button>
                                    )}
                                    {stillSlot && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                                        title="Remove this slot from the timeline entirely"
                                        onClick={() => void deleteGraphicsSlot(stillSlot.id)}
                                      >
                                        Delete slot
                                      </button>
                                    )}
                                    {motionSlot && (
                                      <button type="button" style={ghost} onClick={() => void onResetGraphicsSlot(motionSlot.id)}>
                                        Reset motion
                                      </button>
                                    )}
                                    {motionSlot && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                                        title="Remove this motion slot from the timeline entirely"
                                        onClick={() => void deleteGraphicsSlot(motionSlot.id)}
                                      >
                                        Delete motion slot
                                      </button>
                                    )}
                                  </div>
                                  {beatCardStatus[tlp.beatId] && (
                                    <div style={{ fontSize: 12, color: '#6ee7c5', marginTop: 8, fontWeight: 500 }}>
                                      {beatCardStatus[tlp.beatId]}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* ── AI ideas from grounded review ── */}
                      {enhanceTopLayerRows.length > 0 ? (
                        <div
                          style={{
                            ...card,
                            marginBottom: 16,
                            padding: 16,
                            background: 'rgba(196,181,253,0.03)',
                            border: '1px solid rgba(196,181,253,0.12)'
                          }}
                        >
                          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c4b5fd', marginBottom: 10 }}>
                            {mediaGatewayEnabled && enhanceTimelineProduction.length > 0
                              ? 'On your timeline'
                              : 'Grounded AI ideas from review'}
                          </div>
                          <p style={{ marginTop: 0, color: '#a1a1aa', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                            One editorial graphic per soundbite — empire map, stat infographic, or typography.
                            Generate the still, then Animate from that frame. Slots map onto the top graphics layer automatically.
                          </p>
                          {mediaGatewayEnabled && (
                            <div
                              style={{
                                fontSize: 13,
                                color: '#ddd6fe',
                                marginBottom: 16,
                                padding: '10px 14px',
                                borderRadius: 8,
                                border: '1px solid rgba(196,181,253,0.25)',
                                background: 'rgba(196,181,253,0.06)'
                              }}
                            >
                              Animate runs through Storyteller AI. Attach a reference image per soundbite for
                              image-to-video; leave it empty to use the generated still, or fall back to text-to-video.
                            </div>
                          )}
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 12,
                              alignItems: 'center',
                              marginBottom: 16,
                              padding: 12,
                              background: 'rgba(255,255,255,0.02)',
                              borderRadius: 12
                            }}
                          >
                            <button
                              type="button"
                              style={{ ...primaryBtn, background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`, color: '#ffffff', boxShadow: `0 0 10px ${intentColors.glow}`, opacity: graphicsMapBusy ? 0.75 : 1 }}
                              disabled={graphicsMapBusy || enhanceTopLayerRows.length === 0}
                              onClick={() => void onMapGraphicsSlotsToTimeline()}
                            >
                              {graphicsMapBusy ? 'Mapping…' : 'Map all Top Layer slots'}
                            </button>
                            <span style={{ fontSize: 13, color: '#a1a1aa' }}>
                              Slots on timeline: <strong style={{ color: '#f4f4f5' }}>{graphicsSlots.length}</strong> · Ready:{' '}
                              <strong style={{ color: '#6ee7c5' }}>{graphicsSlots.filter((s) => s.status === 'ready').length}</strong>
                            </span>
                          </div>
                          {graphicsStatus && <div style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 8 }}>{graphicsStatus}</div>}
                          {graphicsError && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{graphicsError}</div>}
                          <div style={{ display: 'grid', gap: 12 }}>
                            {enhanceTopLayerRows.map(({ soundbite, timelineLabel, recommendation, reviewAi }) => {
                              const fullSoundbite = soundbites.find((s) => s.id === soundbite.id) ?? soundbite
                              const stillSlot = stillSlotForSoundbite(soundbite.id)
                              const motionSlot = motionSlotForSoundbite(soundbite.id)
                              const previewSlot = motionSlot?.status === 'ready' && motionSlot.generatedAssetId ? motionSlot : stillSlot
                              const previewAsset =
                                previewSlot?.status === 'ready' && previewSlot.generatedAssetId
                                  ? assets.find((a) => a.id === previewSlot.generatedAssetId)
                                  : undefined
                              const previewPath = previewAsset?.local_path?.trim() || null
                              const previewKind = inferAssetMediaKindFromPath(previewPath)
                              const previewDur = previewAsset?.duration_seconds ?? previewSlot?.suggestedDurationSeconds ?? 4
                              const slotForLabel = stillSlot ?? motionSlot
                              const placement = (slotForLabel?.metadata as { placement?: string } | undefined)?.placement
                              const placementLabel =
                                placement === 'pickup-queue'
                                  ? ' · pickup (drag to place)'
                                  : placement === 'overlap'
                                    ? ' · over A-roll'
                                    : ''
                              const stillBusy = graphicsActionBusyKey === `still:${soundbite.id}`
                              const motionBusy = graphicsActionBusyKey === `motion:${soundbite.id}`
                              const hasStillReady = stillSlot?.status === 'ready' && Boolean(stillSlot.generatedAssetId)
                              const effectivePrompts = getEffectiveTopLayerPrompts(soundbite.id, recommendation)
                              const isEditingPrompts = editingTopLayerRowId === soundbite.id
                              const rowRefUpload = topLayerRowRefUploads[soundbite.id]
                              const rowRefAssetId = topLayerRowRefAssetIds[soundbite.id]
                              const motionRefSource = rowRefUpload
                                ? `Attached: ${rowRefUpload.label}`
                                : rowRefAssetId
                                  ? assets.find((a) => a.id === rowRefAssetId)?.original_filename ??
                                    assets.find((a) => a.id === rowRefAssetId)?.local_path?.split('/').pop() ??
                                    'Project image'
                                  : hasStillReady
                                    ? 'Generated still (auto)'
                                    : selectedGraphicsRefAssetId || graphicsReferenceImage
                                      ? 'Section default reference'
                                      : 'None — text-to-video'

                              return (
                                <div
                                  key={`top-layer-${soundbite.id}`}
                                  style={{
                                    padding: 12,
                                    borderRadius: 10,
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)'
                                  }}
                                >
                                  {timelineLabel && (
                                    <div style={{ fontSize: 11, color: '#71717a', marginBottom: 6 }}>{timelineLabel}</div>
                                  )}
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        color: '#c4b5fd',
                                        background: 'rgba(196,181,253,0.12)',
                                        border: '1px solid rgba(196,181,253,0.25)',
                                        borderRadius: 999,
                                        padding: '3px 10px',
                                        fontWeight: 600
                                      }}
                                    >
                                      {recommendation.treatmentLabel}
                                    </span>
                                    {reviewAi.graphIdea && recommendation.mode === 'stat' && (
                                      <span style={{ fontSize: 12, color: '#a1a1aa' }}>
                                        {reviewAi.graphIdea.title}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 13, color: '#f4f4f5', lineHeight: 1.45, marginBottom: 10 }}>
                                    "{soundbite.transcript_text}"
                                  </div>
                                  <div style={{ marginBottom: 8 }}>
                                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a1a1aa', marginBottom: 4 }}>
                                      Still prompt
                                    </div>
                                    {isEditingPrompts ? (
                                      <textarea
                                        value={topLayerEditDraft.stillPrompt}
                                        onChange={(e) => setTopLayerEditDraft((d) => ({ ...d, stillPrompt: e.target.value }))}
                                        rows={3}
                                        style={{
                                          width: '100%',
                                          boxSizing: 'border-box',
                                          padding: 10,
                                          borderRadius: 8,
                                          background: 'rgba(0,0,0,0.35)',
                                          border: '1px solid rgba(196,181,253,0.25)',
                                          color: '#f4f4f5',
                                          fontSize: 13,
                                          lineHeight: 1.45,
                                          resize: 'vertical',
                                          fontFamily: 'inherit'
                                        }}
                                      />
                                    ) : (
                                      <p style={{ margin: 0, fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>
                                        {effectivePrompts.stillPrompt}
                                      </p>
                                    )}
                                  </div>
                                  {(effectivePrompts.motionPrompt || recommendation.motionPrompt || isEditingPrompts) && (
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a1a1aa', marginBottom: 4 }}>
                                        Motion prompt
                                      </div>
                                      {isEditingPrompts ? (
                                        <textarea
                                          value={topLayerEditDraft.motionPrompt}
                                          onChange={(e) => setTopLayerEditDraft((d) => ({ ...d, motionPrompt: e.target.value }))}
                                          rows={3}
                                          style={{
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(0,0,0,0.35)',
                                            border: '1px solid rgba(196,181,253,0.15)',
                                            color: '#f4f4f5',
                                            fontSize: 13,
                                            lineHeight: 1.45,
                                            resize: 'vertical',
                                            fontFamily: 'inherit'
                                          }}
                                        />
                                      ) : (
                                        <p style={{ margin: 0, fontSize: 13, color: '#d4d4d8', lineHeight: 1.5 }}>
                                          {effectivePrompts.motionPrompt ?? '—'}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                                    {isEditingPrompts ? (
                                      <>
                                        <button type="button" style={primaryBtn} onClick={() => saveTopLayerPromptEdits(soundbite.id)}>
                                          Save prompts
                                        </button>
                                        <button type="button" style={ghost} onClick={() => setEditingTopLayerRowId(null)}>
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        style={ghost}
                                        onClick={() => startEditingTopLayerPrompts(soundbite.id, recommendation)}
                                      >
                                        Edit prompts
                                      </button>
                                    )}
                                  </div>
                                  {(effectivePrompts.motionPrompt || recommendation.motionPrompt) && (
                                    <div
                                      style={{
                                        marginBottom: 10,
                                        padding: 10,
                                        borderRadius: 8,
                                        background: 'rgba(196,181,253,0.05)',
                                        border: '1px solid rgba(196,181,253,0.12)'
                                      }}
                                    >
                                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#c4b5fd', marginBottom: 8 }}>
                                        Animate reference image
                                      </div>
                                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#d4d4d8', fontSize: 13 }}>
                                          Project image
                                          <select
                                            value={rowRefAssetId ?? ''}
                                            onChange={(e) => {
                                              const next = e.target.value || null
                                              setTopLayerRowRefAssetIds((prev) => ({ ...prev, [soundbite.id]: next }))
                                              if (next) {
                                                setTopLayerRowRefUploads((prev) => {
                                                  const copy = { ...prev }
                                                  delete copy[soundbite.id]
                                                  return copy
                                                })
                                              }
                                            }}
                                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, minWidth: 180 }}
                                          >
                                            <option value="">None selected</option>
                                            {assets
                                              .filter((asset) => isImageAsset(asset))
                                              .map((asset) => (
                                                <option key={asset.id} value={asset.id}>
                                                  {asset.original_filename ?? asset.local_path?.split('/').pop() ?? asset.id.slice(0, 8)}
                                                </option>
                                              ))}
                                          </select>
                                        </label>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a1a1aa', fontSize: 12 }}>
                                          Upload
                                          <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp"
                                            onChange={(e) => {
                                              const file = e.currentTarget.files?.[0]
                                              e.currentTarget.value = ''
                                              if (file) void onAttachTopLayerRowReferenceImage(soundbite.id, file)
                                            }}
                                          />
                                        </label>
                                      </div>
                                      <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 8 }}>
                                        Using: <span style={{ color: '#e9d5ff' }}>{motionRefSource}</span>
                                      </div>
                                    </div>
                                  )}
                                  {slotForLabel && (
                                    <div style={{ fontSize: 13, color: '#c4b5fd', background: 'rgba(196,181,253,0.08)', padding: '8px 12px', borderRadius: 8, marginBottom: 10 }}>
                                      {formatSlotWindowLabel(slotForLabel)} · {slotForLabel.status}
                                      {placementLabel}
                                      {slotForLabel.status === 'failed' && slotForLabel.errorMessage ? (
                                        <div style={{ marginTop: 6, color: '#fca5a5' }}>
                                          {normalizeGatewayErrorForDisplay(slotForLabel.errorMessage)}
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                  {(stillSlot?.status === 'generating' || motionSlot?.status === 'generating') && (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: '#a1a1aa',
                                        padding: '8px 12px',
                                        borderRadius: 8,
                                        border: '1px dashed rgba(255,255,255,0.12)',
                                        marginBottom: 10
                                      }}
                                    >
                                      Storyteller AI is generating this graphic — the preview will appear here when it lands.
                                    </div>
                                  )}
                                  {previewAsset && previewPath && previewKind === 'video' && (
                                    <InlineClipPlayer
                                      sourcePath={previewPath}
                                      startTime={0}
                                      endTime={previewDur}
                                      aspectRatio={editFormat === 'vertical' ? '9 / 16' : '16 / 9'}
                                      maxHeight={editFormat === 'vertical' ? 360 : 200}
                                      objectFit={editFormat === 'vertical' ? 'cover' : 'contain'}
                                      autoPlay={false}
                                    />
                                  )}
                                  {previewAsset && previewPath && previewKind === 'image' && (
                                    <ExpandableImagePreview
                                      src={window.storyteller?.toMediaUrl?.(previewPath) ?? previewPath}
                                      alt="Generated Top Layer still"
                                      title="Top Layer still preview"
                                      objectFit="contain"
                                      maxHeight={editFormat === 'vertical' ? 360 : 200}
                                      style={{ marginBottom: 10 }}
                                    />
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    <span style={{ fontSize: 12, color: '#a1a1aa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Style</span>
                                    <div style={{ display: 'flex', background: '#141416', borderRadius: 6, padding: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
                                      {(['visual', 'text'] as const).map((mode) => (
                                        <button
                                          key={mode}
                                          type="button"
                                          onClick={() => setImageStyleMode(mode)}
                                          style={{
                                            padding: '4px 12px',
                                            borderRadius: 4,
                                            border: 'none',
                                            background: imageStyleMode === mode ? 'rgba(255,255,255,0.1)' : 'transparent',
                                            color: imageStyleMode === mode ? '#f4f4f5' : '#a1a1aa',
                                            fontSize: 12,
                                            fontWeight: imageStyleMode === mode ? 600 : 400,
                                            cursor: 'pointer',
                                            textTransform: 'capitalize',
                                            transition: 'all 0.15s'
                                          }}
                                        >
                                          {mode === 'visual' ? 'Visual' : 'Text'}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                                    <button
                                      type="button"
                                      style={primaryBtn}
                                      disabled={stillBusy}
                                      onClick={() =>
                                        void onGenerateGraphicsImagePrompt({
                                          soundbite: fullSoundbite as (typeof soundbites)[number],
                                          kind: recommendation.primaryKind,
                                          promptText: effectivePrompts.stillPrompt,
                                          styleTags: recommendation.styleTags,
                                          style: recommendation.style,
                                          topLayerMode: recommendation.mode,
                                          imageStyle: imageStyleMode
                                        })
                                      }
                                    >
                                      {stillBusy ? 'Generating still…' : stillSlot ? 'Regenerate still' : 'Generate still'}
                                    </button>
                                    {(effectivePrompts.motionPrompt || recommendation.motionPrompt) && (
                                      <button
                                        type="button"
                                        style={primaryBtn}
                                        disabled={motionBusy}
                                        title="Uses attached reference, generated still, section default, or text-to-video"
                                        onClick={() =>
                                          void onGenerateMotionFromImagePrompt({
                                            soundbite: fullSoundbite as (typeof soundbites)[number],
                                            promptText: effectivePrompts.motionPrompt ?? '',
                                            styleTags: recommendation.styleTags,
                                            style: recommendation.style
                                          })
                                        }
                                      >
                                        {motionBusy ? 'Animating…' : motionSlot ? 'Regenerate motion' : 'Animate'}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      style={ghost}
                                      onClick={() =>
                                        void onAddGraphicsPromptToTimeline({
                                          soundbite: fullSoundbite as (typeof soundbites)[number],
                                          kind: recommendation.primaryKind,
                                          promptText: effectivePrompts.stillPrompt,
                                          styleTags: recommendation.styleTags,
                                          style: recommendation.style,
                                          topLayerMode: recommendation.mode
                                        })
                                      }
                                    >
                                      Map slot
                                    </button>
                                    <button
                                      type="button"
                                      style={ghost}
                                      onClick={() => void navigator.clipboard.writeText(effectivePrompts.stillPrompt)}
                                    >
                                      Copy still prompt
                                    </button>
                                    {(effectivePrompts.motionPrompt || recommendation.motionPrompt) && (
                                      <button
                                        type="button"
                                        style={ghost}
                                        onClick={() => void navigator.clipboard.writeText(effectivePrompts.motionPrompt ?? '')}
                                      >
                                        Copy motion prompt
                                      </button>
                                    )}
                                    {stillSlot && (
                                      <button type="button" style={ghost} onClick={() => void onResetGraphicsSlot(stillSlot.id)}>
                                        Reset still
                                      </button>
                                    )}
                                    {stillSlot && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                                        title="Remove this slot from the timeline entirely"
                                        onClick={() => void deleteGraphicsSlot(stillSlot.id)}
                                      >
                                        Delete slot
                                      </button>
                                    )}
                                    {motionSlot && (
                                      <button type="button" style={ghost} onClick={() => void onResetGraphicsSlot(motionSlot.id)}>
                                        Reset motion
                                      </button>
                                    )}
                                    {motionSlot && (
                                      <button
                                        type="button"
                                        style={{ ...ghost, color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                                        title="Remove this motion slot from the timeline entirely"
                                        onClick={() => void deleteGraphicsSlot(motionSlot.id)}
                                      >
                                        Delete motion slot
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <div
                            style={{
                              marginTop: 16,
                              padding: 12,
                              borderRadius: 10,
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)'
                            }}
                          >
                            <div style={{ fontSize: 12, color: '#71717a', marginBottom: 8 }}>
                              Section default reference (optional fallback when a row has no attached image or generated still)
                            </div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#d4d4d8', fontSize: 13 }}>
                                Project image
                                <select
                                  value={selectedGraphicsRefAssetId ?? ''}
                                  onChange={(e) => {
                                    setSelectedGraphicsRefAssetId(e.target.value || null)
                                    if (e.target.value) setGraphicsReferenceImage(null)
                                  }}
                                  style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, minWidth: 200 }}
                                >
                                  <option value="">None selected</option>
                                  {assets
                                    .filter((asset) => isImageAsset(asset))
                                    .map((asset) => (
                                      <option key={asset.id} value={asset.id}>
                                        {asset.original_filename ?? asset.local_path?.split('/').pop() ?? asset.id.slice(0, 8)}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a1a1aa', fontSize: 12 }}>
                                Upload
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  onChange={(e) => {
                                    const file = e.currentTarget.files?.[0]
                                    e.currentTarget.value = ''
                                    if (file) void onAttachGraphicsReferenceImage(file)
                                  }}
                                />
                              </label>
                              {graphicsReferenceImage && (
                                <span style={{ fontSize: 12, color: '#c4b5fd' }}>Using: {graphicsReferenceImage.label}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ ...card, padding: 18 }}>
                          <p style={{ margin: 0, color: '#a1a1aa', fontSize: 13, lineHeight: 1.6 }}>
                            No grounded Top Layer prompts yet — run Review analysis first, then return here to generate editorial graphics per soundbite.
                          </p>
                        </div>
                      )}
                    </div>

                    <details id="enhance-custom-overlays" style={{ ...card, padding: 18 }}>
                      <summary style={{ color: '#f4f4f5', cursor: 'pointer', fontSize: 16, fontWeight: 600, userSelect: 'none' }}>
                        Custom overlay at playhead
                      </summary>
                      <p style={{ color: '#71717a', fontSize: 13, marginTop: 12, marginBottom: 24, lineHeight: 1.5 }}>
                        Manual text, hook, and stat/chart overlays — use only when you need a one-off element at the current playhead.
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>
                        <div id="enhance-text">
                          <AddTextOverlayPanel
                            playheadSeconds={previewSequenceSeconds}
                            events={textOverlays}
                            onAdd={handleAddTextOverlay}
                            onUpdate={handleUpdateOverlay}
                            onRemove={handleRemoveOverlay}
                          />
                        </div>

                        <div id="enhance-hook">
                          <AddHookOverlayPanel
                            playheadSeconds={previewSequenceSeconds}
                            events={hookOverlays}
                            onAdd={handleAddHookOverlay}
                            onUpdate={handleUpdateOverlay}
                            onRemove={handleRemoveOverlay}
                          />
                        </div>

                        <div id="enhance-stat">
                          <AddStatOverlayPanel
                            playheadSeconds={previewSequenceSeconds}
                            events={statOverlays}
                            onAdd={handleAddStatOverlay}
                            onUpdate={handleUpdateOverlay}
                            onRemove={handleRemoveOverlay}
                          />
                        </div>
                      </div>
                    </details>

                    <div id="enhance-pause">
                      <AddPausePanel
                        playheadSeconds={previewSequenceSeconds}
                        pauseGaps={pauseGapsList}
                        onAdd={handleInsertPause}
                        onRemove={handleRemovePause}
                      />
                    </div>

                    {/**
                     * Suggested-presets sales pitch — kept as a smaller hint card
                     * below the real authoring panels so the original signal
                     * ("here are the presets that match your direction") isn't
                     * lost while the user adopts the new live-overlay flow.
                     */}
                    <div
                      style={{
                        background: '#141416',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 12,
                        padding: 18,
                        fontSize: 13,
                        color: '#a1a1aa',
                        lineHeight: 1.5
                      }}
                    >
                      Suggested presets from your direction:{' '}
                      <strong style={{ color: '#f4f4f5' }}>{suggestedTextPresets.join(', ')}</strong>
                      {textFxList.length > 0 && (
                        <span style={{ color: '#71717a' }}> · {textFxList.map((p) => p.label).join(' · ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeStep === 'audio' && (
                <div className="step-content">
                  <SoundDesignerPanel
                    projectId={projectId}
                    sequence={sequence}
                    segments={dbSegments}
                    audioDnaId={project?.audioDnaId}
                    onAudioDnaChange={(id) => updateProject(projectId, { audioDnaId: id })}
                    onSequenceChange={(seq) => {
                      setTimeline(projectId, seq)
                    }}
                  />
                </div>
              )}

              {activeStep === 'export' && (
                <div className="step-content">
                  <div style={stepHeader}>
                    <h2 style={stepTitle}>7. Export</h2>
                    <p style={stepDesc}>Render an MP4 or export a handoff package for your NLE.</p>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 32 }}>
                    {EXPORT_PRESETS.map(p => {
                      const isSelected = p.id === 'nle' ? exportMode === 'nle' : exportMode === 'mp4' && p.id === `${editFormat}-${exportQuality}`
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleExportPresetClick(p.id as any)}
                          style={{
                            ...card,
                            padding: 24,
                            textAlign: 'center',
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(110,231,197,0.08)' : '#1c1c1f',
                            border: isSelected ? '1px solid #6ee7c5' : '1px solid rgba(255,255,255,0.08)',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 12
                          }}
                        >
                          <div style={{ fontSize: 24 }}>{p.icon}</div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 15, color: isSelected ? '#6ee7c5' : '#f4f4f5' }}>{p.label}</div>
                            <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 4 }}>{p.desc}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {exportMode === 'mp4' ? (
                    <div style={{ padding: 32, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                      <div style={{ fontSize: 16, marginBottom: 16, color: '#e4e4e7' }}>
                        Ready to export <strong style={{ color: '#f4f4f5' }}>{editFormat === 'vertical' ? 'Vertical' : 'Horizontal'} {exportQuality.toUpperCase()}</strong> MP4.
                      </div>
                      <label
                        style={{
                          display: 'inline-flex',
                          gap: 10,
                          alignItems: 'center',
                          padding: '8px 14px',
                          marginBottom: 18,
                          borderRadius: 999,
                          border: '1px solid rgba(255,255,255,0.10)',
                          background: 'rgba(255,255,255,0.04)',
                          fontSize: 13,
                          color: '#d4d4d8',
                          cursor: dbSegments.length === 0 ? 'not-allowed' : 'pointer',
                          opacity: dbSegments.length === 0 ? 0.55 : 1
                        }}
                        title={
                          dbSegments.length === 0
                            ? 'Run transcription first to enable burned-in captions.'
                            : 'Renders subtitles into the video using libass — no separate sidecar needed.'
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={dbSegments.length === 0}
                          checked={burnCaptions}
                          onChange={(e) => setBurnCaptions(e.target.checked)}
                        />
                        <span>Burn captions into video</span>
                        {dbSegments.length > 0 && (
                          <span style={{ color: '#a1a1aa', fontSize: 12 }}>· {dbSegments.length} segments</span>
                        )}
                      </label>
                      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center' }}>
                        <button type="button" style={{ ...primaryBtn, padding: '14px 32px', fontSize: 16, background: `linear-gradient(135deg, ${intentColors.gradientFrom} 0%, ${intentColors.gradientTo} 100%)`, color: '#ffffff', boxShadow: `0 0 10px ${intentColors.glow}` }} disabled={mp4Busy} onClick={() => void onExportMp4()}>
                          {mp4Busy ? 'Exporting…' : 'Export MP4'}
                        </button>
                        {mp4OutputPath && window.storyteller?.revealInFolder && (
                          <button
                            type="button"
                            style={ghost}
                            onClick={() => void window.storyteller?.revealInFolder?.(mp4OutputPath)}
                          >
                            Show MP4 in folder
                          </button>
                        )}
                      </div>
                      {mp4Status && <div style={{ marginTop: 16, fontSize: 14, color: '#a1a1aa' }}>{mp4Status}</div>}
                      {mp4Error && <div style={{ marginTop: 16, fontSize: 14, color: '#f87171' }}>{mp4Error}</div>}
                    </div>
                  ) : (
                    <div style={{ padding: 32, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 12, textAlign: 'center' }}>
                        Storyteller edits. Your NLE finishes.
                      </div>
                      <div style={{ fontSize: 13, color: '#d4d4d8', marginBottom: 24, textAlign: 'center', lineHeight: 1.55, maxWidth: 640, marginInline: 'auto' }}>
                        Export a rough-cut handoff package: primary edit, source media, timing, and markers.
                        B-roll, titles, and sound-design layers stay in <code style={{ color: '#f4f4f5' }}>manifest.json</code> for manual finishing.
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 32 }}>
                        {(
                          [
                            ['final-cut-pro', 'Final Cut Pro (Rough Cut Beta)'],
                            ['premiere-pro', 'Adobe Premiere Pro'],
                            ['davinci-resolve', 'DaVinci Resolve'],
                            ['otio', 'OTIO (Resolve / adapter workflows only)']
                          ] as const
                        ).map(([id, label]) => (
                          <label
                            key={id}
                            style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, cursor: 'pointer' }}
                          >
                            <input
                              type="radio"
                              name="nle-target"
                              checked={nleTarget === id}
                              onChange={() => setNleTarget(id)}
                              style={{ width: 16, height: 16, accentColor: '#6ee7c5' }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 20, lineHeight: 1.5, background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8 }}>
                        Package name: <code style={{ color: '#f4f4f5' }}>{nleExport.bundleName}</code><br/>
                        On disk: <code style={{ color: '#f4f4f5' }}>{nleExport.primaryTimeline.filename}</code>
                        {nleExport.additionalFiles?.some((f) => f.format === 'xmeml') ? (
                          <>
                            , <code style={{ color: '#f4f4f5' }}>timeline.xml</code> (Premiere XMEML)
                          </>
                        ) : null}
                        , <code style={{ color: '#f4f4f5' }}>manifest.json</code>, <code style={{ color: '#f4f4f5' }}>export-summary.txt</code>, <code style={{ color: '#f4f4f5' }}>README.txt</code><br/>
                        Sequence: {exportDims.width}×{exportDims.height} · Timeline {nleExport.exportSummary.timelineDurationLabel}<br/>
                        Spine clips: <code style={{ color: '#f4f4f5' }}>{exportReadiness.exportableClipCount}</code> exportable of <code style={{ color: '#f4f4f5' }}>{exportReadiness.totalSpineClips}</code>
                        {nleTarget === 'final-cut-pro' ? (
                          <>
                            <br/>
                            <span style={{ color: '#a1a1aa' }}>
                              Final Cut Rough Cut Export (Beta) — primary A-roll only. See export-summary.txt for included vs manifest-only items.
                            </span>
                          </>
                        ) : null}
                        {nleTarget === 'otio' ? (
                          <>
                            <br/>
                            OTIO does not import directly into Final Cut Pro. Use Final Cut Pro export for FCP, or convert OTIO with OpenTimelineIO tools.
                          </>
                        ) : null}
                      </div>
                      {(exportReadiness.cloudOnlyAssetCount > 0 || exportReadiness.missingAssetCount > 0) && (
                        <div
                          style={{
                            marginBottom: 20,
                            padding: 14,
                            borderRadius: 8,
                            background: 'rgba(248, 113, 113, 0.08)',
                            border: '1px solid rgba(248, 113, 113, 0.35)',
                            color: '#fecaca',
                            fontSize: 13,
                            lineHeight: 1.5
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#fda4a4' }}>
                            Some clips will be skipped on export
                          </div>
                          {exportReadiness.cloudOnlyAssetCount > 0 && (
                            <div style={{ marginBottom: exportReadiness.missingAssetCount > 0 ? 8 : 0 }}>
                              {exportReadiness.cloudOnlyAssetCount} cloud-only asset
                              {exportReadiness.cloudOnlyAssetCount === 1 ? '' : 's'} (no local
                              file). Final Cut and Premiere can't relink placeholder paths cleanly,
                              so the clip is dropped from the FCPXML. Download it locally first:
                              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#fecaca' }}>
                                {exportReadiness.cloudOnlyAssetNames.slice(0, 6).map((n) => (
                                  <li key={`cloud-${n}`}>
                                    <code style={{ color: '#fecaca' }}>{n}</code>
                                  </li>
                                ))}
                                {exportReadiness.cloudOnlyAssetNames.length > 6 && (
                                  <li>+{exportReadiness.cloudOnlyAssetNames.length - 6} more</li>
                                )}
                              </ul>
                            </div>
                          )}
                          {exportReadiness.missingAssetCount > 0 && (
                            <div>
                              {exportReadiness.missingAssetCount} asset
                              {exportReadiness.missingAssetCount === 1 ? ' is' : 's are'} not
                              registered with a local path at all. Re-import or relink:
                              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#fecaca' }}>
                                {exportReadiness.missingAssetNames.slice(0, 6).map((n) => (
                                  <li key={`missing-${n}`}>
                                    <code style={{ color: '#fecaca' }}>{n}</code>
                                  </li>
                                ))}
                                {exportReadiness.missingAssetNames.length > 6 && (
                                  <li>+{exportReadiness.missingAssetNames.length - 6} more</li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          style={{ ...primaryBtn, opacity: nleExportBusy ? 0.7 : 1, padding: '12px 24px', fontSize: 15 }}
                          disabled={nleExportBusy}
                          onClick={() => void onExportNlePackage()}
                        >
                          {nleExportBusy ? 'Exporting…' : nleHandoffButtonLabel}
                        </button>
                        {nleExportFolderPath && window.storyteller?.openPath && (
                          <button
                            type="button"
                            style={ghost}
                            onClick={() => void window.storyteller?.openPath?.(nleExportFolderPath)}
                          >
                            Open NLE package folder
                          </button>
                        )}
                        <button
                          type="button"
                          style={ghost}
                          onClick={() => setExportPreview(nleExport.primaryTimeline.content.slice(0, 2800))}
                        >
                          Preview primary timeline XML
                        </button>
                        <button
                          type="button"
                          style={ghost}
                          onClick={() =>
                            setExportPreview(
                              `${nleExport.readme.slice(0, 1200)}

--- manifest (excerpt) ---
${JSON.stringify(nleExport.manifest, null, 2).slice(0, 1600)}`
                            )
                          }
                        >
                          Preview README + manifest
                        </button>
                      </div>
                      
                      {nleExportStatus && <div style={{ marginTop: 16, fontSize: 14, color: '#a1a1aa' }}>{nleExportStatus}</div>}
                      {nleExportError && <div style={{ marginTop: 16, fontSize: 14, color: '#f87171' }}>{nleExportError}</div>}
                      
                      {exportPreview && (
                        <pre style={{ ...pre, marginTop: 24, maxHeight: 400 }}>{exportPreview}…</pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Cold open script shown at bottom of timeline or review steps */}
              {(activeStep === 'review' || activeStep === 'timeline') && (
                <div style={{ marginTop: 32, ...card, padding: 24, background: 'linear-gradient(135deg, #1c1c1f 0%, #141416 100%)' }}>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: '#f4f4f5' }}>Cold open script</div>
                  {introColdOpenLine ? (
                    <>
                      <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 12px' }}>
                        Pulled from your built intro (section markers + beats). Story plan below is still the narrative scaffold.
                      </p>
                      <p style={{ margin: 0, lineHeight: 1.6, fontSize: 15, color: '#e4e4e7', fontStyle: 'italic' }}>"{introColdOpenLine}"</p>
                    </>
                  ) : groundedColdOpenLine ? (
                    <>
                      <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 12px' }}>
                        Pulled from the AI's cold-open pick — the strongest real line to open on. Verbatim from your transcript.
                      </p>
                      <p style={{ margin: 0, lineHeight: 1.6, fontSize: 15, color: '#e4e4e7', fontStyle: 'italic' }}>"{groundedColdOpenLine}"</p>
                    </>
                  ) : (
                    <p style={{ margin: 0, lineHeight: 1.6, fontSize: 14, color: '#a1a1aa' }}>
                      Run Analyze to surface a grounded cold-open line from your transcript.
                    </p>
                  )}
                </div>
              )}
            </div>
          </main>

          <aside style={{ width: 340, borderLeft: '1px solid rgba(255,255,255,0.06)', background: '#1c1c1f', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12, fontWeight: 600 }}>Live Preview</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                disabled={!livePreviewClip || !livePreviewSourcePath}
                onClick={() => setLivePreviewPlaybackState('playing')}
                style={{
                  ...ghost,
                  opacity: livePreviewClip && livePreviewSourcePath ? 1 : 0.5,
                  cursor: livePreviewClip && livePreviewSourcePath ? 'pointer' : 'not-allowed',
                  background: livePreviewPlaybackState === 'playing' ? 'rgba(110,231,197,0.12)' : ghost.background,
                  borderColor: livePreviewPlaybackState === 'playing' ? 'rgba(110,231,197,0.4)' : ghost.border
                }}
              >
                Play
              </button>
              <button
                type="button"
                disabled={!livePreviewClip || !livePreviewSourcePath}
                onClick={() => setLivePreviewPlaybackState('paused')}
                style={{
                  ...ghost,
                  opacity: livePreviewClip && livePreviewSourcePath ? 1 : 0.5,
                  cursor: livePreviewClip && livePreviewSourcePath ? 'pointer' : 'not-allowed',
                  background: livePreviewPlaybackState === 'paused' ? 'rgba(255,255,255,0.08)' : ghost.background
                }}
              >
                Pause
              </button>
              <button
                type="button"
                disabled={!livePreviewClip || !livePreviewSourcePath}
                onClick={() => setLivePreviewPlaybackState('stopped')}
                style={{
                  ...ghost,
                  opacity: livePreviewClip && livePreviewSourcePath ? 1 : 0.5,
                  cursor: livePreviewClip && livePreviewSourcePath ? 'pointer' : 'not-allowed',
                  background: livePreviewPlaybackState === 'stopped' ? 'rgba(255,255,255,0.08)' : ghost.background
                }}
              >
                Stop
              </button>
              <span style={{ fontSize: 12, color: '#71717a', marginLeft: 'auto' }}>
                {timelinePlayheadSeconds.toFixed(2)}s
              </span>
            </div>
            {livePreviewClip && livePreviewSourcePath ? (
              <InlineClipPlayer
                sourcePath={livePreviewSourcePath}
                startTime={livePreviewClip.sourceInSeconds}
                endTime={livePreviewClip.sourceOutSeconds}
                seekTime={livePreviewSeekSourceSeconds}
                seekRequestId={previewSeekRequestId}
                playbackState={livePreviewPlaybackState}
                autoPlay={false}
                loopOnEnd={false}
                onWindowEnd={handleLivePreviewWindowEnd}
                aspectRatio={editFormat === 'vertical' ? '9 / 16' : '16 / 9'}
                maxHeight={editFormat === 'vertical' ? 420 : 220}
                objectFit={editFormat === 'vertical' ? 'cover' : 'contain'}
                framePosition={livePreviewClip.framePosition ?? DEFAULT_FRAME_POSITION}
                onFramePositionChange={
                  editFormat === 'vertical' &&
                  selectedTimelineClipId &&
                  livePreviewClip.id === selectedTimelineClipId
                    ? handleFramePositionChange
                    : undefined
                }
                onTimeUpdate={handleLivePreviewTimeUpdate}
                coverVideo={livePreviewCoverVideo}
                overlay={
                  <OverlayLayer
                    events={activeOverlays}
                    graphics={activeGraphicsOverlays}
                    isPlaying={livePreviewPlaybackState === 'playing'}
                    mediaTime={previewSourceSeconds}
                  />
                }
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  aspectRatio: editFormat === 'vertical' ? '9 / 16' : '16 / 9',
                  maxHeight: editFormat === 'vertical' ? 420 : 220,
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'linear-gradient(180deg, #27272a, #141416)',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#a1a1aa',
                  fontSize: 13,
                  textAlign: 'center',
                  padding: 16,
                  boxSizing: 'border-box',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
                }}
              >
                {editFormat === 'vertical' ? 'Vertical 9:16' : 'Horizontal 16:9'}
                <br />
                {seqDims.w}×{seqDims.h}
                <br />
                <span style={{ color: '#71717a', marginTop: 8, display: 'inline-block' }}>
                  Build a timeline to preview clips here.
                </span>
              </div>
            )}
            
            {selectedSoundbiteId && activeStep === 'review' && (
              <div style={{ marginTop: 16, fontSize: 13, color: '#a1a1aa', background: '#141416', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                Selected soundbite — timestamps shown in Transcript tab.
              </div>
            )}
            
            <div
              style={{
                marginTop: 24,
                fontSize: 13,
                color: '#a1a1aa',
                lineHeight: 1.6,
                background: '#141416',
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#71717a', marginBottom: 6 }}>
                Transcript
              </div>
              <div style={{ color: '#f4f4f5' }}>
                {livePreviewTranscriptText || 'Select a clip or move the timeline playhead to see matching words here.'}
              </div>
            </div>
            
            <div style={{ marginTop: 'auto', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)', background: '#141416' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>NLE rough cut</div>
              <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0, lineHeight: 1.5 }}>
                FCPXML + manifest (Resolve / FCP); Premiere also gets XMEML. Exports use your working format (
                {seqDims.aspect} · {seqDims.w}×{seqDims.h}).
              </p>
            </div>
          </aside>
        </div>
      </div>
      <ClipPreviewModal
        open={previewClip != null}
        sourcePath={previewClip?.sourcePath ?? null}
        sourceUrl={previewClip?.sourceUrl ?? null}
        startTime={previewClip?.startTime ?? 0}
        endTime={previewClip?.endTime ?? 0}
        title={previewClip?.title}
        caption={previewClip?.caption}
        onClose={() => setPreviewClip(null)}
      />
    </div>
  )
}

const stepHeader: React.CSSProperties = { marginBottom: 32 }
const stepTitle: React.CSSProperties = { fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: '#f4f4f5', letterSpacing: '-0.02em' }
const stepDesc: React.CSSProperties = { fontSize: 16, color: '#a1a1aa', margin: 0, lineHeight: 1.5 }

const card: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  padding: 16,
  background: '#1c1c1f'
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 10,
  border: 'none',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: '#ffffff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'opacity 0.2s',
  boxShadow: '0 2px 8px rgba(99,102,241,0.3)'
}

const ghost: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent',
  color: '#f4f4f5',
  fontSize: 14,
  cursor: 'pointer',
  transition: 'background 0.2s'
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 999,
  border: active ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
  background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
  color: active ? '#818cf8' : '#a1a1aa',
  fontSize: 14,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  transition: 'all 0.2s'
})

function formatToggleBtn(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: 'none',
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    color: active ? '#f4f4f5' : '#a1a1aa',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'background 0.2s'
  }
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#141416',
  color: '#f4f4f5',
  fontSize: 14
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#818cf8',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: 13,
  padding: 0
}

const badge: React.CSSProperties = {
  border: '1px solid rgba(99,102,241,0.35)',
  color: '#818cf8',
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 12,
  textTransform: 'capitalize' as const,
  fontWeight: 600
}

const pre: React.CSSProperties = {
  background: '#141416',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: 16,
  fontSize: 12,
  overflow: 'auto',
  color: '#a1a1aa',
  lineHeight: 1.5
}

const actionBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '16px 20px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#1c1c1f',
  color: '#f4f4f5',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  flex: '1 1 140px',
  minWidth: 140
}
