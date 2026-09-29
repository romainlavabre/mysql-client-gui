// Open database sessions. A session owns a small pool (schema browsing, table
// data, admin) and one dedicated connection per editor tab, so `USE`,
// variables and transactions stay attached to the tab.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import mysql, { type Connection, type ConnectionOptions, type Pool, type PoolOptions } from 'mysql2/promise'
import type { ConnectionDraft, SessionInfo } from '@shared/types'
import { isWriteStatement } from '@shared/sql/classify'
import { expandHome, openTunnel, type Tunnel } from './tunnel'

export interface DbSession {
  info: SessionInfo
  readOnly: boolean
  pool: Pool
  tunnel: Tunnel | null
  options: ConnectionOptions
  tabs: Map<string, TabConnection>
}

export interface TabConnection {
  connection: Connection
  threadId: number
  database: string | null
}

type TypeCastField = Parameters<Extract<NonNullable<ConnectionOptions['typeCast']>, (...args: never[]) => unknown>>[0]

/** BIT(n) bytes as an integer: a number when it fits, a decimal string beyond 2^53. */
export function bitToNumber(bytes: Uint8Array | null): number | string | null {
  if (!bytes) return null
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
}

/** Keeps values plain: JSON as text, BIT as a number, geometry as bytes. */
function typeCast(field: TypeCastField, next: () => unknown): unknown {
  if (field.type === 'JSON') return field.string('utf8')
  if (field.type === 'BIT') return bitToNumber(field.buffer())
  if (field.type === 'GEOMETRY') return field.buffer()
  return next()
}

export async function connectionOptions(
  draft: ConnectionDraft,
  dataDir: string
): Promise<{ options: ConnectionOptions; tunnel: Tunnel | null }> {
  const { config, secrets } = draft
  let host = config.host
  let port = config.port
  let tunnel: Tunnel | null = null
  if (config.ssh.enabled) {
    const secret = config.ssh.auth === 'password' ? secrets.sshPassword : secrets.sshPassphrase
    tunnel = await openTunnel(config.ssh, config.host || '127.0.0.1', config.port, secret, dataDir)
    host = '127.0.0.1'
    port = tunnel.localPort
  }
  const options: ConnectionOptions = {
    host,
    port,
    user: config.user,
    password: secrets.password ?? '',
    database: config.defaultDatabase || undefined,
    charset: 'utf8mb4',
    connectTimeout: 15_000,
    dateStrings: true,
    // BIGINT as a number when it fits, as a string beyond 2^53.
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    typeCast,
    // LOAD DATA LOCAL lets a server read client files: off, imports use INSERT batches.
    flags: ['-LOCAL_FILES']
  }
  if (config.ssl.enabled) {
    options.ssl = {
      rejectUnauthorized: config.ssl.rejectUnauthorized,
      ca: config.ssl.caPath ? readFileSync(expandHome(config.ssl.caPath), 'utf8') : undefined,
      cert: config.ssl.certPath ? readFileSync(expandHome(config.ssl.certPath), 'utf8') : undefined,
      key: config.ssl.keyPath ? readFileSync(expandHome(config.ssl.keyPath), 'utf8') : undefined
    }
  }
  return { options, tunnel }
}

async function describeServer(connection: Connection | Pool): Promise<{ version: string; user: string }> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version, CURRENT_USER() AS user')
  return { version: String(rows[0].version), user: String(rows[0].user) }
}

/** Rewrites the cryptic TLS / transport errors into something actionable. */
export function explainConnectionError(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error))
  const message = original.message
  const code = (original as { code?: string }).code ?? ''
  let hint: string | null = null
  if (/self[- ]signed certificate|unable to (get local issuer|verify the first) certificate/i.test(message) || /SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    hint =
      'The server uses a self-signed certificate. Select its CA certificate, or uncheck "Verify the server certificate" ' +
      '(the connection stays encrypted, only the server identity is not checked).'
  } else if (/Hostname\/IP does not match|ERR_TLS_CERT_ALTNAME_INVALID/i.test(message + code)) {
    hint = 'The server certificate was issued for another host name. Connect with the name it was issued for, or uncheck "Verify the server certificate".'
  } else if (/insecure transport are prohibited|require_secure_transport/i.test(message)) {
    hint = 'The server only accepts encrypted connections: enable SSL / TLS.'
  } else if (/does not support secure connection|Server does not support SSL/i.test(message)) {
    hint = 'The server does not support SSL: disable SSL / TLS for this connection.'
  }
  if (!hint) return original
  return new Error(`${hint}\n\n(${message})`, { cause: original })
}

/** Connects once and disconnects: the connection form's "Test" button. */
export async function testConnection(draft: ConnectionDraft, dataDir: string): Promise<{ serverVersion: string }> {
  const { options, tunnel } = await connectionOptions(draft, dataDir)
  try {
    const connection = await mysql.createConnection(options).catch((error: unknown) => {
      throw explainConnectionError(error)
    })
    try {
      return { serverVersion: (await describeServer(connection)).version }
    } finally {
      await connection.end().catch(() => undefined)
    }
  } finally {
    tunnel?.close()
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, DbSession>()

  constructor(private readonly dataDir: string) {}

  async open(connectionId: string, draft: ConnectionDraft): Promise<SessionInfo> {
    const { options, tunnel } = await connectionOptions(draft, this.dataDir)
    const readOnly = draft.config.readOnly
    const poolOptions: PoolOptions = { ...options, connectionLimit: 4, waitForConnections: true, enableKeepAlive: true }
    const pool = mysql.createPool(poolOptions)
    if (readOnly) {
      pool.on('connection', (connection) => {
        connection.query('SET SESSION TRANSACTION READ ONLY')
      })
    }
    try {
      const server = await describeServer(pool)
      const info: SessionInfo = {
        sessionId: randomUUID(),
        connectionId,
        serverVersion: server.version,
        isMariaDb: /mariadb/i.test(server.version),
        currentUser: server.user
      }
      this.sessions.set(info.sessionId, { info, readOnly, pool, tunnel, options, tabs: new Map() })
      return info
    } catch (error) {
      await pool.end().catch(() => undefined)
      tunnel?.close()
      throw explainConnectionError(error)
    }
  }

  get(sessionId: string): DbSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('The connection is closed: reconnect first')
    return session
  }

  /** Throws when a statement would write on a read-only connection. */
  assertWritable(session: DbSession, statements: string[]): void {
    if (!session.readOnly) return
    const write = statements.find(isWriteStatement)
    if (write) throw new Error(`This connection is read-only: refused to run "${write.slice(0, 80)}"`)
  }

  async tab(sessionId: string, tabId: string, database?: string | null): Promise<TabConnection> {
    const session = this.get(sessionId)
    let tab = session.tabs.get(tabId)
    if (!tab) {
      const connection = await mysql.createConnection({ ...session.options, database: database || session.options.database })
      if (session.readOnly) await connection.query('SET SESSION TRANSACTION READ ONLY')
      // A dropped connection is recreated on the next execution.
      connection.on('error', () => session.tabs.delete(tabId))
      tab = { connection, threadId: connection.threadId, database: database || session.options.database || null }
      session.tabs.set(tabId, tab)
    } else if (database !== undefined && database !== null && database !== tab.database) {
      await tab.connection.query(`USE ${mysql.escapeId(database)}`)
      tab.database = database
    }
    return tab
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    const tab = session?.tabs.get(tabId)
    if (!session || !tab) return
    session.tabs.delete(tabId)
    await tab.connection.end().catch(() => tab.connection.destroy())
  }

  /** Stops the statement running on a tab. */
  async cancel(sessionId: string, tabId: string): Promise<void> {
    const session = this.get(sessionId)
    const tab = session.tabs.get(tabId)
    if (!tab) return
    await session.pool.query(`KILL QUERY ${Number(tab.threadId)}`)
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    await Promise.all([...session.tabs.values()].map((tab) => tab.connection.end().catch(() => tab.connection.destroy())))
    await session.pool.end().catch(() => undefined)
    session.tunnel?.close()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }

  /** Sessions opened on connections of a workspace, closed when switching workspace. */
  ids(): string[] {
    return [...this.sessions.keys()]
  }
}
