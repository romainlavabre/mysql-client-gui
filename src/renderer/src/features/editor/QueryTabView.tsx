// SQL editor tab: editor on top, results below.
import { useQuery } from '@tanstack/react-query'
import type { KeyBinding } from '@codemirror/view'
import { AlignLeft, Bookmark, CircleStop, Database, ListTree, Play } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { format as formatSql } from 'sql-formatter'
import { splitStatements, statementAt } from '@shared/sql/split'
import { api, errorMessage } from '../../lib/bridge'
import { confirmStatements } from '../../lib/actions'
import { toast } from '../../components/feedback'
import { SqlEditor, type SqlEditorHandle } from '../../components/SqlEditor'
import { Button, IconButton, Select, Tooltip } from '../../components/ui'
import { updateTab, useApp, type QueryTab } from '../../store'
import { invalidateSchema } from '../../lib/actions'
import { useQueryClient } from '@tanstack/react-query'
import { ResultsPanel } from './ResultsPanel'
import type { CompletionData } from '../../lib/sqlCompletion'
import { SaveQueryDialog } from '../saved/SaveQueryDialog'
import { useSavedQueries } from '../workspace/useWorkspace'

const DDL_PATTERN = /^\s*(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i

export function QueryTabView({ tab }: { tab: QueryTab }) {
  const session = useApp((s) => s.session)!
  const rowLimit = useApp((s) => s.rowLimit)
  const queryClient = useQueryClient()
  const sessionId = session.info.sessionId
  const editor = useRef<SqlEditorHandle>(null)
  const [saving, setSaving] = useState(false)
  const { data: savedQueries } = useSavedQueries()

  const { data: databases } = useQuery({
    queryKey: ['databases', sessionId],
    queryFn: () => api.schema.databases({ sessionId })
  })
  const { data: completion } = useQuery({
    queryKey: ['completion', sessionId, tab.database],
    queryFn: () => api.schema.completion({ sessionId, database: tab.database! }),
    enabled: !!tab.database,
    staleTime: 5 * 60_000
  })

  const completionData = useMemo<CompletionData>(
    () => ({
      tables: completion ?? {},
      databases: databases?.map((d) => d.name) ?? [],
      // Other databases (db.table) are loaded when first typed, then cached.
      loadDatabase: (database) =>
        queryClient.fetchQuery({
          queryKey: ['completion', sessionId, database],
          queryFn: () => api.schema.completion({ sessionId, database }),
          staleTime: 5 * 60_000
        })
    }),
    [completion, databases, queryClient, sessionId]
  )

  // Latest tab value for the keyboard handlers, which are created once.
  const tabRef = useRef(tab)
  tabRef.current = tab

  const execute = useCallback(
    async (mode: 'run' | 'explain') => {
      const current = tabRef.current
      if (current.running) return
      let sql: string
      const selection = editor.current?.selection()
      if (selection) sql = selection
      else if (mode === 'run') sql = current.sql
      else sql = statementAt(current.sql, editor.current?.cursor() ?? 0)?.sql ?? ''
      if (!sql.trim()) return
      if (mode === 'explain') {
        const statement = splitStatements(sql)[0]?.sql
        if (!statement) return
        sql = `EXPLAIN ${statement}`
      }
      const statements = splitStatements(sql).map((s) => s.sql)
      if (!(await confirmStatements(statements))) return

      updateTab<QueryTab>(current.id, { running: true, results: [], activeResult: 0 })
      try {
        const response = await api.sessions.execute({
          sessionId,
          tabId: current.id,
          sql,
          database: current.database,
          rowLimit,
          stopOnError: true
        })
        // Show the first result set, or the first error.
        const firstError = response.results.findIndex((r) => r.kind === 'error')
        const firstRows = response.results.findIndex((r) => r.kind === 'rows')
        updateTab<QueryTab>(current.id, {
          running: false,
          results: response.results,
          activeResult: firstError >= 0 ? firstError : Math.max(0, firstRows),
          database: response.database
        })
        if (response.database) useApp.setState({ currentDatabase: response.database })
        if (statements.some((s) => DDL_PATTERN.test(s))) void invalidateSchema(queryClient)
      } catch (error) {
        updateTab<QueryTab>(current.id, {
          running: false,
          results: [{ kind: 'error', sql, message: errorMessage(error), durationMs: 0 }]
        })
      }
    },
    [sessionId, rowLimit, queryClient]
  )

  const cancel = (): void => {
    void api.sessions.cancel({ sessionId, tabId: tab.id }).catch((error) => toast(errorMessage(error), 'error'))
  }

  const format = (): void => {
    try {
      const formatted = formatSql(tabRef.current.sql, { language: session.info.isMariaDb ? 'mariadb' : 'mysql', keywordCase: 'upper' })
      updateTab<QueryTab>(tab.id, { sql: formatted })
    } catch (error) {
      toast(`Cannot format: ${errorMessage(error)}`, 'error')
    }
  }

  const save = useCallback(async () => {
    const current = tabRef.current
    const existing = current.savedPath ? savedQueries?.find((q) => q.path === current.savedPath) : undefined
    if (!existing) {
      setSaving(true)
      return
    }
    try {
      await api.queries.save({ query: { ...existing, sql: current.sql } })
      updateTab<QueryTab>(current.id, { savedSql: current.sql })
      void queryClient.invalidateQueries({ queryKey: ['queries'] })
      toast(`Saved "${existing.name}"`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }, [savedQueries, queryClient])

  const keys = useMemo<KeyBinding[]>(
    () => [
      { key: 'Mod-Enter', run: () => (void execute('run'), true) },
      { key: 'Mod-Shift-Enter', run: () => (void execute('run'), true) },
      { key: 'Mod-s', run: () => (void save(), true), preventDefault: true },
      { key: 'Mod-Shift-f', run: () => (format(), true) }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [execute, save]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {tab.running ? (
          <Button size="sm" variant="danger" icon={<CircleStop className="size-3.5" />} onClick={cancel}>
            Cancel
          </Button>
        ) : (
          <Tooltip content="Run all statements, or the selection (Ctrl+Enter)">
            <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => void execute('run')}>
              Run
            </Button>
          </Tooltip>
        )}
        <IconButton label="Explain the current statement" onClick={() => void execute('explain')} disabled={tab.running}>
          <ListTree className="size-4" />
        </IconButton>
        <IconButton label="Format (Ctrl+Shift+F)" onClick={format}>
          <AlignLeft className="size-4" />
        </IconButton>
        <IconButton label={tab.savedPath ? 'Save (Ctrl+S)' : 'Save to the workspace (Ctrl+S)'} onClick={() => void save()}>
          <Bookmark className="size-4" />
        </IconButton>
        {tab.savedPath && <span className="truncate text-[11px] text-muted">{tab.savedPath}</span>}
        <div className="flex-1" />
        <Database className="size-3.5 text-muted" />
        <Select
          className="h-7 w-52 text-xs"
          value={tab.database ?? ''}
          onChange={(e) => {
            const database = e.target.value || null
            updateTab<QueryTab>(tab.id, { database })
            if (database) useApp.setState({ currentDatabase: database })
          }}
        >
          <option value="">No database</option>
          {databases?.map((db) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </Select>
      </div>
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="45" minSize={80}>
          <SqlEditor
            ref={editor}
            value={tab.sql}
            onChange={(sql) => updateTab<QueryTab>(tab.id, { sql })}
            completion={completionData}
            keys={keys}
            placeholder="SELECT * FROM …"
          />
        </Panel>
        <Separator className="resize-handle h-px" />
        <Panel minSize={80}>
          <ResultsPanel
            results={tab.results}
            active={tab.activeResult}
            onActiveChange={(activeResult) => updateTab<QueryTab>(tab.id, { activeResult })}
            running={tab.running}
            rowLimit={rowLimit}
          />
        </Panel>
      </Group>
      <SaveQueryDialog
        open={saving}
        onOpenChange={setSaving}
        initial={{ sql: tab.sql, name: tab.title.startsWith('Query ') ? '' : tab.title }}
        onSaved={(query) => updateTab<QueryTab>(tab.id, { savedPath: query.path, savedSql: query.sql, title: query.name })}
      />
    </div>
  )
}
