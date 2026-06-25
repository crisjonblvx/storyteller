/**
 * TanStack Query Provider for Storyteller Desktop
 *
 * Wraps the app with QueryClientProvider and sets up:
 * - Default error handling
 * - Online/offline state monitoring
 *
 * React Query DevTools can be added in development by installing
 * @tanstack/react-query-devtools and importing them here.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { queryClient } from '../lib/query-client.js'

interface QueryProviderProps {
  children: React.ReactNode
}

/**
 * Monitors online/offline state and triggers refetching when coming back online
 */
function useOnlineStatus() {
  useEffect(() => {
    const handleOnline = () => {
      console.log('[QueryProvider] Back online - resuming queries')
      queryClient.resumePausedMutations()
    }

    const handleOffline = () => {
      console.log('[QueryProvider] Offline - pausing mutations')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
}

/**
 * Global error handler for query errors
 */
function useQueryErrorHandler() {
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'error') {
        const error = event.query.state.error
        console.error('[QueryProvider] Query error:', error)

        // Could dispatch to error tracking service here
        // Could show toast notifications for user-facing errors
      }
    })

    return () => unsubscribe()
  }, [])
}

/**
 * Query Provider Component
 *
 * Usage:
 * ```tsx
 * <QueryProvider>
 *   <App />
 * </QueryProvider>
 * ```
 */
export function QueryProvider({ children }: QueryProviderProps) {
  useOnlineStatus()
  useQueryErrorHandler()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
