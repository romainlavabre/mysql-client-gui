// Column types for the structure editor: catalog, and the split of a full
// type (`decimal(10,2) unsigned`) into base type, length and attribute.

export type TypeFamily = 'integer' | 'decimal' | 'float' | 'bit' | 'datetime' | 'date' | 'string' | 'text' | 'binary' | 'list' | 'other'

export interface ColumnTypeInfo {
  name: string
  group: 'Numeric' | 'Date and time' | 'String' | 'Binary' | 'Spatial' | 'Other'
  family: TypeFamily
  description: string
  /** Length / values used when the type is picked without one. */
  defaultLength?: string
  /** Hint shown in the length field. */
  lengthHint?: string
  /** MariaDB only, or recent MySQL only. */
  availability?: 'mariadb' | 'mysql'
}

export const COLUMN_TYPES: ColumnTypeInfo[] = [
  { name: 'tinyint', group: 'Numeric', family: 'integer', description: '1-byte integer, -128 to 127 (0 to 255 unsigned)', lengthHint: 'display width' },
  { name: 'smallint', group: 'Numeric', family: 'integer', description: '2-byte integer, -32,768 to 32,767 (0 to 65,535 unsigned)' },
  { name: 'mediumint', group: 'Numeric', family: 'integer', description: '3-byte integer, -8,388,608 to 8,388,607 (0 to 16,777,215 unsigned)' },
  { name: 'int', group: 'Numeric', family: 'integer', description: '4-byte integer, about ±2.1 billion (0 to 4.3 billion unsigned)' },
  { name: 'bigint', group: 'Numeric', family: 'integer', description: '8-byte integer, about ±9.2 × 10^18' },
  { name: 'decimal', group: 'Numeric', family: 'decimal', description: 'Exact fixed-point number: money, quantities', defaultLength: '10,2', lengthHint: 'precision,scale' },
  { name: 'float', group: 'Numeric', family: 'float', description: 'Approximate 4-byte floating-point number' },
  { name: 'double', group: 'Numeric', family: 'float', description: 'Approximate 8-byte floating-point number' },
  { name: 'bit', group: 'Numeric', family: 'bit', description: 'Bit field of 1 to 64 bits', defaultLength: '1', lengthHint: 'bits' },
  { name: 'boolean', group: 'Numeric', family: 'integer', description: 'Alias of tinyint(1): 0 is false, anything else true' },
  { name: 'date', group: 'Date and time', family: 'date', description: 'Date, 1000-01-01 to 9999-12-31' },
  { name: 'datetime', group: 'Date and time', family: 'datetime', description: 'Date and time, no time zone conversion', lengthHint: 'fsp (0-6)' },
  { name: 'timestamp', group: 'Date and time', family: 'datetime', description: 'Date and time stored in UTC, 1970 to 2038', lengthHint: 'fsp (0-6)' },
  { name: 'time', group: 'Date and time', family: 'date', description: 'Time or duration, -838:59:59 to 838:59:59', lengthHint: 'fsp (0-6)' },
  { name: 'year', group: 'Date and time', family: 'date', description: 'Year, 1901 to 2155' },
  { name: 'varchar', group: 'String', family: 'string', description: 'Variable-length string up to 65,535 bytes', defaultLength: '255', lengthHint: 'max characters' },
  { name: 'char', group: 'String', family: 'string', description: 'Fixed-length string, right-padded, up to 255 characters', defaultLength: '1', lengthHint: 'characters' },
  { name: 'tinytext', group: 'String', family: 'text', description: 'Text up to 255 bytes' },
  { name: 'text', group: 'String', family: 'text', description: 'Text up to 64 KiB' },
  { name: 'mediumtext', group: 'String', family: 'text', description: 'Text up to 16 MiB' },
  { name: 'longtext', group: 'String', family: 'text', description: 'Text up to 4 GiB' },
  { name: 'enum', group: 'String', family: 'list', description: 'One value of a fixed list', defaultLength: "'a','b'", lengthHint: "'value1','value2'" },
  { name: 'set', group: 'String', family: 'list', description: 'Zero or more values of a fixed list', defaultLength: "'a','b'", lengthHint: "'value1','value2'" },
  { name: 'binary', group: 'Binary', family: 'binary', description: 'Fixed-length bytes, up to 255', defaultLength: '16', lengthHint: 'bytes' },
  { name: 'varbinary', group: 'Binary', family: 'binary', description: 'Variable-length bytes up to 65,535', defaultLength: '255', lengthHint: 'max bytes' },
  { name: 'tinyblob', group: 'Binary', family: 'binary', description: 'Bytes up to 255' },
  { name: 'blob', group: 'Binary', family: 'binary', description: 'Bytes up to 64 KiB' },
  { name: 'mediumblob', group: 'Binary', family: 'binary', description: 'Bytes up to 16 MiB' },
  { name: 'longblob', group: 'Binary', family: 'binary', description: 'Bytes up to 4 GiB' },
  { name: 'json', group: 'Other', family: 'other', description: 'JSON document (a checked longtext on MariaDB)' },
  { name: 'uuid', group: 'Other', family: 'other', description: 'UUID stored in 16 bytes', availability: 'mariadb' },
  { name: 'inet4', group: 'Other', family: 'other', description: 'IPv4 address', availability: 'mariadb' },
  { name: 'inet6', group: 'Other', family: 'other', description: 'IPv6 address', availability: 'mariadb' },
  { name: 'vector', group: 'Other', family: 'other', description: 'Vector of floats (MySQL 9)', defaultLength: '1024', lengthHint: 'dimensions', availability: 'mysql' },
  { name: 'geometry', group: 'Spatial', family: 'other', description: 'Any geometry' },
  { name: 'point', group: 'Spatial', family: 'other', description: 'A point' },
  { name: 'linestring', group: 'Spatial', family: 'other', description: 'A line' },
  { name: 'polygon', group: 'Spatial', family: 'other', description: 'A polygon' },
  { name: 'multipoint', group: 'Spatial', family: 'other', description: 'A collection of points' },
  { name: 'multilinestring', group: 'Spatial', family: 'other', description: 'A collection of lines' },
  { name: 'multipolygon', group: 'Spatial', family: 'other', description: 'A collection of polygons' },
  { name: 'geometrycollection', group: 'Spatial', family: 'other', description: 'A collection of geometries' }
]

export function typeInfo(base: string): ColumnTypeInfo | undefined {
  const name = base.toLowerCase()
  return COLUMN_TYPES.find((t) => t.name === name) ?? (name === 'integer' ? COLUMN_TYPES.find((t) => t.name === 'int') : undefined)
}

export type TypeAttribute = '' | 'unsigned' | 'unsigned zerofill'

export interface ParsedType {
  base: string
  length: string
  attribute: TypeAttribute
}

/** `decimal(10,2) unsigned zerofill` → { base: 'decimal', length: '10,2', attribute: 'unsigned zerofill' }. */
export function parseColumnType(type: string): ParsedType {
  const match = /^\s*([a-z][a-z0-9_ ]*?)\s*(?:\((.*)\))?((?:\s+(?:unsigned|signed|zerofill))*)\s*$/is.exec(type)
  if (!match) return { base: type.trim(), length: '', attribute: '' }
  const flags = match[3].toLowerCase()
  const attribute: TypeAttribute = flags.includes('zerofill') ? 'unsigned zerofill' : flags.includes('unsigned') ? 'unsigned' : ''
  return { base: match[1].trim(), length: (match[2] ?? '').trim(), attribute }
}

export function formatColumnType({ base, length, attribute }: ParsedType): string {
  return `${base.trim()}${length.trim() ? `(${length.trim()})` : ''}${attribute ? ` ${attribute}` : ''}`
}

/** Fractional seconds precision of a datetime / timestamp type, for CURRENT_TIMESTAMP(n). */
export function fractionalDigits(type: string): number {
  const { base, length } = parseColumnType(type)
  const family = typeInfo(base)?.family
  return family === 'datetime' && /^\d$/.test(length) ? Number(length) : 0
}

export function supportsUnsigned(base: string): boolean {
  const family = typeInfo(base)?.family
  return family === 'integer' || family === 'decimal' || family === 'float'
}

export function supportsOnUpdate(base: string): boolean {
  return typeInfo(base)?.family === 'datetime'
}
