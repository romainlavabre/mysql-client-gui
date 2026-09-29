// Adds a workspace: clone a remote repository, open a folder or create a new one.
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { dropSession, useApp } from '../../store'
import { Button, Dialog, ErrorBox, Field, IconButton, Input, SegmentedControl } from '../../components/ui'

type Mode = 'clone' | 'open' | 'create'

function nameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
  return last.replace(/\.git$/, '')
}

export function AddWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('clone')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setNameTouched(false)
      setRemoteUrl('')
      setPath('')
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!nameTouched && mode === 'clone') setName(nameFromUrl(remoteUrl))
  }, [remoteUrl, mode, nameTouched])

  const browse = async (): Promise<void> => {
    const folder = await api.dialog.openDirectory({ title: mode === 'open' ? 'Workspace folder' : 'Where to put the workspace' })
    if (!folder) return
    setPath(folder)
    if (!nameTouched && mode === 'open') setName(folder.split('/').pop() ?? '')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (useApp.getState().session) dropSession()
      const trimmedName = name.trim()
      if (mode === 'clone') await api.workspace.clone({ name: trimmedName, remoteUrl: remoteUrl.trim(), path: path || undefined })
      else if (mode === 'open') await api.workspace.open({ name: trimmedName, path })
      else await api.workspace.create({ name: trimmedName, path: path || undefined })
      await queryClient.invalidateQueries({ queryKey: ['workspace'] })
      toast(`Workspace "${trimmedName}" added`, 'success')
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const valid = name.trim() && (mode === 'clone' ? remoteUrl.trim() : mode === 'open' ? path : true)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add workspace"
      width={560}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {mode === 'clone' ? 'Clone' : mode === 'open' ? 'Open' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid && !busy) void submit()
        }}
      >
        <p className="text-xs leading-relaxed text-muted">
          A workspace is a git repository holding shared connections (without passwords) and saved queries. Use one per client or
          team, and switch between them from the sidebar.
        </p>
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'clone', label: 'Clone a repository' },
            { value: 'open', label: 'Open a folder' },
            { value: 'create', label: 'Create new' }
          ]}
        />
        {mode === 'clone' && (
          <Field label="Repository URL" hint="SSH URLs use your SSH agent; HTTPS URLs your git credential helper.">
            <Input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="git@github.com:acme/db-workspace.git" />
          </Field>
        )}
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameTouched(true)
            }}
            placeholder="Client A"
          />
        </Field>
        <Field
          label={mode === 'open' ? 'Folder' : 'Local folder (optional)'}
          hint={mode === 'open' ? 'An existing git repository or any folder.' : 'Defaults to the app data folder.'}
        >
          <div className="flex gap-1">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={mode === 'open' ? '/path/to/folder' : 'Automatic'} />
            <IconButton label="Browse" type="button" onClick={() => void browse()} className="h-8 w-8 border border-border">
              <FolderOpen className="size-4" />
            </IconButton>
          </div>
        </Field>
        {mode === 'create' && (
          <p className="text-xs text-muted">You can link it to a remote repository later from the workspace menu.</p>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </form>
    </Dialog>
  )
}
