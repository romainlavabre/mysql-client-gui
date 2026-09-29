// Column filters of the table data view.
import { Plus, X } from 'lucide-react'
import type { ColumnFilter, FilterOperator } from '@shared/types'
import { Button, IconButton, Input, Select } from '../../components/ui'

const OPERATORS: FilterOperator[] = ['=', '!=', '<', '<=', '>', '>=', 'CONTAINS', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN']

const NO_VALUE: FilterOperator[] = ['IS NULL', 'IS NOT NULL']

export function FilterBar({
  columns,
  filters,
  rawWhere,
  onChange,
  onRawWhereChange,
  onApply
}: {
  columns: string[]
  filters: ColumnFilter[]
  rawWhere: string
  onChange: (filters: ColumnFilter[]) => void
  onRawWhereChange: (value: string) => void
  onApply: () => void
}) {
  const update = (index: number, patch: Partial<ColumnFilter>): void => onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') onApply()
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-border bg-panel px-2 py-2">
      {filters.map((filter, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Select className="h-7 w-48 text-xs" value={filter.column} onChange={(e) => update(index, { column: e.target.value })}>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select className="h-7 w-32 text-xs" value={filter.operator} onChange={(e) => update(index, { operator: e.target.value as FilterOperator })}>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </Select>
          {!NO_VALUE.includes(filter.operator) && (
            <Input
              className="h-7 flex-1 text-xs"
              value={filter.value ?? ''}
              placeholder={filter.operator.includes('IN') ? 'a, b, c' : filter.operator.includes('LIKE') ? '%value%' : 'value'}
              onChange={(e) => update(index, { value: e.target.value })}
              onKeyDown={onKeyDown}
            />
          )}
          {filter.operator === 'BETWEEN' && (
            <Input className="h-7 flex-1 text-xs" value={filter.value2 ?? ''} placeholder="and" onChange={(e) => update(index, { value2: e.target.value })} onKeyDown={onKeyDown} />
          )}
          <IconButton label="Remove filter" onClick={() => onChange(filters.filter((_, i) => i !== index))}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Input
          className="h-7 flex-1 font-mono text-xs"
          value={rawWhere}
          placeholder="Raw WHERE condition, e.g. created_at > NOW() - INTERVAL 1 DAY"
          onChange={(e) => onRawWhereChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => onChange([...filters, { column: columns[0] ?? '', operator: '=', value: '' }])}
          disabled={columns.length === 0}
        >
          Filter
        </Button>
        <Button size="sm" variant="primary" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  )
}
