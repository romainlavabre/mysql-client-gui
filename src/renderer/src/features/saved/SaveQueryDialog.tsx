// Saves an editor tab as a query file in the workspace repository.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { SavedQuery } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Checkbox, Dialog, ErrorBox, Field, Input, Textarea } from '../../components/ui'
import { useApp } from '../../store'
import { useSavedQueries } from '../workspace/useWorkspace'

export function queryFileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'query'}.sql`
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function SaveQueryDialog({
  open,
  onOpenChange,
  initial,
  existing,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: { sql: string; name?: string }
  /** Query being renamed / moved. */
  existing?: SavedQuery
  onSaved?: (query: SavedQuery) => void
}) {
  const session = useApp((s) => s.session)
  const queryClient = useQueryClient()
  const { data: queries } = useSavedQueries()
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [description, setDescription] = useState('')
  const [bind, setBind] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const folders = useMemo(() => [...new Set((queries ?? []).map((q) => folderOf(q.path)).filter(Boolean))].sort(), [queries])

  useEffect(() => {
    if (!open) return
    setName(existing?.name ?? initial.name ?? '')
    setFolder(existing ? folderOf(existing.path) : '')
    setDescription(existing?.description ?? '')
    setBind(existing ? !!existing.connection : false)
    setError(null)
  }, [open, existing, initial.name])

  const cleanFolder = folder
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
  const path = `${cleanFolder ? `${cleanFolder}/` : ''}${queryFileName(name)}`
  const connectionSlug = existing?.connection ?? session?.connection.slug

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (path !== existing?.path && queries?.some((q) => q.path === path)) throw new Error(`A saved query already exists at ${path}`)
      const saved = await api.queries.save({
        query: {
          path,
          name: name.trim(),
          description: description.trim() || undefined,
          connection: bind ? connectionSlug : undefined,
          sql: existing?.sql ?? initial.sql
        },
        previousPath: existing?.path
      })
      await queryClient.invalidateQueries({ queryKey: ['queries'] })
      toast(`Saved "${saved.name}" to the workspace`, 'success')
      onSaved?.(saved)
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Rename or move query' : 'Save query'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void submit()
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly revenue" />
        </Field>
        <Field label="Folder" hint="Use / for sub-folders.">
          <Input value={folder} onChange={(e) => setFolder(e.target.value)} list="query-folders" placeholder="reports" />
          <datalist id="query-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
        <Field label="Description">
          <Textarea rows={2} className="font-sans text-[13px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {connectionSlug && (
          <Checkbox checked={bind} onChange={setBind} label={<>Only for connection <span className="font-mono">{connectionSlug}</span></>} />
        )}
        <div className="text-[11px] text-muted">
          File: <span className="font-mono">queries/{path}</span>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </form>
    </Dialog>
  )
}
