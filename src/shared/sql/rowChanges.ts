// SQL for the pending edits of the table data view.
import type { CellValue, RowChange } from '../types'
import { qualified, quoteIdent, quoteValue } from './quote'

function whereKey(key: Record<string, CellValue>): string {
  const entries = Object.entries(key)
  if (entries.length === 0) throw new Error('Cannot identify the row: the table has no primary or unique key')
  return entries
    .map(([column, value]) => (value === null ? `${quoteIdent(column)} IS NULL` : `${quoteIdent(column)} = ${quoteValue(value)}`))
    .join(' AND ')
}

export function rowChangeToSql(database: string, table: string, change: RowChange): string {
  const target = qualified(database, table)
  switch (change.type) {
    case 'update': {
      const assignments = Object.entries(change.values)
        .map(([column, value]) => `${quoteIdent(column)} = ${quoteValue(value)}`)
        .join(', ')
      return `UPDATE ${target} SET ${assignments} WHERE ${whereKey(change.key)} LIMIT 1`
    }
    case 'insert': {
      const columns = Object.keys(change.values)
      if (columns.length === 0) return `INSERT INTO ${target} () VALUES ()`
      const values = columns.map((column) => quoteValue(change.values[column]))
      return `INSERT INTO ${target} (${columns.map(quoteIdent).join(', ')}) VALUES (${values.join(', ')})`
    }
    case 'delete':
      return `DELETE FROM ${target} WHERE ${whereKey(change.key)} LIMIT 1`
  }
}

export function rowChangesToSql(database: string, table: string, changes: RowChange[]): string[] {
  return changes.map((change) => rowChangeToSql(database, table, change))
}
