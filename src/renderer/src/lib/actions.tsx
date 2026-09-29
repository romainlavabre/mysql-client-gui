// Shared actions: running generated statements with the safety checks.
import type { QueryClient } from '@tanstack/react-query'
import type { StatementResult } from '@shared/types'
import { isDestructive, isUnboundedWrite, isWriteStatement } from '@shared/sql/classify'
import { api, errorMessage } from './bridge'
import { confirm, toast } from '../components/feedback'
import { useApp } from '../store'

export function requireSession() {
  const session = useApp.getState().session
  if (!session) throw new Error('Not connected')
  return session
}

/**
 * Asks for confirmation before running statements when needed: destructive or
 * unbounded statements, and any write on a production connection.
 * Returns false when the user cancelled.
 */
export async function confirmStatements(statements: string[], options: { force?: boolean; title?: string } = {}): Promise<boolean> {
  const session = requireSession()
  const writes = statements.filter(isWriteStatement)
  if (writes.length === 0 && !options.force) return true
  const isProd = session.connection.env === 'prod'
  const destructive = statements.filter((s) => isDestructive(s) || isUnboundedWrite(s))
  if (!isProd && destructive.length === 0 && !options.force) return true

  const preview = (destructive.length > 0 ? destructive : writes).slice(0, 8)
  return confirm({
    title: options.title ?? (isProd ? 'Write on production' : 'Confirm'),
    body: (
      <div className="flex flex-col gap-2">
        {isProd && (
          <span>
            You are about to modify <b className="text-danger">{session.connection.name}</b> (production).
          </span>
        )}
        {destructive.some(isUnboundedWrite) && <span className="text-warning">UPDATE / DELETE without a WHERE clause affects every row.</span>}
        <pre className="max-h-60 overflow-auto rounded bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap">
          {preview.join(';\n\n')}
          {(destructive.length > 0 ? destructive : writes).length > preview.length ? '\n…' : ''}
        </pre>
      </div>
    ),
    confirmLabel: 'Run',
    danger: true,
    typeToConfirm: isProd && destructive.length > 0 ? session.connection.name : undefined
  })
}

/** Runs generated statements (DDL, maintenance) after confirmation; returns null when cancelled or failed. */
export async function runStatements(
  statements: string[],
  database: string | null,
  queryClient?: QueryClient,
  options: { force?: boolean; title?: string; success?: string } = {}
): Promise<StatementResult[] | null> {
  const session = requireSession()
  if (!(await confirmStatements(statements, options))) return null
  try {
    const results = await api.sessions.runStatements({ sessionId: session.info.sessionId, database, statements })
    const error = results.find((r) => r.kind === 'error')
    if (error && error.kind === 'error') {
      toast(`${error.message}\n\n${error.sql.slice(0, 300)}`, 'error')
      return null
    }
    if (options.success) toast(options.success, 'success')
    if (queryClient) void invalidateSchema(queryClient)
    return results
  } catch (error) {
    toast(errorMessage(error), 'error')
    return null
  }
}

export function invalidateSchema(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['databases'] }),
    queryClient.invalidateQueries({ queryKey: ['objects'] }),
    queryClient.invalidateQueries({ queryKey: ['table'] }),
    queryClient.invalidateQueries({ queryKey: ['completion'] })
  ]).then(() => undefined)
}
