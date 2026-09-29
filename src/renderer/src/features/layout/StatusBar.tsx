// Bottom bar: connection, current database, workspace sync.
import { Database, FolderGit2, Lock } from 'lucide-react'
import { useApp } from '../../store'
import { ENV_COLORS, ENV_LABELS } from '../connections/env'
import { useActiveRepo, useSyncStatus } from '../workspace/useWorkspace'

export function StatusBar() {
  const session = useApp((s) => s.session)
  const database = useApp((s) => s.currentDatabase)
  const repo = useActiveRepo()
  const status = useSyncStatus(repo?.id)
  const color = session ? session.connection.color || ENV_COLORS[session.connection.env] : undefined

  return (
    <div className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-[11px] text-muted">
      {session ? (
        <>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="text-fg">{session.connection.name}</span>
            <span>({ENV_LABELS[session.connection.env]})</span>
          </span>
          {session.connection.readOnly && (
            <span className="flex items-center gap-1 text-warning">
              <Lock className="size-3" /> read-only
            </span>
          )}
          {database && (
            <span className="flex items-center gap-1">
              <Database className="size-3" /> {database}
            </span>
          )}
          <span>{session.info.isMariaDb ? 'MariaDB' : 'MySQL'} {session.info.serverVersion.split('-')[0]}</span>
        </>
      ) : (
        <span>Not connected</span>
      )}
      <div className="flex-1" />
      {repo && (
        <span className="flex items-center gap-1.5">
          <FolderGit2 className="size-3" />
          {repo.name}
          {status?.branch && <span>· {status.branch}</span>}
          {status?.error && <span className="text-danger">· sync error</span>}
          {status && status.conflicts.length > 0 && <span className="text-warning">· conflicts</span>}
        </span>
      )}
    </div>
  )
}
