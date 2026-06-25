import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'
import type { GraphicsSlot, OverlayEvent } from '@storyteller/timeline'
import { ChartRenderer } from './ChartRenderer.js'

/**
 * CSS keyframe animations for KineticTextCard, injected once into the document.
 * Animations are purely CSS — no external library.
 */
const KINETIC_KEYFRAMES = `
@keyframes kinetic-slam {
  0%   { transform: translateY(120%) scaleY(1.4); opacity: 0; }
  55%  { transform: translateY(-8%) scaleY(0.92); opacity: 1; }
  72%  { transform: translateY(4%) scaleY(1.04); opacity: 1; }
  85%  { transform: translateY(-2%) scaleY(0.98); opacity: 1; }
  100% { transform: translateY(0) scaleY(1); opacity: 1; }
}
@keyframes kinetic-slam-exit {
  0%   { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(-110%); opacity: 0; }
}
@keyframes kinetic-scroll-up {
  0%   { transform: translateY(60px); opacity: 0; }
  12%  { transform: translateY(0); opacity: 1; }
  78%  { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(-80px); opacity: 0; }
}
@keyframes kinetic-cascade-word {
  0%   { transform: translateX(-18px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}
@keyframes kinetic-fade-scale {
  0%   { transform: scale(0.55); opacity: 0; }
  60%  { transform: scale(1.04); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes kinetic-tumble {
  0%   { transform: rotate(-22deg) translateY(30px); opacity: 0; }
  60%  { transform: rotate(4deg) translateY(-4px); opacity: 1; }
  80%  { transform: rotate(-2deg) translateY(2px); opacity: 1; }
  100% { transform: rotate(0deg) translateY(0); opacity: 1; }
}
`

function ensureKineticStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('kinetic-text-keyframes')) return
  const style = document.createElement('style')
  style.id = 'kinetic-text-keyframes'
  style.textContent = KINETIC_KEYFRAMES
  document.head.appendChild(style)
}

/**
 * Animation style for the KineticTextCard.
 * - slam       : words slam in from below with elastic ease, hold, exit up
 * - scroll-up  : text scrolls upward continuously (fast credits)
 * - cascade    : each word appears sequentially left to right
 * - fade-scale : text scales from small to large while fading in
 * - tumble     : letters rotate in from different angles
 */
export type KineticAnimation = 'slam' | 'scroll-up' | 'cascade' | 'fade-scale' | 'tumble'

/**
 * OverlayLayer — turns a list of `OverlayEvent`s currently visible at the
 * playhead into the actual stack of cards/text/chart elements over the
 * `<video>`. The parent controls visibility (which events are "active");
 * this component's job is purely render + layout.
 *
 * Why a 3×3 grid?
 *   It maps cleanly onto the five `position` values we expose in the
 *   schema (`top`, `middle`, `bottom-left`, `bottom`, `bottom-right`)
 *   without the overlay layer needing absolute pixel math. Inherited
 *   from the parent's gridTemplate in InlineClipPlayer; we just declare
 *   `gridArea` per overlay.
 *
 *   Five positions covers ~95% of real overlay placement (bottom thirds,
 *   center stat reveals, top-of-screen hooks). If we need quadrants the
 *   user can already drag freely we'll switch to a draggable absolute
 *   positioning model later.
 */
export interface OverlayLayerProps {
  events: OverlayEvent[]
  graphics?: Array<{
    slot: GraphicsSlot
    mediaUrl?: string
    mediaKind?: 'image' | 'video' | 'kinetic-text'
    kineticAnimation?: KineticAnimation
  }>
  /** When set, motion overlay videos follow parent transport instead of free-running. */
  isPlaying?: boolean
  /** Main preview source time (seconds) used to sync looped overlay videos. */
  mediaTime?: number
}

export function OverlayLayer(props: OverlayLayerProps) {
  const { events, graphics = [], isPlaying, mediaTime } = props
  if (events.length === 0 && graphics.length === 0) return null
  return (
    <>
      {events.map((event) => (
        <OverlayCard key={event.id} event={event} />
      ))}
      {graphics.map(({ slot, mediaUrl, mediaKind, kineticAnimation }) => (
        <GraphicsOverlayCard
          key={`gfx-${slot.id}`}
          slot={slot}
          mediaUrl={mediaUrl}
          mediaKind={mediaKind}
          kineticAnimation={kineticAnimation}
          isPlaying={isPlaying}
          mediaTime={mediaTime}
        />
      ))}
    </>
  )
}

function OverlayCard({ event }: { event: OverlayEvent }) {
  /**
   * Map the schema position → grid coordinates inside the parent's
   * 3×3 grid. `gridArea` is `row-start / col-start / row-end / col-end`.
   * `justifySelf` + `alignSelf` keep cards from stretching to fill the
   * full cell — they hug their content instead.
   */
  const place = positionToGridArea(event.position ?? 'bottom')

  const wrapperStyle: CSSProperties = {
    gridArea: place.area,
    justifySelf: place.justify,
    alignSelf: place.align,
    pointerEvents: 'none',
    /**
     * Subtle entry animation — overlays fade-in + rise instead of just
     * popping. The entrance is intentionally cheap; the chart entrance
     * is its own thing inside ChartRenderer.
     */
    animation: 'overlay-enter 380ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    maxWidth: '90%'
  }

  switch (event.kind) {
    case 'text':
      return (
        <div style={wrapperStyle}>
          <TextOverlayCard content={event.content} subtitle={event.subtitle} />
        </div>
      )
    case 'hook':
      return (
        <div style={wrapperStyle}>
          <HookOverlayCard content={event.content} subtitle={event.subtitle} />
        </div>
      )
    case 'stat':
      return (
        <div style={wrapperStyle}>
          {event.stat ? (
            <ChartRenderer payload={event.stat} resetKey={event.id} />
          ) : (
            /**
             * Defensive fallback. The author should never hit this — the Add
             * Stat panel guards against missing payloads — but if a sequence
             * JSON is hand-edited or imported from a tool that didn't supply
             * the stat block, we render the plain text rather than crash.
             */
            <TextOverlayCard content={event.content} subtitle={event.subtitle} />
          )}
        </div>
      )
    default:
      return <span />
  }
}

function GraphicsOverlayCard({
  slot,
  mediaUrl,
  mediaKind,
  kineticAnimation,
  isPlaying,
  mediaTime
}: {
  slot: GraphicsSlot
  mediaUrl?: string
  mediaKind?: 'image' | 'video' | 'kinetic-text'
  kineticAnimation?: KineticAnimation
  isPlaying?: boolean
  mediaTime?: number
}) {
  if (mediaKind === 'kinetic-text') {
    const displayText = slot.promptText ?? slot.id
    const place = positionToGridArea(
      ((slot.metadata as { position?: string } | undefined)?.position as 'top' | 'middle' | 'bottom') ?? 'middle'
    )
    const wrapperStyle: CSSProperties = {
      gridArea: place.area,
      justifySelf: place.justify,
      alignSelf: place.align,
      pointerEvents: 'none'
    }
    return (
      <div style={wrapperStyle}>
        <KineticTextCard text={displayText} animation={kineticAnimation ?? 'slam'} />
      </div>
    )
  }

  const place = positionToGridArea('middle')
  const wrapperStyle: CSSProperties = {
    gridArea: place.area,
    justifySelf: place.justify,
    alignSelf: place.align,
    pointerEvents: 'none',
    animation: 'overlay-enter 380ms cubic-bezier(0.2, 0.8, 0.2, 1)',
    maxWidth: '92%'
  }

  const fallbackLabel =
    slot.kind === 'graph-image'
      ? 'Graph Overlay'
      : slot.kind === 'text-image'
        ? 'Text Image Overlay'
        : 'Motion Overlay'

  return (
    <div style={wrapperStyle}>
      {mediaUrl ? (
        mediaKind === 'video' ? (
          <SyncedOverlayVideo src={mediaUrl} isPlaying={isPlaying} mediaTime={mediaTime} />
        ) : (
          <img
            src={mediaUrl}
            alt={fallbackLabel}
            style={{
              maxWidth: '100%',
              maxHeight: '42vh',
              objectFit: 'contain',
              borderRadius: 10,
              border: '1px solid rgba(250,204,21,0.35)',
              boxShadow: '0 14px 28px rgba(0,0,0,0.45)',
              background: 'rgba(0,0,0,0.45)'
            }}
          />
        )
      ) : (
        <TextOverlayCard content={fallbackLabel} subtitle={slot.promptText?.slice(0, 84)} />
      )}
    </div>
  )
}

/**
 * KineticTextCard — fully transparent (no backdrop), composited directly over
 * video. Uses CSS @keyframes injected once into the document head.
 * Supports multiple animation styles via the `animation` prop.
 */
function KineticTextCard({ text, animation }: { text: string; animation: KineticAnimation }) {
  useEffect(() => {
    ensureKineticStyles()
  }, [])

  const words = text.split(/\s+/).filter(Boolean)

  const baseTextStyle: CSSProperties = {
    fontFamily: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
    fontSize: 'clamp(22px, 5.5vw, 52px)',
    fontWeight: 900,
    lineHeight: 1.1,
    color: '#ffffff',
    textShadow:
      '0 4px 20px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6)',
    letterSpacing: '-0.01em',
    textAlign: 'center'
  }

  switch (animation) {
    case 'slam': {
      return (
        <div
          style={{
            ...baseTextStyle,
            animation: 'kinetic-slam 480ms cubic-bezier(0.17, 0.89, 0.32, 1.28) forwards',
            padding: '0 16px'
          }}
        >
          {text}
        </div>
      )
    }

    case 'scroll-up': {
      return (
        <div
          style={{
            ...baseTextStyle,
            animation: 'kinetic-scroll-up 3.5s ease-in-out forwards',
            padding: '0 16px'
          }}
        >
          {text}
        </div>
      )
    }

    case 'cascade': {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25em', justifyContent: 'center', padding: '0 16px' }}>
          {words.map((word, i) => (
            <span
              key={i}
              style={{
                ...baseTextStyle,
                display: 'inline-block',
                animation: `kinetic-cascade-word 300ms ease-out ${i * 80}ms both`
              }}
            >
              {word}
            </span>
          ))}
        </div>
      )
    }

    case 'fade-scale': {
      return (
        <div
          style={{
            ...baseTextStyle,
            animation: 'kinetic-fade-scale 600ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
            padding: '0 16px'
          }}
        >
          {text}
        </div>
      )
    }

    case 'tumble': {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25em', justifyContent: 'center', padding: '0 16px' }}>
          {words.map((word, i) => (
            <span
              key={i}
              style={{
                ...baseTextStyle,
                display: 'inline-block',
                transformOrigin: 'bottom center',
                animation: `kinetic-tumble 450ms cubic-bezier(0.17, 0.89, 0.32, 1.28) ${i * 90}ms both`
              }}
            >
              {word}
            </span>
          ))}
        </div>
      )
    }

    default:
      return (
        <div style={{ ...baseTextStyle, padding: '0 16px' }}>
          {text}
        </div>
      )
  }
}

function SyncedOverlayVideo({
  src,
  isPlaying,
  mediaTime
}: {
  src: string
  isPlaying?: boolean
  mediaTime?: number
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Capture isPlaying in a ref so the mount effect can read the initial value
  // without closing over a stale boolean — prevents a play→pause flicker when
  // the parent starts paused.
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    try {
      video.currentTime = 0
    } catch {
      /* seek may fail before metadata loads */
    }
    // Only auto-start if the parent hasn't explicitly requested pause.
    // preload="none" means nothing is decoded until play() is called, so
    // calling play() here is the first moment Chromium touches the media
    // pipeline. With use-gl=swiftshader in the main process this path is safe;
    // the guard prevents a spurious play→pause cycle when isPlaying is false.
    if (isPlayingRef.current !== false) {
      void video.play().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      void video.play().catch(() => undefined)
      return
    }
    video.pause()
  }, [isPlaying])

  useEffect(() => {
    const video = videoRef.current
    if (!video || mediaTime == null || !Number.isFinite(mediaTime)) return
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const target = duration != null ? mediaTime % duration : mediaTime
    if (Math.abs(video.currentTime - target) > 0.12) {
      try {
        video.currentTime = target
      } catch {
        /* seek may fail before metadata */
      }
    }
  }, [mediaTime, isPlaying])

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      loop
      playsInline
      // preload="none" prevents Chromium from eagerly decoding frames on mount.
      // Without this, setting src on the element immediately activates the media
      // pipeline (including platform hardware decode paths) before play() is
      // called — this is what triggers the Audio/Network service cascade crash.
      // Decoding is deferred until play() is explicitly called below.
      preload="none"
      style={{
        maxWidth: '100%',
        maxHeight: '42vh',
        borderRadius: 10,
        border: '1px solid rgba(250,204,21,0.35)',
        boxShadow: '0 14px 28px rgba(0,0,0,0.45)',
        background: 'rgba(0,0,0,0.45)'
      }}
    />
  )
}

function TextOverlayCard(props: { content: string; subtitle?: string }) {
  return (
    <div
      style={{
        background: 'rgba(20, 20, 22, 0.78)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 10,
        padding: '10px 16px',
        color: '#f4f4f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 'clamp(16px, 3vw, 24px)',
        fontWeight: 600,
        lineHeight: 1.3,
        textShadow: '0 2px 8px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 14px 28px rgba(0,0,0,0.4)',
        textAlign: 'center'
      }}
    >
      {props.content}
      {props.subtitle && (
        <div
          style={{
            fontSize: 'clamp(11px, 2vw, 14px)',
            fontWeight: 500,
            marginTop: 4,
            color: '#a1a1aa',
            letterSpacing: '0.02em'
          }}
        >
          {props.subtitle}
        </div>
      )}
    </div>
  )
}

function HookOverlayCard(props: { content: string; subtitle?: string }) {
  /**
   * Hooks read as the loudest thing on screen — no card chrome, just big
   * text with a strong shadow so it survives any background. They live
   * top-of-frame so the speaker's face stays unobstructed.
   */
  return (
    <div style={{ textAlign: 'center', padding: '0 12px' }}>
      <div
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 'clamp(20px, 5vw, 42px)',
          fontWeight: 800,
          lineHeight: 1.15,
          color: '#fef3c7',
          textShadow: '0 4px 18px rgba(0,0,0,0.85), 0 0 12px rgba(0,0,0,0.55)',
          letterSpacing: '-0.01em'
        }}
      >
        {props.content}
      </div>
      {props.subtitle && (
        <div
          style={{
            fontSize: 'clamp(12px, 2.4vw, 16px)',
            fontWeight: 600,
            marginTop: 6,
            color: '#fcd34d',
            textShadow: '0 2px 10px rgba(0,0,0,0.85)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}
        >
          {props.subtitle}
        </div>
      )}
    </div>
  )
}

interface GridPlacement {
  area: string
  justify: 'start' | 'center' | 'end'
  align: 'start' | 'center' | 'end'
}

function positionToGridArea(position: NonNullable<OverlayEvent['position']>): GridPlacement {
  switch (position) {
    case 'top':
      return { area: '1 / 1 / 2 / 4', justify: 'center', align: 'start' }
    case 'middle':
      return { area: '2 / 1 / 3 / 4', justify: 'center', align: 'center' }
    case 'bottom-left':
      return { area: '3 / 1 / 4 / 2', justify: 'start', align: 'end' }
    case 'bottom-right':
      return { area: '3 / 3 / 4 / 4', justify: 'end', align: 'end' }
    case 'bottom':
    default:
      return { area: '3 / 1 / 4 / 4', justify: 'center', align: 'end' }
  }
}
