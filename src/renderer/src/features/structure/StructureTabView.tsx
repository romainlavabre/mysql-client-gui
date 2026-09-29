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
import { SearchSelect, type SearchOption } from '../../components/SearchSelect'
import { ColumnsPicker } from '../../components/ColumnsPicker'
import {
  COLUMN_TYPES,
  formatColumnType,
  fractionalDigits,
  parseColumnType,
  supportsOnUpdate,
  supportsUnsigned,
  typeInfo,
  type TypeAttribute
} from '@shared/sql/columnType'
import { Button, ErrorBox, IconButton, Input, Select, Spinner } from '../../components/ui'
import { closeTab, openTab, useApp, type StructureTab } from '../../store'

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT']
const INDEX_KINDS: IndexDefinition['kind'][] = ['PRIMARY', 'UNIQUE', 'INDEX', 'FULLTEXT', 'SPATIAL']

type DefaultMode = 'none' | 'null' | 'value' | 'now' | 'expression'

function defaultMode(column: ColumnDefinition): DefaultMode {
  if (column.default === undefined) return 'none'
  if (column.default === null) return 'null'
  if (column.defaultIsExpression && /^current_timestamp(\(\d*\))?$/i.test(column.default.trim())) return 'now'
  return column.defaultIsExpression ? 'expression' : 'value'
}

/** CURRENT_TIMESTAMP with the precision of the column: datetime(3) needs CURRENT_TIMESTAMP(3). */
function currentTimestamp(type: string): string {
  const digits = fractionalDigits(type)
  return digits ? `CURRENT_TIMESTAMP(${digits})` : 'CURRENT_TIMESTAMP'
}

type AttributeChoice = TypeAttribute | 'on update'

/** Column after picking another base type: sensible length, attributes that still apply. */
function withBaseType(column: ColumnDefinition, base: string): Partial<ColumnDefinition> {
  const parsed = parseColumnType(column.type)
  if (base === 'boolean') return { type: 'tinyint(1)', onUpdateCurrentTimestamp: false }
  const info = typeInfo(base)
  const previous = typeInfo(parsed.base)
  const sameFamily = previous && info && previous.family === info.family
  const length = sameFamily ? parsed.length : (info?.defaultLength ?? '')
  const attribute = supportsUnsigned(base) ? parsed.attribute : ''
  const patch: Partial<ColumnDefinition> = { type: formatColumnType({ base, length, attribute }) }
  if (!supportsOnUpdate(base)) patch.onUpdateCurrentTimestamp = false
  if (defaultMode(column) === 'now' && info?.family !== 'datetime') patch.default = undefined
  return patch
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
  const { data: databases } = useQuery({ queryKey: ['databases', sessionId], queryFn: () => api.schema.databases({ sessionId }) })
  const isMariaDb = session.info.isMariaDb
  // Types of the other server flavour stay pickable, dimmed.
  const typeOptions = useMemo<SearchOption[]>(
    () =>
      COLUMN_TYPES.map((t) => ({
        value: t.name,
        label: t.name.toUpperCase(),
        group: t.group,
        description: t.availability ? `${t.description} — ${t.availability === 'mariadb' ? 'MariaDB' : 'MySQL'} only` : t.description,
        muted: (t.availability === 'mariadb' && !isMariaDb) || (t.availability === 'mysql' && isMariaDb)
      })),
    [isMariaDb]
  )

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
  // Current names, so new and renamed columns can be indexed right away.
  const columnNames = def.columns.map((c) => c.name).filter(Boolean)

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
            <table className="w-full min-w-[1350px] border-collapse text-xs">
              <thead className="bg-panel text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Name</th>
                  <th className="px-2 py-1.5 font-semibold">Type</th>
                  <th className="px-2 py-1.5 font-semibold">Length / Values</th>
                  <th className="px-2 py-1.5 font-semibold">Default</th>
                  <th className="px-2 py-1.5 font-semibold">Attributes</th>
                  <th className="px-2 py-1.5 font-semibold">Null</th>
                  <th className="px-2 py-1.5 font-semibold" title="Auto increment">A_I</th>
                  <th className="px-2 py-1.5 font-semibold">Collation</th>
                  <th className="px-2 py-1.5 font-semibold">Comment</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.columns.map((column, index) => {
                  const mode = defaultMode(column)
                  const parsed = parseColumnType(column.type)
                  const info = typeInfo(parsed.base)
                  const attribute: AttributeChoice = column.onUpdateCurrentTimestamp ? 'on update' : parsed.attribute
                  return (
                    <tr key={index} className="hover:bg-hover/40">
                      <td className={cell}>
                        <Input className={cellInput} value={column.name} onChange={(e) => setColumn(index, { name: e.target.value })} />
                      </td>
                      <td className={`${cell} w-40`}>
                        <SearchSelect
                          value={parsed.base}
                          options={typeOptions}
                          allowCustom
                          onChange={(base) => setColumn(index, withBaseType(column, base.toLowerCase()))}
                        />
                      </td>
                      <td className={`${cell} w-36`}>
                        <Input
                          className={cellInput}
                          value={parsed.length}
                          placeholder={info?.lengthHint ?? ''}
                          title={info?.lengthHint}
                          onChange={(e) => setColumn(index, { type: formatColumnType({ ...parsed, length: e.target.value }) })}
                        />
                      </td>
                      <td className={cell}>
                        <div className="flex gap-1">
                          <Select
                            className="h-7 w-44 shrink-0 text-xs"
                            value={mode}
                            onChange={(e) => {
                              const next = e.target.value as DefaultMode
                              setColumn(index, {
                                default:
                                  next === 'none'
                                    ? undefined
                                    : next === 'null'
                                      ? null
                                      : next === 'now'
                                        ? currentTimestamp(column.type)
                                        : mode === 'now'
                                          ? ''
                                          : (column.default ?? ''),
                                defaultIsExpression: next === 'expression' || next === 'now'
                              })
                            }}
                          >
                            <option value="none">None</option>
                            <option value="null">NULL</option>
                            <option value="value">As defined</option>
                            {(info?.family === 'datetime' || mode === 'now') && <option value="now">CURRENT_TIMESTAMP</option>}
                            <option value="expression">Expression</option>
                          </Select>
                          {(mode === 'value' || mode === 'expression') && (
                            <Input
                              className={cellInput}
                              value={column.default ?? ''}
                              placeholder={mode === 'expression' ? 'e.g. (UUID())' : ''}
                              onChange={(e) => setColumn(index, { default: e.target.value })}
                            />
                          )}
                        </div>
                      </td>
                      <td className={cell}>
                        <Select
                          className="h-7 w-60 text-xs"
                          value={attribute}
                          onChange={(e) => {
                            const next = e.target.value as AttributeChoice
                            setColumn(index, {
                              type: formatColumnType({ ...parsed, attribute: next === 'on update' ? '' : next }),
                              onUpdateCurrentTimestamp: next === 'on update'
                            })
                          }}
                        >
                          <option value="">—</option>
                          {(supportsUnsigned(parsed.base) || parsed.attribute) && (
                            <>
                              <option value="unsigned">UNSIGNED</option>
                              <option value="unsigned zerofill">UNSIGNED ZEROFILL</option>
                            </>
                          )}
                          {(supportsOnUpdate(parsed.base) || column.onUpdateCurrentTimestamp) && (
                            <option value="on update">on update CURRENT_TIMESTAMP</option>
                          )}
                        </Select>
                      </td>
                      <td className={`${cell} text-center`}>
                        <input type="checkbox" className="accent-[var(--accent)]" checked={column.nullable} onChange={(e) => setColumn(index, { nullable: e.target.checked })} />
                      </td>
                      <td className={`${cell} text-center`}>
                        <input type="checkbox" className="accent-[var(--accent)]" checked={column.autoIncrement} onChange={(e) => setColumn(index, { autoIncrement: e.target.checked })} />
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
                  <th className="px-2 py-1.5 font-semibold">Columns (click one for its length and order)</th>
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
                      <ColumnsPicker value={index.columns} columns={columnNames} onChange={(columns) => setIndex(i, { columns })} withOptions />
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
                  <th className="px-2 py-1.5 font-semibold">Referenced database</th>
                  <th className="px-2 py-1.5 font-semibold">Referenced table</th>
                  <th className="px-2 py-1.5 font-semibold">Referenced columns</th>
                  <th className="px-2 py-1.5 font-semibold">On update</th>
                  <th className="px-2 py-1.5 font-semibold">On delete</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {def.foreignKeys.map((fk, i) => (
                  <ForeignKeyRow
                    key={i}
                    fk={fk}
                    database={tab.database}
                    columns={columnNames}
                    tables={tableNames}
                    databases={databases?.map((d) => d.name) ?? []}
                    onChange={(patch) => setFk(i, patch)}
                    onDelete={() => set({ foreignKeys: def.foreignKeys.filter((_, j) => j !== i) })}
                  />
                ))}
              </tbody>
            </table>
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

function ForeignKeyRow({
  fk,
  database,
  columns,
  tables,
  databases,
  onChange,
  onDelete
}: {
  fk: ForeignKeyDefinition
  database: string
  columns: string[]
  tables: string[]
  databases: string[]
  onChange: (patch: Partial<ForeignKeyDefinition>) => void
  onDelete: () => void
}) {
  const sessionId = useApp((s) => s.session!.info.sessionId)
  const refDatabase = fk.refDatabase || database
  // Tables and columns of the referenced database (usually the same one).
  const { data: refSchema } = useQuery({
    queryKey: ['completion', sessionId, refDatabase],
    queryFn: () => api.schema.completion({ sessionId, database: refDatabase }),
    staleTime: 5 * 60_000
  })
  const refTables = refDatabase === database ? tables : Object.keys(refSchema ?? {})
  const refColumns = refSchema?.[fk.refTable] ?? []
  return (
    <tr>
      <td className={cell}>
        <Input className={cellInput} value={fk.name} onChange={(e) => onChange({ name: e.target.value })} />
      </td>
      <td className={cell}>
        <ColumnsPicker
          value={fk.columns.map((name) => ({ name }))}
          columns={columns}
          onChange={(picked) => onChange({ columns: picked.map((c) => c.name) })}
        />
      </td>
      <td className={`${cell} w-40`}>
        <SearchSelect
          value={refDatabase}
          options={databases.map((d) => ({ value: d }))}
          onChange={(next) => onChange({ refDatabase: next === database ? undefined : next, refTable: '', refColumns: [] })}
        />
      </td>
      <td className={`${cell} w-44`}>
        <SearchSelect
          value={fk.refTable}
          options={refTables.map((t) => ({ value: t }))}
          placeholder="Table…"
          onChange={(refTable) => {
            // Point at the primary key convention by default.
            const candidates = refSchema?.[refTable] ?? []
            onChange({ refTable, refColumns: candidates.includes('id') ? ['id'] : [] })
          }}
        />
      </td>
      <td className={cell}>
        <ColumnsPicker
          value={fk.refColumns.map((name) => ({ name }))}
          columns={refColumns}
          onChange={(picked) => onChange({ refColumns: picked.map((c) => c.name) })}
        />
      </td>
      {(['onUpdate', 'onDelete'] as const).map((key) => (
        <td key={key} className={cell}>
          <Select className="h-7 w-32 text-xs" value={fk[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
            {FK_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </td>
      ))}
      <td className={cell}>
        <IconButton label="Delete foreign key" onClick={onDelete} className="size-6 hover:text-danger">
          <Trash2 className="size-3.5" />
        </IconButton>
      </td>
    </tr>
  )
}
