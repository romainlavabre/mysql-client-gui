// Schema introspection through information_schema, normalising the
// differences between MySQL and MariaDB.
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import type {
  ColumnInfo,
  CompletionSchema,
  DatabaseInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaObjects,
  TableDetails
} from '@shared/types'
import { quoteIdent } from '@shared/sql/quote'

type Row = RowDataPacket & Record<string, unknown>

async function rows(pool: Pool, sql: string, params: unknown[] = []): Promise<Row[]> {
  const [result] = await pool.query<Row[]>(sql, params)
  return result
}

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export async function databases(pool: Pool): Promise<DatabaseInfo[]> {
  const result = await rows(
    pool,
    `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation
       FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`
  )
  return result.map((r) => ({ name: str(r.name), charset: str(r.charset), collation: str(r.collation) }))
}

export async function objects(pool: Pool, database: string): Promise<SchemaObjects> {
  const [tables, routines, triggers, events] = await Promise.all([
    rows(
      pool,
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS rowCount,
              DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength, TABLE_COLLATION AS collation,
              TABLE_COMMENT AS comment, AUTO_INCREMENT AS autoIncrement,
              CAST(CREATE_TIME AS CHAR) AS createTime, CAST(UPDATE_TIME AS CHAR) AS updateTime
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [database]
    ),
    rows(
      pool,
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS returns, ROUTINE_COMMENT AS comment
         FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME`,
      [database]
    ),
    rows(
      pool,
      `SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tableName, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`,
      [database]
    ),
    rows(
      pool,
      `SELECT EVENT_NAME AS name, STATUS AS status,
              COALESCE(CONCAT('EVERY ', INTERVAL_VALUE, ' ', INTERVAL_FIELD), CAST(EXECUTE_AT AS CHAR)) AS schedule
         FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`,
      [database]
    )
  ])
  return {
    tables: tables.map((r) => {
      const isView = str(r.type).toUpperCase().includes('VIEW')
      return {
        name: str(r.name),
        kind: isView ? 'view' : 'table',
        engine: strOrNull(r.engine),
        rows: isView ? null : numOrNull(r.rowCount),
        dataLength: numOrNull(r.dataLength),
        indexLength: numOrNull(r.indexLength),
        collation: strOrNull(r.collation),
        comment: isView ? '' : str(r.comment),
        autoIncrement: numOrNull(r.autoIncrement),
        createTime: strOrNull(r.createTime),
        updateTime: strOrNull(r.updateTime)
      }
    }),
    routines: routines.map((r) => ({
      name: str(r.name),
      kind: str(r.type).toUpperCase() === 'FUNCTION' ? 'function' : 'procedure',
      returns: strOrNull(r.returns),
      comment: str(r.comment)
    })),
    triggers: triggers.map((r) => ({ name: str(r.name), table: str(r.tableName), timing: str(r.timing), event: str(r.event) })),
    events: events.map((r) => ({ name: str(r.name), status: str(r.status), schedule: str(r.schedule) }))
  }
}

/** Default value as a literal or an expression, whatever the server flavour. */
export function normalizeDefault(raw: string | null, extra: string, isMariaDb: boolean): { value: string | null; isExpression: boolean } {
  if (raw === null) return { value: null, isExpression: false }
  if (isMariaDb) {
    if (raw === 'NULL') return { value: null, isExpression: false }
    if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
      return { value: raw.slice(1, -1).replace(/''/g, "'").replace(/\\\\/g, '\\'), isExpression: false }
    }
    if (/^[-+]?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(raw)) return { value: raw, isExpression: false }
    return { value: raw, isExpression: true }
  }
  if (/DEFAULT_GENERATED/i.test(extra)) return { value: raw, isExpression: true }
  if (/^current_timestamp(\(\d*\))?$/i.test(raw) || /^b'[01]*'$/i.test(raw)) return { value: raw, isExpression: true }
  return { value: raw, isExpression: false }
}

async function columns(pool: Pool, database: string, table: string, isMariaDb: boolean): Promise<ColumnInfo[]> {
  const result = await rows(
    pool,
    `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS position, COLUMN_TYPE AS columnType, DATA_TYPE AS dataType,
            IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_KEY AS columnKey,
            CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment,
            GENERATION_EXPRESSION AS generation
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [database, table]
  )
  return result.map((r) => {
    const extra = str(r.extra)
    const def = normalizeDefault(strOrNull(r.defaultValue), extra, isMariaDb)
    const generation = strOrNull(r.generation)
    return {
      name: str(r.name),
      position: Number(r.position),
      type: str(r.columnType),
      dataType: str(r.dataType),
      nullable: str(r.nullable) === 'YES',
      default: def.value,
      defaultIsExpression: def.isExpression,
      extra: extra.replace(/DEFAULT_GENERATED\s*/i, '').trim(),
      key: str(r.columnKey),
      charset: strOrNull(r.charset),
      collation: strOrNull(r.collation),
      comment: str(r.comment),
      generationExpression: generation ? generation : null
    }
  })
}

async function indexes(pool: Pool, database: string, table: string): Promise<IndexInfo[]> {
  const result = await rows(
    pool,
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart,
            INDEX_TYPE AS indexType, INDEX_COMMENT AS comment, COLLATION AS collation
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`,
    [database, table]
  )
  const byName = new Map<string, IndexInfo>()
  for (const r of result) {
    const name = str(r.name)
    let index = byName.get(name)
    if (!index) {
      index = { name, unique: Number(r.nonUnique) === 0, type: str(r.indexType), columns: [], comment: str(r.comment) }
      byName.set(name, index)
    }
    index.columns.push({ name: str(r.columnName), subPart: numOrNull(r.subPart), order: str(r.collation) === 'D' ? 'DESC' : 'ASC' })
  }
  return [...byName.values()]
}

function groupForeignKeys(result: Row[]): ForeignKeyInfo[] {
  const byName = new Map<string, ForeignKeyInfo>()
  for (const r of result) {
    const key = `${str(r.tableSchema)}.${str(r.tableName)}.${str(r.name)}`
    let fk = byName.get(key)
    if (!fk) {
      fk = {
        name: str(r.name),
        columns: [],
        refDatabase: str(r.refDatabase),
        refTable: str(r.refTable),
        refColumns: [],
        onUpdate: str(r.onUpdate) || 'RESTRICT',
        onDelete: str(r.onDelete) || 'RESTRICT'
      }
      byName.set(key, fk)
    }
    fk.columns.push(str(r.columnName))
    fk.refColumns.push(str(r.refColumn))
  }
  return [...byName.values()]
}

const FK_SELECT = `SELECT k.CONSTRAINT_NAME AS name, k.TABLE_SCHEMA AS tableSchema, k.TABLE_NAME AS tableName,
            k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS refDatabase, k.REFERENCED_TABLE_NAME AS refTable,
            k.REFERENCED_COLUMN_NAME AS refColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME`

export async function tableDetails(pool: Pool, database: string, table: string, isMariaDb: boolean): Promise<TableDetails> {
  const [info] = await rows(
    pool,
    `SELECT TABLE_TYPE AS type, ENGINE AS engine, TABLE_COLLATION AS collation, TABLE_COMMENT AS comment,
            AUTO_INCREMENT AS autoIncrement
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  )
  if (!info) throw new Error(`Table ${database}.${table} not found`)
  const [cols, idx, fks, refs] = await Promise.all([
    columns(pool, database, table, isMariaDb),
    indexes(pool, database, table),
    rows(pool, `${FK_SELECT} WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [database, table]),
    rows(
      pool,
      `${FK_SELECT} WHERE k.REFERENCED_TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME = ? ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [database, table]
    )
  ])
  const isView = str(info.type).toUpperCase().includes('VIEW')
  const primary = idx.find((i) => i.name === 'PRIMARY')
  // For incoming keys, refDatabase/refTable name the referencing table and
  // columns are its columns; refColumns are the columns of this table.
  const referencedBy = groupForeignKeys(
    refs.map((r) => ({ ...r, refDatabase: r.tableSchema, refTable: r.tableName }) as Row)
  )
  return {
    database,
    name: table,
    kind: isView ? 'view' : 'table',
    engine: strOrNull(info.engine),
    collation: strOrNull(info.collation),
    comment: isView ? '' : str(info.comment),
    autoIncrement: numOrNull(info.autoIncrement),
    columns: cols,
    indexes: idx,
    foreignKeys: groupForeignKeys(fks),
    referencedBy,
    primaryKey: primary ? primary.columns.map((c) => c.name) : []
  }
}

const CREATE_COLUMN: Record<string, string> = {
  table: 'Create Table',
  view: 'Create View',
  procedure: 'Create Procedure',
  function: 'Create Function',
  trigger: 'SQL Original Statement',
  event: 'Create Event'
}

/**
 * CREATE statement of an object. It runs with `database` as the default
 * database so references to it are not qualified (a view reads `orders`, not
 * `db`.`orders`), which keeps dumps restorable into another database.
 * The given connection is left on `database`.
 */
export async function createStatement(
  connection: PoolConnection,
  database: string,
  name: string,
  kind: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'
): Promise<string> {
  await connection.query(`USE ${quoteIdent(database)}`)
  const [found] = await connection.query<Row[]>(`SHOW CREATE ${kind.toUpperCase()} ${quoteIdent(name)}`)
  const result = found[0]
  if (!result) throw new Error(`${kind} ${name} not found`)
  const value = result[CREATE_COLUMN[kind]]
  if (value === null || value === undefined) {
    throw new Error(`Not allowed to read the definition of ${kind} ${name}`)
  }
  return String(value)
}

export async function completion(pool: Pool, database: string): Promise<CompletionSchema> {
  const result = await rows(
    pool,
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database]
  )
  const schema: CompletionSchema = {}
  for (const r of result) (schema[str(r.tableName)] ??= []).push(str(r.columnName))
  return schema
}

export async function charsets(pool: Pool): Promise<{ charset: string; defaultCollation: string; collations: string[] }[]> {
  const result = await rows(
    pool,
    `SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, IS_DEFAULT AS isDefault
       FROM information_schema.COLLATIONS WHERE CHARACTER_SET_NAME IS NOT NULL ORDER BY CHARACTER_SET_NAME, COLLATION_NAME`
  )
  const byCharset = new Map<string, { charset: string; defaultCollation: string; collations: string[] }>()
  for (const r of result) {
    const charset = str(r.charset)
    let entry = byCharset.get(charset)
    if (!entry) {
      entry = { charset, defaultCollation: '', collations: [] }
      byCharset.set(charset, entry)
    }
    entry.collations.push(str(r.collation))
    if (str(r.isDefault) === 'Yes') entry.defaultCollation = str(r.collation)
  }
  return [...byCharset.values()]
}

export async function engines(pool: Pool): Promise<string[]> {
  const result = await rows(pool, 'SHOW ENGINES')
  return result.filter((r) => ['YES', 'DEFAULT'].includes(str(r.Support).toUpperCase())).map((r) => str(r.Engine))
}

/** CREATE statement read on a throwaway pool connection (USE changes its state). */
export async function createStatementFromPool(
  pool: Pool,
  database: string,
  name: string,
  kind: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'
): Promise<string> {
  const connection = await pool.getConnection()
  try {
    return await createStatement(connection, database, name, kind)
  } finally {
    connection.destroy()
  }
}
