// Domain types shared by the main process and the renderer.

// ---------------------------------------------------------------- workspaces

/** A git repository (or plain folder) holding shared connections and saved queries. */
export interface WorkspaceRepo {
  id: string
  name: string
  /** Absolute path of the local clone. */
  path: string
  remoteUrl?: string
}

export interface WorkspaceState {
  repos: WorkspaceRepo[]
  activeRepoId: string | null
}

export interface SyncStatus {
  repoId: string
  isGitRepo: boolean
  hasRemote: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
  syncing: boolean
  /** Files left conflicting by the last sync, relative to the repo root. */
  conflicts: string[]
  lastSyncAt: number | null
  error: string | null
}

export type ConflictChoice = 'mine' | 'theirs'

// --------------------------------------------------------------- connections

export type EnvTag = 'dev' | 'staging' | 'prod' | 'other'

export interface SshTunnelConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  auth: 'agent' | 'keyFile' | 'password'
  /** Path of the private key, `~` allowed. Used when auth is keyFile. */
  keyPath?: string
}

export interface SslConfig {
  enabled: boolean
  rejectUnauthorized: boolean
  caPath?: string
  certPath?: string
  keyPath?: string
}

/** Connection settings stored in the workspace repository. Never holds secrets. */
export interface ConnectionConfig {
  id: string
  /** File name in `connections/`, derived from the name. */
  slug: string
  name: string
  color?: string
  env: EnvTag
  readOnly: boolean
  host: string
  port: number
  user: string
  defaultDatabase?: string
  ssl: SslConfig
  ssh: SshTunnelConfig
}

/** Secrets stored locally only, encrypted with the OS keyring. */
export interface ConnectionSecrets {
  password?: string
  sshPassword?: string
  sshPassphrase?: string
}

/** Per-user overrides of a shared connection, stored locally. */
export interface ConnectionOverride {
  user?: string
}

export interface ConnectionDraft {
  config: ConnectionConfig
  secrets: ConnectionSecrets
  override: ConnectionOverride
}

// ------------------------------------------------------------- saved queries

export interface SavedQuery {
  /** Path relative to `queries/`, with forward slashes, ending with `.sql`. */
  path: string
  name: string
  description?: string
  /** Slug of the connection the query is meant for. */
  connection?: string
  sql: string
}

export interface HistoryEntry {
  id: string
  connectionId: string
  database: string | null
  sql: string
  executedAt: number
  durationMs: number
  error?: string
}

// ------------------------------------------------------------------ sessions

export interface SessionInfo {
  sessionId: string
  connectionId: string
  serverVersion: string
  isMariaDb: boolean
  currentUser: string
}

// ------------------------------------------------------------------- queries

export interface ColumnMeta {
  name: string
  /** Table the column comes from, when known (empty for expressions). */
  table: string
  /** Original column name in its table. */
  orgName: string
  database: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export type CellValue = string | number | null | Uint8Array

export interface RowsResult {
  kind: 'rows'
  sql: string
  columns: ColumnMeta[]
  rows: CellValue[][]
  truncated: boolean
  durationMs: number
}

export interface OkResult {
  kind: 'ok'
  sql: string
  affectedRows: number
  insertId: number | string
  warningCount: number
  info: string
  durationMs: number
}

export interface ErrorResult {
  kind: 'error'
  sql: string
  message: string
  code?: string
  durationMs: number
}

export type StatementResult = RowsResult | OkResult | ErrorResult

export interface ExecuteRequest {
  sessionId: string
  /** Editor tab owning the dedicated connection (keeps USE, variables, transactions). */
  tabId: string
  sql: string
  database?: string | null
  rowLimit: number
  stopOnError: boolean
}

export interface ExecuteResponse {
  results: StatementResult[]
  /** Database selected on the tab connection after execution. */
  database: string | null
}

// -------------------------------------------------------------------- schema

export interface DatabaseInfo {
  name: string
  charset: string
  collation: string
}

export type ObjectKind = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'

export interface TableSummary {
  name: string
  kind: 'table' | 'view'
  engine: string | null
  rows: number | null
  dataLength: number | null
  indexLength: number | null
  collation: string | null
  comment: string
  autoIncrement: number | null
  createTime: string | null
  updateTime: string | null
}

export interface RoutineSummary {
  name: string
  kind: 'procedure' | 'function'
  returns: string | null
  comment: string
}

export interface TriggerSummary {
  name: string
  table: string
  timing: string
  event: string
}

export interface EventSummary {
  name: string
  status: string
  schedule: string
}

export interface SchemaObjects {
  tables: TableSummary[]
  routines: RoutineSummary[]
  triggers: TriggerSummary[]
  events: EventSummary[]
}

export interface ColumnInfo {
  name: string
  position: number
  /** Full column type, e.g. `varchar(255)`, `int unsigned`. */
  type: string
  dataType: string
  nullable: boolean
  default: string | null
  /** Whether `default` is an expression (CURRENT_TIMESTAMP, ...) rather than a literal. */
  defaultIsExpression: boolean
  extra: string
  key: string
  charset: string | null
  collation: string | null
  comment: string
  generationExpression: string | null
}

export interface IndexInfo {
  name: string
  unique: boolean
  type: string
  columns: { name: string; subPart: number | null; order: 'ASC' | 'DESC' }[]
  comment: string
}

export interface ForeignKeyInfo {
  name: string
  columns: string[]
  refDatabase: string
  refTable: string
  refColumns: string[]
  onUpdate: string
  onDelete: string
}

export interface TableDetails {
  database: string
  name: string
  kind: 'table' | 'view'
  engine: string | null
  collation: string | null
  comment: string
  autoIncrement: number | null
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  /** Foreign keys of other tables pointing to this one. */
  referencedBy: ForeignKeyInfo[]
  primaryKey: string[]
}

/** Table name → column names, for editor autocompletion. */
export type CompletionSchema = Record<string, string[]>

// ---------------------------------------------------------------- table data

export type FilterOperator =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'LIKE'
  | 'NOT LIKE'
  | 'CONTAINS'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'BETWEEN'

export interface ColumnFilter {
  column: string
  operator: FilterOperator
  value?: string
  /** Second bound for BETWEEN. */
  value2?: string
}

export interface SortSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

export interface TableDataRequest {
  sessionId: string
  database: string
  table: string
  filters: ColumnFilter[]
  /** Raw SQL condition appended with AND, for power users. */
  rawWhere?: string
  sort: SortSpec[]
  limit: number
  offset: number
}

export interface TableDataResponse {
  columns: ColumnMeta[]
  rows: CellValue[][]
  sql: string
  durationMs: number
}

export type RowChange =
  | { type: 'update'; key: Record<string, CellValue>; values: Record<string, CellValue> }
  | { type: 'insert'; values: Record<string, CellValue> }
  | { type: 'delete'; key: Record<string, CellValue> }

export interface RowChangesRequest {
  sessionId: string
  database: string
  table: string
  changes: RowChange[]
}

// ----------------------------------------------------------------- structure

export interface ColumnDefinition {
  name: string
  type: string
  nullable: boolean
  /** Literal default value, or expression when defaultIsExpression. Undefined = no default. */
  default?: string | null
  defaultIsExpression?: boolean
  autoIncrement: boolean
  onUpdateCurrentTimestamp?: boolean
  /** Generated column expression. */
  generated?: { expression: string; stored: boolean } | null
  charset?: string
  collation?: string
  comment?: string
  /** Name of the column in the original table, to detect renames. */
  originalName?: string
}

export interface IndexDefinition {
  name: string
  kind: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'
  columns: { name: string; length?: number | null; order?: 'ASC' | 'DESC' }[]
  comment?: string
}

export interface ForeignKeyDefinition {
  name: string
  columns: string[]
  refDatabase?: string
  refTable: string
  refColumns: string[]
  onUpdate: string
  onDelete: string
}

export interface TableDefinition {
  database: string
  name: string
  engine?: string
  charset?: string
  collation?: string
  comment?: string
  autoIncrement?: number | null
  columns: ColumnDefinition[]
  indexes: IndexDefinition[]
  foreignKeys: ForeignKeyDefinition[]
}

// ---------------------------------------------------------- import / export

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sql'

export interface DumpOptions {
  sessionId: string
  database: string
  /** Tables and views to include; empty = all. */
  tables: string[]
  structure: boolean
  data: boolean
  dropStatements: boolean
  routines: boolean
  triggers: boolean
  events: boolean
  /** Rows per extended INSERT statement. */
  rowsPerInsert: number
  filePath: string
}

export interface ExportRowsRequest {
  format: ExportFormat
  filePath: string
  columns: string[]
  rows: CellValue[][]
  /** Table name used by the SQL INSERT format. */
  tableName?: string
}

export interface ExportTableRequest {
  sessionId: string
  database: string
  table: string
  format: ExportFormat
  filePath: string
}

export interface ImportSqlRequest {
  sessionId: string
  database: string | null
  filePath: string
  stopOnError: boolean
}

export interface CsvPreview {
  headers: string[]
  rows: string[][]
  delimiter: string
}

export interface ImportCsvRequest {
  sessionId: string
  database: string
  table: string
  filePath: string
  delimiter: string
  hasHeader: boolean
  /** CSV column index → table column name; null skips the CSV column. */
  mapping: (string | null)[]
  /** Values equal to this string are inserted as NULL. */
  nullValue: string
  batchSize: number
  mode: 'insert' | 'insertIgnore' | 'replace'
}

export interface JobProgress {
  jobId: string
  label: string
  done: number
  total: number | null
  finished: boolean
  error: string | null
  /** Non-fatal errors (import with stopOnError disabled). */
  warnings: string[]
}

// --------------------------------------------------------------------- admin

export interface ProcessInfo {
  id: number
  user: string
  host: string
  db: string | null
  command: string
  time: number
  state: string | null
  info: string | null
}

export interface VariableInfo {
  name: string
  value: string
}

export interface UserAccount {
  user: string
  host: string
  locked: boolean
  passwordExpired: boolean
}

export type PrivilegeLevel = { kind: 'global' } | { kind: 'database'; database: string } | { kind: 'table'; database: string; table: string }

export interface GrantRequest {
  sessionId: string
  user: string
  host: string
  level: PrivilegeLevel
  privileges: string[]
  withGrantOption: boolean
}

export type MaintenanceOp = 'ANALYZE' | 'OPTIMIZE' | 'CHECK' | 'REPAIR'
