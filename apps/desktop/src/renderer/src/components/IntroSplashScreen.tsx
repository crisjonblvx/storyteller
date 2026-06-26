import { useCallback, useEffect, useRef, useState } from 'react'
import introVideoUrl from '@renderer/assets/storyteller-intro-animation.mp4'

type Props = {
  onComplete: () => void
  /** Called when the video fails to load — dismisses without marking as seen so it retries next login. */
  onErrorDismiss?: () => void
}

export function IntroSplashScreen({ onComplete, onErrorDismiss }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [skippable, setSkippable] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)

  const finish = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleError = useCallback(() => {
    if (onErrorDismiss) {
      onErrorDismiss()
    } else {
      onComplete()
    }
  }, [onComplete, onErrorDismiss])

  const tryPlay = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    try {
      await video.play()
      setNeedsTap(false)
    } catch {
      setNeedsTap(true)
    }
  }, [])

  useEffect(() => {
    void tryPlay()
  }, [tryPlay])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#000',
        display: 'grid',
        placeItems: 'center'
      }}
      onClick={() => {
        if (needsTap) void tryPlay()
      }}
    >
      <video
        ref={videoRef}
        src={introVideoUrl}
        autoPlay
        muted
        playsInline
        preload="auto"
        onCanPlay={() => {
          setSkippable(true)
          void tryPlay()
        }}
        onPlaying={() => setNeedsTap(false)}
        onEnded={finish}
        onError={handleError}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {needsTap && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void tryPlay()
          }}
          style={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            width: 'min(320px, 80vw)',
            height: 48,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 15,
            fontWeight: 600
          }}
        >
          Tap to play intro
        </button>
      )}
      {skippable && (
        <button
          type="button"
          onClick={finish}
          style={{
            position: 'absolute',
            bottom: 32,
            right: 32,
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.15))',
            background: 'rgba(0,0,0,0.55)',
            color: 'var(--text-primary, #fff)',
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          Skip
        </button>
      )}
    </div>
  )
}
