// Result grid based on AG Grid Community: virtualized, resizable, optionally editable.
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassParams,
  type CellKeyDownEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type SortChangedEvent
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { CellValue, SortSpec } from '@shared/types'
import { cellRaw, cellText } from '../lib/format'

ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz.withParams({
  backgroundColor: 'var(--bg)',
  foregroundColor: 'var(--fg)',
  headerBackgroundColor: 'var(--panel)',
  headerTextColor: 'var(--fg)',
  borderColor: 'var(--border)',
  chromeBackgroundColor: 'var(--panel)',
  accentColor: 'var(--accent)',
  selectedRowBackgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
  rowHoverColor: 'var(--hover)',
  oddRowBackgroundColor: 'color-mix(in srgb, var(--panel) 45%, var(--bg))',
  fontFamily: 'var(--font-mono)',
  headerFontFamily: 'var(--font-sans)',
  headerFontWeight: 600,
  fontSize: 12,
  rowHeight: 26,
  headerHeight: 30,
  spacing: 4,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  cellHorizontalPaddingScale: 0.8,
  inputFocusBorder: { color: 'var(--accent)' }
})

export interface GridColumn {
  name: string
  type?: string
  primaryKey?: boolean
  /** Referenced table, shown as a hint in the header. */
  foreignKey?: string
}

export type RowStatus = 'new' | 'deleted' | 'modified'

export interface DataGridHandle {
  focusedCell(): { row: number; col: number } | null
  selectedRows(): number[]
  /** Copies the selected rows (or the focused cell) as tab-separated text. */
  copy(withHeaders?: boolean): void
  selectAll(): void
}

interface Props {
  columns: GridColumn[]
  rows: CellValue[][]
  editable?: boolean
  onEdit?: (row: number, col: number, value: CellValue) => void
  rowStatus?: (row: number) => RowStatus | undefined
  isCellModified?: (row: number, col: number) => boolean
  onSelectionChange?: (rows: number[]) => void
  onCellDoubleClick?: (row: number, col: number) => void
  /** When set, sorting is done by the caller (server side). */
  sort?: SortSpec[]
  onSortChange?: (sort: SortSpec[]) => void
}

type GridRow = Record<string, CellValue> & { __i: number }

const colField = (index: number): string => `c${index}`

export const DataGrid = forwardRef<DataGridHandle, Props>(function DataGrid(
  { columns, rows, editable, onEdit, rowStatus, isCellModified, onSelectionChange, onCellDoubleClick, sort, onSortChange },
  ref
) {
  const gridApi = useRef<GridApi<GridRow> | null>(null)
  const serverSort = !!onSortChange
  const callbacks = useRef({ onEdit, rowStatus, isCellModified, onSelectionChange, onCellDoubleClick, onSortChange })
  callbacks.current = { onEdit, rowStatus, isCellModified, onSelectionChange, onCellDoubleClick, onSortChange }

  const rowData = useMemo<GridRow[]>(
    () =>
      rows.map((row, i) => {
        const object: GridRow = { __i: i }
        row.forEach((value, c) => {
          object[colField(c)] = value
        })
        return object
      }),
    [rows]
  )

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    const numberColumn: ColDef<GridRow> = {
      colId: '__row',
      headerName: '',
      valueGetter: (p) => (p.data ? p.data.__i + 1 : ''),
      width: 56,
      pinned: 'left',
      sortable: false,
      resizable: false,
      editable: false,
      suppressMovable: true,
      cellClass: 'cell-row-number',
      suppressNavigable: true
    }
    return [
      numberColumn,
      ...columns.map<ColDef<GridRow>>((column, index) => {
        const sortEntry = sort?.find((s) => s.column === column.name)
        return {
          colId: String(index),
          field: colField(index),
          headerName: column.name,
          headerTooltip: [column.type, column.primaryKey ? 'PRIMARY KEY' : '', column.foreignKey ? `→ ${column.foreignKey}` : '']
            .filter(Boolean)
            .join(' · '),
          headerClass: column.primaryKey ? 'text-accent' : undefined,
          valueFormatter: (p) => cellText(p.value as CellValue),
          editable: (p) => !!editable && !(p.data?.[colField(index)] instanceof Uint8Array) && callbacks.current.rowStatus?.(p.data?.__i ?? -1) !== 'deleted',
          valueParser: (p) => p.newValue as string,
          sortable: true,
          sort: serverSort ? (sortEntry ? (sortEntry.direction === 'ASC' ? 'asc' : 'desc') : null) : undefined,
          // Server side sort: keep the row order as returned.
          comparator: serverSort ? () => 0 : undefined,
          cellClassRules: {
            'cell-null': (p: CellClassParams<GridRow>) => p.value === null,
            'cell-modified': (p: CellClassParams<GridRow>) =>
              !!p.data && !!callbacks.current.isCellModified?.(p.data.__i, index)
          }
        }
      })
    ]
  }, [columns, editable, serverSort, sort])

  // Status styles are read through callbacks: redraw when they change.
  useEffect(() => {
    gridApi.current?.redrawRows()
  }, [rowStatus, isCellModified])

  const onGridReady = useCallback((event: GridReadyEvent<GridRow>) => {
    gridApi.current = event.api
  }, [])

  const copyText = useCallback(
    (withHeaders = false) => {
      const api = gridApi.current
      if (!api) return
      const selected = api.getSelectedRows().sort((a, b) => a.__i - b.__i)
      const focused = api.getFocusedCell()
      const focusedRow = focused && focused.column.getColId() !== '__row' ? api.getDisplayedRowAtIndex(focused.rowIndex)?.data : undefined
      const cell = focused && focusedRow ? cellRaw((focusedRow[colField(Number(focused.column.getColId()))] ?? null) as CellValue) : null
      let text: string
      // A click selects its row: a single selected row still means "copy the clicked cell".
      if (cell !== null && selected.length <= 1 && !withHeaders) {
        text = cell
      } else if (selected.length > 0) {
        const lines = selected.map((row) => columns.map((_, c) => cellRaw(row[colField(c)] ?? null)).join('\t'))
        if (withHeaders) lines.unshift(columns.map((c) => c.name).join('\t'))
        text = lines.join('\n')
      } else if (cell !== null) {
        text = cell
      } else {
        return
      }
      void navigator.clipboard.writeText(text)
    },
    [columns]
  )

  useImperativeHandle(ref, () => ({
    focusedCell() {
      const focused = gridApi.current?.getFocusedCell()
      if (!focused || focused.column.getColId() === '__row') return null
      const row = gridApi.current?.getDisplayedRowAtIndex(focused.rowIndex)?.data
      return row ? { row: row.__i, col: Number(focused.column.getColId()) } : null
    },
    selectedRows() {
      return (gridApi.current?.getSelectedRows() ?? []).map((r) => r.__i).sort((a, b) => a - b)
    },
    copy: copyText,
    selectAll() {
      gridApi.current?.selectAll()
    }
  }))

  const onCellKeyDown = useCallback(
    (event: CellKeyDownEvent<GridRow>) => {
      const keyboard = event.event as KeyboardEvent | undefined
      if (!keyboard) return
      if ((keyboard.ctrlKey || keyboard.metaKey) && keyboard.key.toLowerCase() === 'c' && !event.api.getEditingCells().length) {
        copyText(keyboard.shiftKey)
      }
    },
    [copyText]
  )

  return (
    <div className="h-full w-full">
      <AgGridReact<GridRow>
        theme={gridTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        getRowId={(p) => String(p.data.__i)}
        defaultColDef={{ resizable: true, minWidth: 60, maxWidth: 600, suppressHeaderMenuButton: true }}
        autoSizeStrategy={{ type: 'fitCellContents' }}
        rowSelection={{ mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: true }}
        suppressCellFocus={false}
        stopEditingWhenCellsLoseFocus
        singleClickEdit={false}
        enableCellTextSelection={false}
        animateRows={false}
        tooltipShowDelay={400}
        rowClassRules={{
          'row-deleted': (p) => !!p.data && callbacks.current.rowStatus?.(p.data.__i) === 'deleted',
          'row-new': (p) => !!p.data && callbacks.current.rowStatus?.(p.data.__i) === 'new'
        }}
        onGridReady={onGridReady}
        onCellValueChanged={(e) => {
          if (!e.data || e.colDef.colId === undefined) return
          const next = (e.newValue ?? '') as string
          if (next === e.oldValue) return
          callbacks.current.onEdit?.(e.data.__i, Number(e.colDef.colId), next)
        }}
        onSelectionChanged={(e) => callbacks.current.onSelectionChange?.(e.api.getSelectedRows().map((r) => r.__i))}
        onCellDoubleClicked={(e) => {
          if (!e.data || editable || e.colDef.colId === '__row') return
          callbacks.current.onCellDoubleClick?.(e.data.__i, Number(e.colDef.colId))
        }}
        onSortChanged={(e: SortChangedEvent<GridRow>) => {
          if (!serverSort) return
          const state = e.api
            .getColumnState()
            .filter((c) => c.sort && c.colId !== '__row')
            .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
          callbacks.current.onSortChange?.(
            state.map((c) => ({ column: columns[Number(c.colId)].name, direction: c.sort === 'desc' ? 'DESC' : 'ASC' }))
          )
        }}
        onCellKeyDown={onCellKeyDown}
      />
    </div>
  )
})
