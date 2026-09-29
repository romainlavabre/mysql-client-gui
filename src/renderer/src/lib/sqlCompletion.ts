// Schema-aware completion for the SQL editors: tables, columns (bare, or
// after `table.` / `alias.`), databases, and `db.table.column` loaded on demand.
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { MySQL, keywordCompletionSource } from '@codemirror/lang-sql'
import type { CompletionSchema } from '@shared/types'
import { statementAt } from '@shared/sql/split'

export interface CompletionData {
  /** Tables and columns of the current database. */
  tables: CompletionSchema
  databases: string[]
  /** Tables whose columns are always offered first (the table of a filter bar). */
  defaultTables?: string[]
  loadDatabase?: (database: string) => Promise<CompletionSchema>
}

interface TableRef {
  database: string | null
  table: string
  alias: string | null
}

const IDENT = '`?([\\w$]+)`?'
const TABLE_REF = new RegExp(
  `\\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\\s+${IDENT}(?:\\.${IDENT})?(?:\\s+(?:AS\\s+)?(?!(?:ON|USING|WHERE|SET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|GROUP|ORDER|LIMIT|HAVING|UNION|VALUES|SELECT)\\b)([\\w$]+))?`,
  'gi'
)

/** Tables referenced by a statement, with their alias. Comma joins (`FROM a, b`) are read too. */
export function tableRefs(sql: string): TableRef[] {
  const refs: TableRef[] = []
  for (const match of sql.matchAll(TABLE_REF)) {
    const [, first, second, alias] = match
    refs.push(second ? { database: first, table: second, alias: alias ?? null } : { database: null, table: first, alias: alias ?? null })
  }
  // FROM a x, b y
  for (const match of sql.matchAll(/\bFROM\s+([^;]*?)(?:\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|\bJOIN\b|$)/gis)) {
    for (const part of match[1].split(',').slice(1)) {
      const item = new RegExp(`^\\s*${IDENT}(?:\\.${IDENT})?(?:\\s+(?:AS\\s+)?([\\w$]+))?`, 'i').exec(part)
      if (item) refs.push(item[2] ? { database: item[1], table: item[2], alias: item[3] ?? null } : { database: null, table: item[1], alias: item[3] ?? null })
    }
  }
  return refs
}

const unquote = (name: string): string => name.replace(/^`|`$/g, '')

function findTable(schema: CompletionSchema, name: string): string | undefined {
  return schema[name] ? name : Object.keys(schema).find((t) => t.toLowerCase() === name.toLowerCase())
}

function quoteIfNeeded(name: string): string {
  return /^[A-Za-z_][\w$]*$/.test(name) ? name : '`' + name.replace(/`/g, '``') + '`'
}

const tableOption = (name: string, detail?: string, boost = 0): Completion => ({ label: name, apply: quoteIfNeeded(name), type: 'type', detail: detail ?? 'table', boost })
const columnOption = (name: string, table: string, boost = 0): Completion => ({ label: name, apply: quoteIfNeeded(name), type: 'property', detail: table, boost })

/** A completion source reading its data through `get`, so it follows schema changes without reconfiguring the editor. */
export function schemaCompletionSource(get: () => CompletionData | null): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const data = get()
    if (!data) return null
    const word = context.matchBefore(/(?:`?[\w$]*`?\.){0,2}`?[\w$]*/)
    if (!word) return null
    const parts = word.text.split('.')
    const partial = parts[parts.length - 1]
    if (parts.length === 1 && !partial && !context.explicit) return null
    // Not after a number or inside a string: the tokenizer would know better, keep it simple.
    const from = word.to - partial.length + (partial.startsWith('`') ? 1 : 0)

    const doc = context.state.doc.toString()
    const statement = statementAt(doc, context.pos)?.sql ?? doc
    const refs = tableRefs(statement)

    const columnsOf = async (database: string | null, table: string): Promise<{ table: string; columns: string[] } | null> => {
      if (!database) {
        const found = findTable(data.tables, table)
        return found ? { table: found, columns: data.tables[found] } : null
      }
      const schema = await data.loadDatabase?.(database).catch(() => ({}) as CompletionSchema)
      const found = schema ? findTable(schema, table) : undefined
      return schema && found ? { table: found, columns: schema[found] } : null
    }

    if (parts.length === 1) {
      const options: Completion[] = []
      const seen = new Set<string>()
      const primary = [...refs.map((r) => ({ database: r.database, table: r.table })), ...(data.defaultTables ?? []).map((t) => ({ database: null, table: t }))]
      for (const ref of primary) {
        const found = await columnsOf(ref.database, ref.table)
        if (!found) continue
        for (const column of found.columns) {
          const key = `${found.table}.${column}`
          if (seen.has(key)) continue
          seen.add(key)
          options.push(columnOption(column, found.table, 2))
        }
      }
      // Without referenced tables yet, every column of the database, below tables.
      if (primary.length === 0) {
        for (const [table, columns] of Object.entries(data.tables)) for (const column of columns) options.push(columnOption(column, table, -1))
      }
      for (const table of Object.keys(data.tables)) options.push(tableOption(table, undefined, 1))
      for (const ref of refs) if (ref.alias) options.push({ label: ref.alias, type: 'variable', detail: `alias of ${ref.table}`, boost: 1 })
      for (const database of data.databases) options.push({ label: database, apply: quoteIfNeeded(database), type: 'namespace', detail: 'database', boost: -2 })
      return { from, options, validFor: /^`?[\w$]*$/ }
    }

    const qualifier = parts.slice(0, -1).map(unquote)
    if (qualifier.length === 1) {
      const name = qualifier[0]
      const alias = refs.find((r) => r.alias?.toLowerCase() === name.toLowerCase())
      const target = alias ? { database: alias.database, table: alias.table } : { database: null, table: name }
      const found = await columnsOf(target.database, target.table)
      if (found) return { from, options: found.columns.map((c) => columnOption(c, found.table)), validFor: /^`?[\w$]*$/ }
      // db. → its tables
      const database = data.databases.find((d) => d.toLowerCase() === name.toLowerCase())
      if (database && data.loadDatabase) {
        const schema = await data.loadDatabase(database).catch(() => ({}) as CompletionSchema)
        return { from, options: Object.keys(schema).map((t) => tableOption(t, database)), validFor: /^`?[\w$]*$/ }
      }
      return null
    }

    // db.table. → columns
    const found = await columnsOf(qualifier[0], qualifier[1])
    return found ? { from, options: found.columns.map((c) => columnOption(c, found.table)), validFor: /^`?[\w$]*$/ } : null
  }
}

const mysqlKeywords = keywordCompletionSource(MySQL, true)

/** MySQL keywords, except right after a dot where only a table or column can follow. */
export const keywordSource: CompletionSource = (context) => {
  if (context.matchBefore(/\.`?[\w$]*$/)) return null
  return mysqlKeywords(context)
}

/** Completion sources of the SQL fields: schema first, keywords after. */
export function sqlCompletionSources(get: () => CompletionData | null): CompletionSource[] {
  return [schemaCompletionSource(get), keywordSource]
}
