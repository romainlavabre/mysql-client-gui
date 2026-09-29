// Saved queries of the workspace, as a folder tree.
import * as ContextMenu from '@radix-ui/react-context-menu'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronRight, FileCode, Folder, FolderInput, Play, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SavedQuery } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { confirm, toast } from '../../components/feedback'
import { EmptyState, Input, Spinner } from '../../components/ui'
import { openQueryTab, useApp } from '../../store'
import { useSavedQueries } from '../workspace/useWorkspace'
import { SaveQueryDialog } from './SaveQueryDialog'

interface FolderNode {
  name: string
  path: string
  folders: FolderNode[]
  queries: SavedQuery[]
}

function buildTree(queries: SavedQuery[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], queries: [] }
  for (const query of queries) {
    const parts = query.path.split('/')
    parts.pop()
    let node = root
    for (const part of parts) {
      let child = node.folders.find((f) => f.name === part)
      if (!child) {
        child = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: [], queries: [] }
        node.folders.push(child)
      }
      node = child
    }
    node.queries.push(query)
  }
  const sort = (node: FolderNode): void => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name))
    node.queries.sort((a, b) => a.name.localeCompare(b.name))
    node.folders.forEach(sort)
  }
  sort(root)
  return root
}

const menuItem = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-hover'

export function SavedQueries() {
  const { data: queries, isLoading } = useSavedQueries()
  const session = useApp((s) => s.session)!
  const [search, setSearch] = useState('')
  const [onlyThisConnection, setOnlyThisConnection] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState<SavedQuery | null>(null)
  const queryClient = useQueryClient()

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (queries ?? []).filter(
      (q) =>
        (!onlyThisConnection || !q.connection || q.connection === session.connection.slug) &&
        (!needle || q.name.toLowerCase().includes(needle) || q.path.toLowerCase().includes(needle) || q.sql.toLowerCase().includes(needle))
    )
  }, [queries, search, onlyThisConnection, session.connection.slug])

  const tree = useMemo(() => buildTree(filtered), [filtered])

  const open = (query: SavedQuery): void => {
    openQueryTab({ sql: query.sql, title: query.name, savedPath: query.path, savedSql: query.sql })
  }

  const remove = async (query: SavedQuery): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${query.name}"`,
      body: 'The query file is removed from the workspace repository for everyone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.queries.remove({ path: query.path })
      await queryClient.invalidateQueries({ queryKey: ['queries'] })
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const renderFolder = (node: FolderNode, depth: number) => (
    <>
      {node.folders.map((folder) => {
        const isCollapsed = collapsed.has(folder.path) && !search
        return (
          <div key={folder.path}>
            <div
              className="flex h-[26px] cursor-pointer items-center gap-1.5 rounded pr-2 hover:bg-hover"
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c)
                  if (next.has(folder.path)) next.delete(folder.path)
                  else next.add(folder.path)
                  return next
                })
              }
            >
              <ChevronRight className={clsx('size-3.5 text-muted transition-transform', !isCollapsed && 'rotate-90')} />
              <Folder className="size-3.5 text-muted" />
              <span className="truncate">{folder.name}</span>
            </div>
            {!isCollapsed && renderFolder(folder, depth + 1)}
          </div>
        )
      })}
      {node.queries.map((query) => (
        <ContextMenu.Root key={query.path}>
          <ContextMenu.Trigger asChild>
            <div
              className="flex h-[26px] cursor-pointer items-center gap-1.5 rounded pr-2 hover:bg-hover"
              style={{ paddingLeft: 6 + depth * 14 + 18 }}
              onClick={() => open(query)}
              title={query.description ?? query.path}
            >
              <FileCode className="size-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{query.name}</span>
              {query.connection && query.connection !== session.connection.slug && (
                <span className="truncate text-[10px] text-muted">{query.connection}</span>
              )}
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="z-50 w-44 rounded-md border border-border bg-panel-2 p-1 shadow-xl">
              <ContextMenu.Item className={menuItem} onSelect={() => open(query)}>
                <Play className="size-3.5" /> Open
              </ContextMenu.Item>
              <ContextMenu.Item className={menuItem} onSelect={() => setMoving(query)}>
                <FolderInput className="size-3.5" /> Rename / move
              </ContextMenu.Item>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item className={`${menuItem} text-danger`} onSelect={() => void remove(query)}>
                <Trash2 className="size-3.5" /> Delete
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ))}
    </>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input className="pl-7" placeholder="Search saved queries" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 px-1 text-[11px] text-muted">
          <input type="checkbox" className="accent-[var(--accent)]" checked={onlyThisConnection} onChange={(e) => setOnlyThisConnection(e.target.checked)} />
          Hide queries bound to other connections
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-2 text-[13px]">
        {isLoading && <Spinner className="mx-auto mt-6" />}
        {!isLoading && filtered.length === 0 && (
          <EmptyState title="No saved query">
            <p className="text-xs">Save an editor tab with Ctrl+S to share it through the workspace repository.</p>
          </EmptyState>
        )}
        {renderFolder(tree, 0)}
      </div>
      {moving && (
        <SaveQueryDialog
          open
          onOpenChange={(o) => !o && setMoving(null)}
          initial={{ sql: moving.sql }}
          existing={moving}
          onSaved={(saved) => {
            const { tabs } = useApp.getState()
            useApp.setState({
              tabs: tabs.map((t) => (t.kind === 'query' && t.savedPath === moving.path ? { ...t, savedPath: saved.path, title: saved.name } : t))
            })
          }}
        />
      )}
    </div>
  )
}
