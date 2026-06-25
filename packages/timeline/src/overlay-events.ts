/**
 * Overlay event helpers — pure functions over `TimelineSequence` for the
 * inline `overlayEvents` array. The renderer authors them from the Enhance
 * step, the preview layer renders them, and the exporter consumes them.
 *
 * Why no DB writes here?
 *   See the `OverlayEvent` doc-comment in model.ts — overlays are tied to a
 *   specific edit revision, so we keep them inline on the sequence JSON.
 *   `text_events` (the DB table) was an earlier draft that the rest of the
 *   stack never adopted; resurrecting it would mean migrations + sync code
 *   for zero current benefit. If we ever need a cross-project preset library
 *   we can promote inline → table without breaking saved sequences.
 *
 * All helpers are pure: they return a NEW `TimelineSequence` rather than
 * mutating the input. This keeps the renderer's "set state from a fresh
 * object" contract intact.
 */
import type {
  OverlayEvent,
  OverlayKind,
  OverlayStatPayload,
  TimelineSequence
} from './model.js'

/** Smallest reasonable overlay duration — anything shorter never reads on screen. */
const MIN_OVERLAY_SECONDS = 0.5

/**
 * Default duration for a brand-new overlay placed at the playhead. 3 seconds
 * is the sweet spot for a single-sentence headline — long enough to read,
 * short enough not to overstay its welcome.
 */
export const DEFAULT_OVERLAY_SECONDS = 3

function clampDuration(timelineInSeconds: number, requested: number): number {
  if (!Number.isFinite(timelineInSeconds) || timelineInSeconds < 0) return MIN_OVERLAY_SECONDS
  const safe = Number.isFinite(requested) ? requested : DEFAULT_OVERLAY_SECONDS
  return Math.max(MIN_OVERLAY_SECONDS, safe)
}

function makeOverlayId(kind: OverlayKind): string {
  return `ov-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export interface AddOverlayInput {
  kind: OverlayKind
  /** Where to anchor on the sequence timeline (sec). Usually the user's playhead. */
  timelineInSeconds: number
  /** How long to hold (sec). Defaults to `DEFAULT_OVERLAY_SECONDS`. */
  durationSeconds?: number
  content: string
  subtitle?: string
  stat?: OverlayStatPayload
  position?: OverlayEvent['position']
}

/**
 * Create + insert a new overlay event at `timelineInSeconds`. Returns the
 * updated sequence AND the new event (so the caller can scroll to it / select
 * it without a second pass over the array).
 */
export function addOverlayEvent(
  sequence: TimelineSequence,
  input: AddOverlayInput
): { sequence: TimelineSequence; event: OverlayEvent } {
  const dur = clampDuration(input.timelineInSeconds, input.durationSeconds ?? DEFAULT_OVERLAY_SECONDS)
  const event: OverlayEvent = {
    id: makeOverlayId(input.kind),
    kind: input.kind,
    timelineInSeconds: Math.max(0, input.timelineInSeconds),
    timelineOutSeconds: Math.max(0, input.timelineInSeconds) + dur,
    content: input.content,
    subtitle: input.subtitle,
    stat: input.stat,
    position: input.position ?? defaultPositionForKind(input.kind),
    createdAt: new Date().toISOString()
  }
  const events = [...(sequence.overlayEvents ?? []), event].sort(
    (a, b) => a.timelineInSeconds - b.timelineInSeconds
  )
  return { sequence: { ...sequence, overlayEvents: events }, event }
}

/**
 * In-place edit (immutable copy) of an existing overlay. Pass only the fields
 * you want to change. Returns the same sequence reference if `eventId` doesn't
 * exist so callers can short-circuit redundant persistence.
 */
export function updateOverlayEvent(
  sequence: TimelineSequence,
  eventId: string,
  patch: Partial<Omit<OverlayEvent, 'id' | 'kind' | 'createdAt'>>
): TimelineSequence {
  const events = sequence.overlayEvents ?? []
  let changed = false
  const next = events.map((e) => {
    if (e.id !== eventId) return e
    changed = true
    const merged: OverlayEvent = { ...e, ...patch }
    /**
     * If only one of in/out changed, recompute the other if the gap collapsed
     * — otherwise preview + export math break on negative durations.
     */
    if (merged.timelineOutSeconds - merged.timelineInSeconds < MIN_OVERLAY_SECONDS) {
      merged.timelineOutSeconds = merged.timelineInSeconds + MIN_OVERLAY_SECONDS
    }
    return merged
  })
  if (!changed) return sequence
  next.sort((a, b) => a.timelineInSeconds - b.timelineInSeconds)
  return { ...sequence, overlayEvents: next }
}

export function removeOverlayEvent(sequence: TimelineSequence, eventId: string): TimelineSequence {
  const events = sequence.overlayEvents ?? []
  const next = events.filter((e) => e.id !== eventId)
  if (next.length === events.length) return sequence
  return { ...sequence, overlayEvents: next }
}

/**
 * Find every overlay that should be on screen at `seconds`. Used by the
 * preview overlay layer. Returns events sorted by their original z-order
 * (insertion order, broken by `timelineInSeconds` ascending).
 */
export function overlaysActiveAt(sequence: TimelineSequence, seconds: number): OverlayEvent[] {
  if (!sequence.overlayEvents?.length) return []
  return sequence.overlayEvents.filter(
    (e) => seconds >= e.timelineInSeconds && seconds < e.timelineOutSeconds
  )
}

function defaultPositionForKind(kind: OverlayKind): OverlayEvent['position'] {
  switch (kind) {
    case 'hook':
      return 'top'
    case 'stat':
      return 'middle'
    case 'text':
    default:
      return 'bottom'
  }
}
