// Database overview: its tables with sizes, bulk actions and maintenance.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileCode, Plus, RefreshCw, Search, Table2, Trash2, Upload, Wrench, Eraser } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MaintenanceOp, StatementResult } from '@shared/types'
import { qualified } from '@shared/sql/quote'
import { api, errorMessage } from '../../lib/bridge'
import { formatBytes, formatNumber } from '../../lib/format'
import { runStatements } from '../../lib/actions'
import { toast } from '../../components/feedback'
import { Button, Dialog, ErrorBox, Input, Select, Spinner } from '../../components/ui'
import { openQueryTab, openTab, useApp, type DatabaseTab } from '../../store'
import { openIo } from '../io/ioStore'

export function DatabaseTabView({ tab }: { tab: DatabaseTab }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [maintenance, setMaintenance] = useState<{ op: MaintenanceOp; results: StatementResult[] } | null>(null)
  const [running, setRunning] = useState(false)
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['objects', sessionId, tab.database],
    queryFn: () => api.schema.objects({ sessionId, database: tab.database })
  })

  const tables = useMemo(
    () => (data?.tables ?? []).filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())),
    [data, search]
  )
  const totals = useMemo(
    () =>
      tables.reduce(
        (acc, t) => ({ rows: acc.rows + (t.rows ?? 0), data: acc.data + (t.dataLength ?? 0), index: acc.index + (t.indexLength ?? 0) }),
        { rows: 0, data: 0, index: 0 }
      ),
    [tables]
  )
  const selectedTables = tables.filter((t) => selected.has(t.name))
  const selectedBaseTables = selectedTables.filter((t) => t.kind === 'table').map((t) => t.name)

  const toggle = (name: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const runMaintenance = async (op: MaintenanceOp): Promise<void> => {
    setRunning(true)
    try {
      const results = await api.admin.maintenance({ sessionId, database: tab.database, tables: selectedBaseTables, op })
      setMaintenance({ op, results })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
        <span className="text-[13px] font-semibold">{tab.database}</span>
        <span className="text-xs text-muted">
          {data ? `${data.tables.length} tables/views · ${data.routines.length} routines · ${data.triggers.length} triggers · ${data.events.length} events` : ''}
        </span>
        <div className="flex-1" />
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => openTab({ kind: 'structure', database: tab.database, table: null })}>
          New table
        </Button>
        <Button size="sm" icon={<FileCode className="size-3.5" />} onClick={() => openQueryTab({ database: tab.database })}>
          New query
        </Button>
        <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => openIo({ kind: 'importSql', database: tab.database })}>
          Import
        </Button>
        <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => openIo({ kind: 'dump', database: tab.database })}>
          Export
        </Button>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input className="h-8 pl-7" placeholder="Filter tables" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />} onClick={() => void refetch()}>
          Refresh
        </Button>
        <div className="flex-1" />
        {selectedTables.length > 0 && (
          <>
            <span className="text-xs text-muted">{selectedTables.length} selected</span>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => openIo({ kind: 'dump', database: tab.database, tables: selectedTables.map((t) => t.name) })}>
              Dump
            </Button>
            <Select
              className="h-7 w-40 text-xs"
              value=""
              disabled={running || selectedBaseTables.length === 0}
              onChange={(e) => e.target.value && void runMaintenance(e.target.value as MaintenanceOp)}
            >
              <option value="">Maintenance…</option>
              <option value="ANALYZE">Analyze</option>
              <option value="CHECK">Check</option>
              <option value="OPTIMIZE">Optimize</option>
              <option value="REPAIR">Repair</option>
            </Select>
            <Button
              size="sm"
              icon={<Eraser className="size-3.5" />}
              disabled={selectedBaseTables.length === 0}
              onClick={() =>
                void runStatements(
                  selectedBaseTables.map((t) => `TRUNCATE TABLE ${qualified(tab.database, t)}`),
                  tab.database,
                  queryClient,
                  { force: true, title: 'Truncate tables', success: `${selectedBaseTables.length} table(s) emptied` }
                )
              }
            >
              Truncate
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                const views = selectedTables.filter((t) => t.kind === 'view').map((t) => qualified(tab.database, t.name))
                const baseTables = selectedBaseTables.map((t) => qualified(tab.database, t))
                const statements = [
                  ...(views.length ? [`DROP VIEW ${views.join(', ')}`] : []),
                  ...(baseTables.length ? [`DROP TABLE ${baseTables.join(', ')}`] : [])
                ]
                const done = await runStatements(statements, tab.database, queryClient, {
                  force: true,
                  title: 'Drop tables',
                  success: `${selectedTables.length} object(s) dropped`
                })
                if (done) setSelected(new Set())
              }}
            >
              Drop
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <Spinner className="m-6" />}
        {error && (
          <div className="p-4">
            <ErrorBox>{errorMessage(error)}</ErrorBox>
          </div>
        )}
        {data && (
          <table className="w-full border-collapse whitespace-nowrap text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="sticky top-0 w-8 border-b border-border bg-panel px-3 py-1.5">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={tables.length > 0 && selected.size === tables.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(tables.map((t) => t.name)) : new Set())}
                  />
                </th>
                {['Name', 'Rows (est.)', 'Data', 'Index', 'Engine', 'Collation', 'Updated', 'Comment', ''].map((h) => (
                  <th key={h} className="sticky top-0 border-b border-border bg-panel px-3 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name} className="hover:bg-hover">
                  <td className="border-b border-border/60 px-3 py-1">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={selected.has(t.name)} onChange={() => toggle(t.name)} />
                  </td>
                  <td className="border-b border-border/60 px-3 py-1">
                    <button
                      className="flex items-center gap-1.5 hover:text-accent"
                      onClick={() => openTab({ kind: 'table', database: tab.database, table: t.name, isView: t.kind === 'view', view: 'data' })}
                    >
                      {t.kind === 'view' ? <Eye className="size-3.5 text-sky-400" /> : <Table2 className="size-3.5 text-sky-400" />}
                      {t.name}
                    </button>
                  </td>
                  <td className="border-b border-border/60 px-3 py-1 text-right font-mono">{formatNumber(t.rows)}</td>
                  <td className="border-b border-border/60 px-3 py-1 text-right font-mono">{formatBytes(t.dataLength)}</td>
                  <td className="border-b border-border/60 px-3 py-1 text-right font-mono">{formatBytes(t.indexLength)}</td>
                  <td className="border-b border-border/60 px-3 py-1">{t.engine}</td>
                  <td className="border-b border-border/60 px-3 py-1">{t.collation}</td>
                  <td className="border-b border-border/60 px-3 py-1 text-muted">{t.updateTime}</td>
                  <td className="max-w-64 truncate border-b border-border/60 px-3 py-1 text-muted">{t.comment}</td>
                  <td className="border-b border-border/60 px-3 py-1">
                    {t.kind === 'table' && (
                      <button className="text-muted hover:text-fg" title="Alter table" onClick={() => openTab({ kind: 'structure', database: tab.database, table: t.name })}>
                        <Wrench className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-muted">
                <td />
                <td className="px-3 py-1.5 font-semibold">{tables.length} object(s)</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatNumber(totals.rows)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatBytes(totals.data)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatBytes(totals.index)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <Dialog open={!!maintenance} onOpenChange={(open) => !open && setMaintenance(null)} title={`${maintenance?.op ?? ''} TABLE`} width={760}>
        {maintenance?.results.map((result, i) =>
          result.kind === 'rows' ? (
            <table key={i} className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c.name} className="border-b border-border px-2 py-1 text-left text-muted">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((value, k) => (
                      <td key={k} className="selectable border-b border-border/60 px-2 py-1 font-mono">
                        {String(value ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : result.kind === 'error' ? (
            <ErrorBox key={i}>{result.message}</ErrorBox>
          ) : null
        )}
      </Dialog>
    </div>
  )
}
