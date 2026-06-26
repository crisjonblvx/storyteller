import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@renderer/stores/auth'
import { IntroSplashScreen } from '@renderer/components/IntroSplashScreen'

export const INTRO_PENDING_SESSION_KEY = 'storyteller_intro_pending'

/** Call after a successful sign-in / demo entry so the intro plays on the next screen. */
export function markIntroPending(): void {
  try {
    sessionStorage.setItem(INTRO_PENDING_SESSION_KEY, '1')
  } catch {
    // ignore quota / privacy mode
  }
}

/**
 * Full-screen intro overlay after login. Uses sessionStorage so it runs once per
 * sign-in, not only on the first app install.
 */
export function PostLoginIntro() {
  const { user, demo, loading } = useAuthStore()
  const loc = useLocation()
  const [show, setShow] = useState(() => {
    try {
      return sessionStorage.getItem(INTRO_PENDING_SESSION_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (loading) return
    if (!user && !demo) return
    if (loc.pathname === '/login') return
    try {
      if (sessionStorage.getItem(INTRO_PENDING_SESSION_KEY) === '1') {
        setShow(true)
      }
    } catch {
      // ignore
    }
  }, [loading, user, demo, loc.pathname])

  if (!show) return null

  return (
    <IntroSplashScreen
      onComplete={() => {
        try {
          sessionStorage.removeItem(INTRO_PENDING_SESSION_KEY)
          localStorage.setItem('storyteller_intro_seen_v4', '1')
        } catch {
          // ignore
        }
        setShow(false)
      }}
      onErrorDismiss={() => {
        try {
          sessionStorage.removeItem(INTRO_PENDING_SESSION_KEY)
        } catch {
          // ignore
        }
        setShow(false)
      }}
    />
  )
}
