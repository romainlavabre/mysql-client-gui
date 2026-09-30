// New version: a card to install it, and a status bar button to bring the card back.
import { ArrowUpCircle, Download, RotateCw, SquareTerminal, X } from 'lucide-react'
import { useEffect } from 'react'
import { create } from 'zustand'
import type { UpdateStatus } from '@shared/types'
import { api, errorMessage, onEvent } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button } from '../../components/ui'

const useUpdateStore = create<{ status: UpdateStatus | null; hidden: boolean }>(() => ({ status: null, hidden: false }))

export function useUpdateStatus(): UpdateStatus | null {
  return useUpdateStore((s) => s.status)
}

export function showUpdateNotice(): void {
  useUpdateStore.setState({ hidden: false })
}

async function openTerminal(): Promise<void> {
  try {
    const { command, copied } = await api.update.openTerminal()
    if (copied) toast(`No terminal found: the update command was copied, paste it in a terminal.\n${command}`, 'warning')
  } catch (error) {
    toast(errorMessage(error), 'error')
  }
}

export function UpdateNotice() {
  const { status, hidden } = useUpdateStore()

  useEffect(() => {
    void api.update.status().then((initial) => useUpdateStore.setState((s) => ({ status: s.status ?? initial })))
    return onEvent('update:status', (next) => {
      // A new version brings the card back.
      const previous = useUpdateStore.getState().status
      useUpdateStore.setState({ status: next, ...(next.latest !== previous?.latest ? { hidden: false } : {}) })
    })
  }, [])

  if (!status?.latest || hidden || status.state === 'idle') return null
  const { state, kind } = status
  const canInstall = kind !== 'unknown'

  return (
    <div className="fixed right-3 top-3 z-50 w-96 rounded-md border border-border bg-panel-2 p-3 shadow-xl">
      <div className="flex items-start gap-2 text-xs">
        <ArrowUpCircle className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {state === 'installed' ? `Simone ${status.latest} is installed` : `Simone ${status.latest} is available`}
          </div>
          <div className="mt-0.5 text-muted">
            {state === 'installed'
              ? 'Restart to use it.'
              : state === 'installing'
                ? kind === 'deb'
                  ? 'Downloading and installing… your password may be asked.'
                  : 'Downloading and installing…'
                : `You have ${status.current}.`}{' '}
            {status.notesUrl && state !== 'installed' && (
              <a className="text-accent hover:underline" href={status.notesUrl} target="_blank" rel="noreferrer">
                What's new
              </a>
            )}
          </div>
          {state === 'error' && <div className="selectable mt-1.5 text-danger">{status.error}</div>}
        </div>
        {state !== 'installing' && (
          <button className="text-muted hover:text-fg" onClick={() => useUpdateStore.setState({ hidden: true })} aria-label="Later">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {state === 'installed' ? (
          <Button size="sm" variant="primary" icon={<RotateCw className="size-3.5" />} onClick={() => void api.update.restart()}>
            Restart
          </Button>
        ) : (
          <>
            {state !== 'installing' && (
              <Button size="sm" variant="ghost" onClick={() => useUpdateStore.setState({ hidden: true })}>
                Later
              </Button>
            )}
            {(!canInstall || state === 'error') && (
              <Button
                size="sm"
                variant={canInstall ? 'secondary' : 'primary'}
                icon={<SquareTerminal className="size-3.5" />}
                onClick={() => void openTerminal()}
              >
                Update in a terminal
              </Button>
            )}
            {canInstall && (
              <Button
                size="sm"
                variant={state === 'error' ? 'secondary' : 'primary'}
                icon={<Download className="size-3.5" />}
                loading={state === 'installing'}
                onClick={() => void api.update.install().catch(() => undefined)}
              >
                {state === 'error' ? 'Retry' : 'Update'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
