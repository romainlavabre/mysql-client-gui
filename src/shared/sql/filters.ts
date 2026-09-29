// Compiles the table view's column filters and sort into SQL clauses.
import type { ColumnFilter, SortSpec } from '../types'
import { quoteIdent, quoteString } from './quote'

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function filterToSql(filter: ColumnFilter): string {
  const column = quoteIdent(filter.column)
  const value = filter.value ?? ''
  switch (filter.operator) {
    case 'IS NULL':
    case 'IS NOT NULL':
      return `${column} ${filter.operator}`
    case 'CONTAINS':
      return `${column} LIKE ${quoteString('%' + value.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%')}`
    case 'IN':
    case 'NOT IN': {
      const items = splitList(value)
      if (items.length === 0) return filter.operator === 'IN' ? 'FALSE' : 'TRUE'
      return `${column} ${filter.operator} (${items.map(quoteString).join(', ')})`
    }
    case 'BETWEEN':
      return `${column} BETWEEN ${quoteString(value)} AND ${quoteString(filter.value2 ?? '')}`
    default:
      return `${column} ${filter.operator} ${quoteString(value)}`
  }
}

/** WHERE clause (including the keyword), or an empty string. */
export function buildWhere(filters: ColumnFilter[], rawWhere?: string): string {
  const parts = filters.map(filterToSql)
  const raw = rawWhere?.trim()
  if (raw) parts.push(`(${raw})`)
  return parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : ''
}

export function buildOrderBy(sort: SortSpec[]): string {
  if (sort.length === 0) return ''
  return 'ORDER BY ' + sort.map((s) => `${quoteIdent(s.column)} ${s.direction === 'DESC' ? 'DESC' : 'ASC'}`).join(', ')
}
