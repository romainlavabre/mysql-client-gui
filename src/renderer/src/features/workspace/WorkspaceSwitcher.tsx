// Workspace (git repository) selector at the top of the sidebar.
import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronsUpDown, FolderGit2, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { WorkspaceRepo } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { confirm, prompt, toast } from '../../components/feedback'
import { dropSession, useApp } from '../../store'
import { AddWorkspaceDialog } from './AddWorkspaceDialog'
import { useWorkspace } from './useWorkspace'
import { SyncBadge } from './SyncBadge'

const itemClass =
  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-hover'

export function WorkspaceSwitcher() {
  const { data } = useWorkspace()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const active = data?.repos.find((r) => r.id === data.activeRepoId) ?? null

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: ['workspace'] })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const switchTo = (repo: WorkspaceRepo): Promise<void> =>
    run(async () => {
      if (useApp.getState().session) dropSession()
      await api.workspace.activate({ repoId: repo.id })
    })

  const rename = async (repo: WorkspaceRepo): Promise<void> => {
    const name = await prompt({ title: 'Rename workspace', label: 'Name', initial: repo.name, confirmLabel: 'Rename' })
    if (name?.trim()) await run(() => api.workspace.rename({ repoId: repo.id, name: name.trim() }))
  }

  const setRemote = async (repo: WorkspaceRepo): Promise<void> => {
    const remoteUrl = await prompt({
      title: 'Git remote',
      label: 'Remote URL (e.g. git@github.com:team/db-config.git)',
      initial: repo.remoteUrl ?? '',
      confirmLabel: 'Save'
    })
    if (remoteUrl?.trim()) await run(() => api.workspace.setRemote({ repoId: repo.id, remoteUrl: remoteUrl.trim() }))
  }

  const remove = async (repo: WorkspaceRepo): Promise<void> => {
    const ok = await confirm({
      title: `Remove workspace "${repo.name}"`,
      body: (
        <>
          The workspace is removed from the app, and the passwords saved for its connections are forgotten.
          <br />
          Its local clone (<span className="font-mono text-xs">{repo.path}</span>) is deleted if the app created it; a folder
          you opened yourself is kept. The remote repository is not touched.
        </>
      ),
      confirmLabel: 'Remove',
      danger: true
    })
    if (ok) {
      if (useApp.getState().sessionRepoId === repo.id) dropSession()
      await run(() => api.workspace.remove({ repoId: repo.id, deleteFiles: true }))
    }
  }

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-2">
      <Menu.Root>
        <Menu.Trigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover outline-none">
          <FolderGit2 className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{active?.name ?? 'No workspace'}</div>
            <div className="truncate text-[11px] text-muted">{active ? (active.remoteUrl ?? 'Local only') : 'Add one to get started'}</div>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className="z-50 w-72 rounded-md border border-border bg-panel-2 p-1 shadow-xl">
            <Menu.Label className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Workspaces</Menu.Label>
            {data?.repos.map((repo) => (
              <Menu.Sub key={repo.id}>
                <Menu.SubTrigger className={itemClass} onClick={() => void switchTo(repo)}>
                  <Check className={repo.id === data.activeRepoId ? 'size-3.5 text-accent' : 'size-3.5 opacity-0'} />
                  <span className="min-w-0 flex-1 truncate">{repo.name}</span>
                </Menu.SubTrigger>
                <Menu.Portal>
                  <Menu.SubContent sideOffset={6} className="z-50 w-48 rounded-md border border-border bg-panel-2 p-1 shadow-xl">
                    <Menu.Item className={itemClass} onSelect={() => void switchTo(repo)}>
                      <Check className="size-3.5" /> Switch to
                    </Menu.Item>
                    <Menu.Item className={itemClass} onSelect={() => void rename(repo)}>
                      <Pencil className="size-3.5" /> Rename
                    </Menu.Item>
                    <Menu.Item className={itemClass} onSelect={() => void setRemote(repo)}>
                      <Link2 className="size-3.5" /> {repo.remoteUrl ? 'Change remote' : 'Set remote'}
                    </Menu.Item>
                    <Menu.Separator className="my-1 h-px bg-border" />
                    <Menu.Item className={`${itemClass} text-danger`} onSelect={() => void remove(repo)}>
                      <Trash2 className="size-3.5" /> Remove
                    </Menu.Item>
                  </Menu.SubContent>
                </Menu.Portal>
              </Menu.Sub>
            ))}
            {data && data.repos.length > 0 && <Menu.Separator className="my-1 h-px bg-border" />}
            <Menu.Item className={itemClass} onSelect={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add workspace…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {active && <SyncBadge repo={active} />}
      <AddWorkspaceDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
