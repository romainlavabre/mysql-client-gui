// Local preferences.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Dialog, Field, Input } from '../../components/ui'
import { setRowLimit, useApp } from '../../store'

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rowLimit = useApp((s) => s.rowLimit)
  const [limit, setLimit] = useState(String(rowLimit))
  const { data: info } = useQuery({ queryKey: ['app-info'], queryFn: () => api.app.info(), enabled: open })

  useEffect(() => {
    if (open) setLimit(String(rowLimit))
  }, [open, rowLimit])

  const save = (): void => {
    const value = Number(limit)
    if (!Number.isInteger(value) || value < 1) {
      toast('The row limit must be a positive integer', 'error')
      return
    }
    setRowLimit(value)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Row limit for query results" hint="Rows beyond the limit are not loaded. Table views are paginated anyway.">
          <Input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        {info && (
          <div className="rounded-md border border-border p-3 text-xs text-muted">
            <div>Version {info.version}</div>
            <div>
              Saved passwords:{' '}
              {info.secretsEncrypted ? (
                <span className="text-success">encrypted with the system keyring</span>
              ) : (
                <span className="text-warning">no system keyring found, encrypted with a local key file only</span>
              )}
            </div>
            <div>Keyring backend: {info.secretsBackend}</div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
