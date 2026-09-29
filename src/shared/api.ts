// IPC contract between the renderer and the main process.
// Each method `domain.name` is invoked on the channel `domain:name`.
import type {
  CompletionSchema,
  ConflictChoice,
  ConnectionConfig,
  ConnectionDraft,
  CsvPreview,
  DatabaseInfo,
  DumpOptions,
  ExecuteRequest,
  ExecuteResponse,
  ExportRowsRequest,
  ExportTableRequest,
  HistoryEntry,
  ImportCsvRequest,
  ImportSqlRequest,
  JobProgress,
  MaintenanceOp,
  PrivilegeLevel,
  PrivilegeSet,
  ProcessInfo,
  RowChangesRequest,
  SavedQuery,
  SchemaObjects,
  SessionInfo,
  StatementResult,
  SyncStatus,
  TableDataRequest,
  TableDataResponse,
  TableDefinition,
  TableDetails,
  UserAccount,
  VariableInfo,
  WorkspaceRepo,
  WorkspaceState
} from './types'

export interface Api {
  workspace: {
    state(): Promise<WorkspaceState>
    /** Clones a remote repository into `path` (or the default location) and registers it. */
    clone(args: { name: string; remoteUrl: string; path?: string }): Promise<WorkspaceRepo>
    /** Registers an existing folder, initialising the layout when empty. */
    open(args: { name: string; path: string }): Promise<WorkspaceRepo>
    /** Creates a new local git repository. */
    create(args: { name: string; path?: string }): Promise<WorkspaceRepo>
    rename(args: { repoId: string; name: string }): Promise<WorkspaceState>
    remove(args: { repoId: string; deleteFiles: boolean }): Promise<WorkspaceState>
    activate(args: { repoId: string }): Promise<WorkspaceState>
    setRemote(args: { repoId: string; remoteUrl: string }): Promise<WorkspaceRepo>
    status(args: { repoId: string }): Promise<SyncStatus>
    sync(args: { repoId: string }): Promise<SyncStatus>
    resolveConflicts(args: { repoId: string; choices: Record<string, ConflictChoice> }): Promise<SyncStatus>
    defaultClonePath(args: { name: string }): Promise<string>
  }
  connections: {
    list(): Promise<ConnectionConfig[]>
    get(args: { connectionId: string }): Promise<ConnectionDraft>
    save(args: ConnectionDraft): Promise<ConnectionConfig>
    remove(args: { connectionId: string }): Promise<void>
    duplicate(args: { connectionId: string }): Promise<ConnectionConfig>
    test(args: ConnectionDraft): Promise<{ serverVersion: string }>
  }
  queries: {
    list(): Promise<SavedQuery[]>
    save(args: { query: SavedQuery; previousPath?: string }): Promise<SavedQuery>
    remove(args: { path: string }): Promise<void>
    history(args: { connectionId?: string; limit: number }): Promise<HistoryEntry[]>
    clearHistory(): Promise<void>
  }
  sessions: {
    open(args: { connectionId: string }): Promise<SessionInfo>
    close(args: { sessionId: string }): Promise<void>
    closeTab(args: { sessionId: string; tabId: string }): Promise<void>
    execute(args: ExecuteRequest): Promise<ExecuteResponse>
    cancel(args: { sessionId: string; tabId: string }): Promise<void>
    /** Runs statements on the pool, in order, inside a transaction when possible. */
    runStatements(args: { sessionId: string; database: string | null; statements: string[] }): Promise<StatementResult[]>
  }
  schema: {
    databases(args: { sessionId: string }): Promise<DatabaseInfo[]>
    objects(args: { sessionId: string; database: string }): Promise<SchemaObjects>
    table(args: { sessionId: string; database: string; table: string }): Promise<TableDetails>
    createStatement(args: {
      sessionId: string
      database: string
      name: string
      kind: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'
    }): Promise<string>
    completion(args: { sessionId: string; database: string }): Promise<CompletionSchema>
    charsets(args: { sessionId: string }): Promise<{ charset: string; defaultCollation: string; collations: string[] }[]>
    engines(args: { sessionId: string }): Promise<string[]>
  }
  data: {
    fetch(args: TableDataRequest): Promise<TableDataResponse>
    count(args: Omit<TableDataRequest, 'limit' | 'offset' | 'sort'>): Promise<number>
    applyChanges(args: RowChangesRequest): Promise<{ affectedRows: number }>
  }
  structure: {
    definitionOf(args: { sessionId: string; database: string; table: string }): Promise<TableDefinition>
  }
  io: {
    dump(args: DumpOptions): Promise<{ jobId: string }>
    exportRows(args: ExportRowsRequest): Promise<void>
    exportTable(args: ExportTableRequest): Promise<{ jobId: string }>
    importSql(args: ImportSqlRequest): Promise<{ jobId: string }>
    previewCsv(args: { filePath: string; delimiter?: string }): Promise<CsvPreview>
    importCsv(args: ImportCsvRequest): Promise<{ jobId: string }>
    cancelJob(args: { jobId: string }): Promise<void>
  }
  admin: {
    processes(args: { sessionId: string; full: boolean }): Promise<ProcessInfo[]>
    kill(args: { sessionId: string; id: number; queryOnly: boolean }): Promise<void>
    variables(args: { sessionId: string; scope: 'GLOBAL' | 'SESSION' }): Promise<VariableInfo[]>
    status(args: { sessionId: string }): Promise<VariableInfo[]>
    users(args: { sessionId: string }): Promise<UserAccount[]>
    grants(args: { sessionId: string; user: string; host: string }): Promise<string[]>
    createUser(args: { sessionId: string; user: string; host: string; password: string }): Promise<void>
    dropUser(args: { sessionId: string; user: string; host: string }): Promise<void>
    setPassword(args: { sessionId: string; user: string; host: string; password: string }): Promise<void>
    /** Current privileges of an account at one level. */
    privileges(args: { sessionId: string; user: string; host: string; level: PrivilegeLevel }): Promise<PrivilegeSet>
    /** Levels (global, databases, tables) where the account has privileges. */
    privilegeLevels(args: { sessionId: string; user: string; host: string }): Promise<PrivilegeLevel[]>
    maintenance(args: {
      sessionId: string
      database: string
      tables: string[]
      op: MaintenanceOp
    }): Promise<StatementResult[]>
  }
  dialog: {
    openFile(args: { title: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    saveFile(args: {
      title: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string | null>
    openDirectory(args: { title: string }): Promise<string | null>
  }
  app: {
    info(): Promise<{ version: string; platform: string; secretsEncrypted: boolean }>
  }
}

/** Events pushed from the main process. */
export interface ApiEvents {
  'workspace:status': SyncStatus
  'workspace:changed': WorkspaceState
  'job:progress': JobProgress
}

/** Method names per domain, used by the preload script to build the bridge. */
export const API_METHODS: { [D in keyof Api]: (keyof Api[D])[] } = {
  workspace: [
    'state',
    'clone',
    'open',
    'create',
    'rename',
    'remove',
    'activate',
    'setRemote',
    'status',
    'sync',
    'resolveConflicts',
    'defaultClonePath'
  ],
  connections: ['list', 'get', 'save', 'remove', 'duplicate', 'test'],
  queries: ['list', 'save', 'remove', 'history', 'clearHistory'],
  sessions: ['open', 'close', 'closeTab', 'execute', 'cancel', 'runStatements'],
  schema: ['databases', 'objects', 'table', 'createStatement', 'completion', 'charsets', 'engines'],
  data: ['fetch', 'count', 'applyChanges'],
  structure: ['definitionOf'],
  io: ['dump', 'exportRows', 'exportTable', 'importSql', 'previewCsv', 'importCsv', 'cancelJob'],
  admin: [
    'processes',
    'kill',
    'variables',
    'status',
    'users',
    'grants',
    'createUser',
    'dropUser',
    'setPassword',
    'privileges',
    'privilegeLevels',
    'maintenance'
  ],
  dialog: ['openFile', 'saveFile', 'openDirectory'],
  app: ['info']
}

export interface Bridge {
  api: Api
  on<E extends keyof ApiEvents>(event: E, listener: (payload: ApiEvents[E]) => void): () => void
}

/** Error message format used across IPC: Electron prefixes errors, the renderer strips it. */
export function cleanIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
