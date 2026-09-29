// Table tab: data, structure, information and DDL.
import { useQuery } from '@tanstack/react-query'
import { KeyRound, Link, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TableDetails } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { formatBytes, formatNumber } from '../../lib/format'
import { Button, ErrorBox, SegmentedControl, Spinner } from '../../components/ui'
import { openTab, updateTab, useApp, type TableTab } from '../../store'
import { TableDataView } from './TableDataView'
import { DdlView } from './DdlTabView'

export function TableTabView({ tab }: { tab: TableTab }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const { data: details, error, isLoading } = useQuery({
    queryKey: ['table', sessionId, tab.database, tab.table],
    queryFn: () => api.schema.table({ sessionId, database: tab.database, table: tab.table })
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
        <div className="min-w-0 truncate text-[13px]">
          <span className="text-muted">{tab.database}.</span>
          <span className="font-semibold">{tab.table}</span>
        </div>
        <SegmentedControl<TableTab['view']>
          value={tab.view}
          onChange={(view) => updateTab<TableTab>(tab.id, { view })}
          options={[
            { value: 'data', label: 'Data' },
            { value: 'structure', label: 'Structure' },
            { value: 'info', label: 'Info' },
            { value: 'ddl', label: 'DDL' }
          ]}
        />
        <div className="flex-1" />
        {!tab.isView && (
          <Button size="sm" icon={<Wrench className="size-3.5" />} onClick={() => openTab({ kind: 'structure', database: tab.database, table: tab.table })}>
            Alter table
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {error && (
          <div className="p-4">
            <ErrorBox>{errorMessage(error)}</ErrorBox>
          </div>
        )}
        {details && tab.view === 'data' && <TableDataView tab={tab} details={details} />}
        {details && tab.view === 'structure' && <StructureView details={details} />}
        {details && tab.view === 'info' && <InfoView tab={tab} />}
        {tab.view === 'ddl' && <DdlView database={tab.database} name={tab.table} kind={tab.isView ? 'view' : 'table'} />}
      </div>
    </div>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className="sticky top-0 border-b border-border bg-panel px-3 py-1.5 text-left font-semibold text-muted">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="hover:bg-hover">
            {row.map((cell, j) => (
              <td key={j} className="selectable border-b border-border/60 px-3 py-1.5 font-mono">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="overflow-hidden rounded-md border border-border">{children}</div>
    </section>
  )
}

function StructureView({ details }: { details: TableDetails }) {
  const openTable = (database: string, table: string): void => openTab({ kind: 'table', database, table, isView: false, view: 'structure' })
  return (
    <div className="h-full overflow-auto p-4">
      <Section title="Columns">
        <Table
          headers={['#', 'Name', 'Type', 'Null', 'Default', 'Extra', 'Collation', 'Comment']}
          rows={details.columns.map((c) => [
            c.position,
            <span className="flex items-center gap-1.5">
              {details.primaryKey.includes(c.name) && <KeyRound className="size-3 text-accent" />}
              {details.foreignKeys.some((f) => f.columns.includes(c.name)) && <Link className="size-3 text-sky-400" />}
              {c.name}
            </span>,
            c.type,
            c.nullable ? 'YES' : 'NO',
            c.default === null ? <span className="text-muted italic">{c.nullable ? 'NULL' : ''}</span> : c.defaultIsExpression ? c.default : `'${c.default}'`,
            c.generationExpression ? `${c.extra} (${c.generationExpression})` : c.extra,
            c.collation ?? '',
            <span className="font-sans">{c.comment}</span>
          ])}
        />
      </Section>
      {details.indexes.length > 0 && (
        <Section title="Indexes">
          <Table
            headers={['Name', 'Type', 'Unique', 'Columns', 'Comment']}
            rows={details.indexes.map((i) => [
              i.name,
              i.type,
              i.unique ? 'YES' : 'NO',
              i.columns.map((c) => `${c.name}${c.subPart ? `(${c.subPart})` : ''}${c.order === 'DESC' ? ' DESC' : ''}`).join(', '),
              i.comment
            ])}
          />
        </Section>
      )}
      {details.foreignKeys.length > 0 && (
        <Section title="Foreign keys">
          <Table
            headers={['Name', 'Columns', 'References', 'On update', 'On delete']}
            rows={details.foreignKeys.map((f) => [
              f.name,
              f.columns.join(', '),
              <button className="text-sky-400 hover:underline" onClick={() => openTable(f.refDatabase, f.refTable)}>
                {f.refDatabase !== details.database ? `${f.refDatabase}.` : ''}
                {f.refTable} ({f.refColumns.join(', ')})
              </button>,
              f.onUpdate,
              f.onDelete
            ])}
          />
        </Section>
      )}
      {details.referencedBy.length > 0 && (
        <Section title="Referenced by">
          <Table
            headers={['Table', 'Columns', 'Constraint', 'On delete']}
            rows={details.referencedBy.map((f) => [
              <button className="text-sky-400 hover:underline" onClick={() => openTable(f.refDatabase, f.refTable)}>
                {f.refDatabase !== details.database ? `${f.refDatabase}.` : ''}
                {f.refTable}
              </button>,
              `${f.columns.join(', ')} → ${f.refColumns.join(', ')}`,
              f.name,
              f.onDelete
            ])}
          />
        </Section>
      )}
    </div>
  )
}

function InfoView({ tab }: { tab: TableTab }) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const { data } = useQuery({
    queryKey: ['objects', sessionId, tab.database],
    queryFn: () => api.schema.objects({ sessionId, database: tab.database })
  })
  const summary = data?.tables.find((t) => t.name === tab.table)
  if (!summary) return <Spinner className="m-6" />
  const items: [string, ReactNode][] = [
    ['Type', summary.kind === 'view' ? 'View' : 'Table'],
    ['Engine', summary.engine],
    ['Rows (estimate)', formatNumber(summary.rows)],
    ['Data size', formatBytes(summary.dataLength)],
    ['Index size', formatBytes(summary.indexLength)],
    ['Total size', formatBytes((summary.dataLength ?? 0) + (summary.indexLength ?? 0))],
    ['Collation', summary.collation],
    ['Auto increment', formatNumber(summary.autoIncrement)],
    ['Created', summary.createTime],
    ['Updated', summary.updateTime],
    ['Comment', summary.comment]
  ]
  return (
    <div className="h-full overflow-auto p-4">
      <dl className="grid max-w-xl grid-cols-[160px_1fr] gap-x-4 gap-y-2 text-xs">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="selectable font-mono">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
