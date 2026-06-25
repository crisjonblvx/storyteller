import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import {
  DEFAULT_FRAME_POSITION,
  framePositionToCss,
  normalizeFramePosition,
  type FramePosition
} from '@storyteller/timeline'

export type InlineClipPlayerProps = {
  /** Absolute file path to the source media. */
  sourcePath: string | null
  /** Seconds — start of the clip window. */
  startTime: number
  /** Seconds — end of the clip window. */
  endTime: number
  /** Display aspect ratio for the player frame. */
  aspectRatio?: '16 / 9' | '9 / 16' | string
  /** Auto-play on mount + when source/window changes (default true). */
  autoPlay?: boolean
  /** Force the video element muted (default follows autoPlay). */
  muted?: boolean
  /** Show native HTML5 video controls (default true). */
  controls?: boolean
  /** Optional max height in px so the player respects rail bounds. */
  maxHeight?: number
  /** Wrapper background color (default near-black). */
  background?: string
  /**
   * Fires with the video's current source-time (seconds, not sequence-time)
   * on every `timeupdate`, plus once on `seeked`. The parent is responsible
   * for converting source-time → sequence-time using the selected clip's
   * `timelineInSeconds`. We deliberately don't do that conversion here so
   * this component stays generic enough to be used anywhere a single clip
   * needs previewing.
   */
  onTimeUpdate?: (sourceSeconds: number) => void
  /** Optional external seek target inside the current clip window. */
  seekTime?: number
  /** Monotonic id that changes only for explicit external seek requests. */
  seekRequestId?: number
  /** Optional controlled transport state for custom play / pause / stop UI. */
  playbackState?: 'playing' | 'paused' | 'stopped'
  /** Whether the clip should loop back to its window start at the end. */
  loopOnEnd?: boolean
  /** Called when playback reaches the end of the current clip window. */
  onWindowEnd?: () => void
  /**
   * Render in front of the `<video>` element, scaled to the player frame.
   * Use this for the timeline overlay layer (text/hook/stat) so overlays
   * stay aligned with the video pixels even when the frame is letterboxed.
   */
  overlay?: ReactNode
  /**
   * Full-frame video composited above the base clip (e.g. B-roll over A-roll).
   * Transport stays locked to the main `<video>`.
   */
  coverVideo?: {
    sourcePath: string
    sourceInSeconds: number
  }
  /** How source video fits the frame (default `contain`). */
  objectFit?: 'contain' | 'cover'
  /** Cover crop anchor — 0–100 x/y (default center). */
  framePosition?: FramePosition
  /** When set with `objectFit: 'cover'`, enables drag-to-pan on the video surface. */
  onFramePositionChange?: (pos: FramePosition) => void
}

/**
 * Inline `<video>` for previewing a single clip window inside a panel
 * (e.g. the right-rail Live Preview on the Timeline step).
 *
 * Uses the `storyteller-media://` protocol so it can stream local files
 * with HTTP-style Range support — required for `<video>` to seek without
 * re-downloading. Seek + play discipline mirrors `ClipPreviewModal`:
 *   1. Seek immediately if `readyState >= HAVE_METADATA`, otherwise wait
 *      for the `loadedmetadata` event.
 *   2. Use `seeked` to confirm the seek landed before pressing play.
 *   3. Loop on `timeupdate` once we pass `endTime`.
 *
 * The looser-than-default seek tolerance (`> 0.05 || start <= 0.5`) is
 * intentional — long-GOP H.264 / .mov containers snap to the nearest
 * preceding keyframe, which can land seconds before `start`. We accept
 * that pre-roll rather than waiting for an exact match that never lands.
 */
export function InlineClipPlayer(props: InlineClipPlayerProps) {
  const {
    sourcePath,
    startTime,
    endTime,
    aspectRatio = '16 / 9',
    autoPlay = true,
    muted: mutedProp,
    controls = true,
    maxHeight,
    background = '#000',
    onTimeUpdate,
    seekTime,
    seekRequestId = 0,
    playbackState,
    loopOnEnd = true,
    onWindowEnd,
    overlay,
    coverVideo,
    objectFit = 'contain',
    framePosition,
    onFramePositionChange
  } = props

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const coverVideoRef = useRef<HTMLVideoElement | null>(null)
  const coverSourcePathRef = useRef<string | null>(null)
  const coverSourceInRef = useRef(0)
  const coverMainAnchorRef = useRef(0)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const panDragRef = useRef<{
    startX: number
    startY: number
    origin: FramePosition
    frameW: number
    frameH: number
  } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const desiredSeekRef = useRef(0)
  const playbackStateRef = useRef(playbackState)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [mediaDurationSec, setMediaDurationSec] = useState<number | null>(null)
  const [codecInfo, setCodecInfo] = useState<{
    video: string | null
    audio: string | null
  } | null>(null)
  const [playablePath, setPlayablePath] = useState<string | null>(null)
  const [coverPlayablePath, setCoverPlayablePath] = useState<string | null>(null)
  const [proxyState, setProxyState] = useState<{
    phase: 'idle' | 'preparing' | 'ready' | 'failed'
    detail?: string
    code?: string
    outcome?: 'cache' | 'transcoded' | 'skipped'
  }>({ phase: 'idle' })

  const start = Math.max(0, Number.isFinite(startTime) ? startTime : 0)
  const end = useMemo(
    () => (Number.isFinite(endTime) && endTime > start ? endTime : Math.max(start + 0.5, start)),
    [endTime, start]
  )
  const duration = Math.max(0, end - start)

  // Refs so the playback effect can read the latest start/end without
  // being torn down and rebuilt every time they change (e.g. during trim drag).
  const startRef = useRef(start)
  const endRef = useRef(end)
  // Media-duration-clamped end updated on loadedmetadata and when end changes.
  const effectiveEndRef = useRef(end)
  const videoMuted = mutedProp ?? autoPlay
  const desiredSeek = useMemo(() => {
    const raw = Number.isFinite(seekTime) ? (seekTime as number) : start
    return Math.min(Math.max(raw, start), Math.max(start, end - 0.01))
  }, [seekTime, start, end])
  useEffect(() => {
    desiredSeekRef.current = desiredSeek
  }, [desiredSeek])
  useEffect(() => {
    playbackStateRef.current = playbackState
  }, [playbackState])

  // Keep start/end refs in sync. Also recalculate effectiveEndRef so the
  // timeupdate boundary check is always correct without re-running the main
  // playback effect (which would pause and re-seek the video).
  useEffect(() => {
    startRef.current = start
    endRef.current = end
    const v = videoRef.current
    const mediaDuration =
      v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity
    effectiveEndRef.current = Math.min(end, Number.isFinite(mediaDuration) ? mediaDuration : end)
  }, [start, end])

  const hasRealWindow =
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    endTime > startTime &&
    endTime - startTime >= 0.05

  /**
   * Resolve the path Chromium can actually decode. Most podcast/video
   * exports are H.264 and we'll get the original back unchanged; HEVC,
   * ProRes, DNxHR, and friends get a one-time transcode into a small
   * H.264/AAC `.mp4` cached in `userData/preview-proxies/`. The IPC is
   * idempotent and concurrent-safe — calling it from both this component
   * and the modal at the same time will resolve to the same proxy.
   */
  useEffect(() => {
    if (!sourcePath) {
      setPlayablePath(null)
      setProxyState({ phase: 'idle' })
      setCodecInfo(null)
      return
    }
    let cancelled = false
    const ensure = window.storyteller?.ensurePreviewProxy
    if (!ensure) {
      // No proxy IPC available — fall back to playing the source directly.
      setPlayablePath(sourcePath)
      setProxyState({ phase: 'ready', outcome: 'skipped' })
      return
    }
    setProxyState({ phase: 'preparing' })
    setPlayablePath(null)
    ensure(sourcePath)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setPlayablePath(res.playablePath)
          setProxyState({ phase: 'ready', outcome: res.outcome })
          setCodecInfo({
            video: res.source.codecVideo,
            audio: res.source.codecAudio
          })
          console.log('[live-preview] proxy ready', {
            sourcePath,
            playablePath: res.playablePath,
            outcome: res.outcome,
            usedSource: res.usedSource,
            durationMs: res.durationMs,
            sourceCodec: res.source
          })
        } else {
          // Proxy failed — try the original anyway and let `<video>` decide.
          setPlayablePath(sourcePath)
          setProxyState({ phase: 'failed', detail: res.error, code: res.code })
          console.warn('[live-preview] proxy failed; trying source directly', {
            sourcePath,
            code: res.code,
            error: res.error
          })
        }
      })
      .catch((e) => {
        if (cancelled) return
        setPlayablePath(sourcePath)
        setProxyState({ phase: 'failed', detail: (e as Error).message })
        console.warn('[live-preview] ensurePreviewProxy threw', sourcePath, e)
      })
    return () => {
      cancelled = true
    }
  }, [sourcePath])

  const src = useMemo(() => {
    if (playablePath && window.storyteller?.toMediaUrl) {
      return window.storyteller.toMediaUrl(playablePath)
    }
    return ''
  }, [playablePath])

  const coverSourcePath = coverVideo?.sourcePath?.trim() ?? null

  useEffect(() => {
    coverSourcePathRef.current = coverSourcePath
    coverSourceInRef.current = coverVideo?.sourceInSeconds ?? 0
    coverMainAnchorRef.current = videoRef.current?.currentTime ?? desiredSeekRef.current
  }, [coverSourcePath, coverVideo?.sourceInSeconds, seekRequestId])

  useEffect(() => {
    if (!coverSourcePath) {
      setCoverPlayablePath(null)
      return
    }
    let cancelled = false
    const ensure = window.storyteller?.ensurePreviewProxy
    if (!ensure) {
      setCoverPlayablePath(coverSourcePath)
      return
    }
    setCoverPlayablePath(null)
    ensure(coverSourcePath)
      .then((res) => {
        if (cancelled) return
        setCoverPlayablePath(res.ok ? res.playablePath : coverSourcePath)
      })
      .catch(() => {
        if (cancelled) return
        setCoverPlayablePath(coverSourcePath)
      })
    return () => {
      cancelled = true
    }
  }, [coverSourcePath])

  const coverSrc = useMemo(() => {
    if (coverPlayablePath && window.storyteller?.toMediaUrl) {
      return window.storyteller.toMediaUrl(coverPlayablePath)
    }
    return ''
  }, [coverPlayablePath])

  useEffect(() => {
    setReady(false)
    if (proxyState.phase === 'preparing') {
      setError(null)
      return
    }
    setError(src ? null : sourcePath ? null : 'No playable source for this clip.')
  }, [src, proxyState.phase, sourcePath])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return

    let cancelled = false
    let notifiedWindowEnd = false

    const shouldPlay = () =>
      playbackStateRef.current !== undefined
        ? playbackStateRef.current === 'playing'
        : autoPlay

    const seekTo = (t: number) => {
      try {
        v.currentTime = Math.max(0, t)
      } catch (e) {
        setError(`Could not seek: ${(e as Error).message}`)
      }
    }

    const startPlayback = () => {
      if (cancelled || !shouldPlay()) return
      void v.play().catch(() => {
        /* autoplay may be blocked; controls are visible so the user can press play */
      })
    }

    const onLoadedMetadata = () => {
      if (cancelled) return
      const mediaDuration = Number.isFinite(v.duration) ? v.duration : Infinity
      if (mediaDuration > 0 && Number.isFinite(mediaDuration)) {
        setMediaDurationSec(mediaDuration)
      }
      // Update effectiveEndRef with media-duration clamp so onTime uses the
      // correct boundary without needing to re-run this effect.
      effectiveEndRef.current = Math.min(
        endRef.current,
        mediaDuration > 0 && Number.isFinite(mediaDuration) ? mediaDuration : endRef.current
      )
      const target = desiredSeekRef.current
      if (Math.abs(v.currentTime - target) < 0.12) {
        setReady(true)
        if (onTimeUpdate) onTimeUpdate(v.currentTime)
        if (shouldPlay()) startPlayback()
        return
      }
      seekTo(target)
      if (onTimeUpdate) onTimeUpdate(v.currentTime)
    }

    const onSeeked = () => {
      if (cancelled) return
      // startRef.current avoids closing over the `start` value at effect-creation
      // time, so trim-drag changes to the in-point don't stale this check.
      if (v.currentTime > 0.05 || startRef.current <= 0.5) {
        setReady(true)
        if (shouldPlay()) startPlayback()
      }
      if (onTimeUpdate) onTimeUpdate(v.currentTime)
    }

    const onTime = () => {
      if (cancelled) return
      if (onTimeUpdate) onTimeUpdate(v.currentTime)
      // effectiveEndRef is kept current by the start/end ref-sync effect so
      // we read the latest trim boundary on every tick without re-running this
      // effect (which would pause and re-seek the video).
      if (v.currentTime >= effectiveEndRef.current) {
        if (!loopOnEnd) {
          v.pause()
          if (!notifiedWindowEnd) {
            notifiedWindowEnd = true
            onWindowEnd?.()
          }
          return
        }
        v.pause()
        seekTo(startRef.current)
      }
    }

    const onErr = () => {
      const code = v.error?.code ?? 0
      let message: string
      if (code === 1) message = 'Playback aborted.'
      else if (code === 2) message = 'Network error while streaming the clip.'
      else if (code === 3)
        message = 'Decoding error — file may be corrupt or use an unsupported codec.'
      else if (code === 4) {
        const hints: string[] = []
        if (codecInfo?.video) hints.push(`video: ${codecInfo.video}`)
        if (codecInfo?.audio) hints.push(`audio: ${codecInfo.audio}`)
        const detail = hints.length > 0 ? ` (${hints.join(', ')})` : ''
        message = `This format isn't supported by the bundled player${detail}. Chromium ships H.264/VP9/AV1 only — HEVC, ProRes, and DNxHR need a transcode.`
      } else message = 'Unknown playback error.'
      setError(message)
      console.warn('[live-preview] HTMLVideoElement error', {
        code,
        sourcePath,
        codecVideo: codecInfo?.video,
        codecAudio: codecInfo?.audio
      })
    }

    v.addEventListener('loadedmetadata', onLoadedMetadata)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('error', onErr)

    if (v.readyState >= 1 /* HAVE_METADATA */) {
      onLoadedMetadata()
    } else {
      try {
        v.load()
      } catch {
        /* no-op */
      }
    }

    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onLoadedMetadata)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('error', onErr)
      try {
        v.pause()
      } catch {
        /* no-op */
      }
    }
    // `start` and `end` are intentionally excluded — the ref-sync effect keeps
    // startRef/endRef/effectiveEndRef current so this effect never needs to
    // restart just because the trim window changed.
  }, [src, autoPlay, codecInfo, sourcePath, onTimeUpdate, loopOnEnd, onWindowEnd])

  useEffect(() => {
    const main = videoRef.current
    const cover = coverVideoRef.current
    if (!main || !cover || !coverSrc) return

    let cancelled = false
    let rafId = 0
    let rVfcHandle = 0

    const shouldPlay = () =>
      playbackStateRef.current !== undefined
        ? playbackStateRef.current === 'playing'
        : autoPlay

    const syncCover = () => {
      if (cancelled) return
      const mainTime = main.currentTime
      const target = coverSourceInRef.current + (mainTime - coverMainAnchorRef.current)
      const drift = cover.currentTime - target
      const absDrift = Math.abs(drift)

      if (absDrift > 0.35) {
        try {
          cover.currentTime = target
        } catch {
          /* seek may fail before metadata */
        }
      } else if (absDrift > 0.08 && main.paused) {
        try {
          cover.currentTime = target
        } catch {
          /* no-op */
        }
      }

      if (shouldPlay() && cover.paused && !main.paused) {
        void cover.play().catch(() => undefined)
      } else if (!shouldPlay() && !cover.paused) {
        cover.pause()
      }
    }

    const onCoverLoaded = () => {
      syncCover()
    }

    const schedule = () => {
      if (cancelled) return
      if ('requestVideoFrameCallback' in main) {
        rVfcHandle = (
          main as HTMLVideoElement & {
            requestVideoFrameCallback: (cb: () => void) => number
          }
        ).requestVideoFrameCallback(() => {
          syncCover()
          schedule()
        })
        return
      }
      rafId = requestAnimationFrame(() => {
        syncCover()
        schedule()
      })
    }

    cover.addEventListener('loadedmetadata', onCoverLoaded)
    if (cover.readyState >= 1) onCoverLoaded()
    schedule()

    return () => {
      cancelled = true
      cover.removeEventListener('loadedmetadata', onCoverLoaded)
      if (rafId) cancelAnimationFrame(rafId)
      if (rVfcHandle && 'cancelVideoFrameCallback' in main) {
        ;(
          main as HTMLVideoElement & {
            cancelVideoFrameCallback: (handle: number) => void
          }
        ).cancelVideoFrameCallback(rVfcHandle)
      }
    }
  }, [coverSrc, autoPlay, seekRequestId])

  useEffect(() => {
    const v = videoRef.current
    if (!v || !src) return
    const target = desiredSeekRef.current
    if (Math.abs(v.currentTime - target) < 0.12) {
      if (playbackStateRef.current === 'playing') {
        void v.play().catch(() => {
          /* user can retry via controls */
        })
      }
      return
    }
    try {
      v.currentTime = target
    } catch {
      /* no-op */
    }
  }, [seekRequestId, src])

  useEffect(() => {
    if (playbackState === undefined) return
    const v = videoRef.current
    if (!v || !src) return
    if (playbackState === 'playing') {
      void v.play().catch(() => {
        /* user can retry via controls */
      })
      return
    }
    v.pause()
    if (playbackState === 'stopped') {
      const target = desiredSeekRef.current
      if (Math.abs(v.currentTime - target) >= 0.12) {
        try {
          v.currentTime = target
        } catch {
          /* no-op */
        }
      }
    }
  }, [playbackState, src])

  const errorButtonStyle: CSSProperties = {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(252,165,165,0.4)',
    background: 'rgba(220,38,38,0.12)',
    color: '#fecaca',
    cursor: 'pointer'
  }

  const resolvedFramePosition = useMemo(
    () => normalizeFramePosition(framePosition ?? DEFAULT_FRAME_POSITION),
    [framePosition]
  )
  const canPanFrame =
    objectFit === 'cover' && Boolean(onFramePositionChange) && Boolean(src)

  const handlePanPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!canPanFrame || !onFramePositionChange) return
      const frame = frameRef.current
      if (!frame) return
      const rect = frame.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origin: resolvedFramePosition,
        frameW: rect.width,
        frameH: rect.height
      }
      setIsPanning(true)
    },
    [canPanFrame, onFramePositionChange, resolvedFramePosition]
  )

  const handlePanPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = panDragRef.current
      if (!drag || !onFramePositionChange) return
      const dxPct = ((e.clientX - drag.startX) / drag.frameW) * 100
      const dyPct = ((e.clientY - drag.startY) / drag.frameH) * 100
      onFramePositionChange(
        normalizeFramePosition({
          x: drag.origin.x - dxPct,
          y: drag.origin.y - dyPct
        })
      )
    },
    [onFramePositionChange]
  )

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current) return
    panDragRef.current = null
    setIsPanning(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* no-op */
    }
  }, [])

  const frameStyle: CSSProperties = {
    width: '100%',
    aspectRatio,
    maxHeight,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    background,
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    position: 'relative'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={frameRef} style={frameStyle}>
        {src ? (
          <>
            <video
              ref={videoRef}
              src={src}
              controls={controls}
              preload="metadata"
              playsInline
              muted={videoMuted}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit,
                objectPosition: framePositionToCss(resolvedFramePosition),
                background: '#000'
              }}
            />
            {coverSrc && coverSourcePath && (
              <video
                ref={coverVideoRef}
                src={coverSrc}
                preload="metadata"
                playsInline
                muted
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  background: 'transparent'
                }}
              />
            )}
            {canPanFrame && (
              <div
                onPointerDown={handlePanPointerDown}
                onPointerMove={handlePanPointerMove}
                onPointerUp={endPan}
                onPointerCancel={endPan}
                title="Drag to reframe"
                style={{
                  position: 'absolute',
                  inset: '0 0 48px 0',
                  cursor: isPanning ? 'grabbing' : 'grab',
                  touchAction: 'none'
                }}
              />
            )}
            {overlay && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  /**
                   * `pointerEvents: 'none'` lets the user still scrub the
                   * video controls under the overlay layer. Individual
                   * overlays opt-in to clicks if they need them.
                   */
                  pointerEvents: 'none',
                  display: 'grid',
                  /**
                   * Position-driven layout — overlay children declare their
                   * desired corner via grid-area, so we don't have to
                   * thread CSS positioning through every chart/text component.
                   */
                  gridTemplateRows: '1fr 1fr 1fr',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  padding: '6%',
                  boxSizing: 'border-box'
                }}
              >
                {overlay}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#a1a1aa',
              fontSize: 13,
              textAlign: 'center',
              padding: 16
            }}
          >
            {sourcePath && proxyState.phase === 'preparing'
              ? 'Generating preview proxy…'
              : 'No clip selected.'}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          color: '#a1a1aa',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center'
        }}
      >
        <span>
          {start.toFixed(2)}s – {end.toFixed(2)}s · {duration.toFixed(2)}s
        </span>
        {mediaDurationSec != null && (
          <span style={{ color: '#71717a' }}>(file is {mediaDurationSec.toFixed(2)}s)</span>
        )}
        {!hasRealWindow && (
          <span style={{ color: '#fbbf24', fontStyle: 'italic' }}>· timing unavailable</span>
        )}
        {proxyState.phase === 'preparing' && (
          <span style={{ color: '#a78bfa', fontStyle: 'italic' }}>· generating proxy…</span>
        )}
        {proxyState.phase === 'ready' && proxyState.outcome === 'transcoded' && (
          <span style={{ color: '#71717a' }}>· proxy</span>
        )}
        {proxyState.phase === 'ready' && proxyState.outcome === 'cache' && (
          <span style={{ color: '#71717a' }}>· proxy (cached)</span>
        )}
        {!ready && !error && src && proxyState.phase !== 'preparing' && (
          <span style={{ color: '#71717a' }}>· loading…</span>
        )}
      </div>
      {(error || proxyState.phase === 'failed') && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: '#fca5a5',
            background: 'rgba(220,38,38,0.08)',
            border: '1px solid rgba(220,38,38,0.25)',
            padding: '8px 10px',
            borderRadius: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {proxyState.phase === 'failed' && proxyState.code === 'SOURCE_MISSING' && (
            <>
              <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                The source file isn't on disk where the project remembers it.
              </span>
              {sourcePath && (
                <code
                  style={{
                    fontSize: 11,
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fde68a',
                    padding: '4px 6px',
                    borderRadius: 4,
                    wordBreak: 'break-all'
                  }}
                >
                  {sourcePath}
                </code>
              )}
              <span style={{ color: '#a1a1aa' }}>
                It was probably moved, renamed, or never copied to this machine. Re-import the
                original to relink it.
              </span>
            </>
          )}
          {proxyState.phase === 'failed' && proxyState.code !== 'SOURCE_MISSING' && (
            <span style={{ color: '#fbbf24' }}>
              Proxy generation failed: {proxyState.detail ?? 'unknown error'}. Trying source
              directly.
            </span>
          )}
          {error && proxyState.code !== 'SOURCE_MISSING' && <span>{error}</span>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sourcePath && window.storyteller?.openPath && (
              <button
                type="button"
                onClick={() => {
                  window.storyteller!.openPath!(sourcePath).catch((e) =>
                    console.warn('[live-preview] openPath failed', e)
                  )
                }}
                style={errorButtonStyle}
              >
                Open in default player
              </button>
            )}
            {sourcePath && window.storyteller?.revealInFolder && (
              <button
                type="button"
                onClick={() => {
                  window.storyteller!.revealInFolder!(sourcePath).catch((e) =>
                    console.warn('[live-preview] revealInFolder failed', e)
                  )
                }}
                style={errorButtonStyle}
              >
                Reveal in Finder
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
