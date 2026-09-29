import { describe, expect, it } from 'vitest'
import { buildAlterTable, buildCreateTable, columnSql } from '@shared/sql/ddl'
import type { TableDefinition } from '@shared/types'

const base = (): TableDefinition => ({
  database: 'app',
  name: 'users',
  engine: 'InnoDB',
  collation: 'utf8mb4_general_ci',
  comment: '',
  columns: [
    { name: 'id', originalName: 'id', type: 'int unsigned', nullable: false, autoIncrement: true },
    { name: 'email', originalName: 'email', type: 'varchar(255)', nullable: false, autoIncrement: false },
    {
      name: 'created_at',
      originalName: 'created_at',
      type: 'datetime',
      nullable: false,
      default: 'CURRENT_TIMESTAMP',
      defaultIsExpression: true,
      autoIncrement: false
    }
  ],
  indexes: [
    { name: 'PRIMARY', kind: 'PRIMARY', columns: [{ name: 'id' }] },
    { name: 'uniq_email', kind: 'UNIQUE', columns: [{ name: 'email' }] }
  ],
  foreignKeys: []
})

describe('columnSql', () => {
  it('renders defaults', () => {
    expect(columnSql({ name: 'a', type: 'int', nullable: true, default: null, autoIncrement: false })).toBe('`a` int NULL DEFAULT NULL')
    expect(columnSql({ name: 'a', type: 'varchar(3)', nullable: false, default: "x'y", autoIncrement: false })).toBe(
      "`a` varchar(3) NOT NULL DEFAULT 'x\\'y'"
    )
    expect(
      columnSql({ name: 'a', type: 'json', nullable: false, default: "json_array()", defaultIsExpression: true, autoIncrement: false })
    ).toBe('`a` json NOT NULL DEFAULT (json_array())')
  })
  it('renders generated columns', () => {
    expect(
      columnSql({ name: 'full', type: 'varchar(10)', nullable: true, autoIncrement: false, generated: { expression: "concat(a,b)", stored: true } })
    ).toBe('`full` varchar(10) GENERATED ALWAYS AS (concat(a,b)) STORED')
  })
})

describe('buildCreateTable', () => {
  it('renders a full table', () => {
    expect(buildCreateTable(base())).toBe(
      [
        'CREATE TABLE `app`.`users` (',
        '  `id` int unsigned NOT NULL AUTO_INCREMENT,',
        '  `email` varchar(255) NOT NULL,',
        '  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,',
        '  PRIMARY KEY (`id`),',
        '  UNIQUE INDEX `uniq_email` (`email`)',
        ') ENGINE=InnoDB COLLATE=utf8mb4_general_ci'
      ].join('\n')
    )
  })
})

describe('buildAlterTable', () => {
  it('returns nothing when unchanged', () => {
    expect(buildAlterTable(base(), base())).toEqual([])
  })

  it('adds, renames, drops and moves columns', () => {
    const modified = base()
    modified.columns = [
      modified.columns[0],
      { name: 'name', type: 'varchar(100)', nullable: true, autoIncrement: false },
      { ...modified.columns[1], name: 'mail' }
    ]
    expect(buildAlterTable(base(), modified)).toEqual([
      'ALTER TABLE `app`.`users`\n' +
        '  DROP COLUMN `created_at`,\n' +
        '  ADD COLUMN `name` varchar(100) NULL AFTER `id`,\n' +
        '  CHANGE COLUMN `email` `mail` varchar(255) NOT NULL'
    ])
  })

  it('moves a column', () => {
    const modified = base()
    modified.columns = [modified.columns[1], modified.columns[0], modified.columns[2]]
    expect(buildAlterTable(base(), modified)).toEqual([
      'ALTER TABLE `app`.`users`\n  MODIFY COLUMN `email` varchar(255) NOT NULL FIRST'
    ])
  })

  it('recreates changed indexes and foreign keys', () => {
    const original = base()
    original.foreignKeys = [
      { name: 'fk_a', columns: ['id'], refTable: 'accounts', refColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'RESTRICT' }
    ]
    const modified = structuredClone(original)
    modified.indexes[1].columns.push({ name: 'id' })
    modified.foreignKeys[0].onDelete = 'SET NULL'
    expect(buildAlterTable(original, modified)).toEqual([
      'ALTER TABLE `app`.`users` DROP FOREIGN KEY `fk_a`',
      'ALTER TABLE `app`.`users`\n' +
        '  DROP INDEX `uniq_email`,\n' +
        '  ADD UNIQUE INDEX `uniq_email` (`email`, `id`),\n' +
        '  ADD CONSTRAINT `fk_a` FOREIGN KEY (`id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT'
    ])
  })

  it('renames the table and changes options', () => {
    const modified = base()
    modified.name = 'members'
    modified.comment = 'People'
    expect(buildAlterTable(base(), modified)).toEqual([
      "ALTER TABLE `app`.`users`\n  COMMENT='People'",
      'RENAME TABLE `app`.`users` TO `app`.`members`'
    ])
  })
})
