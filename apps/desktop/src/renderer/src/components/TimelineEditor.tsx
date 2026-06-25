import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  type DragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type { TimelineSequence, TimelineClip, BrollSlot, GraphicsSlot, BuilderPacing } from '@storyteller/timeline'
import {
  closeTimelineGapsInSequence,
  moveClipFreelyInSequence,
  moveBrollSlotInSequence,
  overlayVideoTrackLabel,
  reorderClipsInSequence,
  removeClipFromSequence,
  spineVideoTrackIndex,
  trimClipInSequence,
  videoTracksForTimelineDisplay,
  type ClipTrimEdge
} from '@storyteller/timeline'
import {
  ASSET_LIBRARY_DRAG_MIME,
  parseAssetDragPayload,
  type AssetDragPayload
} from '@renderer/hooks/useAssetLibrary'

interface TimelineEditorProps {
  sequence: TimelineSequence
  /**
   * Called with the new sequence on every committed change (e.g. drag end,
   * clip delete). During a trim drag the callback is also called with
   * `options.isDraft = true` once per animation frame so the parent can
   * update its display without triggering expensive DB writes. The final
   * call on mouse-up has no `options` (or `isDraft = false`) and is the
   * one the parent should persist.
   */
  onSequenceChange?: (seq: TimelineSequence, options?: { isDraft?: boolean }) => void
  /**
   * Fired when a trim drag starts or ends. The parent can use this to lock
   * the live-preview playhead to the clip edge being trimmed.
   */
  onTrimActiveChange?: (trim: { clipId: string; edge: ClipTrimEdge; trackIndex: number } | null) => void
  pacing?: BuilderPacing
  onPacingChange?: (pacing: BuilderPacing) => void
  playheadSeconds?: number
  onPlayheadChange?: (seconds: number) => void
  playbackState?: 'playing' | 'paused' | 'stopped'
  canControlPlayback?: boolean
  onPlay?: () => void
  onPause?: () => void
  onStop?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  /**
   * Optional controlled selection. When set, the editor reflects this
   * id and does not maintain its own state. When omitted, the editor
   * tracks selection internally (legacy behavior).
   */
  selectedClipId?: string | null
  onSelectedClipChange?: (id: string | null) => void
  /** Drop handler for assets dragged from the cross-project library. */
  onAssetLibraryDrop?: (payload: AssetDragPayload, atSeconds: number) => void
}

/**
 * Zoom range: a minimum that keeps even a 30s clip visible without
 * horizontal scroll on narrow displays, and a maximum that gives sub-
 * second precision when trimming. The default `40` matches the original
 * static layout so the editor opens identically until the user zooms.
 */
const MIN_PX_PER_SEC = 8
const MAX_PX_PER_SEC = 200
const DEFAULT_PX_PER_SEC = 40

/** Pixel width reserved on the left for the track-label gutter (V1, A1…). */
const TRACK_LABEL_GUTTER_PX = 80

/** Width of the drag-to-trim handles on each side of a clip. */
const TRIM_HANDLE_PX = 12

export function TimelineEditor({
  sequence,
  onSequenceChange,
  onTrimActiveChange,
  pacing: controlledPacing,
  onPacingChange,
  playheadSeconds = 0,
  onPlayheadChange,
  playbackState = 'stopped',
  canControlPlayback = false,
  onPlay,
  onPause,
  onStop,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  selectedClipId: controlledSelectedClipId,
  onSelectedClipChange,
  onAssetLibraryDrop
}: TimelineEditorProps) {
  const [internalSelectedClipId, setInternalSelectedClipId] = useState<string | null>(null)
  const isControlled = controlledSelectedClipId !== undefined
  const selectedClipId = isControlled ? controlledSelectedClipId : internalSelectedClipId
  const setSelectedClipId = useCallback(
    (id: string | null) => {
      if (!isControlled) setInternalSelectedClipId(id)
      onSelectedClipChange?.(id)
    },
    [isControlled, onSelectedClipChange]
  )
  const [internalPacing, setInternalPacing] = useState<BuilderPacing>('Balanced')
  const [moveMode, setMoveMode] = useState<'Ripple' | 'Free position'>('Ripple')
  const pacing = controlledPacing ?? internalPacing
  const setPacing = useCallback(
    (next: BuilderPacing) => {
      if (controlledPacing === undefined) setInternalPacing(next)
      onPacingChange?.(next)
    },
    [controlledPacing, onPacingChange]
  )

  /** Editable timeline scale. Persisted in component state only. */
  const [pxPerSec, setPxPerSec] = useState<number>(DEFAULT_PX_PER_SEC)

  /**
   * Drag-to-reorder state. We only support reordering V1 a-roll clips:
   *   - `draggingClipId`: the clip currently being dragged (visual fade)
   *   - `dragOverIndex`: the would-be insert index in V1 (renders a thin
   *     teal indicator between clips)
   * Audio clips and B-roll slots aren't independently draggable — they're
   * duration-locked to the V1 clips and reflow automatically.
   */
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [assetDropActive, setAssetDropActive] = useState(false)
  const suppressNextClipClickRef = useRef(false)
  const v1RowRef = useRef<HTMLDivElement | null>(null)
  // True while a trim drag is in-flight so that the sequenceRef sync effect
  // does not overwrite the incrementally-updated ref with the stale prop value.
  const isDraggingTrimRef = useRef(false)

  /** Hover state for the V1 clip ×-button (per-clip so only one shows). */
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null)

  /** Trim-in-progress state. `null` when no trim is active. */
  const [activeTrim, setActiveTrim] = useState<{
    clipId: string
    edge: ClipTrimEdge
    trackIndex: number
  } | null>(null)

  /**
   * Measured width of the scrolling timeline area (excludes the sticky
   * track gutter + the inspector). Used by the Fit button and for
   * sizing the indicator math when no clips exist yet.
   */
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const [scrollAreaWidth, setScrollAreaWidth] = useState<number>(800)

  useLayoutEffect(() => {
    const el = scrollAreaRef.current
    if (!el) return
    const update = (): void => setScrollAreaWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const totalDuration = useMemo(() => {
    if (sequence.durationSeconds) return sequence.durationSeconds
    let max = 0
    sequence.videoTracks?.forEach((t) =>
      t.clips.forEach((c) => {
        max = Math.max(max, c.timelineOutSeconds)
      })
    )
    sequence.audioTracks?.forEach((t) =>
      t.clips.forEach((c) => {
        max = Math.max(max, c.timelineOutSeconds)
      })
    )
    sequence.brollSlots?.forEach((s) => {
      max = Math.max(max, s.timelineEnd)
    })
    sequence.graphicsSlots?.forEach((s) => {
      max = Math.max(max, s.timelineEnd)
    })
    return Math.max(max, 30)
  }, [sequence])

  const timelineWidth = Math.max(totalDuration * pxPerSec, 800)

  const handleClipClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, clip: TimelineClip) => {
      if (suppressNextClipClickRef.current) {
        suppressNextClipClickRef.current = false
        return
      }
      e.stopPropagation()
      setSelectedClipId(clip.id)
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0
      const seekSeconds =
        clip.timelineInSeconds + ratio * Math.max(0, clip.timelineOutSeconds - clip.timelineInSeconds)
      onPlayheadChange?.(seekSeconds)
    },
    [setSelectedClipId, onPlayheadChange]
  )

  const spineTrackIndex = spineVideoTrackIndex(sequence.videoTracks)
  const v1Clips = sequence.videoTracks[spineTrackIndex]?.clips ?? []
  const displayVideoTracks = useMemo(
    () => videoTracksForTimelineDisplay(sequence.videoTracks),
    [sequence.videoTracks]
  )

  /** Selected clip lookup — used by Inspector + delete + trim handlers. */
  const selectedClip = useMemo<TimelineClip | null>(() => {
    if (!selectedClipId) return null
    for (const track of sequence.videoTracks) {
      const found = track.clips.find((c) => c.id === selectedClipId)
      if (found) return found
    }
    for (const track of sequence.audioTracks) {
      const found = track.clips.find((c) => c.id === selectedClipId)
      if (found) return found
    }
    return null
  }, [selectedClipId, sequence])

  const isSelectedClipOnV1 = useMemo<boolean>(
    () => Boolean(selectedClipId && v1Clips.some((c) => c.id === selectedClipId)),
    [selectedClipId, v1Clips]
  )
  const selectedVideoTrackIndex = useMemo<number>(() => {
    if (!selectedClipId) return -1
    return sequence.videoTracks.findIndex((track) => track.clips.some((c) => c.id === selectedClipId))
  }, [selectedClipId, sequence.videoTracks])

  const isGraphicsTrackIndex = useCallback(
    (trackIndex: number) => sequence.videoTracks[trackIndex]?.id === 'v-graphics',
    [sequence.videoTracks]
  )

  const upsertGraphicsWindow = useCallback(
    (
      base: TimelineSequence,
      clipId: string,
      nextIn: number,
      nextOut: number
    ): TimelineSequence => {
      let graphicsSlotId: string | undefined
      const videoTracks = base.videoTracks.map((track) => {
        if (track.id !== 'v-graphics') return track
        return {
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip
            graphicsSlotId = (clip.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId
            return { ...clip, timelineInSeconds: nextIn, timelineOutSeconds: nextOut }
          })
        }
      })
      const graphicsSlots = graphicsSlotId
        ? (base.graphicsSlots ?? []).map((slot) =>
            slot.id === graphicsSlotId
              ? { ...slot, timelineStart: nextIn, timelineEnd: nextOut }
              : slot
          )
        : base.graphicsSlots
      const maxVideoOut = Math.max(
        0,
        ...videoTracks.flatMap((track) => track.clips.map((clip) => clip.timelineOutSeconds))
      )
      return {
        ...base,
        videoTracks,
        ...(graphicsSlots ? { graphicsSlots } : {}),
        durationSeconds: Math.max(base.durationSeconds, maxVideoOut)
      }
    },
    []
  )

  const removeGraphicsClip = useCallback((base: TimelineSequence, clipId: string): TimelineSequence => {
    let graphicsSlotId: string | undefined
    const videoTracks = base.videoTracks.map((track) => {
      if (track.id !== 'v-graphics') return track
      const nextClips = track.clips.filter((clip) => {
        const match = clip.id === clipId
        if (match) {
          graphicsSlotId = (clip.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId
        }
        return !match
      })
      return { ...track, clips: nextClips }
    })
    const graphicsSlots = graphicsSlotId
      ? (base.graphicsSlots ?? []).map((slot) =>
          slot.id === graphicsSlotId
            ? { ...slot, generatedAssetId: undefined, status: 'empty' as const, errorMessage: undefined }
            : slot
        )
      : base.graphicsSlots
    return {
      ...base,
      videoTracks,
      ...(graphicsSlots ? { graphicsSlots } : {})
    }
  }, [])

  /** Delete selected clip on any editable video track. */
  const deleteSelectedClip = useCallback(() => {
    if (!onSequenceChange || !selectedClipId || selectedVideoTrackIndex < 0) return
    const next = isGraphicsTrackIndex(selectedVideoTrackIndex)
      ? removeGraphicsClip(sequence, selectedClipId)
      : removeClipFromSequence(sequence, selectedVideoTrackIndex, selectedClipId)
    setSelectedClipId(null)
    onSequenceChange(next)
  }, [
    isGraphicsTrackIndex,
    onSequenceChange,
    removeGraphicsClip,
    selectedClipId,
    selectedVideoTrackIndex,
    sequence,
    setSelectedClipId
  ])

  /**
   * Compute the would-be insert index based on the cursor X within the V1
   * track's content area. We compare to each clip's pixel midpoint:
   * cursor before midpoint → insert at the clip's index; after → insert
   * after. Returns a value in `[0, v1Clips.length]`.
   */
  const computeDropIndex = useCallback(
    (e: DragEvent<HTMLDivElement>): number => {
      const row = v1RowRef.current
      if (!row) return v1Clips.length
      const rect = row.getBoundingClientRect()
      const x = e.clientX - rect.left
      for (let i = 0; i < v1Clips.length; i++) {
        const clip = v1Clips[i]!
        const startPx = clip.timelineInSeconds * pxPerSec
        const endPx = clip.timelineOutSeconds * pxPerSec
        const mid = (startPx + endPx) / 2
        if (x < mid) return i
      }
      return v1Clips.length
    },
    [v1Clips, pxPerSec]
  )

  const clampPlayheadSeconds = useCallback(
    (seconds: number) => Math.min(Math.max(0, seconds), totalDuration),
    [totalDuration]
  )

  const handleAssetLibraryDragOver = useCallback(
    (e: DragEvent) => {
      if (!onAssetLibraryDrop) return
      if (!e.dataTransfer.types.includes(ASSET_LIBRARY_DRAG_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setAssetDropActive(true)
    },
    [onAssetLibraryDrop]
  )

  const handleAssetLibraryDrop = useCallback(
    (e: DragEvent) => {
      setAssetDropActive(false)
      if (!onAssetLibraryDrop) return
      const raw = e.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME)
      if (!raw) return
      const payload = parseAssetDragPayload(raw)
      if (!payload) return
      e.preventDefault()
      onAssetLibraryDrop(payload, clampPlayheadSeconds(playheadSeconds))
    },
    [onAssetLibraryDrop, playheadSeconds, clampPlayheadSeconds]
  )

  const handleAssetLibraryDragLeave = useCallback((e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setAssetDropActive(false)
  }, [])

  const secondsFromClientX = useCallback(
    (clientX: number, rect: DOMRect) => clampPlayheadSeconds((clientX - rect.left) / pxPerSecRef.current),
    [clampPlayheadSeconds]
  )

  /**
   * Translate a drop-index back into pixel-X for the insert indicator.
   * `index = 0` → before the first clip; `index = clips.length` → after
   * the last clip. The indicator hugs the boundary between clips.
   */
  const indicatorPxForIndex = useCallback(
    (clips: TimelineClip[], index: number): number => {
      if (clips.length === 0) return 0
      if (index <= 0) return clips[0]!.timelineInSeconds * pxPerSec
      if (index >= clips.length) {
        const last = clips[clips.length - 1]!
        return last.timelineOutSeconds * pxPerSec
      }
      return clips[index]!.timelineInSeconds * pxPerSec
    },
    [pxPerSec]
  )

  const handleDragStartV1 = (e: DragEvent<HTMLDivElement>, clip: TimelineClip): void => {
    if (!onSequenceChange) return
    setDraggingClipId(clip.id)
    setSelectedClipId(clip.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', clip.id)
  }

  const handleDragEndV1 = (): void => {
    setDraggingClipId(null)
    setDragOverIndex(null)
  }

  const handleDragOverV1Row = (e: DragEvent<HTMLDivElement>): void => {
    if (!onSequenceChange || !draggingClipId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const idx = computeDropIndex(e)
    setDragOverIndex(idx)
  }

  const handleDropV1 = (e: DragEvent<HTMLDivElement>): void => {
    if (!onSequenceChange || !draggingClipId) return
    e.preventDefault()
    const targetIndex = computeDropIndex(e)
    const fromIndex = v1Clips.findIndex((c) => c.id === draggingClipId)
    setDraggingClipId(null)
    setDragOverIndex(null)
    if (fromIndex < 0) return
    const newOrder = v1Clips.map((c) => c.id)
    const [moved] = newOrder.splice(fromIndex, 1)
    if (!moved) return
    const insertAt = targetIndex > fromIndex ? targetIndex - 1 : targetIndex
    newOrder.splice(insertAt, 0, moved)
    if (newOrder.every((id, i) => id === v1Clips[i]?.id)) return
    const next = reorderClipsInSequence(sequence, 0, newOrder)
    onSequenceChange(next)
  }

  const beginPlayheadDrag = useCallback(
    (clientX: number, rect: DOMRect): void => {
      onPlayheadChange?.(secondsFromClientX(clientX, rect))
      const onMove = (ev: MouseEvent): void => {
        onPlayheadChange?.(secondsFromClientX(ev.clientX, rect))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onPlayheadChange, secondsFromClientX]
  )

  const handleTimelineSurfaceMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!onPlayheadChange) return
      beginPlayheadDrag(e.clientX, e.currentTarget.getBoundingClientRect())
    },
    [beginPlayheadDrag, onPlayheadChange]
  )

  /**
   * Begin a trim drag. We attach native window listeners (instead of
   * using React's drag API) so the cursor keeps tracking even when it
   * leaves the clip element, and so we can read the live `pxPerSec` and
   * `sequence` via refs without re-binding listeners on every change.
   *
   * The delta we hand to `trimClipInSequence` on each mousemove is the
   * difference between the **target** edge (anchored to the cursor's
   * absolute X) and the **current** edge in the live sequence. That way
   * clamps inside the helper produce a stable resting state instead of
   * drifting per frame.
   */
  const pxPerSecRef = useRef(pxPerSec)
  useEffect(() => {
    pxPerSecRef.current = pxPerSec
  }, [pxPerSec])
  const sequenceRef = useRef(sequence)
  useEffect(() => {
    // Do not overwrite during an active trim drag — onMove updates
    // sequenceRef.current directly so delta calculations stay correct, and we
    // don't want a React re-render from a parent draft update to reset it.
    if (!isDraggingTrimRef.current) {
      sequenceRef.current = sequence
    }
  }, [sequence])

  const handleFreeMoveMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, clip: TimelineClip, trackIndex: number): void => {
      if (!onSequenceChange || moveMode !== 'Free position') return
      e.preventDefault()
      e.stopPropagation()
      setSelectedClipId(clip.id)
      setDraggingClipId(clip.id)
      let didMove = false
      const startX = e.clientX
      const startIn = clip.timelineInSeconds

      const onMove = (ev: MouseEvent): void => {
        const dxSec = (ev.clientX - startX) / pxPerSecRef.current
        if (Math.abs(dxSec) > 0.01) didMove = true
        const desiredStart = Math.max(0, startIn + dxSec)
        const next = isGraphicsTrackIndex(trackIndex)
          ? (() => {
              const liveClip = sequenceRef.current.videoTracks[trackIndex]?.clips.find((c) => c.id === clip.id)
              if (!liveClip) return sequenceRef.current
              const dur = Math.max(0.1, liveClip.timelineOutSeconds - liveClip.timelineInSeconds)
              return upsertGraphicsWindow(
                sequenceRef.current,
                clip.id,
                desiredStart,
                desiredStart + dur
              )
            })()
          : moveClipFreelyInSequence(sequenceRef.current, 0, clip.id, desiredStart)
        if (next === sequenceRef.current) return
        sequenceRef.current = next
        onSequenceChange(next, { isDraft: true })
      }
      const onUp = (): void => {
        if (didMove) suppressNextClipClickRef.current = true
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDraggingClipId(null)
        onSequenceChange(sequenceRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [
      isGraphicsTrackIndex,
      moveMode,
      onSequenceChange,
      setSelectedClipId,
      upsertGraphicsWindow
    ]
  )

  const handleBrollSlotMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, slot: BrollSlot): void => {
      if (!onSequenceChange) return
      e.preventDefault()
      e.stopPropagation()
      setSelectedClipId(slot.id)
      setDraggingClipId(slot.id)
      let didMove = false
      const startX = e.clientX
      const startIn = slot.timelineStart

      const onMove = (ev: MouseEvent): void => {
        const dxSec = (ev.clientX - startX) / pxPerSecRef.current
        if (Math.abs(dxSec) > 0.01) didMove = true
        const desiredStart = Math.max(0, startIn + dxSec)
        const next = moveBrollSlotInSequence(sequenceRef.current, slot.id, desiredStart)
        if (next === sequenceRef.current) return
        sequenceRef.current = next
        onSequenceChange(next, { isDraft: true })
      }
      const onUp = (): void => {
        if (didMove) suppressNextClipClickRef.current = true
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDraggingClipId(null)
        onSequenceChange(sequenceRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onSequenceChange]
  )

  /** Direct slot-based drag for graphics slots that have no linked v-graphics clip (e.g. kinetic-text). */
  const handleGraphicsSlotDirectMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, slot: GraphicsSlot): void => {
      if (!onSequenceChange) return
      e.preventDefault()
      e.stopPropagation()
      setSelectedClipId(slot.id)
      setDraggingClipId(slot.id)
      let didMove = false
      const startX = e.clientX
      const startIn = slot.timelineStart

      const onMove = (ev: MouseEvent): void => {
        const dxSec = (ev.clientX - startX) / pxPerSecRef.current
        if (Math.abs(dxSec) > 0.01) didMove = true
        const desiredStart = Math.max(0, startIn + dxSec)
        const dur = Math.max(0.1, slot.timelineEnd - slot.timelineStart)
        const seq = sequenceRef.current
        const nextSlots = (seq.graphicsSlots ?? []).map((s) =>
          s.id === slot.id
            ? { ...s, timelineStart: desiredStart, timelineEnd: desiredStart + dur }
            : s
        )
        // Also shift the linked clip in v-graphics (if it exists)
        const videoTracks = seq.videoTracks.map((track) => {
          if (track.id !== 'v-graphics') return track
          return {
            ...track,
            clips: track.clips.map((c) => {
              const meta = (c.metadata ?? {}) as { graphicsSlotId?: string }
              if (meta.graphicsSlotId !== slot.id) return c
              return { ...c, timelineInSeconds: desiredStart, timelineOutSeconds: desiredStart + dur }
            })
          }
        })
        const next: TimelineSequence = { ...seq, graphicsSlots: nextSlots, videoTracks }
        if (next === seq) return
        sequenceRef.current = next
        onSequenceChange(next, { isDraft: true })
      }
      const onUp = (): void => {
        if (didMove) suppressNextClipClickRef.current = true
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDraggingClipId(null)
        onSequenceChange(sequenceRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [onSequenceChange]
  )

  const handleTrimMouseDown = useCallback(
    (
      e: ReactMouseEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: ClipTrimEdge,
      trackIndex: number
    ): void => {
      if (!onSequenceChange) return
      e.preventDefault()
      e.stopPropagation()
      setSelectedClipId(clip.id)
      setActiveTrim({ clipId: clip.id, edge, trackIndex })
      onTrimActiveChange?.({ clipId: clip.id, edge, trackIndex })
      isDraggingTrimRef.current = true

      const startX = e.clientX
      const startEdgeSec =
        edge === 'in' ? clip.timelineInSeconds : clip.timelineOutSeconds

      // rAF handle and latest pending sequence for the throttled parent update.
      let rafId = 0
      let pendingNext: TimelineSequence | null = null

      const onMove = (ev: MouseEvent): void => {
        const dxSec = (ev.clientX - startX) / pxPerSecRef.current
        const targetSec = startEdgeSec + dxSec
        const liveClip = sequenceRef.current.videoTracks[trackIndex]?.clips.find((c) => c.id === clip.id)
        if (!liveClip) return
        const currentSec =
          edge === 'in' ? liveClip.timelineInSeconds : liveClip.timelineOutSeconds
        const deltaThisFrame = targetSec - currentSec
        if (Math.abs(deltaThisFrame) < 1e-4) return
        const isBrollTrack = sequenceRef.current.videoTracks[trackIndex]?.id === 'v-broll'
        const next = isBrollTrack
          ? (() => {
              const minDur = 0.1
              let nextIn = liveClip.timelineInSeconds
              let nextOut = liveClip.timelineOutSeconds
              const srcDur = Math.max(0.1, liveClip.sourceOutSeconds - liveClip.sourceInSeconds)
              if (edge === 'in') {
                nextIn = Math.max(0, Math.min(liveClip.timelineOutSeconds - minDur, liveClip.timelineInSeconds + deltaThisFrame))
              } else {
                nextOut = Math.min(
                  liveClip.timelineInSeconds + srcDur,
                  Math.max(liveClip.timelineInSeconds + minDur, liveClip.timelineOutSeconds + deltaThisFrame)
                )
              }
              if (nextIn === liveClip.timelineInSeconds && nextOut === liveClip.timelineOutSeconds) {
                return sequenceRef.current
              }
              const brollSlotId = (liveClip.metadata as { brollSlotId?: string } | undefined)?.brollSlotId
              const videoTracks = sequenceRef.current.videoTracks.map((vt) => {
                if (vt.id !== 'v-broll') return vt
                return {
                  ...vt,
                  clips: vt.clips.map((c) =>
                    c.id === clip.id ? { ...c, timelineInSeconds: nextIn, timelineOutSeconds: nextOut } : c
                  )
                }
              })
              const brollSlots = brollSlotId
                ? (sequenceRef.current.brollSlots ?? []).map((slot) =>
                    slot.id === brollSlotId
                      ? { ...slot, timelineStart: nextIn, timelineEnd: nextOut }
                      : slot
                  )
                : sequenceRef.current.brollSlots
              const maxVideoOut = Math.max(
                sequenceRef.current.durationSeconds,
                ...videoTracks.flatMap((vt) => vt.clips.map((c) => c.timelineOutSeconds))
              )
              return {
                ...sequenceRef.current,
                videoTracks,
                ...(brollSlots ? { brollSlots } : {}),
                durationSeconds: Math.max(sequenceRef.current.durationSeconds, maxVideoOut)
              }
            })()
          : isGraphicsTrackIndex(trackIndex)
            ? (() => {
                const minDur = 0.1
                let nextIn = liveClip.timelineInSeconds
                let nextOut = liveClip.timelineOutSeconds
                if (edge === 'in') {
                  nextIn = Math.max(0, Math.min(liveClip.timelineOutSeconds - minDur, liveClip.timelineInSeconds + deltaThisFrame))
                } else {
                  nextOut = Math.max(liveClip.timelineInSeconds + minDur, liveClip.timelineOutSeconds + deltaThisFrame)
                }
                return upsertGraphicsWindow(sequenceRef.current, clip.id, nextIn, nextOut)
              })()
            : trimClipInSequence(sequenceRef.current, trackIndex, clip.id, edge, deltaThisFrame)
        if (next === sequenceRef.current) return

        // Update sequenceRef synchronously so the next onMove tick computes
        // deltas from the latest position, even if the parent re-render hasn't
        // arrived yet.
        sequenceRef.current = next
        pendingNext = next

        // Throttle parent notifications to one per animation frame so we
        // never queue more than ~60 state updates per second. The parent's
        // isDraft handler is lightweight (local setState), but it still
        // triggers re-renders; the rAF batch keeps that at display rate.
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            rafId = 0
            if (pendingNext) {
              onSequenceChange(pendingNext, { isDraft: true })
              pendingNext = null
            }
          })
        }
      }

      const onUp = (): void => {
        // Cancel any pending rAF — we're about to commit the final value directly.
        if (rafId) {
          cancelAnimationFrame(rafId)
          rafId = 0
        }
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setActiveTrim(null)
        isDraggingTrimRef.current = false
        onTrimActiveChange?.(null)
        // Commit the final trimmed sequence as a persisted, undo-recorded change.
        onSequenceChange(sequenceRef.current)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [isGraphicsTrackIndex, onSequenceChange, onTrimActiveChange, setSelectedClipId, upsertGraphicsWindow]
  )

  /**
   * Wrapper-level keyboard delete. We make the editor focusable and only
   * trap Del/Backspace when a clip is selected and the keypress didn't
   * originate from a form field. This avoids fighting with text inputs
   * elsewhere on the page (e.g. project title, transcript notes).
   */
  const editorRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const isField = isEditableTarget(target)
      const isUndoRedoCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z'
      if (isUndoRedoCombo) {
        if (isField) return
        e.preventDefault()
        if (e.shiftKey) onRedo?.()
        else onUndo?.()
        return
      }
      if (e.code === 'Space') {
        if (isField) return
        if (!editorRef.current?.isConnected || !canControlPlayback) return
        e.preventDefault()
        if (playbackState === 'playing') onPause?.()
        else onPlay?.()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isField) return
      // Only act when our editor wrapper is in the DOM and a deletable
      // V1 clip is selected. Otherwise hand the key off to the browser.
      if (!editorRef.current?.isConnected) return
      if (!selectedClipId || !isSelectedClipOnV1) return
      e.preventDefault()
      deleteSelectedClip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedClipId,
    isSelectedClipOnV1,
    deleteSelectedClip,
    onUndo,
    onRedo,
    canControlPlayback,
    playbackState,
    onPause,
    onPlay
  ])

  const renderClip = (
    clip: TimelineClip,
    trackType: 'video' | 'audio',
    trackIndex = 0
  ) => {
    const left = clip.timelineInSeconds * pxPerSec
    const width = (clip.timelineOutSeconds - clip.timelineInSeconds) * pxPerSec
    const isSelected = selectedClipId === clip.id
    // Only spine (A-roll) clips on the primary video track participate in drag-
    // to-reorder, trim, and delete. The reorder helper relays out audio
    // + markers automatically.
    const isV1 = trackType === 'video' && trackIndex === spineTrackIndex
    const isGraphicsTrack = trackType === 'video' && sequence.videoTracks[trackIndex]?.id === 'v-graphics'
    const isBrollTrack = trackType === 'video' && sequence.videoTracks[trackIndex]?.id === 'v-broll'
    const isInteractive = Boolean(onSequenceChange) && (isV1 || isGraphicsTrack || isBrollTrack)
    const isBeingDragged = draggingClipId === clip.id
    const isHovered = hoveredClipId === clip.id
    const isTrimmingThisClip = activeTrim?.clipId === clip.id
    const showHandle = isInteractive && (isSelected || isHovered || isTrimmingThisClip)
    const showDeleteBtn = isInteractive && (isHovered || isSelected) && !isBeingDragged

    return (
      <div
        key={clip.id}
        onClick={(e) => handleClipClick(e, clip)}
        onMouseDown={isInteractive && trackType === 'video' && moveMode === 'Free position'
          ? (e) => handleFreeMoveMouseDown(e, clip, trackIndex)
          : (e) => e.stopPropagation()}
        onMouseEnter={isInteractive ? () => setHoveredClipId(clip.id) : undefined}
        onMouseLeave={isInteractive ? () => setHoveredClipId((id) => (id === clip.id ? null : id)) : undefined}
        draggable={isV1 && !activeTrim && moveMode === 'Ripple'}
        onDragStart={isV1 && moveMode === 'Ripple' ? (e) => handleDragStartV1(e, clip) : undefined}
        onDragEnd={isV1 && moveMode === 'Ripple' ? handleDragEndV1 : undefined}
        style={{
          position: 'absolute',
          left,
          width: Math.max(width, 4),
          top: 4,
          bottom: 4,
          background: isSelected
            ? 'rgba(110,231,197,0.2)'
            : trackType === 'video'
              ? '#27272a'
              : '#1f1f22',
          border: `1px solid ${isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 6,
          cursor: isInteractive ? 'grab' : 'pointer',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          boxSizing: 'border-box',
          transition: isBeingDragged ? 'none' : 'background 0.15s, border-color 0.15s',
          opacity: isBeingDragged ? 0.4 : (clip.disabled ? 0.35 : 1),
          boxShadow: isTrimmingThisClip ? '0 0 0 2px rgba(110,231,197,0.7) inset' : undefined
        }}
      >
        {/* Left trim handle */}
        {isInteractive && (
          <div
            onMouseDown={(e) => handleTrimMouseDown(e, clip, 'in', trackIndex)}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim in-point"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: TRIM_HANDLE_PX,
              background: isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.25)',
              cursor: 'ew-resize',
              opacity: showHandle ? 1 : 0,
              transition: 'opacity 0.15s',
              zIndex: 2
            }}
          />
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: isInteractive ? TRIM_HANDLE_PX : 0, paddingRight: isInteractive ? TRIM_HANDLE_PX : 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? '#6ee7c5' : '#f4f4f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {clip.role.toUpperCase()}
          </span>
          {width > 60 && (
            <span style={{ fontSize: 10, color: '#a1a1aa' }}>
              {(clip.timelineOutSeconds - clip.timelineInSeconds).toFixed(1)}s
            </span>
          )}
        </div>

        {/* Right trim handle */}
        {isInteractive && (
          <div
            onMouseDown={(e) => handleTrimMouseDown(e, clip, 'out', trackIndex)}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim out-point"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: TRIM_HANDLE_PX,
              background: isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.25)',
              cursor: 'ew-resize',
              opacity: showHandle ? 1 : 0,
              transition: 'opacity 0.15s',
              zIndex: 2
            }}
          />
        )}

        {/* Hover × delete button. Sits on top-right; small and subtle. */}
        {showDeleteBtn && (
          <button
            type="button"
            aria-label="Delete clip"
            title="Delete clip"
            onClick={(e) => {
              e.stopPropagation()
              if (!onSequenceChange) return
              const next = isGraphicsTrackIndex(trackIndex)
                ? removeGraphicsClip(sequence, clip.id)
                : removeClipFromSequence(sequence, trackIndex, clip.id)
              if (selectedClipId === clip.id) setSelectedClipId(null)
              onSequenceChange(next)
            }}
            style={{
              position: 'absolute',
              top: 2,
              right: TRIM_HANDLE_PX + 2,
              width: 18,
              height: 18,
              borderRadius: 9,
              border: 'none',
              background: 'rgba(0,0,0,0.6)',
              color: '#fca5a5',
              fontSize: 12,
              lineHeight: '18px',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }

  const renderBrollSlot = (slot: BrollSlot) => {
    const brollTrackIndex = sequence.videoTracks.findIndex((t) => t.id === 'v-broll')
    const brollClip =
      brollTrackIndex >= 0
        ? sequence.videoTracks[brollTrackIndex]!.clips.find(
            (c) => (c.metadata as { brollSlotId?: string } | undefined)?.brollSlotId === slot.id
          )
        : undefined
    const hasClip = Boolean(brollClip && slot.status === 'ready')
    const left = slot.timelineStart * pxPerSec
    const width = (slot.timelineEnd - slot.timelineStart) * pxPerSec
    const isBeingDragged = draggingClipId === slot.id

    if (hasClip && brollClip) {
      const isSelected = selectedClipId === brollClip.id || selectedClipId === slot.id
      const isHovered = hoveredClipId === brollClip.id
      const isTrimmingThisClip = activeTrim?.clipId === brollClip.id
      const showHandle = isSelected || isHovered || isTrimmingThisClip
      return (
        <div
          key={slot.id}
          onClick={() => setSelectedClipId(brollClip.id)}
          onMouseDown={(e) => handleBrollSlotMouseDown(e, slot)}
          onMouseEnter={() => setHoveredClipId(brollClip.id)}
          onMouseLeave={() => setHoveredClipId((id) => (id === brollClip.id ? null : id))}
          style={{
            position: 'absolute',
            left,
            width: Math.max(width, 4),
            top: 4,
            bottom: 4,
            background: isSelected ? 'rgba(110,231,197,0.2)' : '#27272a',
            border: `1px solid ${isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 6,
            cursor: onSequenceChange ? 'grab' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            opacity: isBeingDragged ? 0.4 : (brollClip.disabled ? 0.35 : 1),
            boxShadow: isTrimmingThisClip ? '0 0 0 2px rgba(110,231,197,0.7) inset' : undefined
          }}
        >
          {/* Left trim handle */}
          <div
            onMouseDown={(e) => handleTrimMouseDown(e, brollClip, 'in', brollTrackIndex)}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim in-point"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: TRIM_HANDLE_PX,
              background: isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.25)',
              cursor: 'ew-resize',
              opacity: showHandle ? 1 : 0,
              transition: 'opacity 0.15s',
              zIndex: 2
            }}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: TRIM_HANDLE_PX, paddingRight: TRIM_HANDLE_PX }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? '#6ee7c5' : '#f4f4f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              B-ROLL
            </span>
            {width > 60 && (
              <span style={{ fontSize: 10, color: '#a1a1aa' }}>
                {(slot.timelineEnd - slot.timelineStart).toFixed(1)}s
              </span>
            )}
          </div>
          {/* Right trim handle */}
          <div
            onMouseDown={(e) => handleTrimMouseDown(e, brollClip, 'out', brollTrackIndex)}
            onClick={(e) => e.stopPropagation()}
            title="Drag to trim out-point"
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: TRIM_HANDLE_PX,
              background: isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.25)',
              cursor: 'ew-resize',
              opacity: showHandle ? 1 : 0,
              transition: 'opacity 0.15s',
              zIndex: 2
            }}
          />
        </div>
      )
    }

    const isSelected = selectedClipId === slot.id
    return (
      <div
        key={slot.id}
        onClick={() => setSelectedClipId(slot.id)}
        onMouseDown={(e) => handleBrollSlotMouseDown(e, slot)}
        style={{
          position: 'absolute',
          left,
          width: Math.max(width, 4),
          top: 4,
          bottom: 4,
          background: isSelected ? 'rgba(110,231,197,0.15)' : 'rgba(255,255,255,0.03)',
          border: `1px dashed ${isSelected ? '#6ee7c5' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 6,
          cursor: onSequenceChange ? 'grab' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          opacity: isBeingDragged ? 0.5 : 1
        }}
      >
        <span style={{ fontSize: 10, color: isSelected ? '#6ee7c5' : '#a1a1aa', fontWeight: 600 }}>
          {slot.status === 'ready' ? 'B-ROLL READY' : 'B-ROLL SLOT'}
        </span>
      </div>
    )
  }

  const graphicsSlotGroups = useMemo(
    () => groupOverlappingGraphicsSlots(sequence.graphicsSlots ?? []),
    [sequence.graphicsSlots]
  )

  const graphicsSlotLabel = (slot: GraphicsSlot, compact = false): string => {
    const label =
      slot.kind === 'graph-image' ? 'GRAPHIC' : slot.kind === 'text-image' ? 'TEXT IMG' : 'MOTION'
    const suffix = slot.status === 'ready' ? ' READY' : ' SLOT'
    return compact ? label : `${label}${suffix}`
  }

  const renderGraphicsSlotGroup = (group: GraphicsSlot[]) => {
    const start = Math.min(...group.map((slot) => slot.timelineStart))
    const end = Math.max(...group.map((slot) => slot.timelineEnd))
    const left = start * pxPerSec
    const width = (end - start) * pxPerSec
    const isSelected = group.some((slot) => selectedClipId === slot.id)
    const stacked = group.length > 1
    const graphicsTrackIndex = sequence.videoTracks.findIndex((t) => t.id === 'v-graphics')
    const firstClip =
      graphicsTrackIndex >= 0
        ? sequence.videoTracks[graphicsTrackIndex]!.clips.find(
            (c) => (c.metadata as { graphicsSlotId?: string } | undefined)?.graphicsSlotId === group[0].id
          )
        : undefined
    const hasReadyClip = Boolean(firstClip && group.some((slot) => slot.status === 'ready'))
    return (
      <div
        key={group.map((slot) => slot.id).join(':')}
        onClick={() => setSelectedClipId(group[0].id)}
        onMouseDown={
          firstClip
            ? (e) => handleFreeMoveMouseDown(e, firstClip, graphicsTrackIndex)
            : group[0]
              ? (e) => handleGraphicsSlotDirectMouseDown(e, group[0]!)
              : undefined
        }
        style={{
          position: 'absolute',
          left,
          width: Math.max(width, 4),
          top: 4,
          bottom: 4,
          background: isSelected
            ? (hasReadyClip ? 'rgba(250,204,21,0.25)' : 'rgba(250,204,21,0.12)')
            : (hasReadyClip ? 'rgba(250,204,21,0.15)' : 'rgba(250,204,21,0.04)'),
          border: `1px solid ${isSelected ? 'rgba(250,204,21,0.65)' : 'rgba(250,204,21,0.3)'}`,
          borderRadius: 6,
          opacity: firstClip?.disabled ? 0.35 : 1,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: stacked ? 'column' : 'row',
          alignItems: stacked ? 'stretch' : 'center',
          justifyContent: stacked ? 'flex-start' : 'center',
          gap: stacked ? 1 : 0,
          padding: stacked ? '2px 4px' : 0,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        {stacked && (
          <span
            style={{
              alignSelf: 'flex-end',
              fontSize: 8,
              lineHeight: 1,
              fontWeight: 700,
              color: '#fde68a',
              background: 'rgba(0,0,0,0.35)',
              borderRadius: 999,
              padding: '1px 4px'
            }}
          >
            ×{group.length}
          </span>
        )}
        {group.map((slot) => (
          <span
            key={slot.id}
            onClick={(event) => {
              event.stopPropagation()
              setSelectedClipId(slot.id)
            }}
            style={{
              fontSize: stacked ? 8 : 10,
              lineHeight: 1.15,
              color: selectedClipId === slot.id ? '#fef08a' : '#facc15',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {graphicsSlotLabel(slot, stacked)}
          </span>
        ))}
      </div>
    )
  }

  /**
   * Choose a "nice" ruler tick interval (in seconds) so labels never
   * collide. Smaller pxPerSec → wider intervals.
   */
  const rulerStepSec = useMemo<number>(() => {
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const minLabelGapPx = 56
    for (const step of candidates) {
      if (step * pxPerSec >= minLabelGapPx) return step
    }
    return 600
  }, [pxPerSec])

  const fitZoom = (): void => {
    // Subtract 16px to give a small breathing margin on the right.
    const usable = Math.max(scrollAreaWidth - 16, 200)
    const ideal = usable / Math.max(totalDuration, 1)
    const clamped = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, ideal))
    setPxPerSec(clamped)
  }

  const stepZoom = (direction: 1 | -1): void => {
    setPxPerSec((current) => {
      const factor = direction === 1 ? 1.5 : 1 / 1.5
      return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, current * factor))
    })
  }

  return (
    <div
      ref={editorRef}
      tabIndex={-1}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 500,
        background: '#141416',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        outline: 'none'
      }}
    >
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: '#1c1c1f', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Move</span>
          <div style={{ display: 'flex', background: '#141416', borderRadius: 6, padding: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
            {(['Ripple', 'Free position'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setMoveMode(mode)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: moveMode === mode ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: moveMode === mode ? '#f4f4f5' : '#a1a1aa',
                  fontSize: 12,
                  fontWeight: moveMode === mode ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Pacing</span>
          <div style={{ display: 'flex', background: '#141416', borderRadius: 6, padding: 2, border: '1px solid rgba(255,255,255,0.06)' }}>
            {(['Tight', 'Balanced', 'Cinematic'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPacing(p)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: pacing === p ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: pacing === p ? '#f4f4f5' : '#a1a1aa',
                  fontSize: 12,
                  fontWeight: pacing === p ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Zoom</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => stepZoom(-1)}
              style={zoomButtonStyle}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Fit timeline to view"
              title="Fit timeline"
              onClick={fitZoom}
              style={{ ...zoomButtonStyle, padding: '4px 10px' }}
            >
              Fit
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => stepZoom(1)}
              style={zoomButtonStyle}
            >
              +
            </button>
          </div>
          <input
            type="range"
            min={MIN_PX_PER_SEC}
            max={MAX_PX_PER_SEC}
            step={1}
            value={Math.round(pxPerSec)}
            onChange={(e) => setPxPerSec(Number(e.target.value))}
            aria-label="Timeline zoom"
            style={{ width: 120, accentColor: '#6ee7c5' }}
          />
          <span style={{ fontSize: 11, color: '#a1a1aa', minWidth: 64 }}>
            {pxPerSec.toFixed(0)} px/s
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Transport</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              title="Play from playhead"
              aria-label="Play from playhead"
              onClick={onPlay}
              disabled={!canControlPlayback}
              style={{
                ...transportButtonStyle,
                opacity: canControlPlayback ? 1 : 0.45,
                cursor: canControlPlayback ? 'pointer' : 'not-allowed',
                background: playbackState === 'playing' ? 'rgba(110,231,197,0.12)' : 'transparent',
                borderColor: playbackState === 'playing' ? 'rgba(110,231,197,0.4)' : 'rgba(255,255,255,0.1)'
              }}
            >
              <TransportIcon kind="play" />
            </button>
            <button
              type="button"
              title="Pause"
              aria-label="Pause preview"
              onClick={onPause}
              disabled={!canControlPlayback}
              style={{
                ...transportButtonStyle,
                opacity: canControlPlayback ? 1 : 0.45,
                cursor: canControlPlayback ? 'pointer' : 'not-allowed',
                background: playbackState === 'paused' ? 'rgba(255,255,255,0.08)' : 'transparent'
              }}
            >
              <TransportIcon kind="pause" />
            </button>
            <button
              type="button"
              title="Stop"
              aria-label="Stop preview"
              onClick={onStop}
              disabled={!canControlPlayback}
              style={{
                ...transportButtonStyle,
                opacity: canControlPlayback ? 1 : 0.45,
                cursor: canControlPlayback ? 'pointer' : 'not-allowed',
                background: playbackState === 'stopped' ? 'rgba(255,255,255,0.08)' : 'transparent'
              }}
            >
              <TransportIcon kind="stop" />
            </button>
          </div>
          <span style={{ fontSize: 11, color: '#a1a1aa', minWidth: 56 }}>
            {clampPlayheadSeconds(playheadSeconds).toFixed(2)}s
          </span>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            title="Undo"
            aria-label="Undo timeline edit"
            onClick={onUndo}
            disabled={!canUndo}
            style={{ ...zoomButtonStyle, opacity: canUndo ? 1 : 0.45, cursor: canUndo ? 'pointer' : 'not-allowed' }}
          >
            Undo
          </button>
          <button
            type="button"
            title="Redo"
            aria-label="Redo timeline edit"
            onClick={onRedo}
            disabled={!canRedo}
            style={{ ...zoomButtonStyle, opacity: canRedo ? 1 : 0.45, cursor: canRedo ? 'pointer' : 'not-allowed' }}
          >
            Redo
          </button>
        </div>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <button
          type="button"
          title="Close gaps and butt-splice the current timeline order"
          onClick={() => {
            if (!onSequenceChange) return
            const next = closeTimelineGapsInSequence(sequence, 0)
            if (next !== sequence) onSequenceChange(next)
          }}
          style={{ ...zoomButtonStyle, width: 'auto', padding: '0 10px' }}
        >
          Close gaps
        </button>

        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)' }} />

        <button
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent',
            color: '#f4f4f5',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12H3M12 3v18" />
          </svg>
          Add Breathing Room
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Timeline Area */}
        <div
          ref={scrollAreaRef}
          onDragOver={handleAssetLibraryDragOver}
          onDrop={handleAssetLibraryDrop}
          onDragLeave={handleAssetLibraryDragLeave}
          style={{
            flex: 1,
            overflowX: 'auto',
            overflowY: 'auto',
            position: 'relative',
            background: assetDropActive ? 'rgba(99,102,241,0.08)' : '#141416',
            outline: assetDropActive ? '2px dashed rgba(129,140,248,0.55)' : 'none',
            outlineOffset: -2
          }}
        >
          <div style={{ width: timelineWidth + TRACK_LABEL_GUTTER_PX, minHeight: '100%', padding: '20px 0', position: 'relative' }}>
            {/* Time Ruler */}
            <div
              onMouseDown={handleTimelineSurfaceMouseDown}
              style={{
                position: 'absolute',
                top: 0,
                left: TRACK_LABEL_GUTTER_PX,
                right: 0,
                height: 20,
                borderBottom: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              {Array.from({ length: Math.ceil(totalDuration / rulerStepSec) + 1 }).map((_, i) => {
                const sec = i * rulerStepSec
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: sec * pxPerSec,
                      top: 0,
                      bottom: 0,
                      borderLeft: '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    <span style={{ position: 'absolute', left: 4, top: 4, fontSize: 10, color: '#a1a1aa' }}>
                      {formatRulerLabel(sec)}
                    </span>
                  </div>
                )
              })}
            </div>

            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 20,
                bottom: 0,
                left: TRACK_LABEL_GUTTER_PX + clampPlayheadSeconds(playheadSeconds) * pxPerSec,
                width: 2,
                background: '#6ee7c5',
                boxShadow: '0 0 8px rgba(110,231,197,0.6)',
                pointerEvents: 'none',
                zIndex: 20
              }}
            />

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Graphics Slots Track */}
              {sequence.graphicsSlots && sequence.graphicsSlots.length > 0 && (
                <div style={{ display: 'flex', height: 48, position: 'relative', background: 'rgba(250,204,21,0.04)' }}>
                  <div style={trackLabelStyle}>GRAPHICS</div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    {graphicsSlotGroups.map(renderGraphicsSlotGroup)}
                  </div>
                </div>
              )}

              {/* B-roll Slots Track */}
              {sequence.brollSlots && sequence.brollSlots.length > 0 && (
                <div style={{ display: 'flex', height: 48, position: 'relative', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={trackLabelStyle}>B-ROLL</div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    {sequence.brollSlots.map(renderBrollSlot)}
                  </div>
                </div>
              )}

              {/* Video Tracks — overlay rows (B-roll, graphics) above spine (A-roll) */}
              {displayVideoTracks.map(({ track, index: trackIndex }) => {
                if (track.id === 'v-broll' || track.id === 'v-graphics') return null
                const isSpine = trackIndex === spineTrackIndex
                const overlayLabel = overlayVideoTrackLabel(track.id)
                const spineRows = displayVideoTracks.filter((row) => !overlayVideoTrackLabel(row.track.id))
                const spineLabel = overlayLabel
                  ? overlayLabel
                  : `V${Math.max(1, spineRows.findIndex((row) => row.index === trackIndex) + 1)}`
                const insertPx =
                  isSpine && dragOverIndex != null ? indicatorPxForIndex(track.clips, dragOverIndex) : null
                return (
                  <div key={track.id} style={{ display: 'flex', height: 64, position: 'relative', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={trackLabelStyle}>{spineLabel}</div>
                    <div
                      ref={isSpine ? v1RowRef : undefined}
                      onMouseDown={handleTimelineSurfaceMouseDown}
                      onDragOver={isSpine && moveMode === 'Ripple' ? handleDragOverV1Row : undefined}
                      onDrop={isSpine && moveMode === 'Ripple' ? handleDropV1 : undefined}
                      onDragLeave={isSpine && moveMode === 'Ripple' ? () => setDragOverIndex(null) : undefined}
                      style={{ flex: 1, position: 'relative' }}
                    >
                      {track.clips.map((clip) => renderClip(clip, 'video', trackIndex))}
                      {insertPx != null && (
                        <div
                          aria-hidden
                          style={{
                            position: 'absolute',
                            left: insertPx - 1,
                            top: 0,
                            bottom: 0,
                            width: 3,
                            background: '#6ee7c5',
                            borderRadius: 2,
                            pointerEvents: 'none',
                            boxShadow: '0 0 8px rgba(110,231,197,0.6)'
                          }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Audio Tracks */}
              {sequence.audioTracks.map((track, i) => (
                <div key={track.id} style={{ display: 'flex', height: 48, position: 'relative', background: 'rgba(255,255,255,0.01)' }}>
                  <div style={trackLabelStyle}>A{i + 1}</div>
                  <div onMouseDown={handleTimelineSurfaceMouseDown} style={{ flex: 1, position: 'relative' }}>
                    {track.clips.map((clip) => renderClip(clip, 'audio'))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Inspector Sidebar */}
        <div style={{ width: 240, background: '#1c1c1f', borderLeft: '1px solid rgba(255,255,255,0.06)', padding: 16, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: 16 }}>
            Inspector
          </div>

          {selectedClip ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: '#141416', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>Selection</div>
                <div style={{ fontSize: 13, color: '#f4f4f5', wordBreak: 'break-all' }}>{selectedClip.id}</div>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {selectedClip.role}
                </div>
              </div>

              <div style={{ background: '#141416', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 8 }}>Timing</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <PropertyRow label="In" value={`${selectedClip.timelineInSeconds.toFixed(2)}s`} />
                  <PropertyRow label="Out" value={`${selectedClip.timelineOutSeconds.toFixed(2)}s`} />
                  <PropertyRow
                    label="Duration"
                    value={`${(selectedClip.timelineOutSeconds - selectedClip.timelineInSeconds).toFixed(2)}s`}
                    accent={Boolean(activeTrim && activeTrim.clipId === selectedClip.id)}
                  />
                  <PropertyRow
                    label="Source"
                    value={`${selectedClip.sourceInSeconds.toFixed(2)}s → ${selectedClip.sourceOutSeconds.toFixed(2)}s`}
                  />
                </div>
              </div>

              {isSelectedClipOnV1 && onSequenceChange && (
                <button
                  type="button"
                  onClick={deleteSelectedClip}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(248,113,113,0.4)',
                    background: 'rgba(248,113,113,0.1)',
                    color: '#fca5a5',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="Delete clip (Del / Backspace)"
                >
                  Delete clip
                </button>
              )}
              {selectedClip && onSequenceChange && (
                <button
                  type="button"
                  onClick={() => {
                    const videoTracks = sequence.videoTracks.map((track) => ({
                      ...track,
                      clips: track.clips.map((c) =>
                        c.id === selectedClip.id ? { ...c, disabled: !c.disabled } : c
                      )
                    }))
                    onSequenceChange({ ...sequence, videoTracks })
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${selectedClip.disabled ? 'rgba(110,231,197,0.4)' : 'rgba(161,161,170,0.3)'}`,
                    background: selectedClip.disabled ? 'rgba(110,231,197,0.1)' : 'transparent',
                    color: selectedClip.disabled ? '#6ee7c5' : '#a1a1aa',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {selectedClip.disabled ? 'Enable clip' : 'Disable clip'}
                </button>
              )}
              {isSelectedClipOnV1 && (
                <p style={{ color: '#71717a', fontSize: 11, margin: 0 }}>
                  Tip: drag to reorder · drag the teal handles to trim · press Del to remove.
                </p>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a1a1aa', fontSize: 13, textAlign: 'center', padding: 20 }}>
              Select a clip to view properties
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const trackLabelStyle: CSSProperties = {
  position: 'sticky',
  left: 0,
  width: TRACK_LABEL_GUTTER_PX,
  background: '#1c1c1f',
  borderRight: '1px solid rgba(255,255,255,0.06)',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  fontSize: 11,
  color: '#a1a1aa',
  fontWeight: 600
}

const zoomButtonStyle: CSSProperties = {
  width: 28,
  height: 24,
  padding: 0,
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent',
  color: '#f4f4f5',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
}

const transportButtonStyle: CSSProperties = {
  height: 24,
  minWidth: 32,
  padding: '0 8px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent',
  color: '#f4f4f5',
  fontSize: 12,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
}

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function groupOverlappingGraphicsSlots(slots: GraphicsSlot[]): GraphicsSlot[][] {
  if (slots.length === 0) return []
  const sorted = [...slots].sort(
    (a, b) => a.timelineStart - b.timelineStart || a.timelineEnd - b.timelineEnd
  )
  const groups: GraphicsSlot[][] = []
  let current = [sorted[0]]
  let groupEnd = sorted[0].timelineEnd

  for (let i = 1; i < sorted.length; i += 1) {
    const slot = sorted[i]
    if (slot.timelineStart < groupEnd - 0.001) {
      current.push(slot)
      groupEnd = Math.max(groupEnd, slot.timelineEnd)
      continue
    }
    groups.push(current)
    current = [slot]
    groupEnd = slot.timelineEnd
  }
  groups.push(current)
  return groups
}

function TransportIcon({ kind }: { kind: 'play' | 'pause' | 'stop' }) {
  if (kind === 'play') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 2.2L9.2 6 3 9.8V2.2Z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'pause') {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2.2" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
        <rect x="7.4" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="currentColor" />
    </svg>
  )
}

function PropertyRow({
  label,
  value,
  accent
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: '#a1a1aa' }}>{label}</span>
      <span style={{ color: accent ? '#6ee7c5' : '#f4f4f5', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

/**
 * Format a ruler tick label. Use plain seconds under a minute and
 * `M:SS` once we cross the one-minute mark, so wide-zoom timelines stay
 * readable.
 */
function formatRulerLabel(sec: number): string {
  if (sec < 60) {
    return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`
  }
  const m = Math.floor(sec / 60)
  const s = Math.round(sec - m * 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
