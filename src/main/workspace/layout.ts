// Files of a workspace repository: what is shared between users.
//
//   mysql-client.json           workspace metadata
//   connections/<slug>.json     connection settings (never secrets)
//   queries/**/<name>.sql       saved queries, metadata in leading `-- @key value` comments
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ConnectionConfig, SavedQuery } from '@shared/types'

export const WORKSPACE_FILE = 'mysql-client.json'
export const CONNECTIONS_DIR = 'connections'
export const QUERIES_DIR = 'queries'
const FORMAT_VERSION = 1

const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
  env: z.enum(['dev', 'staging', 'prod', 'other']).catch('other'),
  readOnly: z.boolean().catch(false),
  host: z.string().catch('127.0.0.1'),
  port: z.number().int().catch(3306),
  user: z.string().catch(''),
  defaultDatabase: z.string().optional(),
  ssl: z
    .object({
      enabled: z.boolean().catch(false),
      rejectUnauthorized: z.boolean().catch(true),
      caPath: z.string().optional(),
      certPath: z.string().optional(),
      keyPath: z.string().optional()
    })
    .catch({ enabled: false, rejectUnauthorized: true }),
  ssh: z
    .object({
      enabled: z.boolean().catch(false),
      host: z.string().catch(''),
      port: z.number().int().catch(22),
      user: z.string().catch(''),
      auth: z.enum(['agent', 'keyFile', 'password']).catch('agent'),
      keyPath: z.string().optional()
    })
    .catch({ enabled: false, host: '', port: 22, user: '', auth: 'agent' })
})

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'connection'
}

export function ensureLayout(dir: string, name: string): string[] {
  const created: string[] = []
  mkdirSync(dir, { recursive: true })
  const workspaceFile = join(dir, WORKSPACE_FILE)
  if (!existsSync(workspaceFile)) {
    writeFileSync(workspaceFile, JSON.stringify({ name, formatVersion: FORMAT_VERSION }, null, 2) + '\n')
    created.push(WORKSPACE_FILE)
  }
  for (const folder of [CONNECTIONS_DIR, QUERIES_DIR]) {
    const keep = join(dir, folder, '.gitkeep')
    if (!existsSync(keep)) {
      mkdirSync(join(dir, folder), { recursive: true })
      writeFileSync(keep, '')
      created.push(`${folder}/.gitkeep`)
    }
  }
  return created
}

// --------------------------------------------------------------- connections

export function listConnections(dir: string): ConnectionConfig[] {
  const folder = join(dir, CONNECTIONS_DIR)
  if (!existsSync(folder)) return []
  const connections: ConnectionConfig[] = []
  for (const file of readdirSync(folder).sort()) {
    if (!file.endsWith('.json')) continue
    try {
      const parsed = connectionSchema.parse(JSON.parse(readFileSync(join(folder, file), 'utf8')))
      connections.push({ ...parsed, slug: file.slice(0, -'.json'.length) })
    } catch {
      // A broken file must not hide the other connections.
    }
  }
  return connections.sort((a, b) => a.name.localeCompare(b.name))
}

function uniqueSlug(dir: string, name: string): string {
  const base = slugify(name)
  let slug = base
  for (let n = 2; existsSync(join(dir, CONNECTIONS_DIR, `${slug}.json`)); n++) slug = `${base}-${n}`
  return slug
}

/** Writes a connection; returns the saved config and the repo-relative paths touched. */
export function writeConnection(dir: string, config: ConnectionConfig): { config: ConnectionConfig; paths: string[] } {
  const existing = listConnections(dir).find((c) => c.id === config.id)
  const id = config.id || randomUUID()
  const slug = existing?.slug ?? uniqueSlug(dir, config.name)
  const saved: ConnectionConfig = { ...config, id, slug }
  // The slug is the file name, it is not repeated inside the file.
  const { slug: _slug, ...content } = saved
  void _slug
  const path = `${CONNECTIONS_DIR}/${slug}.json`
  mkdirSync(join(dir, CONNECTIONS_DIR), { recursive: true })
  writeFileSync(join(dir, path), JSON.stringify(content, null, 2) + '\n')
  return { config: saved, paths: [path] }
}

export function deleteConnection(dir: string, connectionId: string): { config: ConnectionConfig; paths: string[] } {
  const existing = listConnections(dir).find((c) => c.id === connectionId)
  if (!existing) throw new Error('Connection not found')
  const path = `${CONNECTIONS_DIR}/${existing.slug}.json`
  rmSync(join(dir, path))
  return { config: existing, paths: [path] }
}

// ------------------------------------------------------------- saved queries

const HEADER_LINE = /^--\s*@(\w+)[ \t]?(.*)$/

export function parseQueryFile(path: string, content: string): SavedQuery {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const meta: Record<string, string> = {}
  let index = 0
  for (; index < lines.length; index++) {
    const match = HEADER_LINE.exec(lines[index])
    if (!match) break
    meta[match[1].toLowerCase()] = match[2].trim()
  }
  if (index > 0 && lines[index] === '') index++
  const fileName = path.split('/').pop() ?? path
  return {
    path,
    name: meta.name || fileName.replace(/\.sql$/i, ''),
    description: meta.description || undefined,
    connection: meta.connection || undefined,
    sql: lines.slice(index).join('\n').replace(/\n+$/, '')
  }
}

export function serializeQuery(query: SavedQuery): string {
  const header = [`-- @name ${oneLine(query.name)}`]
  if (query.description) header.push(`-- @description ${oneLine(query.description)}`)
  if (query.connection) header.push(`-- @connection ${oneLine(query.connection)}`)
  return `${header.join('\n')}\n\n${query.sql.replace(/\s+$/, '')}\n`
}

function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim()
}

/** Validates a query path and resolves it inside `queries/`, refusing escapes. */
export function queryFile(dir: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!/\.sql$/i.test(normalized)) throw new Error('A saved query path must end with .sql')
  if (normalized.split('/').some((part) => part === '..' || part === '' || part === '.')) {
    throw new Error(`Invalid query path: ${path}`)
  }
  const root = resolve(dir, QUERIES_DIR)
  const file = resolve(root, normalized)
  if (!file.startsWith(root + sep)) throw new Error(`Invalid query path: ${path}`)
  return file
}

export function listQueries(dir: string): SavedQuery[] {
  const root = join(dir, QUERIES_DIR)
  const queries: SavedQuery[] = []
  const walk = (folder: string): void => {
    if (!existsSync(folder)) return
    for (const entry of readdirSync(folder)) {
      const full = join(folder, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.sql$/i.test(entry)) {
        const path = relative(root, full).split(sep).join('/')
        queries.push(parseQueryFile(path, readFileSync(full, 'utf8')))
      }
    }
  }
  walk(root)
  return queries.sort((a, b) => a.path.localeCompare(b.path))
}

export function writeQuery(dir: string, query: SavedQuery, previousPath?: string): { query: SavedQuery; paths: string[] } {
  const file = queryFile(dir, query.path)
  const paths = [`${QUERIES_DIR}/${query.path}`]
  if (previousPath && previousPath !== query.path) {
    const previous = queryFile(dir, previousPath)
    if (existsSync(file)) throw new Error(`A saved query already exists at ${query.path}`)
    rmSync(previous, { force: true })
    removeEmptyParents(dirname(previous), join(dir, QUERIES_DIR))
    paths.push(`${QUERIES_DIR}/${previousPath}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, serializeQuery(query))
  return { query: parseQueryFile(query.path, serializeQuery(query)), paths }
}

export function deleteQuery(dir: string, path: string): string[] {
  const file = queryFile(dir, path)
  rmSync(file, { force: true })
  removeEmptyParents(dirname(file), join(dir, QUERIES_DIR))
  return [`${QUERIES_DIR}/${path}`]
}

function removeEmptyParents(folder: string, stopAt: string): void {
  let current = resolve(folder)
  const stop = resolve(stopAt)
  while (current.startsWith(stop + sep) && readdirSync(current).length === 0) {
    rmSync(current, { recursive: true })
    current = dirname(current)
  }
}
