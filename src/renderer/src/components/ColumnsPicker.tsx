// Ordered list of columns picked from a list (index and foreign key columns).
import * as Popover from '@radix-ui/react-popover'
import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { SearchList } from './SearchSelect'
import { cn } from './ui'

export interface PickedColumn {
  name: string
  length?: number | null
  order?: 'ASC' | 'DESC'
}

function label(column: PickedColumn): string {
  return `${column.name}${column.length ? `(${column.length})` : ''}${column.order === 'DESC' ? ' DESC' : ''}`
}

export function ColumnsPicker({
  value,
  columns,
  onChange,
  withOptions = false,
  placeholder = 'Add column'
}: {
  value: PickedColumn[]
  /** Columns that can be picked. */
  columns: string[]
  onChange: (value: PickedColumn[]) => void
  /** Prefix length and ASC / DESC per column (indexes). */
  withOptions?: boolean
  placeholder?: string
}) {
  const [adding, setAdding] = useState(false)
  const available = columns.filter((c) => !value.some((v) => v.name === c))

  const update = (index: number, patch: Partial<PickedColumn>): void => onChange(value.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const move = (index: number, delta: number): void => {
    const next = [...value]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    onChange(next)
  }

  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1">
      {value.map((column, index) => {
        const unknown = !columns.includes(column.name)
        const chip = (
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded border border-border bg-panel-2 pl-2 pr-0.5 font-mono text-[11px]',
              unknown && 'border-danger text-danger',
              withOptions && 'cursor-pointer hover:bg-hover'
            )}
            title={unknown ? 'This column does not exist (renamed or deleted?)' : undefined}
          >
            {label(column)}
            <button
              className="flex size-4 items-center justify-center rounded text-muted hover:text-danger"
              onClick={(e) => {
                e.stopPropagation()
                onChange(value.filter((_, i) => i !== index))
              }}
              aria-label={`Remove ${column.name}`}
            >
              <X className="size-3" />
            </button>
          </span>
        )
        if (!withOptions) return <span key={column.name}>{chip}</span>
        return (
          <Popover.Root key={column.name}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            <Popover.Portal>
              <Popover.Content sideOffset={4} className="z-50 flex w-56 flex-col gap-2 rounded-md border border-border bg-panel-2 p-3 text-xs shadow-xl">
                <div className="font-mono font-semibold">{column.name}</div>
                <label className="flex items-center justify-between gap-2 text-muted">
                  Prefix length
                  <input
                    type="number"
                    min={1}
                    value={column.length ?? ''}
                    placeholder="full"
                    onChange={(e) => update(index, { length: e.target.value ? Number(e.target.value) : null })}
                    className="h-7 w-20 rounded border border-border bg-bg px-2 text-fg outline-none focus:border-accent"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-muted">
                  Order
                  <select
                    value={column.order ?? 'ASC'}
                    onChange={(e) => update(index, { order: e.target.value as 'ASC' | 'DESC' })}
                    className="h-7 w-20 rounded border border-border bg-bg px-1 text-fg outline-none"
                  >
                    <option value="ASC">ASC</option>
                    <option value="DESC">DESC</option>
                  </select>
                </label>
                <div className="flex justify-between">
                  <button className="flex items-center gap-1 text-muted hover:text-fg disabled:opacity-40" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowLeft className="size-3.5" /> Before
                  </button>
                  <button
                    className="flex items-center gap-1 text-muted hover:text-fg disabled:opacity-40"
                    disabled={index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    After <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )
      })}
      <Popover.Root open={adding} onOpenChange={setAdding}>
        <Popover.Trigger
          disabled={available.length === 0}
          className="inline-flex h-6 items-center gap-1 rounded border border-dashed border-border px-1.5 text-[11px] text-muted hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <Plus className="size-3" />
          {value.length === 0 ? placeholder : ''}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={4} className="z-50 rounded-md border border-border bg-panel-2 shadow-xl">
            <SearchList
              options={available.map((c) => ({ value: c }))}
              placeholder="Search columns…"
              onSelect={(name) => {
                onChange([...value, { name }])
                setAdding(false)
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
