// DDL generation for the structure editor: CREATE TABLE, and the ALTER TABLE
// statements turning an original definition into a modified one.
import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  IndexDefinition,
  TableDefinition,
  TableDetails
} from '../types'
import { qualified, quoteIdent, quoteString } from './quote'

export function columnSql(column: ColumnDefinition): string {
  const parts = [quoteIdent(column.name), column.type.trim()]
  if (column.charset) parts.push(`CHARACTER SET ${column.charset}`)
  if (column.collation) parts.push(`COLLATE ${column.collation}`)
  if (column.generated) {
    parts.push(`GENERATED ALWAYS AS (${column.generated.expression}) ${column.generated.stored ? 'STORED' : 'VIRTUAL'}`)
    if (!column.nullable) parts.push('NOT NULL')
  } else {
    parts.push(column.nullable ? 'NULL' : 'NOT NULL')
    if (column.default !== undefined) {
      if (column.default === null) parts.push('DEFAULT NULL')
      else if (column.defaultIsExpression) parts.push(`DEFAULT ${wrapDefaultExpression(column.default)}`)
      else parts.push(`DEFAULT ${quoteString(column.default)}`)
    }
    if (column.onUpdateCurrentTimestamp) parts.push('ON UPDATE CURRENT_TIMESTAMP')
    if (column.autoIncrement) parts.push('AUTO_INCREMENT')
  }
  if (column.comment) parts.push(`COMMENT ${quoteString(column.comment)}`)
  return parts.join(' ')
}

/** Functions like CURRENT_TIMESTAMP are allowed bare; other expressions must be parenthesised. */
function wrapDefaultExpression(expression: string): string {
  const trimmed = expression.trim()
  if (/^(current_timestamp|now|localtime|localtimestamp)(\(\d*\))?$/i.test(trimmed)) return trimmed
  if (/^[-+]?\d+(\.\d+)?$/.test(trimmed) || /^b'[01]*'$/i.test(trimmed) || /^x'[0-9a-f]*'$/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return trimmed
  return `(${trimmed})`
}

function indexColumnsSql(index: IndexDefinition): string {
  return index.columns
    .map((column) => {
      let sql = quoteIdent(column.name)
      if (column.length) sql += `(${column.length})`
      if (column.order === 'DESC') sql += ' DESC'
      return sql
    })
    .join(', ')
}

export function indexSql(index: IndexDefinition): string {
  const comment = index.comment ? ` COMMENT ${quoteString(index.comment)}` : ''
  const columns = `(${indexColumnsSql(index)})`
  switch (index.kind) {
    case 'PRIMARY':
      return `PRIMARY KEY ${columns}${comment}`
    case 'UNIQUE':
      return `UNIQUE INDEX ${quoteIdent(index.name)} ${columns}${comment}`
    case 'FULLTEXT':
      return `FULLTEXT INDEX ${quoteIdent(index.name)} ${columns}${comment}`
    case 'SPATIAL':
      return `SPATIAL INDEX ${quoteIdent(index.name)} ${columns}${comment}`
    default:
      return `INDEX ${quoteIdent(index.name)} ${columns}${comment}`
  }
}

export function foreignKeySql(fk: ForeignKeyDefinition): string {
  const reference = qualified(fk.refDatabase, fk.refTable)
  return (
    `CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${fk.columns.map(quoteIdent).join(', ')}) ` +
    `REFERENCES ${reference} (${fk.refColumns.map(quoteIdent).join(', ')}) ` +
    `ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
  )
}

function tableOptionsSql(def: TableDefinition): string[] {
  const options: string[] = []
  if (def.engine) options.push(`ENGINE=${def.engine}`)
  if (def.charset) options.push(`DEFAULT CHARSET=${def.charset}`)
  if (def.collation) options.push(`COLLATE=${def.collation}`)
  if (def.autoIncrement) options.push(`AUTO_INCREMENT=${def.autoIncrement}`)
  if (def.comment) options.push(`COMMENT=${quoteString(def.comment)}`)
  return options
}

export function buildCreateTable(def: TableDefinition): string {
  if (!def.name.trim()) throw new Error('The table name is required')
  if (def.columns.length === 0) throw new Error('A table needs at least one column')
  const lines = [
    ...def.columns.map(columnSql),
    ...def.indexes.map(indexSql),
    ...def.foreignKeys.map(foreignKeySql)
  ]
  const options = tableOptionsSql(def)
  return (
    `CREATE TABLE ${qualified(def.database, def.name)} (\n  ${lines.join(',\n  ')}\n)` +
    (options.length > 0 ? ' ' + options.join(' ') : '')
  )
}

function sameIndex(a: IndexDefinition, b: IndexDefinition): boolean {
  return indexSql(a) === indexSql(b)
}

function sameForeignKey(a: ForeignKeyDefinition, b: ForeignKeyDefinition): boolean {
  return foreignKeySql(a) === foreignKeySql(b)
}

/** Statements turning `original` into `modified`; empty when nothing changed. */
export function buildAlterTable(original: TableDefinition, modified: TableDefinition): string[] {
  const target = qualified(original.database, original.name)
  const statements: string[] = []
  const clauses: string[] = []

  // Foreign keys are dropped in their own statement: MySQL rejects dropping and
  // re-adding a constraint with the same name in a single ALTER.
  const droppedFks = original.foreignKeys.filter((fk) => {
    const kept = modified.foreignKeys.find((m) => m.name === fk.name)
    return !kept || !sameForeignKey(fk, kept)
  })
  if (droppedFks.length > 0) {
    statements.push(`ALTER TABLE ${target} ${droppedFks.map((fk) => `DROP FOREIGN KEY ${quoteIdent(fk.name)}`).join(', ')}`)
  }

  // Indexes to drop first, so renamed columns and new indexes don't collide.
  for (const index of original.indexes) {
    const kept = modified.indexes.find((m) => (index.kind === 'PRIMARY' ? m.kind === 'PRIMARY' : m.name === index.name))
    if (!kept || !sameIndex(index, kept)) {
      clauses.push(index.kind === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${quoteIdent(index.name)}`)
    }
  }

  // Columns.
  const originalByName = new Map(original.columns.map((c) => [c.name, c]))
  const keptOriginalNames = new Set(modified.columns.map((c) => c.originalName).filter((n): n is string => !!n))
  for (const column of original.columns) {
    if (!keptOriginalNames.has(column.name)) clauses.push(`DROP COLUMN ${quoteIdent(column.name)}`)
  }
  // Order of the original columns once drops are applied, to detect moves.
  let currentOrder = original.columns.map((c) => c.name).filter((name) => keptOriginalNames.has(name))
  modified.columns.forEach((column, position) => {
    const previous = position === 0 ? null : modified.columns[position - 1].name
    const placement = previous === null ? ' FIRST' : ` AFTER ${quoteIdent(previous)}`
    const originalColumn = column.originalName ? originalByName.get(column.originalName) : undefined
    if (!originalColumn) {
      clauses.push(`ADD COLUMN ${columnSql(column)}${placement}`)
      currentOrder.splice(position, 0, column.name)
      return
    }
    const currentIndex = currentOrder.indexOf(originalColumn.name)
    const moved = currentIndex !== position
    const changed = columnSql({ ...originalColumn, originalName: undefined }) !== columnSql({ ...column, originalName: undefined })
    if (changed || moved) {
      const keyword = originalColumn.name === column.name ? `MODIFY COLUMN` : `CHANGE COLUMN ${quoteIdent(originalColumn.name)}`
      clauses.push(`${keyword} ${columnSql(column)}${moved ? placement : ''}`)
    }
    currentOrder = currentOrder.filter((name) => name !== originalColumn.name)
    currentOrder.splice(position, 0, column.name)
  })

  // Indexes to add.
  for (const index of modified.indexes) {
    const existing = original.indexes.find((o) => (index.kind === 'PRIMARY' ? o.kind === 'PRIMARY' : o.name === index.name))
    if (!existing || !sameIndex(existing, index)) clauses.push(`ADD ${indexSql(index)}`)
  }

  // Foreign keys to add.
  for (const fk of modified.foreignKeys) {
    const existing = original.foreignKeys.find((o) => o.name === fk.name)
    if (!existing || !sameForeignKey(existing, fk)) clauses.push(`ADD ${foreignKeySql(fk)}`)
  }

  // Table options.
  if ((modified.engine ?? '') !== (original.engine ?? '') && modified.engine) clauses.push(`ENGINE=${modified.engine}`)
  if ((modified.collation ?? '') !== (original.collation ?? '') && modified.collation) {
    clauses.push(`${modified.charset ? `DEFAULT CHARSET=${modified.charset} ` : ''}COLLATE=${modified.collation}`)
  }
  if ((modified.comment ?? '') !== (original.comment ?? '')) clauses.push(`COMMENT=${quoteString(modified.comment ?? '')}`)
  if (modified.autoIncrement && modified.autoIncrement !== original.autoIncrement) {
    clauses.push(`AUTO_INCREMENT=${modified.autoIncrement}`)
  }

  if (clauses.length > 0) statements.push(`ALTER TABLE ${target}\n  ${clauses.join(',\n  ')}`)
  if (modified.name !== original.name) {
    statements.push(`RENAME TABLE ${target} TO ${qualified(original.database, modified.name)}`)
  }
  return statements
}

/** Editable definition of an existing table, as returned by schema introspection. */
export function detailsToDefinition(details: TableDetails): TableDefinition {
  const charset = details.collation ? details.collation.split('_')[0] : undefined
  return {
    database: details.database,
    name: details.name,
    engine: details.engine ?? undefined,
    charset,
    collation: details.collation ?? undefined,
    comment: details.comment,
    autoIncrement: details.autoIncrement,
    columns: details.columns.map((column) => {
      const extra = column.extra.toLowerCase()
      const generated = column.generationExpression
        ? { expression: column.generationExpression, stored: /stored|persistent/.test(extra) }
        : null
      return {
        name: column.name,
        originalName: column.name,
        type: column.type,
        nullable: column.nullable,
        default: column.default === null && !column.nullable ? undefined : column.default,
        defaultIsExpression: column.defaultIsExpression,
        autoIncrement: extra.includes('auto_increment'),
        onUpdateCurrentTimestamp: extra.includes('on update'),
        generated,
        // Only explicit when it differs from the table default, to keep the DDL short.
        charset: column.collation && column.collation !== details.collation ? (column.charset ?? undefined) : undefined,
        collation: column.collation && column.collation !== details.collation ? column.collation : undefined,
        comment: column.comment || undefined
      }
    }),
    indexes: details.indexes.map((index) => ({
      name: index.name,
      kind:
        index.name === 'PRIMARY'
          ? 'PRIMARY'
          : index.type === 'FULLTEXT'
            ? 'FULLTEXT'
            : index.type === 'SPATIAL'
              ? 'SPATIAL'
              : index.unique
                ? 'UNIQUE'
                : 'INDEX',
      columns: index.columns.map((c) => ({ name: c.name, length: c.subPart, order: c.order })),
      comment: index.comment || undefined
    })),
    foreignKeys: details.foreignKeys.map((fk) => ({
      name: fk.name,
      columns: fk.columns,
      refDatabase: fk.refDatabase === details.database ? undefined : fk.refDatabase,
      refTable: fk.refTable,
      refColumns: fk.refColumns,
      onUpdate: fk.onUpdate,
      onDelete: fk.onDelete
    }))
  }
}
