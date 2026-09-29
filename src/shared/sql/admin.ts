// SQL for user and privilege management.
import type { PrivilegeLevel, PrivilegeSet, SslRequirement } from '../types'
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

/** Static privileges that can be granted at each level (GRANT OPTION is handled apart). */
export const PRIVILEGES_BY_LEVEL: Record<PrivilegeLevel['kind'], { group: string; privileges: string[] }[]> = {
  global: [
    { group: 'Data', privileges: [...PRIVILEGES.data] },
    { group: 'Structure', privileges: [...PRIVILEGES.structure] },
    { group: 'Administration', privileges: PRIVILEGES.administration.filter((p) => p !== 'GRANT OPTION') }
  ],
  database: [
    { group: 'Data', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    { group: 'Structure', privileges: [...PRIVILEGES.structure] },
    { group: 'Administration', privileges: ['LOCK TABLES'] }
  ],
  table: [
    { group: 'Data', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    { group: 'Structure', privileges: ['CREATE', 'ALTER', 'INDEX', 'DROP', 'SHOW VIEW', 'CREATE VIEW', 'TRIGGER', 'REFERENCES'] },
    { group: 'Administration', privileges: [] }
  ]
}

export function privilegesForLevel(kind: PrivilegeLevel['kind']): string[] {
  return PRIVILEGES_BY_LEVEL[kind].flatMap((g) => g.privileges)
}

/**
 * GRANT / REVOKE statements turning the current privileges of an account at
 * a level into the desired ones. Privileges this editor does not manage
 * (MySQL dynamic privileges, column grants) are left untouched.
 */
export function privilegeChangesSql(
  user: string,
  host: string,
  level: PrivilegeLevel,
  current: PrivilegeSet,
  desired: PrivilegeSet
): string[] {
  const managed = new Set(privilegesForLevel(level.kind))
  const has = new Set(current.privileges.filter((p) => managed.has(p)))
  const wants = new Set(desired.privileges.filter((p) => managed.has(p)))
  const removed = [...has].filter((p) => !wants.has(p))
  const added = [...wants].filter((p) => !has.has(p))
  const statements: string[] = []
  if (removed.length > 0) statements.push(revokeSql(user, host, level, removed, false))
  if (current.grantOption && !desired.grantOption) statements.push(revokeSql(user, host, level, [], true))
  const addGrantOption = desired.grantOption && !current.grantOption
  if (added.length > 0) statements.push(grantSql(user, host, level, added, addGrantOption))
  else if (addGrantOption) statements.push(grantSql(user, host, level, ['USAGE'], true))
  return statements
}

export function sameSslRequirement(a: SslRequirement, b: SslRequirement): boolean {
  if (a.type !== b.type) return false
  return a.type !== 'specified' || (a.cipher.trim() === b.cipher.trim() && a.issuer.trim() === b.issuer.trim() && a.subject.trim() === b.subject.trim())
}

/** ALTER USER … REQUIRE: the connection an account must use. */
export function sslRequireSql(user: string, host: string, ssl: SslRequirement): string {
  let clause: string
  switch (ssl.type) {
    case 'none':
      clause = 'NONE'
      break
    case 'ssl':
      clause = 'SSL'
      break
    case 'x509':
      clause = 'X509'
      break
    case 'specified': {
      const parts = [
        ssl.cipher.trim() && `CIPHER ${quoteString(ssl.cipher.trim())}`,
        ssl.issuer.trim() && `ISSUER ${quoteString(ssl.issuer.trim())}`,
        ssl.subject.trim() && `SUBJECT ${quoteString(ssl.subject.trim())}`
      ].filter(Boolean)
      if (parts.length === 0) throw new Error('Give a cipher, an issuer or a subject')
      clause = parts.join(' AND ')
    }
  }
  return `ALTER USER ${account(user, host)} REQUIRE ${clause}`
}

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
