// Server administration: processes, variables, status, users and privileges.
import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { GrantRequest, MaintenanceOp, ProcessInfo, StatementResult, UserAccount, VariableInfo } from '@shared/types'
import { account, grantSql, revokeSql } from '@shared/sql/admin'
import { qualified, quoteString } from '@shared/sql/quote'
import { runStatement } from './query'

type Row = RowDataPacket & Record<string, unknown>

export async function processes(pool: Pool, full: boolean): Promise<ProcessInfo[]> {
  const [rows] = await pool.query<Row[]>(full ? 'SHOW FULL PROCESSLIST' : 'SHOW PROCESSLIST')
  return rows.map((r) => ({
    id: Number(r.Id),
    user: String(r.User ?? ''),
    host: String(r.Host ?? ''),
    db: r.db === null || r.db === undefined ? null : String(r.db),
    command: String(r.Command ?? ''),
    time: Number(r.Time ?? 0),
    state: r.State === null || r.State === undefined ? null : String(r.State),
    info: r.Info === null || r.Info === undefined ? null : String(r.Info)
  }))
}

export async function kill(pool: Pool, id: number, queryOnly: boolean): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid process id')
  await pool.query(`KILL ${queryOnly ? 'QUERY ' : ''}${id}`)
}

async function nameValue(pool: Pool, sql: string): Promise<VariableInfo[]> {
  const [rows] = await pool.query<Row[]>(sql)
  return rows.map((r) => ({ name: String(r.Variable_name), value: String(r.Value ?? '') }))
}

export function variables(pool: Pool, scope: 'GLOBAL' | 'SESSION'): Promise<VariableInfo[]> {
  return nameValue(pool, `SHOW ${scope === 'GLOBAL' ? 'GLOBAL' : 'SESSION'} VARIABLES`)
}

export function status(pool: Pool): Promise<VariableInfo[]> {
  return nameValue(pool, 'SHOW GLOBAL STATUS')
}

export async function users(pool: Pool): Promise<UserAccount[]> {
  // Column sets differ between MySQL and MariaDB: select everything and pick what exists.
  const [rows] = await pool.query<Row[]>('SELECT * FROM mysql.user ORDER BY User, Host')
  return rows.map((r) => ({
    user: String(r.User),
    host: String(r.Host),
    locked: String(r.account_locked ?? 'N') === 'Y',
    passwordExpired: String(r.password_expired ?? 'N') === 'Y'
  }))
}

export async function grants(pool: Pool, user: string, host: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW GRANTS FOR ${account(user, host)}`)
  return rows.map((r) => String(Object.values(r)[0]))
}

export async function createUser(pool: Pool, user: string, host: string, password: string): Promise<void> {
  if (!user.trim()) throw new Error('The user name is required')
  await pool.query(`CREATE USER ${account(user, host || '%')} IDENTIFIED BY ${quoteString(password)}`)
}

export async function dropUser(pool: Pool, user: string, host: string): Promise<void> {
  await pool.query(`DROP USER ${account(user, host)}`)
}

export async function setPassword(pool: Pool, user: string, host: string, password: string): Promise<void> {
  await pool.query(`ALTER USER ${account(user, host)} IDENTIFIED BY ${quoteString(password)}`)
}

export async function grant(pool: Pool, request: GrantRequest): Promise<void> {
  await pool.query(grantSql(request.user, request.host, request.level, request.privileges, request.withGrantOption))
}

export async function revoke(pool: Pool, request: GrantRequest): Promise<void> {
  await pool.query(revokeSql(request.user, request.host, request.level, request.privileges, request.withGrantOption))
}

export async function maintenance(pool: Pool, database: string, tables: string[], op: MaintenanceOp): Promise<StatementResult[]> {
  if (!['ANALYZE', 'OPTIMIZE', 'CHECK', 'REPAIR'].includes(op)) throw new Error(`Unknown operation ${op}`)
  if (tables.length === 0) return []
  const connection = await pool.getConnection()
  try {
    return await runStatement(connection, `${op} TABLE ${tables.map((t) => qualified(database, t)).join(', ')}`, 10_000)
  } finally {
    connection.release()
  }
}
