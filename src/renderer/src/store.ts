// Application state: active connection, open tabs and UI preferences.
import { create } from 'zustand'
import type { ConnectionConfig, SessionInfo, StatementResult } from '@shared/types'
import { api, errorMessage } from './lib/bridge'
import { toast } from './components/feedback'

export interface QueryTab {
  id: string
  kind: 'query'
  title: string
  sql: string
  database: string | null
  /** Saved query file backing the tab, if any. */
  savedPath?: string
  /** SQL as last saved, to show the unsaved marker. */
  savedSql?: string
  results: StatementResult[]
  activeResult: number
  running: boolean
}

export interface TableTab {
  id: string
  kind: 'table'
  database: string
  table: string
  isView: boolean
  view: 'data' | 'structure' | 'info' | 'ddl'
  /** Filter applied when opened from a foreign key jump. */
  initialFilter?: { column: string; value: string }
}

export interface DatabaseTab {
  id: string
  kind: 'database'
  database: string
}

export interface StructureTab {
  id: string
  kind: 'structure'
  database: string
  /** null when creating a new table. */
  table: string | null
}

export interface AdminTab {
  id: string
  kind: 'admin'
  section: 'processes' | 'variables' | 'status' | 'users'
}

export interface DdlTab {
  id: string
  kind: 'ddl'
  database: string
  name: string
  objectKind: 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'
}

export type Tab = QueryTab | TableTab | DatabaseTab | StructureTab | AdminTab | DdlTab

/** A tab without its id, distributed over the union so each kind keeps its fields. */
export type NewTab = Tab extends infer T ? (T extends Tab ? Omit<T, 'id'> : never) : never

export interface ActiveSession {
  info: SessionInfo
  connection: ConnectionConfig
}

export type SidebarView = 'explorer' | 'saved' | 'history'

interface AppState {
  session: ActiveSession | null
  /** Workspace the session's connection belongs to. */
  sessionRepoId: string | null
  connecting: string | null
  tabs: Tab[]
  activeTabId: string | null
  sidebarView: SidebarView
  /** Database used for new query tabs and highlighted in the explorer. */
  currentDatabase: string | null
  theme: 'dark' | 'light'
  rowLimit: number
}

export const useApp = create<AppState>(() => ({
  session: null,
  sessionRepoId: null,
  connecting: null,
  tabs: [],
  activeTabId: null,
  sidebarView: 'explorer',
  currentDatabase: null,
  theme: (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
  rowLimit: Number(localStorage.getItem('rowLimit')) || 1000
}))

let tabCounter = 0
export const newTabId = (): string => `tab-${Date.now().toString(36)}-${++tabCounter}`

// ------------------------------------------------------ persisted query tabs

interface StoredTab {
  title: string
  sql: string
  database: string | null
  savedPath?: string
  savedSql?: string
}

const tabsKey = (connectionId: string): string => `tabs:${connectionId}`

function persistTabs(): void {
  const { session, tabs } = useApp.getState()
  if (!session) return
  const stored: StoredTab[] = tabs
    .filter((t): t is QueryTab => t.kind === 'query')
    .map((t) => ({ title: t.title, sql: t.sql, database: t.database, savedPath: t.savedPath, savedSql: t.savedSql }))
  try {
    localStorage.setItem(tabsKey(session.connection.id), JSON.stringify(stored))
  } catch {
    // Storage full or unavailable: tabs are simply not restored.
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined
useApp.subscribe((state, previous) => {
  if (state.tabs !== previous.tabs) {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(persistTabs, 500)
  }
})

function restoreTabs(connectionId: string, database: string | null): QueryTab[] {
  try {
    const stored = JSON.parse(localStorage.getItem(tabsKey(connectionId)) ?? '[]') as StoredTab[]
    return stored.map((t) => ({ ...t, id: newTabId(), kind: 'query', results: [], activeResult: 0, running: false, database: t.database ?? database }))
  } catch {
    return []
  }
}

// ------------------------------------------------------------------- actions

export function setTheme(theme: 'dark' | 'light'): void {
  localStorage.setItem('theme', theme)
  document.documentElement.classList.toggle('light', theme === 'light')
  useApp.setState({ theme })
}

export function setRowLimit(rowLimit: number): void {
  localStorage.setItem('rowLimit', String(rowLimit))
  useApp.setState({ rowLimit })
}

/**
 * Connects to a connection. When already connected elsewhere, the new session
 * is opened first and the old one closed only once it succeeded, so a failed
 * switch leaves the current connection untouched. Query tabs are saved per
 * connection and restored.
 */
export async function connect(connection: ConnectionConfig, repoId: string | null): Promise<void> {
  const previous = useApp.getState().session
  if (previous?.connection.id === connection.id) return
  useApp.setState({ connecting: connection.id })
  let info: SessionInfo
  try {
    info = await api.sessions.open({ connectionId: connection.id })
  } catch (error) {
    useApp.setState({ connecting: null })
    toast(`Could not connect to ${connection.name}:\n${errorMessage(error)}`, 'error')
    return
  }
  if (previous) {
    persistTabs()
    void api.sessions.close({ sessionId: previous.info.sessionId }).catch(() => undefined)
  }
  const database = connection.defaultDatabase || null
  const restored = restoreTabs(connection.id, database)
  const tabs: Tab[] = restored.length > 0 ? restored : [emptyQueryTab(database, 1)]
  useApp.setState({
    session: { info, connection },
    sessionRepoId: repoId,
    connecting: null,
    currentDatabase: database,
    tabs,
    activeTabId: tabs[0].id,
    // Keep the sidebar view when switching; show the explorer on a fresh connection.
    sidebarView: previous ? useApp.getState().sidebarView : 'explorer'
  })
}

export async function disconnect(): Promise<void> {
  const { session } = useApp.getState()
  if (!session) return
  persistTabs()
  useApp.setState({ session: null, sessionRepoId: null, tabs: [], activeTabId: null, currentDatabase: null })
  await api.sessions.close({ sessionId: session.info.sessionId }).catch(() => undefined)
}

/** Forgets the session without calling the backend (it already closed it, e.g. on workspace switch). */
export function dropSession(): void {
  persistTabs()
  useApp.setState({ session: null, sessionRepoId: null, tabs: [], activeTabId: null, currentDatabase: null })
}

function emptyQueryTab(database: string | null, index: number, sql = ''): QueryTab {
  return { id: newTabId(), kind: 'query', title: `Query ${index}`, sql, database, results: [], activeResult: 0, running: false }
}

export function openQueryTab(options: Partial<Pick<QueryTab, 'sql' | 'title' | 'database' | 'savedPath' | 'savedSql'>> = {}): string {
  const { tabs, currentDatabase } = useApp.getState()
  if (options.savedPath) {
    const existing = tabs.find((t) => t.kind === 'query' && t.savedPath === options.savedPath)
    if (existing) {
      useApp.setState({ activeTabId: existing.id })
      return existing.id
    }
  }
  const count = tabs.filter((t) => t.kind === 'query').length + 1
  const tab: QueryTab = {
    ...emptyQueryTab(options.database !== undefined ? options.database : currentDatabase, count, options.sql ?? ''),
    ...(options.title ? { title: options.title } : {}),
    savedPath: options.savedPath,
    savedSql: options.savedSql
  }
  useApp.setState({ tabs: [...tabs, tab], activeTabId: tab.id })
  return tab.id
}

function sameTarget(a: Tab, b: NewTab): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'table':
      return a.database === (b as TableTab).database && a.table === (b as TableTab).table
    case 'database':
      return a.database === (b as DatabaseTab).database
    case 'structure':
      return a.database === (b as StructureTab).database && a.table === (b as StructureTab).table && a.table !== null
    case 'admin':
      return true
    case 'ddl':
      return a.database === (b as DdlTab).database && a.name === (b as DdlTab).name && a.objectKind === (b as DdlTab).objectKind
    default:
      return false
  }
}

/** Opens a tab, or focuses (and updates) the existing one for the same object. */
export function openTab(tab: NewTab): void {
  const { tabs } = useApp.getState()
  const existing = tabs.find((t) => sameTarget(t, tab))
  if (existing) {
    useApp.setState({ tabs: tabs.map((t) => (t.id === existing.id ? ({ ...t, ...tab } as Tab) : t)), activeTabId: existing.id })
    return
  }
  const created = { ...tab, id: newTabId() } as Tab
  useApp.setState({ tabs: [...tabs, created], activeTabId: created.id })
}

export function updateTab<T extends Tab>(id: string, patch: Partial<T> | ((tab: T) => Partial<T>)): void {
  useApp.setState((state) => ({
    tabs: state.tabs.map((t) => (t.id === id ? ({ ...t, ...(typeof patch === 'function' ? patch(t as T) : patch) } as Tab) : t))
  }))
}

export function closeTab(id: string): void {
  const { tabs, activeTabId, session } = useApp.getState()
  const index = tabs.findIndex((t) => t.id === id)
  if (index < 0) return
  const closing = tabs[index]
  const remaining = tabs.filter((t) => t.id !== id)
  let nextActive = activeTabId
  if (activeTabId === id) {
    // Stay in the same database group when it still has tabs.
    const sameGroup = remaining.filter((t) => tabGroup(t) === tabGroup(closing))
    const neighbour = sameGroup.find((t) => tabs.indexOf(t) > index) ?? sameGroup.at(-1)
    nextActive = (neighbour ?? remaining[index] ?? remaining[index - 1] ?? null)?.id ?? null
  }
  useApp.setState({ tabs: remaining, activeTabId: nextActive })
  if (closing.kind === 'query' && session) {
    void api.sessions.closeTab({ sessionId: session.info.sessionId, tabId: id }).catch(() => undefined)
  }
}

export function isDirty(tab: QueryTab): boolean {
  return tab.savedPath ? tab.sql !== tab.savedSql : false
}

// ---------------------------------------------------------------- tab groups
// Tabs are grouped by database in the tab bar. A query tab belongs to the
// database selected in its editor, so it follows a USE or a selector change.

export const SERVER_GROUP = '\u0000server'
export const NO_DATABASE_GROUP = '\u0000none'

export function tabGroup(tab: Tab): string {
  switch (tab.kind) {
    case 'admin':
      return SERVER_GROUP
    case 'query':
      return tab.database ?? NO_DATABASE_GROUP
    default:
      return tab.database
  }
}

export function groupLabel(group: string): string {
  if (group === SERVER_GROUP) return 'Server'
  if (group === NO_DATABASE_GROUP) return 'No database'
  return group
}

export interface TabGroupInfo {
  key: string
  tabs: Tab[]
}

/** Groups in order of their first tab; server and no-database groups last. */
export function groupTabs(tabs: Tab[]): TabGroupInfo[] {
  const groups = new Map<string, Tab[]>()
  for (const tab of tabs) {
    const key = tabGroup(tab)
    groups.set(key, [...(groups.get(key) ?? []), tab])
  }
  const special = (key: string): number => (key === NO_DATABASE_GROUP ? 1 : key === SERVER_GROUP ? 2 : 0)
  return [...groups.entries()].map(([key, groupTabs]) => ({ key, tabs: groupTabs })).sort((a, b) => special(a.key) - special(b.key))
}

/** Last active tab of each group, to come back to it when the group is selected again. */
const lastActiveByGroup = new Map<string, string>()

useApp.subscribe((state, previous) => {
  if (state.activeTabId === previous.activeTabId) return
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  if (!tab) return
  lastActiveByGroup.set(tabGroup(tab), tab.id)
  const group = tabGroup(tab)
  if (group !== SERVER_GROUP && group !== NO_DATABASE_GROUP && state.currentDatabase !== group) {
    useApp.setState({ currentDatabase: group })
  }
})

/** Selects a group: its last active tab, else its first one. Returns false when the group has no tab. */
export function activateGroup(group: string): boolean {
  const { tabs } = useApp.getState()
  const members = tabs.filter((t) => tabGroup(t) === group)
  if (members.length === 0) return false
  const remembered = members.find((t) => t.id === lastActiveByGroup.get(group))
  useApp.setState({ activeTabId: (remembered ?? members[0]).id })
  return true
}
