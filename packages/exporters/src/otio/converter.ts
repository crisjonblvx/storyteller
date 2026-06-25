/**
 * TimelineSequence to OpenTimelineIO (OTIO) Converter
 *
 * Converts Storyteller's canonical TimelineSequence to OTIO format
 * for interchange with professional NLEs (FCP, Premiere, Resolve, etc.)
 */

import type { TimelineSequence, TimelineClip, TimelineMarker, TimelineTrack } from '@storyteller/timeline'
import type {
  OtioDocument,
  RationalTime,
  TimeRange,
  TrackKind,
  StorytellerMetadata,
  OtioExportOptions
} from './types.js'

/**
 * Convert seconds to rational time with given frame rate
 */
function secondsToRationalTime(seconds: number, rate: number): RationalTime {
  return {
    value: Math.round(seconds * rate),
    rate
  }
}

/**
 * Convert seconds to OTIO TimeRange
 */
function secondsToTimeRange(startSeconds: number, durationSeconds: number, fps: number): TimeRange {
  return {
    start_time: secondsToRationalTime(startSeconds, fps),
    duration: secondsToRationalTime(durationSeconds, fps)
  }
}

/**
 * Convert Storyteller marker to OTIO marker
 */
function convertMarker(marker: TimelineMarker, fps: number): {
  OTIO_SCHEMA: 'Marker.1'
  name: string
  marked_range: TimeRange
  color?: string
} {
  return {
    OTIO_SCHEMA: 'Marker.1',
    name: marker.label,
    marked_range: secondsToTimeRange(marker.timeSeconds, 1 / fps, fps), // 1 frame duration
    color: marker.color
  }
}

/**
 * Build Storyteller metadata for a clip
 */
function buildClipMetadata(
  clip: TimelineClip,
  sequence: TimelineSequence,
  options: OtioExportOptions
): { storyteller: StorytellerMetadata['storyteller'] } | undefined {
  const meta: StorytellerMetadata['storyteller'] = {
    version: 1,
    projectId: sequence.projectId,
    sequenceId: sequence.id,
    role: clip.role
  }

  if (clip.soundbiteId && options.includeSoundbiteMetadata !== false) {
    meta.soundbiteId = clip.soundbiteId
  }

  if (clip.transcriptSegmentIds?.length && options.includeTranscriptMetadata !== false) {
    meta.transcriptSegmentIds = clip.transcriptSegmentIds
  }

  if (clip.brollPromptId && options.includeBrollMetadata !== false) {
    meta.brollSlotId = clip.brollPromptId
  }

  const clipMeta = clip.metadata as Record<string, unknown> | undefined
  if (clipMeta?.introRole) {
    meta.introRole = String(clipMeta.introRole)
  }
  if (clipMeta?.textEventId) {
    meta.textEventId = String(clipMeta.textEventId)
  }

  return { storyteller: meta }
}

/**
 * Convert a single clip to OTIO Clip or Gap
 */
function convertClip(
  clip: TimelineClip,
  assetPathsById: Record<string, string>,
  sequence: TimelineSequence,
  options: OtioExportOptions
):
  | {
      OTIO_SCHEMA: 'Clip.1'
      name: string
      source_range: TimeRange
      media_reference: {
        OTIO_SCHEMA: 'ExternalReference.1'
        target_url: string
        available_range?: TimeRange
      } | null
      metadata?: { storyteller: StorytellerMetadata['storyteller'] }
      markers?: ReturnType<typeof convertMarker>[]
    }
  | {
      OTIO_SCHEMA: 'Gap.1'
      name: string
      source_range: TimeRange
      metadata?: { storyteller: StorytellerMetadata['storyteller'] }
    } {
  const fps = sequence.format.fps
  const duration = clip.timelineOutSeconds - clip.timelineInSeconds

  // Handle pause-gap clips (no media)
  if (clip.role === 'pause-gap') {
    return {
      OTIO_SCHEMA: 'Gap.1',
      name: 'Storyteller Pause Gap',
      source_range: secondsToTimeRange(0, duration, fps),
      metadata: buildClipMetadata(clip, sequence, options)
    }
  }

  // Handle regular clips with media
  const path = assetPathsById[clip.assetId]
  const sourceIn = clip.sourceInSeconds
  const sourceDuration = clip.sourceOutSeconds - clip.sourceInSeconds

  // Build media reference
  const mediaReference = path
    ? {
        OTIO_SCHEMA: 'ExternalReference.1' as const,
        target_url: path.startsWith('file://') ? path : `file://${path}`,
        available_range: secondsToTimeRange(0, sourceDuration + sourceIn, fps)
      }
    : null

  return {
    OTIO_SCHEMA: 'Clip.1',
    name: clip.role,
    source_range: secondsToTimeRange(sourceIn, sourceDuration, fps),
    media_reference: mediaReference,
    metadata: buildClipMetadata(clip, sequence, options)
  }
}

/**
 * Convert a track to OTIO Track.
 *
 * OTIO tracks are *linear*: children are played back-to-back with no implicit
 * gaps. Any time hole between two clips on the Storyteller timeline must be
 * emitted as an explicit `Gap.1` child of the right duration, otherwise the
 * downstream NLE collapses everything to start-at-zero. We also prepend a
 * head-gap when the first clip starts after t=0.
 */
function convertTrack(
  track: TimelineTrack,
  kind: TrackKind,
  assetPathsById: Record<string, string>,
  sequence: TimelineSequence,
  options: OtioExportOptions,
  sequenceMarkers: TimelineMarker[]
): {
  OTIO_SCHEMA: 'Track.1'
  name: string
  kind: TrackKind
  children: ReturnType<typeof convertClip>[]
  markers?: ReturnType<typeof convertMarker>[]
} {
  const fps = sequence.format.fps

  const sortedClips = [...track.clips].sort(
    (a, b) => a.timelineInSeconds - b.timelineInSeconds
  )

  const children: ReturnType<typeof convertClip>[] = []
  let cursor = 0
  for (const clip of sortedClips) {
    if (clip.timelineInSeconds > cursor + 1e-6) {
      const gapDuration = clip.timelineInSeconds - cursor
      children.push({
        OTIO_SCHEMA: 'Gap.1',
        name: 'Storyteller filler gap',
        source_range: secondsToTimeRange(0, gapDuration, fps)
      })
    }
    children.push(convertClip(clip, assetPathsById, sequence, options))
    cursor = clip.timelineOutSeconds
  }
  // Trailing gap so total track duration matches sequence duration when the
  // last clip ends before sequence end (avoids "short track" warnings on
  // Resolve/FCP import via otioconvert).
  if (sequence.durationSeconds > cursor + 1e-6) {
    children.push({
      OTIO_SCHEMA: 'Gap.1',
      name: 'Storyteller trailing gap',
      source_range: secondsToTimeRange(0, sequence.durationSeconds - cursor, fps)
    })
  }

  // Add markers to first video track only (avoid duplicates)
  const markers = kind === 'Video' && sequenceMarkers.length > 0
    ? sequenceMarkers.map((m) => convertMarker(m, fps))
    : undefined

  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.name,
    kind,
    children,
    markers
  }
}

/**
 * Convert TimelineSequence to OTIO Document
 */
export function timelineToOtio(
  sequence: TimelineSequence,
  assetPathsById: Record<string, string>,
  options: OtioExportOptions = {}
): OtioDocument {
  const fps = sequence.format.fps
  const rate = Math.round(fps)

  // Convert video tracks
  const videoTracks = sequence.videoTracks.map((track, index) =>
    convertTrack(
      track,
      'Video',
      assetPathsById,
      sequence,
      options,
      index === 0 ? sequence.markers : [] // Only add markers to first video track
    )
  )

  // Convert audio tracks
  const audioTracks = sequence.audioTracks.map((track) =>
    convertTrack(track, 'Audio', assetPathsById, sequence, options, [])
  )

  // Convert text tracks (as metadata tracks in OTIO)
  const textTracks = sequence.textTracks.map((track) =>
    convertTrack(track, 'Text', assetPathsById, sequence, options, [])
  )

  // Build document metadata
  const documentMetadata: { storyteller: StorytellerMetadata['storyteller'] } = {
    storyteller: {
      version: 1,
      projectId: sequence.projectId,
      sequenceId: sequence.id,
      role: 'a-roll' // Default role for sequence
    }
  }

  if (sequence.brollSlots?.length && options.includeBrollMetadata !== false) {
    // Store B-roll slot count in metadata (slots themselves are on the timeline)
    documentMetadata.storyteller.brollSlotId = `${sequence.brollSlots.length} slots`
  }

  // Build OTIO document
  const document: OtioDocument = {
    OTIO_SCHEMA: 'Timeline.1',
    name: sequence.id,
    global_start_time: {
      value: 0,
      rate
    },
    metadata: documentMetadata,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [...videoTracks, ...audioTracks, ...textTracks]
    }
  }

  return document
}

/**
 * Serialize OTIO document to JSON string
 */
export function serializeOtio(document: OtioDocument): string {
  return JSON.stringify(document, null, 2)
}
