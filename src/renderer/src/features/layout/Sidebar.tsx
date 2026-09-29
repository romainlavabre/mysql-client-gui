// Left panel: workspace switcher, then connections or the active connection's views.
import { FolderGit2, Plug, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Button, EmptyState, IconButton } from '../../components/ui'
import { disconnect, useApp } from '../../store'
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher'
import { AddWorkspaceDialog } from '../workspace/AddWorkspaceDialog'
import { useWorkspace } from '../workspace/useWorkspace'
import { ConnectionList } from '../connections/ConnectionList'
import { Explorer } from '../explorer/Explorer'
import { SavedQueries } from '../saved/SavedQueries'
import { HistoryPanel } from '../saved/HistoryPanel'
import { ENV_COLORS } from '../connections/env'

export function Sidebar() {
  const { data: workspace } = useWorkspace()
  const session = useApp((s) => s.session)
  const view = useApp((s) => s.sidebarView)
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex h-full flex-col bg-panel">
      <WorkspaceSwitcher />
      {!workspace?.activeRepoId ? (
        <EmptyState icon={<FolderGit2 className="size-10" />} title="No workspace yet">
          <p className="text-xs">Clone the git repository shared with your team, or create a local workspace.</p>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add workspace
          </Button>
          <AddWorkspaceDialog open={adding} onOpenChange={setAdding} />
        </EmptyState>
      ) : !session ? (
        <ConnectionList />
      ) : (
        <>
          <div
            className="flex items-center gap-2 border-b border-border px-3 py-2"
            style={{ boxShadow: `inset 3px 0 0 ${session.connection.color || ENV_COLORS[session.connection.env]}` }}
          >
            <Plug className="size-3.5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{session.connection.name}</div>
              <div className="truncate text-[11px] text-muted">
                {session.info.currentUser} · {session.info.serverVersion}
              </div>
            </div>
            <IconButton label="Disconnect" onClick={() => void disconnect()}>
              <Unplug className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1">
            {view === 'explorer' && <Explorer />}
            {view === 'saved' && <SavedQueries />}
            {view === 'history' && <HistoryPanel />}
          </div>
        </>
      )}
    </div>
  )
}
