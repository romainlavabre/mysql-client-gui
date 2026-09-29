// Left panel: workspace switcher, then connections or the active connection's views.
import { FolderGit2, Unplug } from 'lucide-react'
import { useState } from 'react'
import { Button, EmptyState, IconButton } from '../../components/ui'
import { disconnect, useApp } from '../../store'
import { WorkspaceSwitcher } from '../workspace/WorkspaceSwitcher'
import { AddWorkspaceDialog } from '../workspace/AddWorkspaceDialog'
import { useWorkspace } from '../workspace/useWorkspace'
import { ConnectionList } from '../connections/ConnectionList'
import { ConnectionSwitcher } from '../connections/ConnectionSwitcher'
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
            className="flex items-center gap-1 border-b border-border px-2 py-1.5"
            style={{ boxShadow: `inset 3px 0 0 ${session.connection.color || ENV_COLORS[session.connection.env]}` }}
          >
            <ConnectionSwitcher />
            <IconButton label="Disconnect" onClick={() => void disconnect()}>
              <Unplug className="size-4" />
            </IconButton>
          </div>
          {/* Keyed by session: switching connection starts from a fresh tree. */}
          <div className="min-h-0 flex-1" key={session.info.sessionId}>
            {view === 'explorer' && <Explorer />}
            {view === 'saved' && <SavedQueries />}
            {view === 'history' && <HistoryPanel />}
          </div>
        </>
      )}
    </div>
  )
}
