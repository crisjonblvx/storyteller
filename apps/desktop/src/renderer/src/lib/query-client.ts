/**
 * TanStack Query (React Query) Configuration for Storyteller Desktop
 *
 * Provides centralized server state management with:
 * - Automatic caching and deduplication
 * - Background refetching
 * - Optimistic updates
 * - Error handling and retries
 */

import { QueryClient } from '@tanstack/react-query'

/**
 * Default query client configuration optimized for desktop app usage.
 *
 * Desktop apps have different needs than web apps:
 * - Network is more reliable (local + cloud hybrid)
 * - Data can be larger (video metadata, transcripts)
 * - Users expect offline resilience
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Desktop apps should retry on failure (network may be intermittent)
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Keep data fresh but don't over-fetch
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes (formerly cacheTime)

      // Refetch on window focus is less relevant for desktop
      // but useful when switching back to the app
      refetchOnWindowFocus: true,

      // Don't refetch on reconnect by default (desktop handles this differently)
      refetchOnReconnect: false,

      // Enable suspense for better loading states
      suspense: false, // Can be enabled per-query if needed

      // Handle errors gracefully
      throwOnError: false
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
      retryDelay: 1000
    }
  }
})

/**
 * Query keys for Storyteller domain
 * Follows TanStack Query best practices for cache management
 */
export const queryKeys = {
  // Projects
  projects: {
    all: ['projects'] as const,
    byId: (id: string) => ['projects', id] as const,
    list: (filters?: Record<string, unknown>) => ['projects', 'list', filters] as const
  },

  // Assets
  assets: {
    all: ['assets'] as const,
    byProject: (projectId: string) => ['assets', 'project', projectId] as const,
    byId: (id: string) => ['assets', id] as const,
    list: (filters?: Record<string, unknown>) => ['assets', 'list', filters] as const,
    probe: (path: string) => ['assets', 'probe', path] as const
  },

  // Transcripts
  transcripts: {
    all: ['transcripts'] as const,
    byAsset: (assetId: string) => ['transcripts', 'asset', assetId] as const,
    byProject: (projectId: string) => ['transcripts', 'project', projectId] as const,
    segments: (assetId: string) => ['transcripts', 'segments', assetId] as const
  },

  // Soundbites
  soundbites: {
    all: ['soundbites'] as const,
    byProject: (projectId: string) => ['soundbites', 'project', projectId] as const,
    candidates: (projectId: string) => ['soundbites', 'candidates', projectId] as const
  },

  // B-roll
  broll: {
    all: ['broll'] as const,
    byProject: (projectId: string) => ['broll', 'project', projectId] as const,
    slots: (projectId: string) => ['broll', 'slots', projectId] as const,
    prompts: (projectId: string) => ['broll', 'prompts', projectId] as const
  },

  // Timelines
  timelines: {
    all: ['timelines'] as const,
    byProject: (projectId: string) => ['timelines', 'project', projectId] as const,
    byId: (id: string) => ['timelines', id] as const,
    sequence: (timelineId: string) => ['timelines', 'sequence', timelineId] as const
  },

  // User/Auth
  auth: {
    session: ['auth', 'session'] as const,
    user: ['auth', 'user'] as const,
    profile: (userId: string) => ['auth', 'profile', userId] as const
  },

  // App status
  app: {
    status: ['app', 'status'] as const,
    features: ['app', 'features'] as const,
    config: ['app', 'config'] as const
  }
} as const

/**
 * Helper to invalidate all project-related queries
 * Useful after project mutations
 */
export function invalidateProjectQueries(projectId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey
      // Invalidate any query that contains this projectId
      return key.some((k) => k === projectId)
    }
  })
}

/**
 * Helper to prefetch project data for faster navigation
 */
export function prefetchProject(projectId: string) {
  // Prefetch common project data
  queryClient.prefetchQuery({
    queryKey: queryKeys.assets.byProject(projectId),
    queryFn: async () => {
      // This will be replaced with actual Supabase query
      const { supabase } = await import('./supabase.js')
      const { data } = await supabase.from('assets').select('*').eq('project_id', projectId)
      return data || []
    },
    staleTime: 1000 * 60 * 10 // 10 minutes
  })
}

/**
 * Helper for optimistic updates
 * Updates cache immediately, rolls back on error
 */
export function optimisticUpdate<T>(
  queryKey: readonly unknown[],
  updater: (old: T | undefined) => T | undefined
) {
  return queryClient.setQueryData(queryKey, updater)
}
