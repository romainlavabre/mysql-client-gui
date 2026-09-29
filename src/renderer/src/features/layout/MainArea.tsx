// Main area: connection editor when disconnected, tabs when connected.
import clsx from 'clsx'
import { Activity, Code2, Database, FileCode, Plus, Table2, Wrench, X, Eye } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { EmptyState, Button } from '../../components/ui'
import {
  NO_DATABASE_GROUP,
  SERVER_GROUP,
  activateGroup,
  closeTab,
  groupLabel,
  groupTabs,
  isDirty,
  openQueryTab,
  tabGroup,
  useApp,
  type QueryTab,
  type Tab,
  type TabGroupInfo
} from '../../store'
import { ENV_COLORS } from '../connections/env'
import { ConnectionForm } from '../connections/ConnectionForm'
import { useConnectionEditor } from '../connections/ConnectionList'
import { QueryTabView } from '../editor/QueryTabView'
import { TableTabView } from '../table/TableTabView'
import { DatabaseTabView } from '../database/DatabaseTabView'
import { StructureTabView } from '../structure/StructureTabView'
import { AdminTabView } from '../admin/AdminTabView'
import { DdlTabView } from '../table/DdlTabView'
import { confirm } from '../../components/feedback'

function tabTitle(tab: Tab): string {
  switch (tab.kind) {
    case 'query':
      return tab.title
    case 'table':
      return tab.table
    case 'database':
      return tab.database
    case 'structure':
      return tab.table ? `${tab.table} (structure)` : 'New table'
    case 'admin':
      return 'Server'
    case 'ddl':
      return tab.name
  }
}

function tabIcon(tab: Tab): ReactNode {
  const cls = 'size-3.5 shrink-0'
  switch (tab.kind) {
    case 'query':
      return <FileCode className={clsx(cls, 'text-accent')} />
    case 'table':
      return tab.isView ? <Eye className={clsx(cls, 'text-sky-400')} /> : <Table2 className={clsx(cls, 'text-sky-400')} />
    case 'database':
      return <Database className={clsx(cls, 'text-emerald-400')} />
    case 'structure':
      return <Wrench className={clsx(cls, 'text-violet-400')} />
    case 'admin':
      return <Activity className={clsx(cls, 'text-rose-400')} />
    case 'ddl':
      return <Code2 className={clsx(cls, 'text-violet-400')} />
  }
}

async function requestClose(tab: Tab): Promise<void> {
  if (tab.kind === 'query' && isDirty(tab)) {
    const ok = await confirm({
      title: 'Unsaved changes',
      body: `"${tab.title}" has changes not saved to the workspace. Close it anyway?`,
      confirmLabel: 'Close',
      danger: true
    })
    if (!ok) return
  }
  closeTab(tab.id)
}

/** Closes every tab of a group, with one confirmation for the unsaved queries. */
async function requestCloseGroup(group: TabGroupInfo): Promise<void> {
  const dirty = group.tabs.filter((t): t is QueryTab => t.kind === 'query' && isDirty(t))
  if (dirty.length > 0) {
    const ok = await confirm({
      title: 'Unsaved changes',
      body: `${dirty.map((t) => `"${t.title}"`).join(', ')} ${dirty.length > 1 ? 'have' : 'has'} changes not saved to the workspace. Close anyway?`,
      confirmLabel: 'Close all',
      danger: true
    })
    if (!ok) return
  }
  for (const tab of group.tabs) closeTab(tab.id)
}

function isRealDatabase(group: string): boolean {
  return group !== SERVER_GROUP && group !== NO_DATABASE_GROUP
}

function groupIcon(group: string): ReactNode {
  if (group === SERVER_GROUP) return <Activity className="size-3.5 shrink-0 text-rose-400" />
  if (group === NO_DATABASE_GROUP) return <FileCode className="size-3.5 shrink-0 text-muted" />
  return <Database className="size-3.5 shrink-0 text-emerald-400" />
}

function GroupBar({ groups, activeGroup }: { groups: TabGroupInfo[]; activeGroup: string | null }) {
  const session = useApp((s) => s.session)
  const color = session ? session.connection.color || ENV_COLORS[session.connection.env] : undefined
  return (
    <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel-2">
      {groups.map((group) => {
        const active = group.key === activeGroup
        return (
          <div
            key={group.key}
            className={clsx(
              'group relative flex max-w-64 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-xs',
              active ? 'bg-panel font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'
            )}
            onClick={() => activateGroup(group.key)}
            onAuxClick={(e) => e.button === 1 && void requestCloseGroup(group)}
            title={isRealDatabase(group.key) ? `Database ${group.key}` : groupLabel(group.key)}
          >
            {active && <span className="absolute inset-x-0 bottom-0 h-0.5" style={{ background: color }} />}
            {groupIcon(group.key)}
            <span className="truncate">{groupLabel(group.key)}</span>
            <span className="rounded bg-bg px-1 text-[10px] text-muted">{group.tabs.length}</span>
            <button
              className="flex size-5 items-center justify-center rounded opacity-0 hover:bg-hover group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                void requestCloseGroup(group)
              }}
              aria-label={`Close the tabs of ${groupLabel(group.key)}`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function TabBar({ tabs, activeGroup }: { tabs: Tab[]; activeGroup: string | null }) {
  const activeTabId = useApp((s) => s.activeTabId)
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-panel">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              'group relative flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-xs',
              tab.id === activeTabId ? 'bg-bg text-fg' : 'text-muted hover:bg-hover hover:text-fg'
            )}
            onClick={() => useApp.setState({ activeTabId: tab.id })}
            onAuxClick={(e) => e.button === 1 && void requestClose(tab)}
            title={tab.kind === 'table' || tab.kind === 'structure' ? `${tab.database}.${tabTitle(tab)}` : tabTitle(tab)}
          >
            {tab.id === activeTabId && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            {tabIcon(tab)}
            <span className="truncate">{tabTitle(tab)}</span>
            {tab.kind === 'query' && tab.running && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
            {tab.kind === 'query' && isDirty(tab) ? (
              <span className="flex size-5 items-center justify-center">
                <span className="size-2 rounded-full bg-fg group-hover:hidden" />
                <X
                  className="hidden size-3.5 rounded hover:bg-hover group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation()
                    void requestClose(tab)
                  }}
                />
              </span>
            ) : (
              <button
                className="flex size-5 items-center justify-center rounded opacity-0 hover:bg-hover group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  void requestClose(tab)
                }}
                aria-label="Close tab"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="flex w-9 shrink-0 items-center justify-center text-muted hover:bg-hover hover:text-fg"
        onClick={() => newQueryInGroup(activeGroup)}
        aria-label="New query"
        title={activeGroup && isRealDatabase(activeGroup) ? `New query on ${activeGroup}` : 'New query'}
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

/** New query tab on the database of the active group. */
function newQueryInGroup(group: string | null): void {
  if (group && isRealDatabase(group)) openQueryTab({ database: group })
  else if (group === NO_DATABASE_GROUP) openQueryTab({ database: null })
  else openQueryTab()
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'query':
      return <QueryTabView tab={tab} />
    case 'table':
      return <TableTabView tab={tab} />
    case 'database':
      return <DatabaseTabView tab={tab} />
    case 'structure':
      return <StructureTabView tab={tab} />
    case 'admin':
      return <AdminTabView tab={tab} />
    case 'ddl':
      return <DdlTabView tab={tab} />
  }
}

function useTabShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { session, tabs, activeTabId } = useApp.getState()
      if (!session || !(e.ctrlKey || e.metaKey)) return
      const active = tabs.find((t) => t.id === activeTabId)
      const activeGroup = active ? tabGroup(active) : null
      if (e.key === 't') {
        e.preventDefault()
        newQueryInGroup(activeGroup)
      } else if (e.key === 'w') {
        e.preventDefault()
        if (active) void requestClose(active)
      } else if (e.key === 'Tab' && e.altKey) {
        // Ctrl+Alt+Tab: next database group.
        e.preventDefault()
        const groups = groupTabs(tabs)
        if (groups.length < 2) return
        const index = groups.findIndex((g) => g.key === activeGroup)
        activateGroup(groups[(index + (e.shiftKey ? -1 : 1) + groups.length) % groups.length].key)
      } else if (e.key === 'Tab') {
        // Ctrl+Tab: next tab of the active group.
        e.preventDefault()
        const members = tabs.filter((t) => tabGroup(t) === activeGroup)
        if (members.length < 2) return
        const index = members.findIndex((t) => t.id === activeTabId)
        useApp.setState({ activeTabId: members[(index + (e.shiftKey ? -1 : 1) + members.length) % members.length].id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function MainArea() {
  const session = useApp((s) => s.session)
  const tabs = useApp((s) => s.tabs)
  const activeTabId = useApp((s) => s.activeTabId)
  const editing = useConnectionEditor((s) => s.editing)
  const groups = useMemo(() => groupTabs(tabs), [tabs])
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeGroup = activeTab ? tabGroup(activeTab) : null
  useTabShortcuts()

  if (!session) {
    if (editing) return <ConnectionForm key={editing} connectionId={editing} />
    return (
      <EmptyState icon={<Database className="size-12" />} title="Simone">
        <p className="max-w-sm text-xs">Select a connection to edit it, double-click to connect, or create a new one.</p>
        <Button variant="primary" onClick={() => useConnectionEditor.setState({ editing: 'new' })}>
          New connection
        </Button>
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {groups.length > 0 && <GroupBar groups={groups} activeGroup={activeGroup} />}
      {groups.length > 0 && <TabBar tabs={groups.find((g) => g.key === activeGroup)?.tabs ?? []} activeGroup={activeGroup} />}
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 && (
          <EmptyState icon={<FileCode className="size-10" />} title="No open tab">
            <Button variant="primary" onClick={() => openQueryTab()}>
              New query
            </Button>
          </EmptyState>
        )}
        {/* Tabs stay mounted so editors and grids keep their state. */}
        {tabs.map((tab) => (
          <div key={tab.id} className={clsx('absolute inset-0', tab.id !== activeTabId && 'hidden')}>
            <TabContent tab={tab} />
          </div>
        ))}
      </div>
    </div>
  )
}
