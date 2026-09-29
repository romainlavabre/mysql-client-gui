// Local query history (never shared), capped to the most recent entries.
import { randomUUID } from 'node:crypto'
import type { HistoryEntry } from '@shared/types'
import { JsonStore } from './jsonStore'

const MAX_ENTRIES = 1000
const MAX_SQL_LENGTH = 20_000

export class HistoryStore {
  private readonly store: JsonStore<{ entries: HistoryEntry[] }>

  constructor(filePath: string) {
    this.store = new JsonStore(filePath, () => ({ entries: [] }))
  }

  add(entry: Omit<HistoryEntry, 'id'>): void {
    const sql = entry.sql.length > MAX_SQL_LENGTH ? entry.sql.slice(0, MAX_SQL_LENGTH) + '\n-- (truncated)' : entry.sql
    this.store.update((file) => {
      file.entries.unshift({ ...entry, sql, id: randomUUID() })
      file.entries.length = Math.min(file.entries.length, MAX_ENTRIES)
    })
  }

  list(connectionId: string | undefined, limit: number): HistoryEntry[] {
    const entries = this.store.read().entries
    return (connectionId ? entries.filter((e) => e.connectionId === connectionId) : entries).slice(0, limit)
  }

  clear(): void {
    this.store.write({ entries: [] })
  }
}
