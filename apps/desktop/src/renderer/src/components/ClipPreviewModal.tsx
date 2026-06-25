import { useEffect, useRef, useState } from 'react'

export type ClipPreviewModalProps = {
  open: boolean
  /** Absolute file path to the source media (video/audio). */
  sourcePath: string | null
  /** Optional Supabase / HTTP signed URL fallback when no local path is set. */
  sourceUrl?: string | null
  /** Seconds — start of the clip window. */
  startTime: number
  /** Seconds — end of the clip window. */
  endTime: number
  /** Display label (clip name, soundbite text, etc). */
  title?: string
  /** Optional caption / transcript text shown under the player. */
  caption?: string
  onClose: () => void
}

/**
 * Lightweight clip-preview modal. Opens a `<video>` element pointed at the
 * project's primary media via the `storyteller-media://` protocol (which
 * supports HTTP-style Range requests so seeking works) and clamps playback
 * to `[startTime, endTime]`.
 *
 * Design notes:
 *   - We deliberately *don't* use `#t=start,end` URL fragments because not
 *     every container respects them; we enforce the window in JS instead.
 *   - We pause when the clip end is reached and snap back to `startTime`
 *     so the user can hit play again to re-watch.
 *   - We close on Escape and on backdrop click.
 *   - Uses software-decoded `<video>` (the Electron main process now boots
 *     with `disable-accelerated-video-decode`), which is the path that
 *     stopped crashing on this machine.
 */
export function ClipPreviewModal(props: ClipPreviewModalProps) {
  const { open, sourcePath, sourceUrl, startTime, endTime, title, caption, onClose } = props

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [playablePath, setPlayablePath] = useState<string | null>(null)
  const [proxyState, setProxyState] = useState<{
    phase: 'idle' | 'preparing' | 'ready' | 'failed'
    detail?: string
    outcome?: 'cache' | 'transcoded' | 'skipped'
  }>({ phase: 'idle' })

  const start = Math.max(0, Number.isFinite(startTime) ? startTime : 0)
  const end =
    Number.isFinite(endTime) && endTime > start ? endTime : Math.max(start + 0.5, start)
  const duration = Math.max(0, end - start)

  /** True iff we got real, non-degenerate timing from the caller. */
  const hasRealWindow =
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    endTime > startTime &&
    endTime - startTime >= 0.05

  /**
   * A clip that claims to be longer than ~3 minutes is almost certainly bad
   * data — the soundbite ranker caps real clips at 110 seconds. Most likely
   * it's an old row written by a pre-stitcher build and the project needs to
   * be re-analyzed.
   */
  const looksLikeWholeFile = hasRealWindow && endTime - startTime > 180

  /** Loaded media duration — used so we can compare the clip window vs the file. */
  const [mediaDurationSec, setMediaDurationSec] = useState<number | null>(null)
  /**
   * If the requested window covers >= 90% of the file, the soundbite has
   * effectively no window — same root cause as above (bad data).
   */
  const coversWholeFile =
    mediaDurationSec != null && hasRealWindow && (endTime - startTime) / mediaDurationSec > 0.9

  /**
   * Resolve a Chromium-friendly path. For local files we run the source
   * through `ensurePreviewProxy`, which returns the original path when the
   * codec is already H.264/VP9/AV1 + AAC/Opus/MP3, or a cached H.264 sidecar
   * when it isn't. Remote `sourceUrl` previews skip this step — we trust the
   * server to have served something playable.
   */
  useEffect(() => {
    if (!open) return
    if (!sourcePath) {
      setPlayablePath(null)
      setProxyState({ phase: 'idle' })
      return
    }
    let cancelled = false
    const ensure = window.storyteller?.ensurePreviewProxy
    if (!ensure) {
      setPlayablePath(sourcePath)
      setProxyState({ phase: 'ready', outcome: 'skipped' })
      return
    }
    setPlayablePath(null)
    setProxyState({ phase: 'preparing' })
    ensure(sourcePath)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setPlayablePath(res.playablePath)
          setProxyState({ phase: 'ready', outcome: res.outcome })
          console.log('[clip-preview] proxy ready', {
            sourcePath,
            playablePath: res.playablePath,
            outcome: res.outcome,
            usedSource: res.usedSource,
            durationMs: res.durationMs,
            sourceCodec: res.source
          })
        } else {
          setPlayablePath(sourcePath)
          setProxyState({ phase: 'failed', detail: res.error })
          console.warn('[clip-preview] proxy failed; trying source directly', {
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
        console.warn('[clip-preview] ensurePreviewProxy threw', sourcePath, e)
      })
    return () => {
      cancelled = true
    }
  }, [open, sourcePath])

  const src = (() => {
    if (playablePath && window.storyteller?.toMediaUrl) {
      return window.storyteller.toMediaUrl(playablePath)
    }
    if (sourceUrl) return sourceUrl
    return ''
  })()

  // Reset state whenever the source or window changes.
  useEffect(() => {
    if (!open) return
    setReady(false)
    if (proxyState.phase === 'preparing') {
      setError(null)
      return
    }
    setError(src ? null : sourcePath ? null : 'No playable source for this clip.')
  }, [open, src, start, end, proxyState.phase, sourcePath])

  /**
   * Seek + play loop.
   *
   * Important: we cannot rely on `loadedmetadata` firing — by the time React
   * attaches this listener, Chromium may already be past `HAVE_METADATA`
   * (`readyState >= 1`) and the event will never fire again. So we:
   *   1. Seek immediately if metadata is already there.
   *   2. Otherwise wait for `loadedmetadata`.
   *   3. Use `seeked` to confirm the seek actually landed before pressing
   *      play — `currentTime = X` is asynchronous and silently clamps if
   *      the byte range isn't seekable yet.
   *   4. Clamp end to `duration` once we know the media's real length so we
   *      don't sit waiting for `currentTime >= end` on a clip whose end is
   *      beyond the file.
   */
  useEffect(() => {
    if (!open) return
    const v = videoRef.current
    if (!v) return

    let cancelled = false
    let effectiveEnd = end

    const seekTo = (t: number) => {
      try {
        v.currentTime = Math.max(0, t)
      } catch (e) {
        setError(`Could not seek: ${(e as Error).message}`)
      }
    }

    const startPlayback = () => {
      if (cancelled) return
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
      effectiveEnd = Math.min(end, mediaDuration > 0 ? mediaDuration : end)
      seekTo(start)
    }

    const onSeeked = () => {
      if (cancelled) return
      /**
       * Containers with sparse keyframes (e.g. .mov from cameras, long-GOP
       * H.264) snap a seek to the nearest preceding keyframe, which can
       * land several seconds before `start`. As long as we landed somewhere
       * forward of byte 0 we treat the seek as successful — the
       * `timeupdate` loop will still pause at `effectiveEnd`, just with
       * a tiny pre-roll. That's preferable to "loops forever waiting for
       * a perfect seek that never lands."
       */
      if (v.currentTime > 0.05 || start <= 0.5) {
        setReady(true)
        startPlayback()
      }
    }

    const onTime = () => {
      if (cancelled) return
      if (v.currentTime >= effectiveEnd) {
        v.pause()
        seekTo(start)
      }
    }

    const onErr = () => {
      const code = v.error?.code ?? 0
      const message =
        code === 1
          ? 'Playback aborted.'
          : code === 2
            ? 'Network error while streaming the clip.'
            : code === 3
              ? 'Decoding error — the file may be corrupt or use an unsupported codec.'
              : code === 4
                ? 'This format is not supported by the bundled player. Try opening the file in Finder.'
                : 'Unknown playback error.'
      setError(message)
    }

    v.addEventListener('loadedmetadata', onLoadedMetadata)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('error', onErr)

    // If metadata is already ready by the time this effect runs, the
    // `loadedmetadata` event will never fire again — kick the seek manually.
    if (v.readyState >= 1 /* HAVE_METADATA */) {
      onLoadedMetadata()
    } else {
      // Some video sources need an explicit load() to start fetching headers.
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
  }, [open, src, start, end])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Preview: ${title}` : 'Clip preview'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(8,8,11,0.78)',
        backdropFilter: 'blur(6px)',
        display: 'grid',
        placeItems: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          width: 'min(960px, 92vw)',
          maxHeight: '90vh',
          background: '#15151a',
          color: '#f4f4f5',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: '#1c1c1f'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Clip preview
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 2
              }}
              title={title ?? undefined}
            >
              {title ?? 'Untitled clip'}
            </div>
            <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {start.toFixed(2)}s – {end.toFixed(2)}s · {duration.toFixed(2)}s
              {mediaDurationSec != null && (
                <span style={{ marginLeft: 6, color: '#71717a' }}>
                  (file is {mediaDurationSec.toFixed(2)}s)
                </span>
              )}
              {!hasRealWindow && (
                <span
                  style={{
                    marginLeft: 8,
                    color: '#fbbf24',
                    fontStyle: 'italic'
                  }}
                  title="This clip's start/end timestamps are missing or invalid — the player will fall back to the start of the file."
                >
                  · timing unavailable
                </span>
              )}
              {(looksLikeWholeFile || coversWholeFile) && (
                <span
                  style={{
                    marginLeft: 8,
                    color: '#fbbf24',
                    fontStyle: 'italic'
                  }}
                  title="The stored start/end span effectively the entire file. This usually means the soundbite was created by an older analysis run. Re-run Analyze on this project."
                >
                  · spans whole file — re-run Analyze
                </span>
              )}
              {proxyState.phase === 'preparing' && (
                <span
                  style={{ marginLeft: 8, color: '#a78bfa', fontStyle: 'italic' }}
                  title="Source codec isn't supported by Chromium — generating an H.264 sidecar."
                >
                  · generating proxy…
                </span>
              )}
              {proxyState.phase === 'ready' && proxyState.outcome === 'transcoded' && (
                <span style={{ marginLeft: 8, color: '#71717a' }} title="Playing transcoded H.264 proxy">
                  · proxy
                </span>
              )}
              {proxyState.phase === 'ready' && proxyState.outcome === 'cache' && (
                <span style={{ marginLeft: 8, color: '#71717a' }} title="Playing cached H.264 proxy">
                  · proxy (cached)
                </span>
              )}
              {proxyState.phase === 'failed' && (
                <span style={{ marginLeft: 8, color: '#fbbf24', fontStyle: 'italic' }}>
                  · proxy failed — using source
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{
              background: 'transparent',
              color: '#a1a1aa',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              padding: '8px 14px',
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            Close (Esc)
          </button>
        </header>

        <div style={{ background: '#000', display: 'grid', placeItems: 'center', minHeight: 280 }}>
          {src ? (
            <video
              ref={videoRef}
              src={src}
              controls
              preload="metadata"
              playsInline
              style={{
                width: '100%',
                maxHeight: 540,
                display: 'block',
                background: '#000'
              }}
            />
          ) : (
            <div style={{ padding: 40, color: '#a1a1aa', fontSize: 14, textAlign: 'center' }}>
              {sourcePath && proxyState.phase === 'preparing'
                ? 'Generating preview proxy…'
                : 'No playable source attached to this clip yet.'}
            </div>
          )}
        </div>

        {(error || caption) && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: '#fca5a5',
                  background: 'rgba(220,38,38,0.08)',
                  border: '1px solid rgba(220,38,38,0.25)',
                  padding: '8px 10px',
                  borderRadius: 8,
                  marginBottom: caption ? 10 : 0
                }}
              >
                {error}
              </div>
            )}
            {caption && (
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: '#e4e4e7',
                  fontStyle: 'italic'
                }}
              >
                "{caption}"
              </div>
            )}
            {!ready && !error && (
              <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 8 }}>Loading clip…</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
