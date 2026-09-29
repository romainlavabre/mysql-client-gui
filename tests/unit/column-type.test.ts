import { describe, expect, it } from 'vitest'
import { formatColumnType, parseColumnType, supportsOnUpdate, supportsUnsigned } from '@shared/sql/columnType'
import { columnSql } from '@shared/sql/ddl'

describe('parseColumnType', () => {
  it('splits base type, length and attribute', () => {
    expect(parseColumnType('int(10) unsigned')).toEqual({ base: 'int', length: '10', attribute: 'unsigned' })
    expect(parseColumnType('decimal(10,2) unsigned zerofill')).toEqual({ base: 'decimal', length: '10,2', attribute: 'unsigned zerofill' })
    expect(parseColumnType('varchar(255)')).toEqual({ base: 'varchar', length: '255', attribute: '' })
    expect(parseColumnType("enum('a','b(c)')")).toEqual({ base: 'enum', length: "'a','b(c)'", attribute: '' })
    expect(parseColumnType('datetime')).toEqual({ base: 'datetime', length: '', attribute: '' })
    expect(parseColumnType('double precision')).toEqual({ base: 'double precision', length: '', attribute: '' })
  })
  it('round-trips types as written by the server', () => {
    for (const type of ['int(10) unsigned', 'tinyint(1)', 'decimal(10,2)', "enum('a','b')", 'datetime(3)', 'bigint unsigned zerofill', 'json']) {
      expect(formatColumnType(parseColumnType(type))).toBe(type)
    }
  })
  it('knows which attributes apply', () => {
    expect(supportsUnsigned('INT')).toBe(true)
    expect(supportsUnsigned('varchar')).toBe(false)
    expect(supportsOnUpdate('timestamp')).toBe(true)
    expect(supportsOnUpdate('date')).toBe(false)
  })
})

describe('ON UPDATE CURRENT_TIMESTAMP', () => {
  it('matches the fractional precision of the column', () => {
    const base = { name: 'updated_at', nullable: false, autoIncrement: false, default: 'CURRENT_TIMESTAMP', defaultIsExpression: true, onUpdateCurrentTimestamp: true }
    expect(columnSql({ ...base, type: 'datetime' })).toBe('`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
    expect(columnSql({ ...base, type: 'datetime(3)', default: 'CURRENT_TIMESTAMP(3)' })).toBe(
      '`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'
    )
  })
})
