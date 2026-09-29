// Local history of executed queries for the active connection.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Trash2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../../lib/bridge'
import { formatDuration, relativeTime } from '../../lib/format'
import { EmptyState, IconButton, Input, Spinner } from '../../components/ui'
import { openQueryTab, useApp } from '../../store'

export function HistoryPanel() {
  const session = useApp((s) => s.session)!
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['history', session.connection.id],
    queryFn: () => api.queries.history({ connectionId: session.connection.id, limit: 500 }),
    staleTime: 0,
    refetchInterval: 5000
  })

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data ?? []).filter((e) => !needle || e.sql.toLowerCase().includes(needle))
  }, [data, search])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
          <Input className="pl-7" placeholder="Search history" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <IconButton
          label="Clear history"
          className="size-8"
          onClick={async () => {
            await api.queries.clearHistory()
            void queryClient.invalidateQueries({ queryKey: ['history'] })
          }}
        >
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {isLoading && <Spinner className="mx-auto mt-6" />}
        {!isLoading && filtered.length === 0 && <EmptyState title="No history yet" />}
        {filtered.map((entry) => (
          <button
            key={entry.id}
            className="mb-1 flex w-full flex-col gap-1 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-hover"
            onClick={() => openQueryTab({ sql: entry.sql, database: entry.database })}
            title={entry.error ?? 'Open in a new tab'}
          >
            <code className="line-clamp-3 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all">{entry.sql}</code>
            <span className="flex items-center gap-2 text-[10px] text-muted">
              {entry.error && <XCircle className="size-3 text-danger" />}
              {relativeTime(entry.executedAt)} · {formatDuration(entry.durationMs)}
              {entry.database && <> · {entry.database}</>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
