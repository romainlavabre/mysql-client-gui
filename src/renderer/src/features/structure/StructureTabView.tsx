// Table structure editor: create a table or alter an existing one, with live DDL preview.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { ColumnDefinition, ForeignKeyDefinition, IndexDefinition, TableDefinition } from '@shared/types'
import { buildAlterTable, buildCreateTable } from '@shared/sql/ddl'
import { api, errorMessage } from '../../lib/bridge'
import { runStatements } from '../../lib/actions'
import { SqlEditor } from '../../components/SqlEditor'
import { Button, ErrorBox, IconButton, Input, Select, Spinner } from '../../components/ui'
import { closeTab, openTab, useApp, type StructureTab } from '../../store'

const COMMON_TYPES = [
  'int',
  'int unsigned',
  'bigint',
  'bigint unsigned',
  'tinyint(1)',
  'smallint',
  'decimal(10,2)',
  'double',
  'float',
  'varchar(255)',
  'char(36)',
  'text',
  'mediumtext',
  'longtext',
  'json',
  'date',
  'datetime',
  'timestamp',
  'time',
  'year',
  'blob',
  'longblob',
  'varbinary(255)',
  "enum('a','b')",
  'bit(1)'
]

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']
const INDEX_KINDS: IndexDefinition['kind'][] = ['PRIMARY', 'UNIQUE', 'INDEX', 'FULLTEXT', 'SPATIAL']

type DefaultMode = 'none' | 'null' | 'value' | 'expression'

function defaultMode(column: ColumnDefinition): DefaultMode {
  if (column.default === undefined) return 'none'
  if (column.default === null) return 'null'
  return column.defaultIsExpression ? 'expression' : 'value'
}

const emptyTable = (database: string): TableDefinition => ({
  database,
  name: '',
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collation: undefined,
  comment: '',
  columns: [
    { name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true },
    { name: 'created_at', type: 'datetime', nullable: false, default: 'CURRENT_TIMESTAMP', defaultIsExpression: true, autoIncrement: false }
  ],
  indexes: [{ name: 'PRIMARY', kind: 'PRIMARY', columns: [{ name: 'id' }] }],
  foreignKeys: []
})

/** "a, b(10) DESC" ⇄ index columns. */
function parseIndexColumns(text: string): IndexDefinition['columns'] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^`?([^`(\s]+)`?\s*(?:\((\d+)\))?\s*(ASC|DESC)?$/i.exec(part)
      if (!match) return { name: part }
      return { name: match[1], length: match[2] ? Number(match[2]) : null, order: match[3]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC' }
    })
}

function formatIndexColumns(columns: IndexDefinition['columns']): string {
  return columns.map((c) => `${c.name}${c.length ? `(${c.length})` : ''}${c.order === 'DESC' ? ' DESC' : ''}`).join(', ')
}

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const cell = 'border-b border-border/60 px-1 py-1'
const cellInput = 'h-7 text-xs font-mono'

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      <div className="overflow-x-auto rounded-md border border-border">{children}</div>
    </section>
  )
}

export function StructureTabView({ tab }: { tab: StructureTab }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const queryClient = useQueryClient()
  const isNew = tab.table === null

  const { data: original, error, isLoading, refetch } = useQuery({
    queryKey: ['definition', sessionId, tab.database, tab.table],
    queryFn: () => api.structure.definitionOf({ sessionId, database: tab.database, table: tab.table! }),
    enabled: !isNew,
    staleTime: 0,
    gcTime: 0
  })
  const { data: charsets } = useQuery({
    queryKey: ['charsets', sessionId],
    queryFn: () => api.schema.charsets({ sessionId }),
    staleTime: Infinity
  })
  const { data: engines } = useQuery({ queryKey: ['engines', sessionId], queryFn: () => api.schema.engines({ sessionId }), staleTime: Infinity })
  const { data: objects } = useQuery({
    queryKey: ['objects', sessionId, tab.database],
    queryFn: () => api.schema.objects({ sessionId, database: tab.database })
  })

  const [def, setDef] = useState<TableDefinition | null>(isNew ? emptyTable(tab.database) : null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (original) setDef(structuredClone(original))
  }, [original])

  const collations = useMemo(() => charsets?.flatMap((c) => c.collations).sort() ?? [], [charsets])

  const statements = useMemo(() => {
    if (!def) return { sql: [] as string[], error: null as string | null }
    try {
      return { sql: isNew ? [buildCreateTable(def)] : original ? buildAlterTable(original, def) : [], error: null }
    } catch (e) {
      return { sql: [], error: errorMessage(e) }
    }
  }, [def, original, isNew])

  if (isLoading || !def) return <Spinner className="m-6" />
  if (error)
    return (
      <div className="p-4">
        <ErrorBox>{errorMessage(error)}</ErrorBox>
      </div>
    )

  const set = (patch: Partial<TableDefinition>): void => setDef({ ...def, ...patch })
  const setColumn = (index: number, patch: Partial<ColumnDefinition>): void =>
    set({ columns: def.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const moveColumn = (index: number, delta: number): void => {
    const columns = [...def.columns]
    const [moved] = columns.splice(index, 1)
    columns.splice(index + delta, 0, moved)
    set({ columns })
  }
  const setIndex = (index: number, patch: Partial<IndexDefinition>): void =>
    set({ indexes: def.indexes.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const setFk = (index: number, patch: Partial<ForeignKeyDefinition>): void =>
    set({ foreignKeys: def.foreignKeys.map((c, i) => (i === index ? { ...c, ...patch } : c)) })

  const apply = async (): Promise<void> => {
    setApplying(true)
    const done = await runStatements(statements.sql, tab.database, queryClient, {
      force: true,
      title: isNew ? `Create table ${def.name}` : `Alter table ${tab.table}`,
      success: isNew ? `Table ${def.name} created` : `Table ${def.name} altered`
    })
    setApplying(false)
    if (!done) return
    if (isNew || def.name !== tab.table) {
      closeTab(tab.id)
      openTab({ kind: 'structure', database: tab.database, table: def.name })
    } else {
      await refetch()
    }
  }

  const tableNames = objects?.tables.filter((t) => t.kind === 'table').map((t) => t.name) ?? []

  return (
    <Group orientation="vertical" className="h-full">
      <Panel minSize={150}>
        <div className="h-full overflow-auto p-4">
          <div className="mb-5 grid grid-cols-[2fr_1fr_1.5fr_2fr] gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Table name
              <Input value={def.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Engine
              <Select value={def.engine ?? ''} onChange={(e) => set({ engine: e.target.value || undefined })}>
                <option value="">Default</option>
                {(engines ?? ['InnoDB']).map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Collation
              <Select
                value={def.collation ?? ''}
                onChange={(e) => set({ collation: e.target.value || undefined, charset: e.target.value ? e.target.value.split('_')[0] : def.charset })}
              >
                <option value="">Default</option>
                {collations.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Comment
              <Input value={def.comment ?? ''} onChange={(e) => set({ comment: e.target.value })} />
            </label>
          </div>

          <datalist id="column-types">
            {COMMON_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <Section
            title="Columns"
            action={
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => set({ columns: [...def.columns, { name: `column_${def.columns.length + 1}`, type: 'varchar(255)', nullable: true, autoIncrement: false }] })}
              >
                Column
              </Button>
            }
          >
            <table className="w-full min-w-[1000px] border-collapse text-xs">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Name</th>
                  <th className="px-2 py-1.5 font-semibold">Type</th>
                  <th className="px-2 py-1.5 font-semibold">Null</th>
                  <th className="px-2 py-1.5 font-semibold">Default</th>
                  <th className="px-2 py-1.5 font-semibold" title="Auto increment">AI</th>
                  <th className="px-2 py-1.5 font-semibold" title="ON UPDATE CURRENT_TIMESTAMP">On upd.</th>
                  <th className="px-2 py-1.5 font-semibold">Collation</th>
                  <th className="px-2 py-1.5 font-semibold">Comment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.columns.map((column, index) => {
                  const mode = defaultMode(column)
                  return (
                    <tr key={index} className="hover:bg-hover/40">
                      <td className={cell}>
                        <Input className={cellInput} value={column.name} onChange={(e) => setColumn(index, { name: e.target.value })} />
                      </td>
                      <td className={cell}>
                        <Input className={cellInput} list="column-types" value={column.type} onChange={(e) => setColumn(index, { type: e.target.value })} />
                      </td>
                      <td className={`${cell} text-center`}>
                        <input type="checkbox" className="accent-[var(--accent)]" checked={column.nullable} onChange={(e) => setColumn(index, { nullable: e.target.checked })} />
                      </td>
                      <td className={cell}>
                        <div className="flex gap-1">
                          <Select
                            className="h-7 w-28 text-xs"
                            value={mode}
                            onChange={(e) => {
                              const next = e.target.value as DefaultMode
                              setColumn(index, {
                                default: next === 'none' ? undefined : next === 'null' ? null : (column.default ?? ''),
                                defaultIsExpression: next === 'expression'
                              })
                            }}
                          >
                            <option value="none">None</option>
                            <option value="null">NULL</option>
                            <option value="value">Value</option>
                            <option value="expression">Expression</option>
                          </Select>
                          {(mode === 'value' || mode === 'expression') && (
                            <Input
                              className={cellInput}
                              value={column.default ?? ''}
                              placeholder={mode === 'expression' ? 'CURRENT_TIMESTAMP' : ''}
                              onChange={(e) => setColumn(index, { default: e.target.value })}
                            />
                          )}
                        </div>
                      </td>
                      <td className={`${cell} text-center`}>
                        <input type="checkbox" className="accent-[var(--accent)]" checked={column.autoIncrement} onChange={(e) => setColumn(index, { autoIncrement: e.target.checked })} />
                      </td>
                      <td className={`${cell} text-center`}>
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={!!column.onUpdateCurrentTimestamp}
                          onChange={(e) => setColumn(index, { onUpdateCurrentTimestamp: e.target.checked })}
                        />
                      </td>
                      <td className={cell}>
                        <Select
                          className="h-7 w-44 text-xs"
                          value={column.collation ?? ''}
                          onChange={(e) => setColumn(index, { collation: e.target.value || undefined, charset: e.target.value ? e.target.value.split('_')[0] : undefined })}
                        >
                          <option value="">Table default</option>
                          {collations.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className={cell}>
                        <Input className="h-7 text-xs" value={column.comment ?? ''} onChange={(e) => setColumn(index, { comment: e.target.value || undefined })} />
                      </td>
                      <td className={`${cell} whitespace-nowrap`}>
                        <IconButton label="Move up" disabled={index === 0} onClick={() => moveColumn(index, -1)} className="size-6">
                          <ArrowUp className="size-3.5" />
                        </IconButton>
                        <IconButton label="Move down" disabled={index === def.columns.length - 1} onClick={() => moveColumn(index, 1)} className="size-6">
                          <ArrowDown className="size-3.5" />
                        </IconButton>
                        <IconButton label="Delete column" onClick={() => set({ columns: def.columns.filter((_, i) => i !== index) })} className="size-6 hover:text-danger">
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Section>

          <Section
            title="Indexes"
            action={
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() => set({ indexes: [...def.indexes, { name: `idx_${def.name || 'table'}_${def.indexes.length + 1}`, kind: 'INDEX', columns: [] }] })}
              >
                Index
              </Button>
            }
          >
            <table className="w-full border-collapse text-xs">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Name</th>
                  <th className="px-2 py-1.5 font-semibold">Kind</th>
                  <th className="px-2 py-1.5 font-semibold">Columns (e.g. a, b(10) DESC)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.indexes.map((index, i) => (
                  <tr key={i}>
                    <td className={cell}>
                      <Input className={cellInput} value={index.name} disabled={index.kind === 'PRIMARY'} onChange={(e) => setIndex(i, { name: e.target.value })} />
                    </td>
                    <td className={cell}>
                      <Select
                        className="h-7 w-32 text-xs"
                        value={index.kind}
                        onChange={(e) => {
                          const kind = e.target.value as IndexDefinition['kind']
                          setIndex(i, { kind, name: kind === 'PRIMARY' ? 'PRIMARY' : index.name === 'PRIMARY' ? `idx_${i + 1}` : index.name })
                        }}
                      >
                        {INDEX_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={cell}>
                      <IndexColumnsInput value={index.columns} onChange={(columns) => setIndex(i, { columns })} />
                    </td>
                    <td className={cell}>
                      <IconButton label="Delete index" onClick={() => set({ indexes: def.indexes.filter((_, j) => j !== i) })} className="size-6 hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title="Foreign keys"
            action={
              <Button
                size="sm"
                icon={<Plus className="size-3.5" />}
                onClick={() =>
                  set({
                    foreignKeys: [
                      ...def.foreignKeys,
                      { name: `fk_${def.name || 'table'}_${def.foreignKeys.length + 1}`, columns: [], refTable: tableNames[0] ?? '', refColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }
                    ]
                  })
                }
              >
                Foreign key
              </Button>
            }
          >
            <table className="w-full border-collapse text-xs">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Name</th>
                  <th className="px-2 py-1.5 font-semibold">Columns</th>
                  <th className="px-2 py-1.5 font-semibold">Referenced table</th>
                  <th className="px-2 py-1.5 font-semibold">Referenced columns</th>
                  <th className="px-2 py-1.5 font-semibold">On update</th>
                  <th className="px-2 py-1.5 font-semibold">On delete</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.foreignKeys.map((fk, i) => (
                  <tr key={i}>
                    <td className={cell}>
                      <Input className={cellInput} value={fk.name} onChange={(e) => setFk(i, { name: e.target.value })} />
                    </td>
                    <td className={cell}>
                      <ListInput value={fk.columns} onChange={(columns) => setFk(i, { columns })} placeholder="user_id" />
                    </td>
                    <td className={cell}>
                      <Input className={cellInput} list="fk-tables" value={fk.refTable} onChange={(e) => setFk(i, { refTable: e.target.value })} />
                    </td>
                    <td className={cell}>
                      <ListInput value={fk.refColumns} onChange={(refColumns) => setFk(i, { refColumns })} placeholder="id" />
                    </td>
                    {(['onUpdate', 'onDelete'] as const).map((key) => (
                      <td key={key} className={cell}>
                        <Select className="h-7 w-32 text-xs" value={fk[key]} onChange={(e) => setFk(i, { [key]: e.target.value })}>
                          {FK_ACTIONS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </Select>
                      </td>
                    ))}
                    <td className={cell}>
                      <IconButton label="Delete foreign key" onClick={() => set({ foreignKeys: def.foreignKeys.filter((_, j) => j !== i) })} className="size-6 hover:text-danger">
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="fk-tables">
              {tableNames.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Section>
        </div>
      </Panel>
      <Separator className="resize-handle h-px" />
      <Panel defaultSize="30" minSize={100}>
        <div className="flex h-full flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
            <span className="text-xs font-semibold text-muted">
              {statements.sql.length === 0 ? 'No change' : `${statements.sql.length} statement(s)`}
            </span>
            <div className="flex-1" />
            {!isNew && (
              <Button size="sm" icon={<Undo2 className="size-3.5" />} disabled={statements.sql.length === 0} onClick={() => original && setDef(structuredClone(original))}>
                Revert
              </Button>
            )}
            <Button size="sm" variant="primary" loading={applying} disabled={statements.sql.length === 0 || !!statements.error} onClick={() => void apply()}>
              {isNew ? 'Create table' : 'Apply changes'}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {statements.error ? (
              <div className="p-3">
                <ErrorBox>{statements.error}</ErrorBox>
              </div>
            ) : (
              <SqlEditor value={statements.sql.map((s) => `${s};`).join('\n\n')} readOnly />
            )}
          </div>
        </div>
      </Panel>
    </Group>
  )
}

/** Text input for a list, parsed on blur so typing commas is not disrupted. */
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (value: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => setText(value.join(', ')), [value])
  return (
    <Input className={cellInput} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitList(text))} />
  )
}

function IndexColumnsInput({ value, onChange }: { value: IndexDefinition['columns']; onChange: (value: IndexDefinition['columns']) => void }) {
  const [text, setText] = useState(formatIndexColumns(value))
  useEffect(() => setText(formatIndexColumns(value)), [value])
  return <Input className={cellInput} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(parseIndexColumns(text))} />
}
