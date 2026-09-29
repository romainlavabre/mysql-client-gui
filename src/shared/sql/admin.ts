// SQL for user and privilege management.
import type { PrivilegeLevel } from '../types'
import { quoteIdent, quoteString } from './quote'

export const PRIVILEGES = {
  data: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FILE'],
  structure: [
    'CREATE',
    'ALTER',
    'INDEX',
    'DROP',
    'CREATE TEMPORARY TABLES',
    'SHOW VIEW',
    'CREATE ROUTINE',
    'ALTER ROUTINE',
    'EXECUTE',
    'CREATE VIEW',
    'EVENT',
    'TRIGGER',
    'REFERENCES'
  ],
  administration: [
    'GRANT OPTION',
    'SUPER',
    'PROCESS',
    'RELOAD',
    'SHUTDOWN',
    'SHOW DATABASES',
    'LOCK TABLES',
    'REPLICATION CLIENT',
    'REPLICATION SLAVE',
    'CREATE USER'
  ]
} as const

export function account(user: string, host: string): string {
  return `${quoteString(user)}@${quoteString(host)}`
}

export function levelSql(level: PrivilegeLevel): string {
  switch (level.kind) {
    case 'global':
      return '*.*'
    case 'database':
      return `${quoteIdent(level.database)}.*`
    case 'table':
      return `${quoteIdent(level.database)}.${quoteIdent(level.table)}`
  }
}

function privilegeList(privileges: string[]): string {
  const list = privileges.filter((p) => p !== 'GRANT OPTION')
  if (list.length === 0) throw new Error('Select at least one privilege')
  for (const privilege of list) {
    if (!/^[A-Z ]+$/.test(privilege)) throw new Error(`Invalid privilege: ${privilege}`)
  }
  return list.join(', ')
}

export function grantSql(user: string, host: string, level: PrivilegeLevel, privileges: string[], withGrantOption: boolean): string {
  return (
    `GRANT ${privilegeList(privileges)} ON ${levelSql(level)} TO ${account(user, host)}` +
    (withGrantOption ? ' WITH GRANT OPTION' : '')
  )
}

export function revokeSql(user: string, host: string, level: PrivilegeLevel, privileges: string[], withGrantOption: boolean): string {
  const list = privileges.filter((p) => p !== 'GRANT OPTION')
  const parts = [...list]
  if (withGrantOption) parts.push('GRANT OPTION')
  if (parts.length === 0) throw new Error('Select at least one privilege')
  return `REVOKE ${parts.join(', ')} ON ${levelSql(level)} FROM ${account(user, host)}`
}
