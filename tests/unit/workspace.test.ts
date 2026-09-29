import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

  it('always works on master, even when the remote default branch is main', async () => {
    // A remote created on GitHub: default branch main, one commit.
    const mainRemote = join(root, 'main-remote.git')
    execFileSync('git', ['init', '--bare', '--initial-branch=main', mainRemote])
    const seed = join(root, 'seed')
    execFileSync('git', ['clone', mainRemote, seed])
    writeFileSync(join(seed, 'README.md'), 'hello\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'Initial commit')
    git(seed, 'push', 'origin', 'main')

    const { ws } = manager('alice')
    const repo = await ws.clone('GitHub', mainRemote)
    await ws.saveConnection({ config: connection('DB'), secrets: {}, override: {} })
    await ws.flush()
    expect(git(repo.path, 'branch', '--show-current').trim()).toBe('master')
    expect(git(mainRemote, 'log', '--format=%s', 'master')).toContain('Add connection "DB"')
    // The README of main is kept in master's history, main is untouched.
    expect(git(mainRemote, 'log', '--format=%s', 'master')).toContain('Initial commit')
    expect(git(mainRemote, 'log', '--format=%s', 'main').trim()).toBe('Initial commit')
    expect(git(repo.path, 'rev-parse', '--abbrev-ref', 'master@{upstream}').trim()).toBe('origin/master')
  })

  it('creates local workspaces on master and clones empty remotes on master', async () => {
    const { ws } = manager('alice')
    const local = await ws.create('Local')
    expect(git(local.path, 'branch', '--show-current').trim()).toBe('master')
    const empty = join(root, 'empty.git')
    execFileSync('git', ['init', '--bare', '--initial-branch=main', empty])
    const cloned = await ws.clone('Empty', empty)
    await ws.flush()
    expect(git(cloned.path, 'branch', '--show-current').trim()).toBe('master')
    expect(git(empty, 'branch', '--list').trim()).toBe('master')
  })

  it('renames the file of a renamed connection and rebinds its queries', async () => {
    const { ws } = manager('alice')
    const repo = await ws.clone('Shared', remote)
    const dev4 = await ws.saveConnection({ config: connection('DEV 4'), secrets: { password: 'p' }, override: {} })
    const copy = await ws.duplicateConnection(dev4.id)
    expect(copy.slug).toBe('dev-4-copy')
    await ws.saveQuery({ path: 'q.sql', name: 'Q', connection: 'dev-4-copy', sql: 'SELECT 1' })
    await ws.saveQuery({ path: 'other.sql', name: 'O', connection: 'dev-4', sql: 'SELECT 2' })

    const renamed = await ws.saveConnection({ ...ws.draft(copy.id), config: { ...ws.draft(copy.id).config, name: 'DEV 5' } })
    await ws.flush()
    expect(renamed.slug).toBe('dev-5')
    expect(readdirSync(join(repo.path, 'connections')).sort()).toEqual(['.gitkeep', 'dev-4.json', 'dev-5.json'])
    expect(ws.listQueries().map((q) => [q.path, q.connection])).toEqual([
      ['other.sql', 'dev-4'],
      ['q.sql', 'dev-5']
    ])
    // Same connection id: the local password follows.
    expect(ws.draft(copy.id).secrets).toEqual({ password: 'p' })
    expect(git(remote, 'log', '-1', '--format=%s', 'master').trim()).toBe('Rename connection "DEV 5"')
    // Every change keeps its own commit message, even with syncs running in between.
    expect(git(remote, 'log', '--format=%s', 'master').trim().split('\n')).toEqual([
      'Rename connection "DEV 5"',
      'Add query "O"',
      'Add query "Q"',
      'Add connection "DEV 4 (copy)"',
      'Add connection "DEV 4"',
      'Initialize workspace'
    ])
    expect(git(remote, 'show', '--name-status', '--format=', 'master')).toMatch(/R\d*\s+connections\/dev-4-copy\.json\s+connections\/dev-5\.json/)

    // A name taken by another connection gets a suffix instead of overwriting it.
    const clash = await ws.saveConnection({ ...ws.draft(renamed.id), config: { ...ws.draft(renamed.id).config, name: 'DEV 4' } })
    expect(clash.slug).toBe('dev-4-2')
    // Saving again under the same name keeps the file.
    expect((await ws.saveConnection(ws.draft(clash.id))).slug).toBe('dev-4-2')
  })

  it('refuses query paths escaping the queries folder', async () => {
    const { ws } = manager('alice')
    await ws.create('Local')
    await expect(ws.saveQuery({ path: '../evil.sql', name: 'x', sql: '' })).rejects.toThrow(/Invalid query path/)
  })
})
