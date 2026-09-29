// Schema tree: databases, then their tables, views, routines, triggers and events.
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FileCode,
  FunctionSquare,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Timer,
  Trash2,
  Upload,
  Wrench,
  Zap,
  Eraser,
  Info
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { SchemaObjects, TableSummary } from '@shared/types'
import { qualified, quoteIdent } from '@shared/sql/quote'
import { api } from '../../lib/bridge'
import { formatNumber } from '../../lib/format'
import { invalidateSchema, runStatements } from '../../lib/actions'
import { prompt } from '../../components/feedback'
import { IconButton, Input, Spinner } from '../../components/ui'
import { activateGroup, openQueryTab, openTab, useApp } from '../../store'
import { openIo } from '../io/ioStore'
import { CreateDatabaseDialog } from './CreateDatabaseDialog'

const menuItem = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-hover'
const menuContent = 'z-50 min-w-48 rounded-md border border-border bg-panel-2 p-1 shadow-xl'

function MenuItem({ icon, children, onSelect, danger }: { icon: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <ContextMenu.Item className={clsx(menuItem, danger && 'text-danger')} onSelect={onSelect}>
      {icon}
      {children}
    </ContextMenu.Item>
  )
}

const Separator = () => <ContextMenu.Separator className="my-1 h-px bg-border" />

function Row({
  depth,
  icon,
  label,
  meta,
  expanded,
  active,
  onClick,
  onDoubleClick
}: {
  depth: number
  icon: ReactNode
  label: ReactNode
  meta?: ReactNode
  expanded?: boolean
  active?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  return (
    <div
      className={clsx('flex h-[26px] cursor-pointer items-center gap-1.5 rounded pr-2 text-[13px] hover:bg-hover', active && 'bg-hover')}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {expanded === undefined ? (
        <span className="w-3.5 shrink-0" />
      ) : (
        <ChevronRight className={clsx('size-3.5 shrink-0 text-muted transition-transform', expanded && 'rotate-90')} />
      )}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && <span className="shrink-0 text-[11px] text-muted">{meta}</span>}
    </div>
  )
}

export function Explorer() {
  const session = useApp((s) => s.session)!
  const currentDatabase = useApp((s) => s.currentDatabase)
  const queryClient = useQueryClient()
  const sessionId = session.info.sessionId
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentDatabase ? [currentDatabase] : []))
  const [creatingDatabase, setCreatingDatabase] = useState(false)

  const { data: databases, isLoading, error } = useQuery({
    queryKey: ['databases', sessionId],
    queryFn: () => api.schema.databases({ sessionId })
  })

  const toggle = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const visibleDatabases = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return databases ?? []
    // Keep databases whose name matches, or that are expanded (their objects are filtered instead).
    return (databases ?? []).filter((db) => db.name.toLowerCase().includes(needle) || expanded.has(db.name))
  }, [databases, filter, expanded])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input className="pl-7" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <IconButton label="Create database" onClick={() => setCreatingDatabase(true)} className="size-8">
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Refresh" onClick={() => void invalidateSchema(queryClient)} className="size-8">
          <RefreshCw className="size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2">
        {isLoading && <Spinner className="mx-auto mt-6" />}
        {error && <div className="p-3 text-xs text-danger">{String(error)}</div>}
        {visibleDatabases.map((db) => (
          <DatabaseNode
            key={db.name}
            name={db.name}
            expanded={expanded.has(db.name)}
            active={currentDatabase === db.name}
            onToggle={() => {
              toggle(db.name)
              useApp.setState({ currentDatabase: db.name })
              // Show the tabs of this database when it has some.
              activateGroup(db.name)
            }}
            expandedGroups={expanded}
            toggleGroup={toggle}
            filter={filter.trim().toLowerCase()}
          />
        ))}
      </div>
      <CreateDatabaseDialog open={creatingDatabase} onOpenChange={setCreatingDatabase} />
    </div>
  )
}

function DatabaseNode({
  name,
  expanded,
  active,
  onToggle,
  expandedGroups,
  toggleGroup,
  filter
}: {
  name: string
  expanded: boolean
  active: boolean
  onToggle: () => void
  expandedGroups: Set<string>
  toggleGroup: (key: string) => void
  filter: string
}) {
  const session = useApp((s) => s.session)!
  const sessionId = session.info.sessionId
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['objects', sessionId, name],
    queryFn: () => api.schema.objects({ sessionId, database: name }),
    enabled: expanded
  })

  const drop = (): void => {
    void runStatements([`DROP DATABASE ${quoteIdent(name)}`], null, queryClient, {
      force: true,
      title: `Drop database ${name}`,
      success: `Database ${name} dropped`
    })
  }

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div>
            <Row
              depth={0}
              expanded={expanded}
              active={active}
              icon={<Database className="size-3.5 shrink-0 text-emerald-400" />}
              label={name}
              onClick={onToggle}
              onDoubleClick={() => openTab({ kind: 'database', database: name })}
            />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContent}>
            <MenuItem icon={<Info className="size-3.5" />} onSelect={() => openTab({ kind: 'database', database: name })}>
              Open overview
            </MenuItem>
            <MenuItem icon={<FileCode className="size-3.5" />} onSelect={() => openQueryTab({ database: name })}>
              New query here
            </MenuItem>
            <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => openTab({ kind: 'structure', database: name, table: null })}>
              Create table
            </MenuItem>
            <Separator />
            <MenuItem icon={<Download className="size-3.5" />} onSelect={() => openIo({ kind: 'dump', database: name })}>
              Export (SQL dump)
            </MenuItem>
            <MenuItem icon={<Upload className="size-3.5" />} onSelect={() => openIo({ kind: 'importSql', database: name })}>
              Import SQL file
            </MenuItem>
            <Separator />
            <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={() => void queryClient.invalidateQueries({ queryKey: ['objects', sessionId, name] })}>
              Refresh
            </MenuItem>
            <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void navigator.clipboard.writeText(name)}>
              Copy name
            </MenuItem>
            <Separator />
            <MenuItem icon={<Trash2 className="size-3.5" />} onSelect={drop} danger>
              Drop database
            </MenuItem>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {expanded && (
        <div>
          {isLoading && <div className="py-1 pl-10"><Spinner className="size-3" /></div>}
          {data && <ObjectGroups database={name} objects={data} expandedGroups={expandedGroups} toggleGroup={toggleGroup} filter={filter} />}
        </div>
      )}
    </div>
  )
}

function ObjectGroups({
  database,
  objects,
  expandedGroups,
  toggleGroup,
  filter
}: {
  database: string
  objects: SchemaObjects
  expandedGroups: Set<string>
  toggleGroup: (key: string) => void
  filter: string
}) {
  const match = (value: string): boolean => !filter || value.toLowerCase().includes(filter)
  const tables = objects.tables.filter((t) => t.kind === 'table' && match(t.name))
  const views = objects.tables.filter((t) => t.kind === 'view' && match(t.name))
  const procedures = objects.routines.filter((r) => r.kind === 'procedure' && match(r.name))
  const functions = objects.routines.filter((r) => r.kind === 'function' && match(r.name))
  const triggers = objects.triggers.filter((t) => match(t.name))
  const events = objects.events.filter((e) => match(e.name))

  const group = (key: string, label: string, count: number, children: ReactNode, defaultOpen = false) => {
    const groupKey = `${database}/${key}`
    // Tables are open by default; the toggle stores the inverse state.
    const isOpen = defaultOpen ? !expandedGroups.has(groupKey) : expandedGroups.has(groupKey) || (!!filter && count > 0)
    if (count === 0 && key !== 'tables') return null
    return (
      <div key={key}>
        <Row depth={1} expanded={isOpen} icon={null} label={<span className="text-muted">{label}</span>} meta={count} onClick={() => toggleGroup(groupKey)} />
        {isOpen && children}
      </div>
    )
  }

  return (
    <>
      {group(
        'tables',
        'Tables',
        tables.length,
        tables.map((t) => <TableNode key={t.name} database={database} table={t} />),
        true
      )}
      {group('views', 'Views', views.length, views.map((t) => <TableNode key={t.name} database={database} table={t} />))}
      {group(
        'procedures',
        'Procedures',
        procedures.length,
        procedures.map((r) => <RoutineNode key={r.name} database={database} name={r.name} kind="procedure" />)
      )}
      {group(
        'functions',
        'Functions',
        functions.length,
        functions.map((r) => <RoutineNode key={r.name} database={database} name={r.name} kind="function" />)
      )}
      {group(
        'triggers',
        'Triggers',
        triggers.length,
        triggers.map((t) => <RoutineNode key={t.name} database={database} name={t.name} kind="trigger" meta={t.table} />)
      )}
      {group('events', 'Events', events.length, events.map((e) => <RoutineNode key={e.name} database={database} name={e.name} kind="event" />))}
    </>
  )
}

function TableNode({ database, table }: { database: string; table: TableSummary }) {
  const queryClient = useQueryClient()
  const isView = table.kind === 'view'
  const target = qualified(database, table.name)
  const openData = (): void => openTab({ kind: 'table', database, table: table.name, isView, view: 'data' })

  const rename = async (): Promise<void> => {
    const name = await prompt({ title: `Rename ${table.name}`, label: 'New name', initial: table.name, confirmLabel: 'Rename' })
    if (!name || name === table.name) return
    void runStatements([`RENAME TABLE ${target} TO ${qualified(database, name)}`], database, queryClient, { force: true })
  }

  const copyTable = async (): Promise<void> => {
    const name = await prompt({ title: `Copy ${table.name}`, label: 'New table name', initial: `${table.name}_copy`, confirmLabel: 'Copy' })
    if (!name) return
    await runStatements(
      [`CREATE TABLE ${qualified(database, name)} LIKE ${target}`, `INSERT INTO ${qualified(database, name)} SELECT * FROM ${target}`],
      database,
      queryClient,
      { success: `Table copied to ${name}` }
    )
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <Row
            depth={2}
            icon={isView ? <Eye className="size-3.5 shrink-0 text-sky-400" /> : <Table2 className="size-3.5 shrink-0 text-sky-400" />}
            label={table.name}
            meta={table.rows !== null && table.rows > 0 ? `~${formatNumber(table.rows)}` : undefined}
            onClick={() => {
              useApp.setState({ currentDatabase: database })
              openData()
            }}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent}>
          <MenuItem icon={<Table2 className="size-3.5" />} onSelect={openData}>
            Open data
          </MenuItem>
          <MenuItem icon={<Wrench className="size-3.5" />} onSelect={() => openTab({ kind: 'table', database, table: table.name, isView, view: 'structure' })}>
            Structure
          </MenuItem>
          {!isView && (
            <MenuItem icon={<Wrench className="size-3.5" />} onSelect={() => openTab({ kind: 'structure', database, table: table.name })}>
              Alter table
            </MenuItem>
          )}
          <MenuItem
            icon={<FileCode className="size-3.5" />}
            onSelect={() => openQueryTab({ database, sql: `SELECT *\nFROM ${quoteIdent(table.name)}\nLIMIT 100;` })}
          >
            New query (SELECT)
          </MenuItem>
          <MenuItem
            icon={<Code2 className="size-3.5" />}
            onSelect={() => openTab({ kind: 'ddl', database, name: table.name, objectKind: isView ? 'view' : 'table' })}
          >
            Show CREATE statement
          </MenuItem>
          <Separator />
          <MenuItem icon={<Download className="size-3.5" />} onSelect={() => openIo({ kind: 'exportTable', database, table: table.name })}>
            Export rows (CSV, JSON, XLSX…)
          </MenuItem>
          <MenuItem icon={<Download className="size-3.5" />} onSelect={() => openIo({ kind: 'dump', database, tables: [table.name] })}>
            SQL dump
          </MenuItem>
          {!isView && (
            <MenuItem icon={<Upload className="size-3.5" />} onSelect={() => openIo({ kind: 'importCsv', database, table: table.name })}>
              Import CSV
            </MenuItem>
          )}
          <Separator />
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void navigator.clipboard.writeText(table.name)}>
            Copy name
          </MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void rename()}>
            Rename
          </MenuItem>
          {!isView && (
            <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyTable()}>
              Copy table
            </MenuItem>
          )}
          <Separator />
          {!isView && (
            <MenuItem
              icon={<Eraser className="size-3.5" />}
              danger
              onSelect={() =>
                void runStatements([`TRUNCATE TABLE ${target}`], database, queryClient, { force: true, title: `Truncate ${table.name}`, success: `${table.name} emptied` })
              }
            >
              Truncate
            </MenuItem>
          )}
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            danger
            onSelect={() =>
              void runStatements([`DROP ${isView ? 'VIEW' : 'TABLE'} ${target}`], database, queryClient, {
                force: true,
                title: `Drop ${table.name}`,
                success: `${table.name} dropped`
              })
            }
          >
            Drop
          </MenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

const ROUTINE_ICONS = {
  procedure: <Zap className="size-3.5 shrink-0 text-violet-400" />,
  function: <FunctionSquare className="size-3.5 shrink-0 text-violet-400" />,
  trigger: <Zap className="size-3.5 shrink-0 text-amber-400" />,
  event: <Timer className="size-3.5 shrink-0 text-amber-400" />
}

function RoutineNode({
  database,
  name,
  kind,
  meta
}: {
  database: string
  name: string
  kind: 'procedure' | 'function' | 'trigger' | 'event'
  meta?: string
}) {
  const queryClient = useQueryClient()
  const open = (): void => openTab({ kind: 'ddl', database, name, objectKind: kind })
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <Row depth={2} icon={ROUTINE_ICONS[kind]} label={name} meta={meta} onClick={open} />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent}>
          <MenuItem icon={<Code2 className="size-3.5" />} onSelect={open}>
            Show definition
          </MenuItem>
          {kind === 'procedure' && (
            <MenuItem icon={<FileCode className="size-3.5" />} onSelect={() => openQueryTab({ database, sql: `CALL ${quoteIdent(name)}();` })}>
              New query (CALL)
            </MenuItem>
          )}
          {kind === 'function' && (
            <MenuItem icon={<FileCode className="size-3.5" />} onSelect={() => openQueryTab({ database, sql: `SELECT ${quoteIdent(name)}();` })}>
              New query (SELECT)
            </MenuItem>
          )}
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void navigator.clipboard.writeText(name)}>
            Copy name
          </MenuItem>
          <Separator />
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            danger
            onSelect={() =>
              void runStatements([`DROP ${kind.toUpperCase()} ${qualified(database, name)}`], database, queryClient, {
                force: true,
                title: `Drop ${kind} ${name}`,
                success: `${name} dropped`
              })
            }
          >
            Drop
          </MenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
