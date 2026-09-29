import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionConfig, SyncStatus } from '@shared/types'
import { SecretStore } from '../../src/main/secrets'
import { WorkspaceManager } from '../../src/main/workspace/manager'
import { parseQueryFile, serializeQuery } from '../../src/main/workspace/layout'

const fakeCipher = { encrypt: (s: string) => `enc:${Buffer.from(s).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(4), 'base64').toString() }

const connection = (name: string): ConnectionConfig => ({
  id: '',
  slug: '',
  name,
  env: 'dev',
  readOnly: false,
  host: 'db.local',
  port: 3306,
  user: 'app',
  ssl: { enabled: false, rejectUnauthorized: true },
  ssh: { enabled: false, host: '', port: 22, user: '', auth: 'agent' }
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

let root: string
let remote: string

function manager(name: string): { ws: WorkspaceManager; statuses: SyncStatus[] } {
  const statuses: SyncStatus[] = []
  const ws = new WorkspaceManager(
    join(root, name, 'state.json'),
    join(root, name, 'workspaces'),
    new SecretStore(join(root, name, 'secrets.json'), fakeCipher),
    { status: (s) => statuses.push(s), changed: () => undefined },
    0
  )
  return { ws, statuses }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcg-ws-'))
  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '--initial-branch=master', remote])
  process.env.GIT_AUTHOR_NAME = 'Test'
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com'
  process.env.GIT_COMMITTER_NAME = 'Test'
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('query files', () => {
  it('round-trips metadata and SQL', () => {
    const query = { path: 'reports/a.sql', name: 'Monthly', description: 'Revenue', connection: 'prod', sql: 'SELECT 1;\n\nSELECT 2;' }
    expect(parseQueryFile(query.path, serializeQuery(query))).toEqual(query)
  })
  it('reads plain SQL files', () => {
    expect(parseQueryFile('x/list-users.sql', 'SELECT * FROM users\n')).toEqual({
      path: 'x/list-users.sql',
      name: 'list-users',
      description: undefined,
      connection: undefined,
      sql: 'SELECT * FROM users'
    })
  })
})

describe('WorkspaceManager', () => {
  it('shares connections and queries between two clones, never the secrets', async () => {
    const alice = manager('alice')
    await alice.ws.clone('Client A', remote)
    const saved = await alice.ws.saveConnection({
      config: connection('Prod DB'),
      secrets: { password: 's3cret-pass' },
      override: {}
    })
    expect(saved.slug).toBe('prod-db')
    await alice.ws.saveQuery({ path: 'reports/users.sql', name: 'Users', connection: 'prod-db', sql: 'SELECT * FROM users' })
    await alice.ws.flush()

    const bob = manager('bob')
    await bob.ws.clone('Client A', remote)
    expect(bob.ws.listConnections().map((c) => c.name)).toEqual(['Prod DB'])
    expect(bob.ws.listQueries().map((q) => q.path)).toEqual(['reports/users.sql'])
    // Bob has not typed the password: it is local to Alice.
    expect(bob.ws.draft(saved.id).secrets).toEqual({})
    expect(alice.ws.draft(saved.id).secrets).toEqual({ password: 's3cret-pass' })

    const history = git(remote, 'log', '--all', '-p')
    expect(history).not.toContain('s3cret-pass')
    expect(git(remote, 'log', '--format=%s', 'master')).toContain('Add connection "Prod DB"')
  })

  it('switches between workspaces', async () => {
    const { ws } = manager('alice')
    const a = await ws.create('Client A')
    await ws.saveConnection({ config: connection('A1'), secrets: {}, override: {} })
    const b = await ws.create('Client B')
    expect(ws.state().activeRepoId).toBe(b.id)
    expect(ws.listConnections()).toEqual([])
    await ws.activate(a.id)
    expect(ws.listConnections().map((c) => c.name)).toEqual(['A1'])
    ws.remove(a.id, true)
    expect(ws.state()).toMatchObject({ activeRepoId: b.id, repos: [{ name: 'Client B' }] })
  })

  it('reports conflicts and resolves them with the chosen side', async () => {
    const alice = manager('alice')
    await alice.ws.clone('Shared', remote)
    await alice.ws.saveQuery({ path: 'q.sql', name: 'Q', sql: 'SELECT 1' })
    await alice.ws.flush()

    const bob = manager('bob')
    const bobRepo = await bob.ws.clone('Shared', remote)
    await bob.ws.flush()

    await alice.ws.saveQuery({ path: 'q.sql', name: 'Q', sql: 'SELECT "alice"' })
    await alice.ws.flush()

    await bob.ws.saveQuery({ path: 'q.sql', name: 'Q', sql: 'SELECT "bob"' })
    await bob.ws.flush()
    const status = await bob.ws.sync(bobRepo.id)
    expect(status.conflicts).toEqual(['queries/q.sql'])
    // The failed rebase was aborted: Bob's version is still there.
    expect(readFileSync(join(bobRepo.path, 'queries/q.sql'), 'utf8')).toContain('bob')

    const resolved = await bob.ws.resolveConflicts(bobRepo.id, { 'queries/q.sql': 'theirs' })
    expect(resolved.conflicts).toEqual([])
    expect(resolved.error).toBeNull()
    expect(readFileSync(join(bobRepo.path, 'queries/q.sql'), 'utf8')).toContain('alice')
    expect(git(bobRepo.path, 'status', '--porcelain')).toBe('')
  })

  it('commits files edited outside the app on sync', async () => {
    const { ws } = manager('alice')
    const repo = await ws.clone('Shared', remote)
    await ws.flush()
    writeFileSync(join(repo.path, 'queries', 'manual.sql'), 'SELECT 42\n')
    const status = await ws.sync(repo.id)
    expect(status).toMatchObject({ dirty: false, ahead: 0, error: null })
    expect(git(remote, 'log', '--format=%s', 'master')).toContain('Update workspace')
  })

  it('refuses query paths escaping the queries folder', async () => {
    const { ws } = manager('alice')
    await ws.create('Local')
    await expect(ws.saveQuery({ path: '../evil.sql', name: 'x', sql: '' })).rejects.toThrow(/Invalid query path/)
  })
})
