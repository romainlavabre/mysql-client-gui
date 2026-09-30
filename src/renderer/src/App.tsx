import { useEffect } from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useQueryClient } from '@tanstack/react-query'
import { dropSession, setTheme, useApp } from './store'
import { onEvent } from './lib/bridge'
import { DialogHost, Toaster } from './components/feedback'
import { ActivityRail } from './features/layout/ActivityRail'
import { StatusBar } from './features/layout/StatusBar'
import { Sidebar } from './features/layout/Sidebar'
import { MainArea } from './features/layout/MainArea'
import { JobsPanel } from './features/io/JobsPanel'
import { UpdateNotice } from './features/update/UpdateNotice'
import { useWorkspaceStatus } from './features/workspace/useWorkspace'

export function App() {
  const theme = useApp((s) => s.theme)
  const queryClient = useQueryClient()
  useWorkspaceStatus()

  useEffect(() => {
    setTheme(theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () =>
      onEvent('workspace:changed', (state) => {
        queryClient.setQueryData(['workspace'], state)
        // Connections and queries come from the active workspace.
        void queryClient.invalidateQueries({ queryKey: ['connections'] })
        void queryClient.invalidateQueries({ queryKey: ['queries'] })
        // The main process closes the sessions when the active workspace changes.
        const { sessionRepoId } = useApp.getState()
        if (sessionRepoId && sessionRepoId !== state.activeRepoId) dropSession()
      }),
    [queryClient]
  )

  return (
    <RadixTooltip.Provider>
      <div className="flex h-full flex-col">
        <div className="flex min-h-0 flex-1">
          <ActivityRail />
          <Group orientation="horizontal" className="min-w-0 flex-1">
            <Panel defaultSize="22" minSize={220} maxSize="45">
              <Sidebar />
            </Panel>
            <Separator className="resize-handle w-px" />
            <Panel minSize="40">
              <MainArea />
            </Panel>
          </Group>
        </div>
        <StatusBar />
      </div>
      <JobsPanel />
      <UpdateNotice />
      <Toaster />
      <DialogHost />
    </RadixTooltip.Provider>
  )
}
