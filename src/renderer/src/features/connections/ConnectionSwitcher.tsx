// Active connection in the sidebar header: a searchable list to switch to
// another connection of the workspace without disconnecting first.
import * as Popover from '@radix-ui/react-popover'
import { ChevronsUpDown, Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EnvTag } from '@shared/types'
import { SearchList } from '../../components/SearchSelect'
import { Spinner } from '../../components/ui'
import { connect, useApp } from '../../store'
import { useConnections, useWorkspace } from '../workspace/useWorkspace'
import { ENV_LABELS } from './env'

const ENV_ORDER: EnvTag[] = ['prod', 'staging', 'dev', 'other']

export function ConnectionSwitcher() {
  const session = useApp((s) => s.session)!
  const connecting = useApp((s) => s.connecting)
  const { data: connections } = useConnections()
  const { data: workspace } = useWorkspace()
  const [open, setOpen] = useState(false)

  // Ctrl+Shift+K opens the switcher from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const options = [...(connections ?? [])]
    .sort((a, b) => ENV_ORDER.indexOf(a.env) - ENV_ORDER.indexOf(b.env) || a.name.localeCompare(b.name))
    .map((c) => ({
      value: c.id,
      label: c.name,
      group: ENV_LABELS[c.env],
      description: `${c.user ? `${c.user}@` : ''}${c.host}:${c.port}${c.ssh.enabled ? ` via ${c.ssh.host}` : ''}${c.readOnly ? ' · read-only' : ''}`
    }))

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none hover:bg-hover"
        title="Switch connection (Ctrl+Shift+K)"
      >
        {connecting ? <Spinner className="size-3.5 shrink-0" /> : <Plug className="size-3.5 shrink-0 text-success" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{session.connection.name}</div>
          <div className="truncate text-[11px] text-muted">
            {session.info.currentUser} · {session.info.serverVersion}
          </div>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 rounded-md border border-border bg-panel-2 shadow-xl">
          <SearchList
            options={options}
            value={session.connection.id}
            placeholder="Switch to connection…"
            onSelect={(id) => {
              setOpen(false)
              const target = connections?.find((c) => c.id === id)
              if (target) void connect(target, workspace?.activeRepoId ?? null)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
