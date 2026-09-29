// Data hooks for the workspace registry, its sync status and its content.
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { SyncStatus } from '@shared/types'
import { api, onEvent } from '../../lib/bridge'

export function useWorkspace() {
  return useQuery({ queryKey: ['workspace'], queryFn: () => api.workspace.state(), staleTime: Infinity })
}

export function useActiveRepo() {
  const { data } = useWorkspace()
  return data?.repos.find((r) => r.id === data.activeRepoId) ?? null
}

const useStatuses = create<Record<string, SyncStatus>>(() => ({}))

export function useSyncStatus(repoId: string | null | undefined): SyncStatus | null {
  return useStatuses((s) => (repoId ? (s[repoId] ?? null) : null))
}

/** Subscribes to status events and refreshes the active repo status periodically. */
export function useWorkspaceStatus(): void {
  const queryClient = useQueryClient()
  const { data } = useWorkspace()
  const activeRepoId = data?.activeRepoId

  useEffect(
    () =>
      onEvent('workspace:status', (status) => {
        const previous = useStatuses.getState()[status.repoId]
        useStatuses.setState({ [status.repoId]: status })
        // A pull may have brought new connections or queries.
        if (previous?.syncing && !status.syncing) {
          void queryClient.invalidateQueries({ queryKey: ['connections'] })
          void queryClient.invalidateQueries({ queryKey: ['queries'] })
        }
      }),
    [queryClient]
  )

  useEffect(() => {
    if (!activeRepoId) return
    void api.workspace.sync({ repoId: activeRepoId }).catch(() => undefined)
    // Pull the colleagues' changes every 5 minutes.
    const timer = setInterval(() => void api.workspace.sync({ repoId: activeRepoId }).catch(() => undefined), 5 * 60_000)
    return () => clearInterval(timer)
  }, [activeRepoId])
}

export function useConnections() {
  const { data } = useWorkspace()
  return useQuery({
    queryKey: ['connections', data?.activeRepoId],
    queryFn: () => api.connections.list(),
    enabled: !!data?.activeRepoId
  })
}

export function useSavedQueries() {
  const { data } = useWorkspace()
  return useQuery({
    queryKey: ['queries', data?.activeRepoId],
    queryFn: () => api.queries.list(),
    enabled: !!data?.activeRepoId
  })
}
