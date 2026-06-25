/**
 * TanStack Query hooks for Projects
 *
 * Example usage of TanStack Query with Storyteller's Supabase backend.
 * These hooks demonstrate best practices for server state management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys, optimisticUpdate } from '../lib/query-client.js'
import { supabase } from '../lib/supabase.js'
import type { Project } from '@storyteller/shared'

/**
 * Fetch all projects for the current user
 */
export function useProjects(options?: { limit?: number }) {
  return useQuery({
    queryKey: queryKeys.projects.list({ limit: options?.limit }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(options?.limit || 100)

      if (error) throw error
      return data as Project[]
    },
    // Projects change infrequently - longer stale time
    staleTime: 1000 * 60 * 5 // 5 minutes
  })
}

/**
 * Fetch a single project by ID
 */
export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.projects.byId(projectId || ''),
    queryFn: async () => {
      if (!projectId) return null

      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (error) throw error
      return data as Project
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 2 // 2 minutes
  })
}

/**
 * Create a new project
 *
 * Example with optimistic update:
 * ```tsx
 * const create = useCreateProject()
 * create.mutate({ title: 'My Project', mode: 'story' })
 * ```
 */
export function useCreateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { title: string; mode: string; description?: string }) => {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          title: input.title,
          mode: input.mode,
          description: input.description || null
        })
        .select()
        .single()

      if (error) throw error
      return data as Project
    },
    onSuccess: (newProject) => {
      // Invalidate the projects list to include the new project
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })

      // Immediately set the new project data
      queryClient.setQueryData(queryKeys.projects.byId(newProject.id), newProject)
    }
  })
}

/**
 * Update a project
 *
 * Example with optimistic update:
 * ```tsx
 * const update = useUpdateProject()
 * update.mutate({ id: '123', title: 'New Title' })
 * ```
 */
export function useUpdateProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string } & Partial<Project>) => {
      const { id, ...updates } = input

      const { data, error } = await supabase
        .from('projects')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as Project
    },
    onMutate: async (newData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.byId(newData.id) })

      // Snapshot previous value
      const previousProject = queryClient.getQueryData<Project>(
        queryKeys.projects.byId(newData.id)
      )

      // Optimistically update
      if (previousProject) {
        optimisticUpdate(queryKeys.projects.byId(newData.id), (old) => {
          if (!old) return old
          return { ...old, ...newData }
        })
      }

      return { previousProject }
    },
    onError: (err, newData, context) => {
      // Rollback on error
      if (context?.previousProject) {
        queryClient.setQueryData(queryKeys.projects.byId(newData.id), context.previousProject)
      }
    },
    onSettled: (data, error, variables) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.byId(variables.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    }
  })
}

/**
 * Delete a project
 */
export function useDeleteProject() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId)
      if (error) throw error
      return projectId
    },
    onSuccess: (deletedId) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: queryKeys.projects.byId(deletedId) })
      // Invalidate list
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all })
    }
  })
}

/**
 * Prefetch a project for faster navigation
 *
 * Usage in a link component:
 * ```tsx
 * const prefetch = usePrefetchProject()
 * <Link onMouseEnter={() => prefetch('123')} to="/project/123">View</Link>
 * ```
 */
export function usePrefetchProject() {
  const queryClient = useQueryClient()

  return (projectId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.projects.byId(projectId),
      queryFn: async () => {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single()

        if (error) throw error
        return data as Project
      },
      staleTime: 1000 * 60 * 5 // 5 minutes
    })
  }
}
