// Connections of the active workspace, with search, grouping by environment and actions.
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Copy, Lock, Pencil, Plug, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import type { ConnectionConfig, EnvTag } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { confirm, toast } from '../../components/feedback'
import { Button, IconButton, Input, Spinner } from '../../components/ui'
import { connect, useApp } from '../../store'
import { useConnections, useWorkspace } from '../workspace/useWorkspace'
import { ENV_COLORS, ENV_LABELS } from './env'

/** Connection shown in the editor: an id, 'new', or none. */
export const useConnectionEditor = create<{ editing: string | null }>(() => ({ editing: null }))

const ENV_ORDER: EnvTag[] = ['prod', 'staging', 'dev', 'other']
const menuItem = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-hover'

export function ConnectionList() {
  const { data: connections, isLoading } = useConnections()
  const { data: workspace } = useWorkspace()
  const connecting = useApp((s) => s.connecting)
  const editing = useConnectionEditor((s) => s.editing)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = (connections ?? []).filter(
      (c) => !needle || c.name.toLowerCase().includes(needle) || c.host.toLowerCase().includes(needle)
    )
    return ENV_ORDER.map((env) => ({ env, items: filtered.filter((c) => c.env === env) })).filter((g) => g.items.length > 0)
  }, [connections, search])

  const open = (connection: ConnectionConfig): void => {
    void connect(connection, workspace?.activeRepoId ?? null)
  }

  const remove = async (connection: ConnectionConfig): Promise<void> => {
    const ok = await confirm({
      title: `Delete connection "${connection.name}"`,
      body: 'The connection is removed from the workspace repository for everyone sharing it.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.connections.remove({ connectionId: connection.id })
      if (editing === connection.id) useConnectionEditor.setState({ editing: null })
      await queryClient.invalidateQueries({ queryKey: ['connections'] })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const duplicate = async (connection: ConnectionConfig): Promise<void> => {
    try {
      const copy = await api.connections.duplicate({ connectionId: connection.id })
      await queryClient.invalidateQueries({ queryKey: ['connections'] })
      useConnectionEditor.setState({ editing: copy.id })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input className="pl-7" placeholder="Search connections" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <IconButton label="New connection" onClick={() => useConnectionEditor.setState({ editing: 'new' })} className="size-8">
          <Plus className="size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {isLoading && <Spinner className="mx-auto mt-6" />}
        {!isLoading && connections?.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-3 text-center text-xs text-muted">
            No connection in this workspace.
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => useConnectionEditor.setState({ editing: 'new' })}>
              New connection
            </Button>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.env} className="mb-3">
            <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
              <span className="size-2 rounded-full" style={{ background: ENV_COLORS[group.env] }} />
              {ENV_LABELS[group.env]}
            </div>
            {group.items.map((connection) => (
              <ContextMenu.Root key={connection.id}>
                <ContextMenu.Trigger asChild>
                  <div
                    className={clsx(
                      'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover',
                      editing === connection.id && 'bg-hover'
                    )}
                    onClick={() => useConnectionEditor.setState({ editing: connection.id })}
                    onDoubleClick={() => open(connection)}
                  >
                    <span
                      className="h-7 w-1 shrink-0 rounded-full"
                      style={{ background: connection.color || ENV_COLORS[connection.env] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate text-[13px]">
                        {connection.name}
                        {connection.readOnly && <Lock className="size-3 text-muted" />}
                      </div>
                      <div className="truncate text-[11px] text-muted">
                        {connection.user ? `${connection.user}@` : ''}
                        {connection.host}:{connection.port}
                        {connection.ssh.enabled ? ` via ${connection.ssh.host}` : ''}
                      </div>
                    </div>
                    {connecting === connection.id ? (
                      <Spinner />
                    ) : (
                      <IconButton
                        label="Connect"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          open(connection)
                        }}
                      >
                        <Plug className="size-4" />
                      </IconButton>
                    )}
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 w-44 rounded-md border border-border bg-panel-2 p-1 shadow-xl">
                    <ContextMenu.Item className={menuItem} onSelect={() => open(connection)}>
                      <Plug className="size-3.5" /> Connect
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => useConnectionEditor.setState({ editing: connection.id })}>
                      <Pencil className="size-3.5" /> Edit
                    </ContextMenu.Item>
                    <ContextMenu.Item className={menuItem} onSelect={() => void duplicate(connection)}>
                      <Copy className="size-3.5" /> Duplicate
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="my-1 h-px bg-border" />
                    <ContextMenu.Item className={`${menuItem} text-danger`} onSelect={() => void remove(connection)}>
                      <Trash2 className="size-3.5" /> Delete
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
