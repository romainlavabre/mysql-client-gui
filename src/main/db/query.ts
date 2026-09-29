// Statement execution with a row limit: rows are streamed and only the first
// `rowLimit` ones are kept, so a forgotten LIMIT does not freeze the app.
import { Types, type Connection as CoreConnection, type FieldPacket, type ResultSetHeader } from 'mysql2'
import type { Connection } from 'mysql2/promise'
import type { CellValue, ColumnMeta, StatementResult } from '@shared/types'
import { splitStatements } from '@shared/sql/split'

const TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Types as unknown as Record<string, number | string>)
    .filter(([name, code]) => Number.isNaN(Number(name)) && typeof code === 'number')
    .map(([name, code]) => [code, name])
)

const NOT_NULL_FLAG = 1
const PRI_KEY_FLAG = 2
const UNSIGNED_FLAG = 32
const BINARY_CHARSET = 63

function typeName(field: FieldPacket): string {
  const code = field.columnType ?? field.type ?? -1
  let name = TYPE_NAMES[code] ?? 'UNKNOWN'
  const binary = field.characterSet === BINARY_CHARSET
  if (name === 'BLOB') name = binary ? 'BLOB' : 'TEXT'
  if (name === 'VAR_STRING') name = binary ? 'VARBINARY' : 'VARCHAR'
  if (name === 'STRING') name = binary ? 'BINARY' : 'CHAR'
  if (name === 'LONGLONG') name = 'BIGINT'
  if (name === 'LONG') name = 'INT'
  if (name === 'TINY') name = 'TINYINT'
  if (name === 'SHORT') name = 'SMALLINT'
  if (name === 'INT24') name = 'MEDIUMINT'
  if (name === 'NEWDECIMAL') name = 'DECIMAL'
  const flags = typeof field.flags === 'number' ? field.flags : 0
  if (flags & UNSIGNED_FLAG) name += ' UNSIGNED'
  return field.extendedTypeName ? field.extendedTypeName.toUpperCase() : name
}

export function columnMeta(field: FieldPacket): ColumnMeta {
  const flags = typeof field.flags === 'number' ? field.flags : 0
  return {
    name: field.name,
    table: field.orgTable ?? '',
    orgName: field.orgName ?? field.name,
    database: field.db ?? field.schema ?? '',
    type: typeName(field),
    nullable: (flags & NOT_NULL_FLAG) === 0,
    primaryKey: (flags & PRI_KEY_FLAG) !== 0
  }
}

export function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

/** The callback connection behind a promise connection, which streams rows. */
export function coreOf(connection: Connection): CoreConnection {
  return (connection as unknown as { connection: CoreConnection }).connection
}

interface QueryError extends Error {
  code?: string
  sqlMessage?: string
}

/** Runs one statement, keeping at most `rowLimit` rows of each result set. */
export function runStatement(connection: Connection, sql: string, rowLimit: number): Promise<StatementResult[]> {
  const started = performance.now()
  const results: StatementResult[] = []
  // The promise wrapper buffers everything: the core connection streams rows.
  const core = coreOf(connection)
  return new Promise((resolve) => {
    let current: { columns: ColumnMeta[]; rows: CellValue[][]; truncated: boolean } | null = null
    const flushRows = (): void => {
      if (!current) return
      results.push({
        kind: 'rows',
        sql,
        columns: current.columns,
        rows: current.rows,
        truncated: current.truncated,
        durationMs: performance.now() - started
      })
      current = null
    }
    let settled = false
    const fail = (message: string, code?: string): void => {
      flushRows()
      results.push({ kind: 'error', sql, message, code, durationMs: performance.now() - started })
    }
    const finish = (): void => {
      if (settled) return
      settled = true
      core.off('error', onConnectionLost)
      core.off('end', onConnectionLost)
      flushRows()
      resolve(results)
    }
    // A dropped connection may never emit the query's 'end'.
    const onConnectionLost = (error?: Error): void => {
      fail(error?.message ?? 'Connection lost')
      finish()
    }
    core.on('error', onConnectionLost)
    core.on('end', onConnectionLost)
    /** A throwing handler would kill the connection silently: report it instead. */
    const guard =
      <A extends unknown[]>(handler: (...args: A) => void) =>
      (...args: A): void => {
        try {
          handler(...args)
        } catch (error) {
          fail(`Internal error while reading the result: ${(error as Error).message}`)
        }
      }

    const query = core.query({ sql, rowsAsArray: true })
    query.on(
      'fields',
      guard((fields: FieldPacket[] | undefined) => {
        // Also emitted, without fields, for statements returning no rows.
        if (!fields) return
        flushRows()
        current = { columns: fields.map(columnMeta), rows: [], truncated: false }
      })
    )
    query.on(
      'result',
      guard((row: unknown) => {
        if (Array.isArray(row)) {
          if (!current) return
          if (current.rows.length < rowLimit) current.rows.push(row.map(normalizeCell))
          else current.truncated = true
          return
        }
        flushRows()
        const header = row as ResultSetHeader
        results.push({
          kind: 'ok',
          sql,
          affectedRows: header.affectedRows ?? 0,
          insertId: header.insertId ?? 0,
          warningCount: header.warningStatus ?? 0,
          info: header.info ?? '',
          durationMs: performance.now() - started
        })
      })
    )
    query.on('error', (error: QueryError) => fail(error.sqlMessage ?? error.message, error.code))
    query.on('end', finish)
  })
}

/** Splits a script and runs its statements in order on one connection. */
export async function runScript(
  connection: Connection,
  sql: string,
  rowLimit: number,
  stopOnError: boolean
): Promise<StatementResult[]> {
  const results: StatementResult[] = []
  for (const statement of splitStatements(sql)) {
    const statementResults = await runStatement(connection, statement.sql, rowLimit)
    results.push(...statementResults)
    if (stopOnError && statementResults.some((r) => r.kind === 'error')) break
  }
  return results
}
