import { spineVideoTrackIndex } from '@storyteller/timeline'
import type { TimelineClip, TimelineSequence } from '@storyteller/timeline'
import type { NleTarget } from '../xml/types.js'
import type { XmlPackageManifest } from '../xml/types.js'
import type { NleExportInput } from './shared-input.js'

export interface ExportSummaryCounts {
  aRollClips: number
  markers: number
  sourceFiles: number
  pauseGaps: number
}

export interface ExportSummaryExcluded {
  bRollClips: number
  titleOverlays: number
  graphicsOverlays: number
  soundEffectPlacements: number
  skippedSpineClips: number
  orphanMarkers: number
}

export interface ExportSummary {
  projectTitle: string
  targetNle: NleTarget
  timelineDurationSeconds: number
  timelineDurationLabel: string
  generatedAt: string
  included: ExportSummaryCounts
  excluded: ExportSummaryExcluded
  /** Human-readable lines for export-summary.txt */
  lines: string[]
}

function isRelinkPlaceholderUri(uri: string): boolean {
  return /^file:\/\/\/StorytellerRelink\//i.test(uri)
}

function isExportablePath(path: string | undefined): boolean {
  if (!path || path === 'MISSING_MEDIA') return false
  if (isRelinkPlaceholderUri(path)) return false
  return true
}

function formatDurationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function countOverlayTitles(sequence: TimelineSequence): number {
  const overlayEvents = sequence.overlayEvents ?? []
  const textTrackTitles = sequence.textTracks.flatMap((t) => t.clips).length
  const overlayTitles = overlayEvents.filter((e) => e.kind === 'text' || e.kind === 'hook').length
  return textTrackTitles + overlayTitles
}

function countGraphicsOverlays(sequence: TimelineSequence): number {
  const overlayStats = (sequence.overlayEvents ?? []).filter((e) => e.kind === 'stat').length
  const graphicsSlots = (sequence.graphicsSlots ?? []).length
  return overlayStats + graphicsSlots
}

function analyzeCoverage(params: {
  sequence: TimelineSequence
  assetPathsById: Record<string, string>
  soundDesign?: NleExportInput['soundDesign']
}): { included: ExportSummaryCounts; excluded: ExportSummaryExcluded } {
  const { sequence, assetPathsById, soundDesign } = params
  const spineIdx = spineVideoTrackIndex(sequence.videoTracks)
  const spineClips = sequence.videoTracks[spineIdx]?.clips ?? []

  let aRollClips = 0
  let pauseGaps = 0
  let skippedSpineClips = 0
  const exportableSpineClips: TimelineClip[] = []

  for (const clip of spineClips) {
    if (clip.role === 'pause-gap') {
      pauseGaps += 1
      exportableSpineClips.push(clip)
      continue
    }
    if (!isExportablePath(assetPathsById[clip.assetId])) {
      skippedSpineClips += 1
      continue
    }
    aRollClips += 1
    exportableSpineClips.push(clip)
  }

  let markers = 0
  let orphanMarkers = 0
  for (const marker of sequence.markers) {
    const host = exportableSpineClips.find(
      (c) =>
        c.role !== 'pause-gap' &&
        marker.timeSeconds >= c.timelineInSeconds &&
        marker.timeSeconds <= c.timelineOutSeconds
    )
    if (host) markers += 1
    else orphanMarkers += 1
  }

  const sourceAssetIds = new Set<string>()
  for (const clip of exportableSpineClips) {
    if (clip.role !== 'pause-gap' && clip.assetId) sourceAssetIds.add(clip.assetId)
  }

  let bRollClips = 0
  for (const track of sequence.videoTracks) {
    if (track.id === 'v-broll' || track.id === 'v-graphics') {
      bRollClips += track.clips.filter((c) => c.role !== 'pause-gap').length
    }
  }

  const soundEffectPlacements =
    soundDesign?.slots.filter((s) => s.status === 'accepted').length ??
    sequence.soundDesignSlots?.filter((s) => s.status === 'accepted').length ??
    0

  return {
    included: {
      aRollClips,
      markers,
      sourceFiles: sourceAssetIds.size,
      pauseGaps
    },
    excluded: {
      bRollClips,
      titleOverlays: countOverlayTitles(sequence),
      graphicsOverlays: countGraphicsOverlays(sequence),
      soundEffectPlacements,
      skippedSpineClips,
      orphanMarkers
    }
  }
}

function targetLabel(target: NleTarget): string {
  switch (target) {
    case 'final-cut-pro':
      return 'Final Cut Pro'
    case 'premiere-pro':
      return 'Adobe Premiere Pro'
    case 'davinci-resolve':
      return 'DaVinci Resolve'
    case 'otio':
      return 'OTIO'
    default:
      return target
  }
}

function roughCutNote(target: NleTarget): string {
  if (target === 'final-cut-pro') {
    return (
      'Includes primary edit (A-roll rough cut), media, and timeline metadata. ' +
      'B-roll, graphics, and advanced layering are provided in manifest.json for manual finishing ' +
      'while Final Cut XML compatibility continues to improve.'
    )
  }
  return (
    'Includes primary edit (A-roll rough cut), media, and timeline metadata. ' +
    'Overlay tracks and sound-design placements are listed in manifest.json for manual finishing in your NLE.'
  )
}

export function buildExportSummary(params: {
  sequence: TimelineSequence
  assetPathsById: Record<string, string>
  targetNle: NleTarget
  manifest: XmlPackageManifest
  projectTitle?: string
  soundDesign?: NleExportInput['soundDesign']
  generatedAt?: string
}): ExportSummary {
  const {
    sequence,
    assetPathsById,
    targetNle,
    manifest,
    projectTitle,
    soundDesign,
    generatedAt = new Date().toISOString()
  } = params

  const title = projectTitle?.trim() || 'Untitled project'
  const { included, excluded } = analyzeCoverage({ sequence, assetPathsById, soundDesign })

  const lines: string[] = [
    'Storyteller Export Summary',
    '',
    `Project: ${title}`,
    `Target: ${targetLabel(targetNle)}${targetNle === 'final-cut-pro' ? ' — Rough Cut Export (Beta)' : ''}`,
    `Timeline: ${formatDurationLabel(sequence.durationSeconds)}`,
    `Generated: ${generatedAt}`,
    '',
    'Exported:',
    `  ✓ ${included.aRollClips} A-roll clip${included.aRollClips === 1 ? '' : 's'}`,
    ...(included.pauseGaps > 0
      ? [`  ✓ ${included.pauseGaps} pause gap${included.pauseGaps === 1 ? '' : 's'}`]
      : []),
    `  ✓ ${included.markers} marker${included.markers === 1 ? '' : 's'}`,
    `  ✓ ${included.sourceFiles} source file${included.sourceFiles === 1 ? '' : 's'}`,
    '',
    'Not included in interchange timeline:',
    ...(excluded.bRollClips > 0
      ? [`  • ${excluded.bRollClips} B-roll clip${excluded.bRollClips === 1 ? '' : 's'}`]
      : []),
    ...(excluded.titleOverlays > 0
      ? [`  • ${excluded.titleOverlays} title overlay${excluded.titleOverlays === 1 ? '' : 's'}`]
      : []),
    ...(excluded.graphicsOverlays > 0
      ? [`  • ${excluded.graphicsOverlays} graphics overlay${excluded.graphicsOverlays === 1 ? '' : 's'}`]
      : []),
    ...(excluded.soundEffectPlacements > 0
      ? [
          `  • ${excluded.soundEffectPlacements} sound effect placement${excluded.soundEffectPlacements === 1 ? '' : 's'}`
        ]
      : []),
    ...(excluded.skippedSpineClips > 0
      ? [`  • ${excluded.skippedSpineClips} spine clip${excluded.skippedSpineClips === 1 ? '' : 's'} (missing or cloud-only media)`]
      : []),
    ...(excluded.orphanMarkers > 0
      ? [`  • ${excluded.orphanMarkers} marker${excluded.orphanMarkers === 1 ? '' : 's'} (no host clip in interchange)`]
      : []),
    ...(excluded.bRollClips === 0 &&
    excluded.titleOverlays === 0 &&
    excluded.graphicsOverlays === 0 &&
    excluded.soundEffectPlacements === 0 &&
    excluded.skippedSpineClips === 0 &&
    excluded.orphanMarkers === 0
      ? ['  • (none — primary edit only)']
      : []),
    '',
    roughCutNote(targetNle),
    '',
    'Editorial contract:',
    '  • Clip order preserved',
    '  • Trim in/out preserved',
    '  • Timeline duration preserved (within one frame)',
    '  • Source media packaged when available locally',
    '',
    `Manifest clips: ${manifest.clips.length} total references · schema v${manifest.manifestSchemaVersion}`,
    'See manifest.json for complete timeline metadata.'
  ]

  return {
    projectTitle: title,
    targetNle,
    timelineDurationSeconds: sequence.durationSeconds,
    timelineDurationLabel: formatDurationLabel(sequence.durationSeconds),
    generatedAt,
    included,
    excluded,
    lines
  }
}

export function formatExportSummaryText(summary: ExportSummary): string {
  return summary.lines.join('\n')
}
