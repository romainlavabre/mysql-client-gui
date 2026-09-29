import { describe, expect, it } from 'vitest'
import { quoteIdent, quoteValue } from '@shared/sql/quote'
import { buildOrderBy, buildWhere } from '@shared/sql/filters'
import { rowChangeToSql } from '@shared/sql/rowChanges'
import { grantSql, revokeSql } from '@shared/sql/admin'
import { isDestructive, isUnboundedWrite, isWriteStatement } from '@shared/sql/classify'

describe('quoting', () => {
  it('escapes identifiers', () => {
    expect(quoteIdent('we`ird')).toBe('`we``ird`')
  })
  it('escapes values', () => {
    expect(quoteValue(null)).toBe('NULL')
    expect(quoteValue(12.5)).toBe('12.5')
    expect(quoteValue("it's\n\\")).toBe("'it\\'s\\n\\\\'")
    expect(quoteValue(new Uint8Array([0, 255]))).toBe("X'00ff'")
  })
})

describe('filters', () => {
  it('builds a WHERE clause', () => {
    expect(
      buildWhere(
        [
          { column: 'name', operator: 'CONTAINS', value: '50%_off' },
          { column: 'id', operator: 'IN', value: '1, 2,3' },
          { column: 'deleted_at', operator: 'IS NULL' },
          { column: 'age', operator: 'BETWEEN', value: '18', value2: '30' }
        ],
        'status <> 2'
      )
    ).toBe(
      "WHERE `name` LIKE '%50\\\\%\\\\_off%' AND `id` IN ('1', '2', '3') AND `deleted_at` IS NULL AND `age` BETWEEN '18' AND '30' AND (status <> 2)"
    )
  })
  it('is empty without filters', () => {
    expect(buildWhere([])).toBe('')
    expect(buildOrderBy([])).toBe('')
  })
  it('builds ORDER BY', () => {
    expect(buildOrderBy([{ column: 'a', direction: 'DESC' }, { column: 'b', direction: 'ASC' }])).toBe('ORDER BY `a` DESC, `b` ASC')
  })
})

describe('row changes', () => {
  it('updates by key', () => {
    expect(rowChangeToSql('db', 't', { type: 'update', key: { id: 3 }, values: { name: 'x', note: null } })).toBe(
      "UPDATE `db`.`t` SET `name` = 'x', `note` = NULL WHERE `id` = 3 LIMIT 1"
    )
  })
  it('inserts', () => {
    expect(rowChangeToSql('db', 't', { type: 'insert', values: { a: '1' } })).toBe("INSERT INTO `db`.`t` (`a`) VALUES ('1')")
  })
  it('deletes by key, NULL-safe', () => {
    expect(rowChangeToSql('db', 't', { type: 'delete', key: { a: 1, b: null } })).toBe(
      'DELETE FROM `db`.`t` WHERE `a` = 1 AND `b` IS NULL LIMIT 1'
    )
  })
  it('refuses rows without a key', () => {
    expect(() => rowChangeToSql('db', 't', { type: 'delete', key: {} })).toThrow(/no primary/)
  })
})

describe('privileges', () => {
  it('grants and revokes', () => {
    expect(grantSql('bob', '%', { kind: 'database', database: 'app' }, ['SELECT', 'INSERT'], true)).toBe(
      "GRANT SELECT, INSERT ON `app`.* TO 'bob'@'%' WITH GRANT OPTION"
    )
    expect(revokeSql('bob', 'localhost', { kind: 'global' }, ['SELECT'], false)).toBe("REVOKE SELECT ON *.* FROM 'bob'@'localhost'")
  })
  it('rejects injected privileges', () => {
    expect(() => grantSql('a', '%', { kind: 'global' }, ['SELECT; DROP'], false)).toThrow()
  })
})

describe('classification', () => {
  it('detects writes', () => {
    expect(isWriteStatement('select * from t')).toBe(false)
    expect(isWriteStatement('  (SELECT 1)')).toBe(false)
    expect(isWriteStatement('SET @a = 1')).toBe(false)
    expect(isWriteStatement('SET GLOBAL max_connections = 1')).toBe(true)
    expect(isWriteStatement('update t set a = 1')).toBe(true)
    expect(isWriteStatement('-- comment\nDELETE FROM t')).toBe(true)
    expect(isWriteStatement("SELECT 'delete'")).toBe(false)
    expect(isWriteStatement('SELECT * FROM t INTO OUTFILE "/tmp/x"')).toBe(true)
  })
  it('detects UPDATE/DELETE without WHERE', () => {
    expect(isUnboundedWrite('DELETE FROM t')).toBe(true)
    expect(isUnboundedWrite("UPDATE t SET a = 'where'")).toBe(true)
    expect(isUnboundedWrite('UPDATE t SET a = 1 WHERE id = 2')).toBe(false)
    expect(isUnboundedWrite('SELECT 1')).toBe(false)
  })
  it('detects destructive statements', () => {
    expect(isDestructive('drop table x')).toBe(true)
    expect(isDestructive('TRUNCATE x')).toBe(true)
  })
})
