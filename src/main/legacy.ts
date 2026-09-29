// The app was called "MySQL Client GUI" (data in ~/.config/mysql-client-gui)
// until 1.0.0. Its data folder is moved once to the new one.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

export const LEGACY_NAME = 'mysql-client-gui'

/** Files of the app itself: when one exists in the new folder, it has been used already. */
const OWN_FILES = ['workspaces.json', 'secrets.json']

/**
 * Moves the content of the former data folder to `dataDir` when the app has
 * not stored anything there yet, and points the registered workspaces cloned
 * inside it at their new place. Electron may already have created a few
 * entries of its own in `dataDir` (Crashpad…): those are kept and the former
 * copies dropped. Passwords stay stored but must be typed again: the keyring
 * key belongs to the former name. Returns whether something was moved.
 */
export function migrateLegacyDataDir(legacyDir: string, dataDir: string): boolean {
  if (!existsSync(legacyDir) || OWN_FILES.some((file) => existsSync(join(dataDir, file)))) return false
  mkdirSync(dataDir, { recursive: true })
  for (const entry of readdirSync(legacyDir)) {
    if (!existsSync(join(dataDir, entry))) renameSync(join(legacyDir, entry), join(dataDir, entry))
  }
  rmSync(legacyDir, { recursive: true, force: true })

  const registry = join(dataDir, 'workspaces.json')
  if (existsSync(registry)) {
    try {
      const state = JSON.parse(readFileSync(registry, 'utf8')) as { repos?: { path?: string }[] }
      for (const repo of state.repos ?? []) {
        if (repo.path?.startsWith(legacyDir + sep)) repo.path = dataDir + repo.path.slice(legacyDir.length)
      }
      writeFileSync(registry, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    } catch (error) {
      console.warn(`Cannot update the workspace paths after moving ${legacyDir}: ${(error as Error).message}`)
    }
  }
  return true
}
