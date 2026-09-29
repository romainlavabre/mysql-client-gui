// Implementation of the IPC API on top of the main process services.
import { statSync } from 'node:fs'
import { app, dialog, type BrowserWindow } from 'electron'
import type { Api } from '@shared/api'
import { splitStatements } from '@shared/sql/split'
import { detailsToDefinition } from '@shared/sql/ddl'
import type { StatementResult } from '@shared/types'
import type { WorkspaceManager } from '../workspace/manager'
import type { HistoryStore } from '../history'
import { SessionManager, testConnection } from '../db/session'
import { runScript, runStatement } from '../db/query'
import * as schema from '../db/schema'
import * as data from '../db/data'
import * as admin from '../db/admin'
import * as io from '../db/io'

export interface HandlerContext {
  dataDir: string
  workspace: WorkspaceManager
  sessions: SessionManager
  history: HistoryStore
  jobs: io.JobRunner
  window: () => BrowserWindow | null
  secretsEncrypted: () => boolean
}

export function createHandlers(ctx: HandlerContext): Api {
  const { workspace, sessions, history, jobs } = ctx
  const session = (sessionId: string) => sessions.get(sessionId)
  const writable = (sessionId: string, statements: string[] = ['-- admin']) => {
    const s = session(sessionId)
    sessions.assertWritable(s, statements.length > 0 ? statements : ['-- admin'])
    return s
  }
  const refuseReadOnly = (sessionId: string) => {
    const s = session(sessionId)
    if (s.readOnly) throw new Error('This connection is read-only')
    return s
  }
  const parentWindow = () => ctx.window() ?? undefined

  return {
    workspace: {
      state: async () => workspace.state(),
      clone: ({ name, remoteUrl, path }) => workspace.clone(name, remoteUrl, path),
      open: ({ name, path }) => workspace.open(name, path),
      create: ({ name, path }) => workspace.create(name, path),
      rename: async ({ repoId, name }) => workspace.rename(repoId, name),
      remove: async ({ repoId, deleteFiles }) => {
        if (workspace.state().activeRepoId === repoId) await sessions.closeAll()
        return workspace.remove(repoId, deleteFiles)
      },
      activate: async ({ repoId }) => {
        if (workspace.state().activeRepoId !== repoId) await sessions.closeAll()
        return workspace.activate(repoId)
      },
      setRemote: ({ repoId, remoteUrl }) => workspace.setRemote(repoId, remoteUrl),
      status: ({ repoId }) => workspace.status(repoId),
      sync: ({ repoId }) => workspace.sync(repoId),
      resolveConflicts: ({ repoId, choices }) => workspace.resolveConflicts(repoId, choices),
      defaultClonePath: async ({ name }) => workspace.defaultClonePath(name)
    },

    connections: {
      list: async () => workspace.listConnections(),
      get: async ({ connectionId }) => workspace.draft(connectionId),
      save: (draft) => workspace.saveConnection(draft),
      remove: ({ connectionId }) => workspace.removeConnection(connectionId),
      duplicate: ({ connectionId }) => workspace.duplicateConnection(connectionId),
      test: (draft) => {
        const config = { ...draft.config, user: draft.override.user || draft.config.user }
        return testConnection({ ...draft, config }, ctx.dataDir)
      }
    },

    queries: {
      list: async () => workspace.listQueries(),
      save: ({ query, previousPath }) => workspace.saveQuery(query, previousPath),
      remove: ({ path }) => workspace.removeQuery(path),
      history: async ({ connectionId, limit }) => history.list(connectionId, limit),
      clearHistory: async () => history.clear()
    },

    sessions: {
      open: ({ connectionId }) => sessions.open(connectionId, workspace.resolved(connectionId)),
      close: ({ sessionId }) => sessions.close(sessionId),
      closeTab: ({ sessionId, tabId }) => sessions.closeTab(sessionId, tabId),
      execute: async ({ sessionId, tabId, sql, database, rowLimit, stopOnError }) => {
        const s = session(sessionId)
        sessions.assertWritable(
          s,
          splitStatements(sql).map((statement) => statement.sql)
        )
        const tab = await sessions.tab(sessionId, tabId, database)
        const started = performance.now()
        let results: StatementResult[]
        try {
          results = await runScript(tab.connection, sql, rowLimit, stopOnError)
        } catch (error) {
          // Connection lost: forget it so the next run reconnects.
          await sessions.closeTab(sessionId, tabId)
          throw error
        }
        const [rows] = await tab.connection.query<import('mysql2').RowDataPacket[]>('SELECT DATABASE() AS db')
        tab.database = rows[0]?.db ?? null
        const error = results.find((r) => r.kind === 'error')
        history.add({
          connectionId: s.info.connectionId,
          database: tab.database,
          sql,
          executedAt: Date.now(),
          durationMs: performance.now() - started,
          error: error?.kind === 'error' ? error.message : undefined
        })
        return { results, database: tab.database }
      },
      cancel: ({ sessionId, tabId }) => sessions.cancel(sessionId, tabId),
      runStatements: async ({ sessionId, database, statements }) => {
        const s = writable(sessionId, statements)
        const connection = await s.pool.getConnection()
        const results: StatementResult[] = []
        try {
          if (database) await connection.query(`USE \`${database.replace(/`/g, '``')}\``)
          for (const statement of statements) {
            const statementResults = await runStatement(connection, statement, 1000)
            results.push(...statementResults)
            if (statementResults.some((r) => r.kind === 'error')) break
          }
        } finally {
          // USE changed the connection state: do not hand it back to the pool.
          connection.destroy()
        }
        return results
      }
    },

    schema: {
      databases: ({ sessionId }) => schema.databases(session(sessionId).pool),
      objects: ({ sessionId, database }) => schema.objects(session(sessionId).pool, database),
      table: ({ sessionId, database, table }) => {
        const s = session(sessionId)
        return schema.tableDetails(s.pool, database, table, s.info.isMariaDb)
      },
      createStatement: ({ sessionId, database, name, kind }) => schema.createStatementFromPool(session(sessionId).pool, database, name, kind),
      completion: ({ sessionId, database }) => schema.completion(session(sessionId).pool, database),
      charsets: ({ sessionId }) => schema.charsets(session(sessionId).pool),
      engines: ({ sessionId }) => schema.engines(session(sessionId).pool)
    },

    data: {
      fetch: (request) => data.fetchTableData(session(request.sessionId).pool, request),
      count: (request) => data.countRows(session(request.sessionId).pool, request),
      applyChanges: (request) => data.applyRowChanges(refuseReadOnly(request.sessionId).pool, request)
    },

    structure: {
      definitionOf: async ({ sessionId, database, table }) => {
        const s = session(sessionId)
        return detailsToDefinition(await schema.tableDetails(s.pool, database, table, s.info.isMariaDb))
      }
    },

    io: {
      dump: async (options) => {
        const s = session(options.sessionId)
        return { jobId: jobs.start(`Dump ${options.database}`, (job) => io.runDump(s.pool, options, job)) }
      },
      exportRows: (request) => io.exportRows(request),
      exportTable: async (request) => {
        const s = session(request.sessionId)
        return { jobId: jobs.start(`Export ${request.table}`, (job) => io.exportTable(s.pool, request, job)) }
      },
      importSql: async (request) => {
        const s = refuseReadOnly(request.sessionId)
        const size = statSync(request.filePath).size
        return { jobId: jobs.start(`Import ${request.filePath.split('/').pop()}`, (job) => io.importSql(s.pool, request, size, job)) }
      },
      previewCsv: ({ filePath, delimiter }) => io.previewCsv(filePath, delimiter),
      importCsv: async (request) => {
        const s = refuseReadOnly(request.sessionId)
        return { jobId: jobs.start(`Import into ${request.table}`, (job) => io.importCsv(s.pool, request, job)) }
      },
      cancelJob: async ({ jobId }) => jobs.cancel(jobId)
    },

    admin: {
      processes: ({ sessionId, full }) => admin.processes(session(sessionId).pool, full),
      kill: ({ sessionId, id, queryOnly }) => admin.kill(session(sessionId).pool, id, queryOnly),
      variables: ({ sessionId, scope }) => admin.variables(session(sessionId).pool, scope),
      status: ({ sessionId }) => admin.status(session(sessionId).pool),
      users: ({ sessionId }) => admin.users(session(sessionId).pool),
      grants: ({ sessionId, user, host }) => admin.grants(session(sessionId).pool, user, host),
      createUser: ({ sessionId, user, host, password }) => admin.createUser(refuseReadOnly(sessionId).pool, user, host, password),
      dropUser: ({ sessionId, user, host }) => admin.dropUser(refuseReadOnly(sessionId).pool, user, host),
      setPassword: ({ sessionId, user, host, password }) => admin.setPassword(refuseReadOnly(sessionId).pool, user, host, password),
      privileges: ({ sessionId, user, host, level }) => admin.privileges(session(sessionId).pool, user, host, level),
      privilegeLevels: ({ sessionId, user, host }) => admin.privilegeLevels(session(sessionId).pool, user, host),
      maintenance: ({ sessionId, database, tables, op }) => {
        const s = op === 'ANALYZE' || op === 'CHECK' ? session(sessionId) : refuseReadOnly(sessionId)
        return admin.maintenance(s.pool, database, tables, op)
      }
    },

    dialog: {
      openFile: async ({ title, filters }) => {
        const options = { title, filters, properties: ['openFile' as const] }
        const window = parentWindow()
        const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      saveFile: async ({ title, defaultPath, filters }) => {
        const options = { title, defaultPath, filters }
        const window = parentWindow()
        const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
        return result.canceled ? null : (result.filePath ?? null)
      },
      openDirectory: async ({ title }) => {
        const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] }
        const window = parentWindow()
        const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
    },

    app: {
      info: async () => ({ version: app.getVersion(), platform: process.platform, secretsEncrypted: ctx.secretsEncrypted() })
    }
  }
}
