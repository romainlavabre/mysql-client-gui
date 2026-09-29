import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyDataDir } from '../../src/main/legacy'
import { ensureLayout } from '../../src/main/workspace/layout'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'simone-legacy-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('former name', () => {
  it('moves the former data folder and the workspaces cloned inside it', () => {
    const legacy = join(root, 'mysql-client-gui')
    const target = join(root, 'simone')
    mkdirSync(join(legacy, 'workspaces', 'team'), { recursive: true })
    writeFileSync(join(legacy, 'secrets.json'), '{"secrets":{},"overrides":{}}')
    writeFileSync(
      join(legacy, 'workspaces.json'),
      JSON.stringify({
        repos: [
          { id: 'a', name: 'team', path: join(legacy, 'workspaces', 'team') },
          { id: 'b', name: 'elsewhere', path: '/srv/repos/elsewhere' }
        ],
        activeRepoId: 'a'
      })
    )

    expect(migrateLegacyDataDir(legacy, target)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(join(target, 'secrets.json'))).toBe(true)
    expect(existsSync(join(target, 'workspaces', 'team'))).toBe(true)
    const state = JSON.parse(readFileSync(join(target, 'workspaces.json'), 'utf8'))
    expect(state.repos.map((r: { path: string }) => r.path)).toEqual([join(target, 'workspaces', 'team'), '/srv/repos/elsewhere'])
    expect(state.activeRepoId).toBe('a')

    // Done once: nothing to move any more.
    expect(migrateLegacyDataDir(legacy, target)).toBe(false)
  })

  it('moves into a folder Electron has already started', () => {
    const legacy = join(root, 'mysql-client-gui')
    const target = join(root, 'simone')
    mkdirSync(join(legacy, 'Crashpad'), { recursive: true })
    writeFileSync(join(legacy, 'history.json'), '[1]')
    writeFileSync(join(legacy, 'Crashpad', 'old'), '')
    mkdirSync(join(target, 'Crashpad'), { recursive: true })
    expect(migrateLegacyDataDir(legacy, target)).toBe(true)
    expect(readFileSync(join(target, 'history.json'), 'utf8')).toBe('[1]')
    expect(existsSync(join(target, 'Crashpad', 'old'))).toBe(false) // Electron's own copy is kept
    expect(existsSync(legacy)).toBe(false)
  })

  it('never overwrites the data of the app under its new name', () => {
    const legacy = join(root, 'mysql-client-gui')
    const target = join(root, 'simone')
    mkdirSync(legacy)
    mkdirSync(target)
    writeFileSync(join(target, 'workspaces.json'), '{"repos":[]}')
    expect(migrateLegacyDataDir(legacy, target)).toBe(false)
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(join(target, 'workspaces.json'), 'utf8')).toBe('{"repos":[]}')
  })

  it('keeps the former workspace file of a shared repository', () => {
    const repo = join(root, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'mysql-client.json'), '{"name":"team","formatVersion":1}\n')
    expect(ensureLayout(repo, 'team')).not.toContain('simone.json')
    expect(existsSync(join(repo, 'simone.json'))).toBe(false)
    // A new workspace gets the new file.
    const fresh = join(root, 'fresh')
    expect(ensureLayout(fresh, 'fresh')).toContain('simone.json')
  })
})
