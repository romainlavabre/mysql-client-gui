import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { schemaCompletionSource, tableRefs, type CompletionData } from '../../src/renderer/src/lib/sqlCompletion'

const data: CompletionData = {
  tables: { users: ['id', 'email', 'created_at'], orders: ['id', 'user_id', 'amount'], 'order items': ['sku'] },
  databases: ['shop', 'billing'],
  loadDatabase: async (db): Promise<Record<string, string[]>> => (db === 'billing' ? { invoices: ['id', 'total'] } : {})
}

async function complete(doc: string, extra: Partial<CompletionData> = {}, explicit = false) {
  const pos = doc.indexOf('|')
  const text = doc.replace('|', '')
  const state = EditorState.create({ doc: text })
  const result = await schemaCompletionSource(() => ({ ...data, ...extra }))(new CompletionContext(state, pos, explicit))
  return result ? { from: result.from, labels: result.options.map((o) => o.label), options: result.options } : null
}

describe('tableRefs', () => {
  it('reads tables and aliases', () => {
    expect(tableRefs('SELECT * FROM users u JOIN billing.invoices AS i ON i.id = u.id WHERE 1')).toEqual([
      { database: null, table: 'users', alias: 'u' },
      { database: 'billing', table: 'invoices', alias: 'i' }
    ])
    expect(tableRefs('SELECT * FROM `users` WHERE id = 1')).toEqual([{ database: null, table: 'users', alias: null }])
    expect(tableRefs('SELECT * FROM users a, orders b WHERE a.id = b.user_id')).toEqual([
      { database: null, table: 'users', alias: 'a' },
      { database: null, table: 'orders', alias: 'b' }
    ])
    expect(tableRefs('UPDATE orders SET amount = 1')).toEqual([{ database: null, table: 'orders', alias: null }])
  })
})

describe('schemaCompletionSource', () => {
  it('offers the columns of the referenced tables first, then tables', async () => {
    const result = await complete('SELECT em| FROM users')
    const email = result!.options.find((o) => o.label === 'email')!
    const orders = result!.options.find((o) => o.label === 'orders')!
    expect(email.detail).toBe('users')
    expect(email.boost).toBeGreaterThan(orders.boost ?? 0)
    // amount belongs to orders, not referenced: not offered.
    expect(result!.labels).not.toContain('amount')
  })

  it('offers every column when no table is referenced yet', async () => {
    expect((await complete('SELECT am|'))!.labels).toContain('amount')
  })

  it('completes after an alias or a table name', async () => {
    expect((await complete('SELECT u.| FROM users u'))!.labels).toEqual(['id', 'email', 'created_at'])
    expect((await complete('SELECT orders.am| FROM orders'))!.labels).toEqual(['id', 'user_id', 'amount'])
  })

  it('loads other databases on demand', async () => {
    expect((await complete('SELECT * FROM billing.|'))!.labels).toEqual(['invoices'])
    expect((await complete('SELECT billing.invoices.| FROM billing.invoices'))!.labels).toEqual(['id', 'total'])
    expect((await complete('SELECT i.to| FROM billing.invoices i'))!.labels).toEqual(['id', 'total'])
  })

  it('quotes names that need it', async () => {
    const option = (await complete('SELECT * FROM ord|'))!.options.find((o) => o.label === 'order items')!
    expect(option.apply).toBe('`order items`')
  })

  it('offers the default table columns in a filter condition', async () => {
    const result = await complete('cre|', { defaultTables: ['users'] })
    expect(result!.options.find((o) => o.label === 'created_at')?.boost).toBe(2)
    expect(result!.labels).not.toContain('amount')
  })

  it('stays quiet on an empty word unless asked', async () => {
    expect(await complete('SELECT |')).toBeNull()
    expect((await complete('SELECT |', {}, true))!.labels).toContain('users')
  })
})

describe('keywordSource', () => {
  it('offers keywords, but not after a dot', async () => {
    const { keywordSource } = await import('../../src/renderer/src/lib/sqlCompletion')
    const at = (doc: string) => {
      const state = EditorState.create({ doc: doc.replace('|', '') })
      return keywordSource(new CompletionContext(state, doc.indexOf('|'), false))
    }
    expect(await at('SEL|')).not.toBeNull()
    expect(await at('SELECT u.em|')).toBeNull()
  })
})
