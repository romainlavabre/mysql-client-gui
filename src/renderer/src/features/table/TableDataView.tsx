// Paginated, filterable and editable view of a table's rows.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Filter,
  Hash,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
  Undo2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CellValue, ColumnFilter, RowChange, SortSpec, TableDetails } from '@shared/types'
import { rowChangesToSql } from '@shared/sql/rowChanges'
import { api, errorMessage } from '../../lib/bridge'
import { formatDuration, formatNumber } from '../../lib/format'
import { confirmStatements } from '../../lib/actions'
import { confirm, toast } from '../../components/feedback'
import { DataGrid, type DataGridHandle, type RowStatus } from '../../components/DataGrid'
import { CellViewer } from '../../components/CellViewer'
import { Button, Dialog, ErrorBox, IconButton, Select, Spinner } from '../../components/ui'
import { openTab, useApp, type TableTab } from '../../store'
import { openIo } from '../io/ioStore'
import { FilterBar } from './FilterBar'

const PAGE_SIZES = [100, 250, 500, 1000, 5000]

interface Pending {
  /** Row index → column index → new value. */
  edits: Map<number, Map<number, CellValue>>
  deleted: Set<number>
  inserted: CellValue[][]
}

const emptyPending = (): Pending => ({ edits: new Map(), deleted: new Set(), inserted: [] })

/** Columns identifying a row: primary key, else a unique key on NOT NULL columns. */
function rowKeyColumns(details: TableDetails): string[] {
  if (details.primaryKey.length > 0) return details.primaryKey
  const notNull = new Set(details.columns.filter((c) => !c.nullable).map((c) => c.name))
  const unique = details.indexes.find((i) => i.unique && i.columns.every((c) => notNull.has(c.name)))
  return unique ? unique.columns.map((c) => c.name) : []
}

export function TableDataView({ tab, details }: { tab: TableTab; details: TableDetails }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const queryClient = useQueryClient()
  const grid = useRef<DataGridHandle>(null)

  const [filters, setFilters] = useState<ColumnFilter[]>(() =>
    tab.initialFilter ? [{ column: tab.initialFilter.column, operator: '=', value: tab.initialFilter.value }] : []
  )
  const [rawWhere, setRawWhere] = useState('')
  const [applied, setApplied] = useState<{ filters: ColumnFilter[]; rawWhere: string }>({ filters, rawWhere: '' })
  const [showFilters, setShowFilters] = useState(!!tab.initialFilter)
  const [sort, setSort] = useState<SortSpec[]>([])
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<Pending>(emptyPending)
  const [selection, setSelection] = useState<number[]>([])
  const [viewing, setViewing] = useState<{ row: number; col: number } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [applying, setApplying] = useState(false)

  // A foreign key jump reuses the tab with a new filter.
  useEffect(() => {
    if (!tab.initialFilter) return
    const next = [{ column: tab.initialFilter.column, operator: '=' as const, value: tab.initialFilter.value }]
    setFilters(next)
    setApplied({ filters: next, rawWhere: '' })
    setShowFilters(true)
    setPage(0)
  }, [tab.initialFilter])

  const request = {
    sessionId,
    database: tab.database,
    table: tab.table,
    filters: applied.filters.filter((f) => f.column),
    rawWhere: applied.rawWhere || undefined
  }

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['tableData', sessionId, tab.database, tab.table, request.filters, request.rawWhere, sort, pageSize, page],
    queryFn: () => api.data.fetch({ ...request, sort, limit: pageSize, offset: page * pageSize }),
    staleTime: 0,
    gcTime: 0,
    placeholderData: (previous) => previous
  })

  const { data: total, refetch: count, isFetching: counting } = useQuery({
    queryKey: ['tableCount', sessionId, tab.database, tab.table, request.filters, request.rawWhere],
    queryFn: () => api.data.count(request),
    enabled: false
  })

  const keyColumns = useMemo(() => rowKeyColumns(details), [details])
  const editable = !tab.isView && keyColumns.length > 0 && !session.connection.readOnly
  const baseRows = useMemo(() => data?.rows ?? [], [data])
  const columns = useMemo(() => data?.columns.map((c) => c.name) ?? details.columns.map((c) => c.name), [data, details])
  const gridColumns = useMemo(
    () =>
      columns.map((name) => {
        const info = details.columns.find((c) => c.name === name)
        const fk = details.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === name)
        return { name, type: info?.type, primaryKey: details.primaryKey.includes(name), foreignKey: fk ? `${fk.refTable}.${fk.refColumns[0]}` : undefined }
      }),
    [columns, details]
  )

  // Rows displayed: fetched rows with pending edits applied, then new rows.
  const rows = useMemo(() => {
    const merged = baseRows.map((row, i) => {
      const edits = pending.edits.get(i)
      if (!edits) return row
      return row.map((value, c) => (edits.has(c) ? (edits.get(c) as CellValue) : value))
    })
    return [...merged, ...pending.inserted]
  }, [baseRows, pending])

  const changeCount = pending.edits.size + pending.deleted.size + pending.inserted.length

  // Pending changes are dropped when the page changes.
  const resetPending = useCallback(() => {
    setPending(emptyPending())
    setSelection([])
  }, [])

  const guardPending = async (action: () => void): Promise<void> => {
    if (
      changeCount > 0 &&
      !(await confirm({ title: 'Pending changes', body: `Discard ${changeCount} pending change(s)?`, confirmLabel: 'Discard', danger: true }))
    ) {
      return
    }
    resetPending()
    action()
  }

  const rowStatus = useCallback(
    (row: number): RowStatus | undefined => {
      if (row >= baseRows.length) return 'new'
      if (pending.deleted.has(row)) return 'deleted'
      if (pending.edits.has(row)) return 'modified'
      return undefined
    },
    [pending, baseRows.length]
  )

  const isCellModified = useCallback((row: number, col: number) => !!pending.edits.get(row)?.has(col), [pending])

  const onEdit = (row: number, col: number, value: CellValue): void => {
    setPending((current) => {
      const next: Pending = { edits: new Map(current.edits), deleted: new Set(current.deleted), inserted: [...current.inserted] }
      if (row >= baseRows.length) {
        const index = row - baseRows.length
        next.inserted[index] = next.inserted[index].map((v, c) => (c === col ? value : v))
        return next
      }
      const edits = new Map(next.edits.get(row) ?? [])
      if (value === baseRows[row][col]) edits.delete(col)
      else edits.set(col, value)
      if (edits.size === 0) next.edits.delete(row)
      else next.edits.set(row, edits)
      return next
    })
  }

  const addRow = (template?: CellValue[]): void => {
    const row =
      template?.map((value, c) => {
        const info = details.columns.find((col) => col.name === columns[c])
        return info?.extra.includes('auto_increment') ? null : value
      }) ?? columns.map(() => null)
    setPending((current) => ({ ...current, inserted: [...current.inserted, row] }))
  }

  const deleteSelected = (): void => {
    const rowsToDelete = grid.current?.selectedRows() ?? selection
    if (rowsToDelete.length === 0) {
      toast('Select the rows to delete first', 'info')
      return
    }
    setPending((current) => {
      const next: Pending = { edits: new Map(current.edits), deleted: new Set(current.deleted), inserted: [...current.inserted] }
      const insertedToRemove = new Set<number>()
      for (const row of rowsToDelete) {
        if (row >= baseRows.length) insertedToRemove.add(row - baseRows.length)
        else if (next.deleted.has(row)) next.deleted.delete(row)
        else next.deleted.add(row)
      }
      next.inserted = next.inserted.filter((_, i) => !insertedToRemove.has(i))
      return next
    })
  }

  const focused = (): { row: number; col: number } | null => grid.current?.focusedCell() ?? null

  const buildChanges = (): RowChange[] => {
    const keyOf = (row: number): Record<string, CellValue> =>
      Object.fromEntries(keyColumns.map((name) => [name, baseRows[row][columns.indexOf(name)]]))
    const changes: RowChange[] = []
    for (const [row, edits] of pending.edits) {
      if (pending.deleted.has(row)) continue
      changes.push({ type: 'update', key: keyOf(row), values: Object.fromEntries([...edits].map(([c, v]) => [columns[c], v])) })
    }
    for (const row of pending.deleted) changes.push({ type: 'delete', key: keyOf(row) })
    for (const row of pending.inserted) {
      // NULL in a new row means "use the column default".
      changes.push({ type: 'insert', values: Object.fromEntries(row.map((v, c) => [columns[c], v] as const).filter(([, v]) => v !== null)) })
    }
    return changes
  }

  const statements = useMemo(() => {
    if (!reviewing) return []
    try {
      return rowChangesToSql(tab.database, tab.table, buildChanges())
    } catch (e) {
      return [`-- ${errorMessage(e)}`]
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, pending])

  const apply = async (): Promise<void> => {
    const changes = buildChanges()
    if (!(await confirmStatements(rowChangesToSql(tab.database, tab.table, changes)))) return
    setApplying(true)
    try {
      const { affectedRows } = await api.data.applyChanges({ sessionId, database: tab.database, table: tab.table, changes })
      toast(`${changes.length} change(s) applied, ${affectedRows} row(s) affected`, 'success')
      resetPending()
      setReviewing(false)
      await refetch()
      void queryClient.invalidateQueries({ queryKey: ['objects', sessionId, tab.database] })
    } catch (e) {
      toast(`Nothing was changed: ${errorMessage(e)}`, 'error')
    } finally {
      setApplying(false)
    }
  }

  const jumpToReference = (): void => {
    const cell = focused()
    if (!cell) return
    const column = columns[cell.col]
    const fk = details.foreignKeys.find((f) => f.columns.includes(column))
    const value = rows[cell.row]?.[cell.col]
    if (!fk || value === null || value === undefined) {
      toast('Focus a non-NULL cell of a foreign key column first', 'info')
      return
    }
    const refColumn = fk.refColumns[fk.columns.indexOf(column)]
    openTab({
      kind: 'table',
      database: fk.refDatabase || tab.database,
      table: fk.refTable,
      isView: false,
      view: 'data',
      initialFilter: { column: refColumn, value: String(value) }
    })
  }

  const firstRow = page * pageSize + 1
  const hasNext = baseRows.length === pageSize

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton label="Filters" active={showFilters || applied.filters.length > 0 || !!applied.rawWhere} onClick={() => setShowFilters(!showFilters)}>
          <Filter className="size-4" />
        </IconButton>
        <IconButton label="Refresh" onClick={() => void guardPending(() => void refetch())}>
          <RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton label="Add row" disabled={!editable} onClick={() => addRow()}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton
          label="Duplicate focused row"
          disabled={!editable}
          onClick={() => {
            const cell = focused()
            if (cell) addRow(rows[cell.row])
          }}
        >
          <CopyPlus className="size-4" />
        </IconButton>
        <IconButton label="Delete selected rows (toggle)" disabled={!editable} onClick={deleteSelected}>
          <Trash2 className="size-4" />
        </IconButton>
        <IconButton
          label="Set focused cell to NULL"
          disabled={!editable}
          onClick={() => {
            const cell = focused()
            if (cell) onEdit(cell.row, cell.col, null)
          }}
        >
          <Hash className="size-4" />
        </IconButton>
        <IconButton label="View / edit focused cell" onClick={() => setViewing(focused())}>
          <Maximize2 className="size-4" />
        </IconButton>
        <IconButton label="Go to the referenced row (foreign key)" disabled={details.foreignKeys.length === 0} onClick={jumpToReference}>
          <ExternalLink className="size-4" />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton label="Copy selected rows" onClick={() => grid.current?.copy(true)}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label="Export table" onClick={() => openIo({ kind: 'exportTable', database: tab.database, table: tab.table })}>
          <Download className="size-4" />
        </IconButton>
        {changeCount > 0 && (
          <div className="ml-2 flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs text-warning">
            {changeCount} pending
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={resetPending}>
              Discard
            </Button>
            <Button size="sm" onClick={() => setReviewing(true)}>
              Review SQL
            </Button>
            <Button size="sm" variant="primary" loading={applying} onClick={() => void apply()}>
              Apply
            </Button>
          </div>
        )}
        <div className="flex-1" />
        {!editable && !tab.isView && keyColumns.length === 0 && (
          <span className="text-[11px] text-warning">Read-only: no primary or unique key</span>
        )}
      </div>

      {showFilters && (
        <FilterBar
          columns={columns}
          filters={filters}
          rawWhere={rawWhere}
          onChange={setFilters}
          onRawWhereChange={setRawWhere}
          onApply={() =>
            void guardPending(() => {
              setApplied({ filters, rawWhere })
              setPage(0)
            })
          }
        />
      )}

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="p-4">
            <ErrorBox>{errorMessage(error)}</ErrorBox>
          </div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <DataGrid
            ref={grid}
            columns={gridColumns}
            rows={rows}
            editable={editable}
            onEdit={onEdit}
            rowStatus={rowStatus}
            isCellModified={isCellModified}
            onSelectionChange={setSelection}
            onCellDoubleClick={(row, col) => setViewing({ row, col })}
            sort={sort}
            onSortChange={(next) => void guardPending(() => setSort(next))}
          />
        )}
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap border-t border-border bg-panel px-2 text-[11px] text-muted">
        <IconButton label="Previous page" className="size-6" disabled={page === 0} onClick={() => void guardPending(() => setPage(page - 1))}>
          <ChevronLeft className="size-4" />
        </IconButton>
        <span>
          {baseRows.length > 0 ? `${formatNumber(firstRow)}–${formatNumber(firstRow + baseRows.length - 1)}` : 'No rows'}
          {total !== undefined && ` of ${formatNumber(total)}`}
        </span>
        <IconButton label="Next page" className="size-6" disabled={!hasNext} onClick={() => void guardPending(() => setPage(page + 1))}>
          <ChevronRight className="size-4" />
        </IconButton>
        <Select
          className="h-6 w-24 text-[11px]"
          value={pageSize}
          onChange={(e) => void guardPending(() => {
            setPageSize(Number(e.target.value))
            setPage(0)
          })}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} / page
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" loading={counting} onClick={() => void count()}>
          Count rows
        </Button>
        {data && <span>{formatDuration(data.durationMs)}</span>}
        <div className="flex-1" />
        {data && <code className="selectable truncate font-mono text-[10px]">{data.sql}</code>}
      </div>

      {viewing && rows[viewing.row] && (
        <CellViewer
          open
          onOpenChange={(open) => !open && setViewing(null)}
          column={columns[viewing.col]}
          value={rows[viewing.row][viewing.col]}
          editable={editable && rowStatus(viewing.row) !== 'deleted'}
          onSave={(value) => onEdit(viewing.row, viewing.col, value)}
        />
      )}

      <Dialog
        open={reviewing}
        onOpenChange={setReviewing}
        title={`${changeCount} pending change(s)`}
        width={760}
        footer={
          <>
            <Button onClick={() => setReviewing(false)}>Close</Button>
            <Button variant="primary" loading={applying} onClick={() => void apply()}>
              Apply in one transaction
            </Button>
          </>
        }
      >
        <pre className="selectable max-h-[55vh] overflow-auto rounded bg-bg p-3 font-mono text-[11px] whitespace-pre-wrap">
          {statements.join(';\n') + (statements.length ? ';' : '')}
        </pre>
      </Dialog>
    </div>
  )
}
