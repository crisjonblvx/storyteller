/**
 * TanStack Query Hooks for Storyteller
 *
 * These hooks provide type-safe, cached, and synchronized access to
 * server state (Supabase data) with automatic background updates.
 *
 * @example
 * ```tsx
 * import { useProjects, useCreateProject } from './hooks'
 *
 * function ProjectList() {
 *   const { data: projects, isLoading } = useProjects()
 *   const create = useCreateProject()
 *
 *   if (isLoading) return <Spinner />
 *
 *   return (
 *     <>
 *       {projects?.map(p => <ProjectCard key={p.id} project={p} />)}
 *       <button onClick={() => create.mutate({ title: 'New Project', mode: 'story' })}>
 *         Create Project
 *       </button>
 *     </>
 *   )
 * }
 * ```
 */

// Project hooks
export {
  useProjects,
  useProject,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  usePrefetchProject
} from './useProjects.js'

// Re-export query keys and client
export { queryKeys, queryClient } from '../lib/query-client.js'

// Future hooks to add:
// export { useAssets, useAsset, useCreateAsset } from './useAssets.js'
// export { useTranscripts, useTranscript } from './useTranscripts.js'
// export { useSoundbites } from './useSoundbites.js'
// export { useTimeline, useUpdateTimeline } from './useTimelines.js'
// export { useBrollSlots } from './useBroll.js'
