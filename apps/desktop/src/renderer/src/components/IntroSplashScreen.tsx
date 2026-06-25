import { useCallback, useState } from 'react'
import introVideoUrl from '@renderer/assets/storyteller-intro-animation.mp4'

type Props = {
  onComplete: () => void
  /** Called when the video fails to load — dismisses without marking as seen so it retries next launch. */
  onErrorDismiss?: () => void
}

export function IntroSplashScreen({ onComplete, onErrorDismiss }: Props) {
  const [skippable, setSkippable] = useState(false)

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
    >
      <video
        src={introVideoUrl}
        autoPlay
        muted
        playsInline
        onCanPlay={() => setSkippable(true)}
        onEnded={finish}
        onError={handleError}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
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
