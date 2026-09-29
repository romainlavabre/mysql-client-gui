// CREATE DATABASE with charset and collation.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { quoteIdent } from '@shared/sql/quote'
import { api } from '../../lib/bridge'
import { runStatements } from '../../lib/actions'
import { Button, Dialog, Field, Input, Select } from '../../components/ui'
import { useApp } from '../../store'

export function CreateDatabaseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useApp((s) => s.session)!
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [charset, setCharset] = useState('utf8mb4')
  const [collation, setCollation] = useState('')
  const { data: charsets } = useQuery({
    queryKey: ['charsets', session.info.sessionId],
    queryFn: () => api.schema.charsets({ sessionId: session.info.sessionId }),
    enabled: open,
    staleTime: Infinity
  })

  useEffect(() => {
    if (open) {
      setName('')
      setCharset('utf8mb4')
      setCollation('')
    }
  }, [open])

  const current = charsets?.find((c) => c.charset === charset)
  const sql = `CREATE DATABASE ${quoteIdent(name || 'new_database')} CHARACTER SET ${charset}${collation ? ` COLLATE ${collation}` : ''}`

  const create = async (): Promise<void> => {
    const done = await runStatements([sql], null, queryClient, { success: `Database ${name} created` })
    if (done) {
      useApp.setState({ currentDatabase: name })
      onOpenChange(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create database"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Charset">
            <Select
              value={charset}
              onChange={(e) => {
                setCharset(e.target.value)
                setCollation('')
              }}
            >
              {(charsets ?? [{ charset: 'utf8mb4', collations: [], defaultCollation: '' }]).map((c) => (
                <option key={c.charset} value={c.charset}>
                  {c.charset}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Collation">
            <Select value={collation} onChange={(e) => setCollation(e.target.value)}>
              <option value="">Default{current?.defaultCollation ? ` (${current.defaultCollation})` : ''}</option>
              {current?.collations.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <pre className="selectable rounded bg-bg p-2 font-mono text-[11px] text-muted">{sql}</pre>
      </div>
    </Dialog>
  )
}
