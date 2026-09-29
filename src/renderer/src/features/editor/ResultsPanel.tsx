// Results of an editor execution: one sub-tab per statement result.
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Copy, Download, XCircle } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { RowsResult, StatementResult } from '@shared/types'
import { formatDuration, formatNumber } from '../../lib/format'
import { DataGrid, type DataGridHandle } from '../../components/DataGrid'
import { CellViewer } from '../../components/CellViewer'
import { EmptyState, ErrorBox, IconButton, Spinner } from '../../components/ui'
import { openIo } from '../io/ioStore'

function resultLabel(result: StatementResult, index: number): string {
  if (result.kind === 'rows') return `Result ${index + 1}`
  if (result.kind === 'error') return `Error ${index + 1}`
  return `Statement ${index + 1}`
}

export function ResultsPanel({
  results,
  active,
  onActiveChange,
  running,
  rowLimit
}: {
  results: StatementResult[]
  active: number
  onActiveChange: (index: number) => void
  running: boolean
  rowLimit: number
}) {
  if (running && results.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted">
        <Spinner /> Running…
      </div>
    )
  }
  if (results.length === 0) {
    return (
      <EmptyState title="No results yet">
        <p className="text-xs">
          <kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">Enter</kbd> runs the
          statement under the cursor (or the selection),{' '}
          <kbd className="rounded border border-border px-1">Ctrl</kbd>+<kbd className="rounded border border-border px-1">Shift</kbd>+
          <kbd className="rounded border border-border px-1">Enter</kbd> runs everything.
        </p>
      </EmptyState>
    )
  }

  const current = results[Math.min(active, results.length - 1)]
  // Only a single OK or error result: no sub-tabs needed.
  const showTabs = results.length > 1

  return (
    <div className="flex h-full flex-col">
      {showTabs && (
        <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel">
          {results.map((result, index) => (
            <button
              key={index}
              className={clsx(
                'flex items-center gap-1.5 border-r border-border px-3 text-xs',
                index === active ? 'bg-bg text-fg' : 'text-muted hover:bg-hover'
              )}
              onClick={() => onActiveChange(index)}
            >
              {result.kind === 'error' ? (
                <XCircle className="size-3.5 text-danger" />
              ) : result.kind === 'ok' ? (
                <CheckCircle2 className="size-3.5 text-success" />
              ) : null}
              {resultLabel(result, index)}
              {result.kind === 'rows' && <span className="text-muted">({formatNumber(result.rows.length)})</span>}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {current.kind === 'rows' ? (
          <RowsView key={`${active}-${current.sql}`} result={current} rowLimit={rowLimit} />
        ) : current.kind === 'ok' ? (
          <div className="flex flex-col gap-2 p-4 text-sm">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-4" />
              {formatNumber(current.affectedRows)} row(s) affected
              {current.insertId ? <span className="text-muted">· last insert id {current.insertId}</span> : null}
              <span className="text-muted">· {formatDuration(current.durationMs)}</span>
            </div>
            {current.info && <div className="text-xs text-muted">{current.info}</div>}
            {current.warningCount > 0 && <div className="text-xs text-warning">{current.warningCount} warning(s) — run SHOW WARNINGS for details</div>}
            <pre className="selectable mt-2 max-h-40 overflow-auto rounded bg-panel p-2 font-mono text-[11px] text-muted">{current.sql}</pre>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-4">
            <ErrorBox>
              {current.code ? `${current.code}: ` : ''}
              {current.message}
            </ErrorBox>
            <pre className="selectable max-h-40 overflow-auto rounded bg-panel p-2 font-mono text-[11px] text-muted">{current.sql}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

function RowsView({ result, rowLimit }: { result: RowsResult; rowLimit: number }) {
  const grid = useRef<DataGridHandle>(null)
  const [viewing, setViewing] = useState<{ row: number; col: number } | null>(null)
  const columns = useMemo(
    () => result.columns.map((c) => ({ name: c.name, type: c.type, primaryKey: c.primaryKey })),
    [result.columns]
  )
  const tableName = result.columns.find((c) => c.table)?.table

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <DataGrid ref={grid} columns={columns} rows={result.rows} onCellDoubleClick={(row, col) => setViewing({ row, col })} />
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 text-[11px] text-muted">
        <span>{formatNumber(result.rows.length)} row(s)</span>
        {result.truncated && (
          <span className="flex items-center gap-1 text-warning">
            <AlertTriangle className="size-3" /> limited to {formatNumber(rowLimit)} rows — add a LIMIT or raise it in the settings
          </span>
        )}
        <span>{formatDuration(result.durationMs)}</span>
        <div className="flex-1" />
        <IconButton label="Copy selected rows (Ctrl+C, with headers: Ctrl+Shift+C)" onClick={() => grid.current?.copy(true)} className="size-6">
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton
          label="Export results"
          className="size-6"
          onClick={() => openIo({ kind: 'exportRows', columns: result.columns.map((c) => c.name), rows: result.rows, tableName })}
        >
          <Download className="size-3.5" />
        </IconButton>
      </div>
      {viewing && (
        <CellViewer
          open
          onOpenChange={(open) => !open && setViewing(null)}
          column={result.columns[viewing.col]?.name ?? ''}
          value={result.rows[viewing.row]?.[viewing.col] ?? null}
          editable={false}
        />
      )}
    </div>
  )
}
