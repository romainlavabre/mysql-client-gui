// Git sync status of the active workspace, with the sync button and conflict resolution.
import clsx from 'clsx'
import { AlertTriangle, ArrowDown, ArrowUp, CloudOff, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { ConflictChoice, WorkspaceRepo } from '@shared/types'
import { api } from '../../lib/bridge'
import { relativeTime } from '../../lib/format'
import { Button, Dialog, ErrorBox, IconButton, SegmentedControl } from '../../components/ui'
import { useSyncStatus } from './useWorkspace'

export function SyncBadge({ repo }: { repo: WorkspaceRepo }) {
  const status = useSyncStatus(repo.id)
  const [resolving, setResolving] = useState(false)

  if (status && !status.isGitRepo) return null

  const sync = (): void => {
    void api.workspace.sync({ repoId: repo.id })
  }

  let label = 'Sync with the remote repository'
  if (status?.error) label = `Sync failed: ${status.error}`
  else if (status && !status.hasRemote) label = 'Local only: set a remote in the workspace menu to share'
  else if (status?.lastSyncAt) label = `Synced ${relativeTime(status.lastSyncAt)} — click to sync now`

  if (status && status.conflicts.length > 0) {
    return (
      <>
        <IconButton label="Conflicts with the remote: resolve" onClick={() => setResolving(true)} className="text-warning">
          <AlertTriangle className="size-4" />
        </IconButton>
        <ConflictDialog repo={repo} files={status.conflicts} open={resolving} onOpenChange={setResolving} />
      </>
    )
  }

  return (
    <IconButton label={label} onClick={sync} disabled={status?.syncing || (status !== null && !status.hasRemote)}>
      <span className="relative flex items-center">
        {status && !status.hasRemote ? (
          <CloudOff className="size-4" />
        ) : (
          <RefreshCw className={clsx('size-4', status?.syncing && 'animate-spin', status?.error && 'text-danger')} />
        )}
        {status && (status.ahead > 0 || status.behind > 0) && !status.syncing && (
          <span className="absolute -right-2 -top-2 flex text-[9px] font-bold text-accent">
            {status.ahead > 0 && (
              <>
                <ArrowUp className="size-2.5" />
                {status.ahead}
              </>
            )}
            {status.behind > 0 && (
              <>
                <ArrowDown className="size-2.5" />
                {status.behind}
              </>
            )}
          </span>
        )}
      </span>
    </IconButton>
  )
}

function ConflictDialog({
  repo,
  files,
  open,
  onOpenChange
}: {
  repo: WorkspaceRepo
  files: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await api.workspace.resolveConflicts({ repoId: repo.id, choices })
    setBusy(false)
    if (result.error) setError(result.error)
    else if (result.conflicts.length === 0) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Resolve conflicts"
      width={600}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Later</Button>
          <Button variant="primary" loading={busy} disabled={files.some((f) => !choices[f])} onClick={() => void resolve()}>
            Resolve and push
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          These files were changed both here and on the remote. Choose which version to keep for each one. Your local version is
          untouched until you resolve.
        </p>
        {files.map((file) => (
          <div key={file} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="truncate font-mono text-xs">{file}</span>
            <SegmentedControl<ConflictChoice | ''>
              value={choices[file] ?? ''}
              onChange={(value) => value && setChoices((c) => ({ ...c, [file]: value }))}
              options={[
                { value: 'mine', label: 'Keep mine' },
                { value: 'theirs', label: 'Keep theirs' }
              ]}
            />
          </div>
        ))}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Dialog>
  )
}
