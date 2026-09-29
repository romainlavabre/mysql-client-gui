// Table data view: paginated browsing and applying the pending edits.
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { RowChangesRequest, TableDataRequest, TableDataResponse } from '@shared/types'
import { buildOrderBy, buildWhere } from '@shared/sql/filters'
import { qualified } from '@shared/sql/quote'
import { rowChangesToSql } from '@shared/sql/rowChanges'
import { runStatement } from './query'

export function tableDataSql(request: Omit<TableDataRequest, 'sessionId'>): string {
  const parts = [`SELECT * FROM ${qualified(request.database, request.table)}`]
  const where = buildWhere(request.filters, request.rawWhere)
  if (where) parts.push(where)
  const orderBy = buildOrderBy(request.sort)
  if (orderBy) parts.push(orderBy)
  parts.push(`LIMIT ${Math.max(0, Math.floor(request.limit))} OFFSET ${Math.max(0, Math.floor(request.offset))}`)
  return parts.join(' ')
}

export async function fetchTableData(pool: Pool, request: TableDataRequest): Promise<TableDataResponse> {
  const sql = tableDataSql(request)
  const connection = await pool.getConnection()
  try {
    const [result] = await runStatement(connection, sql, request.limit)
    if (result.kind === 'error') throw new Error(result.message)
    if (result.kind !== 'rows') throw new Error('Unexpected result')
    return { columns: result.columns, rows: result.rows, sql, durationMs: result.durationMs }
  } finally {
    connection.release()
  }
}

export async function countRows(pool: Pool, request: Omit<TableDataRequest, 'limit' | 'offset' | 'sort'>): Promise<number> {
  const where = buildWhere(request.filters, request.rawWhere)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${qualified(request.database, request.table)} ${where}`
  )
  return Number(rows[0].total)
}

/** Applies all changes in one transaction; any failure rolls everything back. */
export async function applyRowChanges(pool: Pool, request: RowChangesRequest): Promise<{ affectedRows: number }> {
  const statements = rowChangesToSql(request.database, request.table, request.changes)
  const connection = await pool.getConnection()
  let affectedRows = 0
  try {
    await connection.beginTransaction()
    for (const sql of statements) {
      const [result] = await connection.query<ResultSetHeader>(sql)
      affectedRows += result.affectedRows
    }
    await connection.commit()
    return { affectedRows }
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }
}
