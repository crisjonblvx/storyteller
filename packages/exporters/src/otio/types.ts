/**
 * OpenTimelineIO (OTIO) Schema Types
 *
 * OTIO is Pixar's open format for editorial timeline interchange.
 * These types follow the OTIO 0.15+ schema specification.
 *
 * @see https://opentimelineio.readthedocs.io/
 */

import type { TimelineItemRole } from '@storyteller/timeline'

/** OTIO schema version */
export const OTIO_SCHEMA_VERSION = '1.0'

/** Base OTIO object that all OTIO types extend */
export interface OtioBase {
  OTIO_SCHEMA: string
  name?: string
  metadata?: Record<string, unknown>
}

/** Rational time representation (value/rate) */
export interface RationalTime {
  value: number
  rate: number
}

/** Time range with start time and duration */
export interface TimeRange {
  start_time: RationalTime
  duration: RationalTime
}

/** Reference to external media */
export interface ExternalReference extends OtioBase {
  OTIO_SCHEMA: 'ExternalReference.1'
  target_url: string
  available_range?: TimeRange
}

/** Gap (silent/black segment) in timeline */
export interface Gap extends OtioBase {
  OTIO_SCHEMA: 'Gap.1'
  source_range: TimeRange
}

/** Clip referencing media */
export interface Clip extends OtioBase {
  OTIO_SCHEMA: 'Clip.1'
  source_range: TimeRange
  media_reference: ExternalReference | null
}

/** Track kind - video, audio, or text/graphics */
export type TrackKind = 'Video' | 'Audio' | 'Text'

/** Track containing clips, gaps, and other composable elements */
export interface Track extends OtioBase {
  OTIO_SCHEMA: 'Track.1'
  kind: TrackKind
  children: (Clip | Gap)[]
}

/** Stack of tracks (comparable to a sequence/timeline) */
export interface Stack extends OtioBase {
  OTIO_SCHEMA: 'Stack.1'
  children: Track[]
}

/** Timeline/Sequence root object */
export interface Timeline extends OtioBase {
  OTIO_SCHEMA: 'Timeline.1'
  global_start_time?: RationalTime
  tracks: Stack
}

/** Marker on timeline or clip */
export interface Marker extends OtioBase {
  OTIO_SCHEMA: 'Marker.1'
  marked_range: TimeRange
  color?: string
}

/** Storyteller-specific metadata attached to OTIO objects */
export interface StorytellerMetadata {
  storyteller: {
    version: 1
    projectId: string
    sequenceId: string
    role?: TimelineItemRole
    soundbiteId?: string
    transcriptSegmentIds?: string[]
    brollSlotId?: string
    textEventId?: string
    introRole?: string
  }
}

/** Complete OTIO document root */
export interface OtioDocument {
  OTIO_SCHEMA: 'Timeline.1'
  metadata?: {
    storyteller?: StorytellerMetadata['storyteller']
  }
  name: string
  global_start_time: RationalTime
  tracks: {
    OTIO_SCHEMA: 'Stack.1'
    children: Array<{
      OTIO_SCHEMA: 'Track.1'
      name: string
      kind: TrackKind
      children: Array<
        | {
            OTIO_SCHEMA: 'Clip.1'
            name: string
            source_range: TimeRange
            media_reference: {
              OTIO_SCHEMA: 'ExternalReference.1'
              target_url: string
              available_range?: TimeRange
            } | null
            metadata?: {
              storyteller?: StorytellerMetadata['storyteller']
            }
            markers?: Marker[]
          }
        | {
            OTIO_SCHEMA: 'Gap.1'
            name?: string
            source_range: TimeRange
            metadata?: {
              storyteller?: StorytellerMetadata['storyteller']
            }
          }
      >
      markers?: Marker[]
    }>
  }
}

/** Export result */
export interface OtioExportResult {
  success: boolean
  document: OtioDocument | null
  error?: string
}

/** Options for OTIO export */
export interface OtioExportOptions {
  /** Include transcript segments in metadata */
  includeTranscriptMetadata?: boolean
  /** Include soundbite links in metadata */
  includeSoundbiteMetadata?: boolean
  /** Include B-roll slot references */
  includeBrollMetadata?: boolean
}
