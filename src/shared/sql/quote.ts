// Identifier and literal quoting for generated SQL.
import type { CellValue } from '../types'

export function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/** `db`.`name`, or just `name` when no database is given. */
export function qualified(database: string | null | undefined, name: string): string {
  return database ? `${quoteIdent(database)}.${quoteIdent(name)}` : quoteIdent(name)
}

const ESCAPES: Record<string, string> = {
  '\0': '\\0',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\Z',
  "'": "\\'",
  '\\': '\\\\'
}

export function quoteString(value: string): string {
  // eslint-disable-next-line no-control-regex -- escaping control characters is the point
  return "'" + value.replace(/[\0\b\t\n\r\x1a'\\]/g, (ch) => ESCAPES[ch]) + "'"
}

export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export function quoteValue(value: CellValue | boolean | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Uint8Array) return value.length === 0 ? "''" : `X'${toHex(value)}'`
  return quoteString(value)
}
