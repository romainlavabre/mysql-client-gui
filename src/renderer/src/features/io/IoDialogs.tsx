// Import and export dialogs.
import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CsvPreview, ExportFormat } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Checkbox, Dialog, ErrorBox, Field, IconButton, Input, SegmentedControl, Select, Spinner } from '../../components/ui'
import { useApp } from '../../store'
import { closeIo, useIoDialog, type IoDialog } from './ioStore'

const FORMAT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  json: { name: 'JSON', extensions: ['json'] },
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  sql: { name: 'SQL', extensions: ['sql'] }
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'sql', label: 'SQL INSERT' }
]

const timestamp = (): string => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')

async function chooseSavePath(title: string, name: string, format: ExportFormat): Promise<string | null> {
  return api.dialog.saveFile({ title, defaultPath: `${name}.${format}`, filters: [FORMAT_FILTERS[format]] })
}

export function IoDialogs() {
  const dialog = useIoDialog((s) => s.dialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'dump':
      return <DumpDialog dialog={dialog} />
    case 'exportTable':
      return <ExportTableDialog dialog={dialog} />
    case 'exportRows':
      return <ExportRowsDialog dialog={dialog} />
    case 'importSql':
      return <ImportSqlDialog dialog={dialog} />
    case 'importCsv':
      return <ImportCsvDialog dialog={dialog} />
  }
}

function useSessionId(): string {
  return useApp((s) => s.session!.info.sessionId)
}

function DumpDialog({ dialog }: { dialog: Extract<IoDialog, { kind: 'dump' }> }) {
  const sessionId = useSessionId()
  const { data: objects } = useQuery({
    queryKey: ['objects', sessionId, dialog.database],
    queryFn: () => api.schema.objects({ sessionId, database: dialog.database })
  })
  const [tables, setTables] = useState<Set<string>>(new Set(dialog.tables ?? []))
  const [structure, setStructure] = useState(true)
  const [data, setData] = useState(true)
  const [drop, setDrop] = useState(true)
  const [routines, setRoutines] = useState(!dialog.tables)
  const [triggers, setTriggers] = useState(true)
  const [events, setEvents] = useState(!dialog.tables)
  const [rowsPerInsert, setRowsPerInsert] = useState(500)

  useEffect(() => {
    if (!dialog.tables && objects) setTables(new Set(objects.tables.map((t) => t.name)))
  }, [objects, dialog.tables])

  const start = async (): Promise<void> => {
    const filePath = await api.dialog.saveFile({
      title: 'Save dump',
      defaultPath: `${dialog.database}-${timestamp()}.sql`,
      filters: [FORMAT_FILTERS.sql]
    })
    if (!filePath) return
    const all = objects?.tables.length === tables.size
    try {
      await api.io.dump({
        sessionId,
        database: dialog.database,
        tables: all ? [] : [...tables],
        structure,
        data,
        dropStatements: drop,
        routines,
        triggers,
        events,
        rowsPerInsert,
        filePath
      })
      closeIo()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeIo()}
      title={`Export ${dialog.database}`}
      width={640}
      footer={
        <>
          <Button onClick={closeIo}>Cancel</Button>
          <Button variant="primary" disabled={tables.size === 0 || (!structure && !data)} onClick={() => void start()}>
            Export…
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Tables ({tables.size})</span>
            <span className="flex gap-2">
              <button className="hover:text-fg" onClick={() => setTables(new Set(objects?.tables.map((t) => t.name)))}>
                All
              </button>
              <button className="hover:text-fg" onClick={() => setTables(new Set())}>
                None
              </button>
            </span>
          </div>
          <div className="h-72 overflow-auto rounded-md border border-border p-2 text-xs">
            {!objects && <Spinner />}
            {objects?.tables.map((t) => (
              <div key={t.name} className="py-0.5">
                <Checkbox
                  checked={tables.has(t.name)}
                  onChange={(checked) =>
                    setTables((s) => {
                      const next = new Set(s)
                      if (checked) next.add(t.name)
                      else next.delete(t.name)
                      return next
                    })
                  }
                  label={
                    <span>
                      {t.name}
                      {t.kind === 'view' && <span className="ml-1 text-muted">(view)</span>}
                    </span>
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2.5 text-xs">
          <Checkbox checked={structure} onChange={setStructure} label="Structure (CREATE)" />
          <Checkbox checked={data} onChange={setData} label="Data (INSERT)" />
          <Checkbox checked={drop} onChange={setDrop} label="Add DROP … IF EXISTS" />
          <Checkbox checked={routines} onChange={setRoutines} label="Procedures and functions" />
          <Checkbox checked={triggers} onChange={setTriggers} label="Triggers" />
          <Checkbox checked={events} onChange={setEvents} label="Events" />
          <Field label="Rows per INSERT statement">
            <Input type="number" min={1} value={rowsPerInsert} onChange={(e) => setRowsPerInsert(Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <p className="text-muted">Rows are streamed to the file: large databases do not load in memory. DEFINER clauses are removed.</p>
        </div>
      </div>
    </Dialog>
  )
}

function ExportTableDialog({ dialog }: { dialog: Extract<IoDialog, { kind: 'exportTable' }> }) {
  const sessionId = useSessionId()
  const [format, setFormat] = useState<ExportFormat>('csv')
  const start = async (): Promise<void> => {
    const filePath = await chooseSavePath(`Export ${dialog.table}`, dialog.table, format)
    if (!filePath) return
    try {
      await api.io.exportTable({ sessionId, database: dialog.database, table: dialog.table, format, filePath })
      closeIo()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeIo()}
      title={`Export ${dialog.table}`}
      footer={
        <>
          <Button onClick={closeIo}>Cancel</Button>
          <Button variant="primary" onClick={() => void start()}>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl value={format} onChange={setFormat} options={FORMAT_OPTIONS} />
        <p className="text-xs text-muted">All rows of the table are exported, streamed to the file.</p>
      </div>
    </Dialog>
  )
}

function ExportRowsDialog({ dialog }: { dialog: Extract<IoDialog, { kind: 'exportRows' }> }) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [tableName, setTableName] = useState(dialog.tableName ?? 'export')
  const start = async (): Promise<void> => {
    const filePath = await chooseSavePath('Export results', `${tableName}-${timestamp()}`, format)
    if (!filePath) return
    try {
      await api.io.exportRows({ format, filePath, columns: dialog.columns, rows: dialog.rows, tableName })
      toast(`${dialog.rows.length} row(s) exported`, 'success')
      closeIo()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeIo()}
      title={`Export ${dialog.rows.length} row(s)`}
      footer={
        <>
          <Button onClick={closeIo}>Cancel</Button>
          <Button variant="primary" onClick={() => void start()}>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl value={format} onChange={setFormat} options={FORMAT_OPTIONS} />
        {format === 'sql' && (
          <Field label="Table name in INSERT statements">
            <Input value={tableName} onChange={(e) => setTableName(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-muted">Exports the rows loaded in the grid. To export a whole table, use the table's export action.</p>
      </div>
    </Dialog>
  )
}

function FilePicker({ value, onChange, title, extensions }: { value: string; onChange: (v: string) => void; title: string; extensions: string[] }) {
  return (
    <div className="flex gap-1">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Choose a file" />
      <IconButton
        label="Browse"
        className="h-8 w-8 border border-border"
        onClick={async () => {
          const file = await api.dialog.openFile({ title, filters: [{ name: extensions.join(', '), extensions }] })
          if (file) onChange(file)
        }}
      >
        <FolderOpen className="size-4" />
      </IconButton>
    </div>
  )
}

function ImportSqlDialog({ dialog }: { dialog: Extract<IoDialog, { kind: 'importSql' }> }) {
  const session = useApp((s) => s.session)!
  const [filePath, setFilePath] = useState('')
  const [stopOnError, setStopOnError] = useState(true)
  const [confirmText, setConfirmText] = useState('')
  const isProd = session.connection.env === 'prod'

  const start = async (): Promise<void> => {
    try {
      await api.io.importSql({ sessionId: session.info.sessionId, database: dialog.database, filePath, stopOnError })
      closeIo()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeIo()}
      title={`Import SQL${dialog.database ? ` into ${dialog.database}` : ''}`}
      footer={
        <>
          <Button onClick={closeIo}>Cancel</Button>
          <Button variant={isProd ? 'danger' : 'primary'} disabled={!filePath || (isProd && confirmText !== session.connection.name)} onClick={() => void start()}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="SQL file" hint="Dumps from mysqldump, phpMyAdmin or this app. DELIMITER commands are supported.">
          <FilePicker value={filePath} onChange={setFilePath} title="SQL file" extensions={['sql', 'txt']} />
        </Field>
        <Checkbox checked={stopOnError} onChange={setStopOnError} label="Stop at the first error" />
        {isProd && (
          <Field label={<>Production connection: type <span className="font-mono text-fg">{session.connection.name}</span> to confirm</>}>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  )
}

function ImportCsvDialog({ dialog }: { dialog: Extract<IoDialog, { kind: 'importCsv' }> }) {
  const sessionId = useSessionId()
  const [filePath, setFilePath] = useState('')
  const [delimiter, setDelimiter] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [nullValue, setNullValue] = useState('NULL')
  const [mode, setMode] = useState<'insert' | 'insertIgnore' | 'replace'>('insert')
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [error, setError] = useState<string | null>(null)
  const { data: details } = useQuery({
    queryKey: ['table', sessionId, dialog.database, dialog.table],
    queryFn: () => api.schema.table({ sessionId, database: dialog.database, table: dialog.table })
  })
  const columns = details?.columns.map((c) => c.name) ?? []

  useEffect(() => {
    if (!filePath) return
    setError(null)
    api.io
      .previewCsv({ filePath, delimiter: delimiter || undefined })
      .then((result) => {
        setPreview(result)
        if (!delimiter) setDelimiter(result.delimiter)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [filePath, delimiter])

  // Map CSV columns to table columns with the same name (or position without header).
  useEffect(() => {
    if (!preview || columns.length === 0) return
    setMapping(
      preview.headers.map((header, i) => {
        if (!hasHeader) return columns[i] ?? null
        return columns.find((c) => c.toLowerCase() === header.trim().toLowerCase()) ?? null
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, hasHeader, details])

  const start = async (): Promise<void> => {
    try {
      await api.io.importCsv({
        sessionId,
        database: dialog.database,
        table: dialog.table,
        filePath,
        delimiter: delimiter === '\\t' ? '\t' : delimiter,
        hasHeader,
        mapping,
        nullValue,
        batchSize: 500,
        mode
      })
      closeIo()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const rows = preview ? (hasHeader ? preview.rows : [preview.headers, ...preview.rows]).slice(0, 5) : []

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeIo()}
      title={`Import CSV into ${dialog.table}`}
      width={820}
      footer={
        <>
          <Button onClick={closeIo}>Cancel</Button>
          <Button variant="primary" disabled={!filePath || !mapping.some(Boolean)} onClick={() => void start()}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="CSV file">
          <FilePicker value={filePath} onChange={setFilePath} title="CSV file" extensions={['csv', 'tsv', 'txt']} />
        </Field>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Delimiter">
            <Select value={delimiter === '\t' ? '\\t' : delimiter} onChange={(e) => setDelimiter(e.target.value === '\\t' ? '\t' : e.target.value)}>
              <option value=",">Comma ,</option>
              <option value=";">Semicolon ;</option>
              <option value="\t">Tab</option>
              <option value="|">Pipe |</option>
            </Select>
          </Field>
          <Field label="NULL marker">
            <Input value={nullValue} onChange={(e) => setNullValue(e.target.value)} />
          </Field>
          <Field label="On duplicate key">
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="insert">Fail (INSERT)</option>
              <option value="insertIgnore">Skip (INSERT IGNORE)</option>
              <option value="replace">Replace (REPLACE)</option>
            </Select>
          </Field>
          <div className="flex items-end pb-1.5">
            <Checkbox checked={hasHeader} onChange={setHasHeader} label="First line is a header" />
          </div>
        </div>
        {preview && (
          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {preview.headers.map((header, i) => (
                    <th key={i} className="border-b border-border bg-panel p-1.5 text-left">
                      <div className="mb-1 truncate text-muted">{hasHeader ? header : `Column ${i + 1}`}</div>
                      <Select
                        className="h-7 text-xs"
                        value={mapping[i] ?? ''}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value || null : v)))}
                      >
                        <option value="">Skip</option>
                        {columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((_, j) => (
                      <td key={j} className="max-w-48 truncate border-b border-border/60 px-1.5 py-1 font-mono">
                        {row[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">Rows are inserted in batches inside one transaction: an error cancels the whole import.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Dialog>
  )
}
