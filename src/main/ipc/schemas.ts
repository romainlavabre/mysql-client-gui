// Validation of every IPC payload coming from the renderer.
import { z } from 'zod'
import type { Api } from '@shared/api'

const id = z.string().min(1).max(200)
const name = z.string().min(1).max(500)
const path = z.string().min(1).max(4096)
const sql = z.string().max(50_000_000)
const sessionId = id
const database = z.string().min(1).max(64)
const table = z.string().min(1).max(64)
const cell = z.union([z.string(), z.number(), z.null(), z.instanceof(Uint8Array)])
const cells = z.record(z.string(), cell)

const connectionConfig = z.object({
  id: z.string().max(200),
  slug: z.string().max(200),
  name,
  color: z.string().max(50).optional(),
  env: z.enum(['dev', 'staging', 'prod', 'other']),
  readOnly: z.boolean(),
  host: z.string().max(500),
  port: z.number().int().min(1).max(65535),
  user: z.string().max(200),
  defaultDatabase: z.string().max(64).optional(),
  ssl: z.object({
    enabled: z.boolean(),
    rejectUnauthorized: z.boolean(),
    caPath: z.string().max(4096).optional(),
    certPath: z.string().max(4096).optional(),
    keyPath: z.string().max(4096).optional()
  }),
  ssh: z.object({
    enabled: z.boolean(),
    host: z.string().max(500),
    port: z.number().int().min(1).max(65535),
    user: z.string().max(200),
    auth: z.enum(['agent', 'keyFile', 'password']),
    keyPath: z.string().max(4096).optional()
  })
})

const connectionDraft = z.object({
  config: connectionConfig,
  secrets: z.object({
    password: z.string().max(10_000).optional(),
    sshPassword: z.string().max(10_000).optional(),
    sshPassphrase: z.string().max(10_000).optional()
  }),
  override: z.object({ user: z.string().max(200).optional() }),
  secretsUnreadable: z.boolean().optional()
})

const savedQuery = z.object({
  path,
  name,
  description: z.string().max(5000).optional(),
  connection: z.string().max(200).optional(),
  sql
})

const filter = z.object({
  column: z.string().min(1).max(64),
  operator: z.enum(['=', '!=', '<', '<=', '>', '>=', 'LIKE', 'NOT LIKE', 'CONTAINS', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN']),
  value: z.string().max(100_000).optional(),
  value2: z.string().max(100_000).optional()
})

const sort = z.object({ column: z.string().min(1).max(64), direction: z.enum(['ASC', 'DESC']) })

const tableDataBase = {
  sessionId,
  database,
  table,
  filters: z.array(filter).max(100),
  rawWhere: z.string().max(100_000).optional()
}

const rowChange = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update'), key: cells, values: cells }),
  z.object({ type: z.literal('insert'), values: cells }),
  z.object({ type: z.literal('delete'), key: cells })
])

const exportFormat = z.enum(['csv', 'json', 'xlsx', 'sql'])

const privilegeLevel = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('database'), database }),
  z.object({ kind: z.literal('table'), database, table })
])


const fileFilters = z.array(z.object({ name: z.string().max(100), extensions: z.array(z.string().max(20)).max(20) })).max(20).optional()

const none = z.undefined().optional()

type Schemas = { [D in keyof Api]: { [M in keyof Api[D]]: z.ZodType } }

export const schemas: Schemas = {
  workspace: {
    state: none,
    clone: z.object({ name, remoteUrl: z.string().min(1).max(2000), path: path.optional() }),
    open: z.object({ name, path }),
    create: z.object({ name, path: path.optional() }),
    rename: z.object({ repoId: id, name }),
    remove: z.object({ repoId: id, deleteFiles: z.boolean() }),
    activate: z.object({ repoId: id }),
    setRemote: z.object({ repoId: id, remoteUrl: z.string().min(1).max(2000) }),
    status: z.object({ repoId: id }),
    sync: z.object({ repoId: id }),
    resolveConflicts: z.object({ repoId: id, choices: z.record(z.string().max(4096), z.enum(['mine', 'theirs'])) }),
    defaultClonePath: z.object({ name })
  },
  connections: {
    list: none,
    get: z.object({ connectionId: id }),
    save: connectionDraft,
    remove: z.object({ connectionId: id }),
    duplicate: z.object({ connectionId: id }),
    test: connectionDraft
  },
  queries: {
    list: none,
    save: z.object({ query: savedQuery, previousPath: path.optional() }),
    remove: z.object({ path }),
    history: z.object({ connectionId: id.optional(), limit: z.number().int().min(1).max(10_000) }),
    clearHistory: none
  },
  sessions: {
    open: z.object({ connectionId: id }),
    close: z.object({ sessionId }),
    closeTab: z.object({ sessionId, tabId: id }),
    execute: z.object({
      sessionId,
      tabId: id,
      sql,
      database: z.string().max(64).nullable().optional(),
      rowLimit: z.number().int().min(1).max(10_000_000),
      stopOnError: z.boolean()
    }),
    cancel: z.object({ sessionId, tabId: id }),
    runStatements: z.object({ sessionId, database: z.string().max(64).nullable(), statements: z.array(sql).max(10_000) })
  },
  schema: {
    databases: z.object({ sessionId }),
    objects: z.object({ sessionId, database }),
    table: z.object({ sessionId, database, table }),
    createStatement: z.object({
      sessionId,
      database,
      name: table,
      kind: z.enum(['table', 'view', 'procedure', 'function', 'trigger', 'event'])
    }),
    completion: z.object({ sessionId, database }),
    charsets: z.object({ sessionId }),
    engines: z.object({ sessionId })
  },
  data: {
    fetch: z.object({
      ...tableDataBase,
      sort: z.array(sort).max(20),
      limit: z.number().int().min(1).max(1_000_000),
      offset: z.number().int().min(0)
    }),
    count: z.object(tableDataBase),
    applyChanges: z.object({ sessionId, database, table, changes: z.array(rowChange).max(100_000) })
  },
  structure: {
    definitionOf: z.object({ sessionId, database, table })
  },
  io: {
    dump: z.object({
      sessionId,
      database,
      tables: z.array(table).max(100_000),
      structure: z.boolean(),
      data: z.boolean(),
      dropStatements: z.boolean(),
      routines: z.boolean(),
      triggers: z.boolean(),
      events: z.boolean(),
      rowsPerInsert: z.number().int().min(1).max(100_000),
      filePath: path
    }),
    exportRows: z.object({
      format: exportFormat,
      filePath: path,
      columns: z.array(z.string()).max(10_000),
      rows: z.array(z.array(cell)),
      tableName: z.string().max(64).optional()
    }),
    exportTable: z.object({ sessionId, database, table, format: exportFormat, filePath: path }),
    importSql: z.object({ sessionId, database: z.string().max(64).nullable(), filePath: path, stopOnError: z.boolean() }),
    previewCsv: z.object({ filePath: path, delimiter: z.string().max(5).optional() }),
    importCsv: z.object({
      sessionId,
      database,
      table,
      filePath: path,
      delimiter: z.string().min(1).max(5),
      hasHeader: z.boolean(),
      mapping: z.array(z.string().max(64).nullable()).max(10_000),
      nullValue: z.string().max(100),
      batchSize: z.number().int().min(1).max(100_000),
      mode: z.enum(['insert', 'insertIgnore', 'replace'])
    }),
    cancelJob: z.object({ jobId: id })
  },
  admin: {
    processes: z.object({ sessionId, full: z.boolean() }),
    kill: z.object({ sessionId, id: z.number().int().positive(), queryOnly: z.boolean() }),
    variables: z.object({ sessionId, scope: z.enum(['GLOBAL', 'SESSION']) }),
    status: z.object({ sessionId }),
    users: z.object({ sessionId }),
    grants: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255) }),
    createUser: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255), password: z.string().max(1000) }),
    dropUser: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255) }),
    setPassword: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255), password: z.string().max(1000) }),
    privileges: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255), level: privilegeLevel }),
    privilegeLevels: z.object({ sessionId, user: z.string().max(200), host: z.string().max(255) }),
    maintenance: z.object({ sessionId, database, tables: z.array(table).max(100_000), op: z.enum(['ANALYZE', 'OPTIMIZE', 'CHECK', 'REPAIR']) })
  },
  dialog: {
    openFile: z.object({ title: z.string().max(200), filters: fileFilters }),
    saveFile: z.object({ title: z.string().max(200), defaultPath: z.string().max(4096).optional(), filters: fileFilters }),
    openDirectory: z.object({ title: z.string().max(200) })
  },
  app: {
    info: none
  }
}
