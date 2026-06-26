import { useEffect, useState } from 'react'

/**
 * Returns the current app version label (e.g. "v1.0.1") by reading
 * AppStatus.app.buildLabel from the IPC bridge. Falls back to an empty
 * string while loading so callers can conditionally render.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.storyteller?.getAppStatus?.().then((status) => {
      const label = status?.app?.buildLabel?.trim()
      if (label) setVersion(`v${label}`)
    })
  }, [])

  return version
}
