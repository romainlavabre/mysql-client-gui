// New versions: checks the GitHub releases, installs one from the app, or
// opens a terminal running install.sh when the app cannot do it itself.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InstallKind, UpdateStatus } from '@shared/types'

const REPO = 'romainlavabre/simone'
const NAME = 'simone'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/master/install.sh`

const FIRST_CHECK_DELAY = 10_000
const CHECK_INTERVAL = 6 * 3600_000

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  /** "sha256:<hex>", given by GitHub. */
  digest?: string | null
}

interface Release {
  tag_name: string
  html_url: string
  assets: ReleaseAsset[]
}

function parseVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : null
}

/** Whether `candidate` is a higher X.Y.Z version than `current`; false when either cannot be read. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** The package of this kind with the highest version, should a release carry more than one (as install.sh does). */
export function pickAsset(assets: ReleaseAsset[], kind: 'deb' | 'appimage'): ReleaseAsset | null {
  const extension = kind === 'deb' ? '.deb' : '.AppImage'
  const versionOf = (asset: ReleaseAsset) => /-(\d+\.\d+\.\d+)-/.exec(asset.name)?.[1] ?? '0.0.0'
  const candidates = assets.filter((asset) => asset.name.endsWith(extension))
  return candidates.reduce<ReleaseAsset | null>((best, asset) => (!best || isNewer(versionOf(asset), versionOf(best)) ? asset : best), null)
}

/** Folder where install.sh unpacks the AppImage. */
export function appImageInstallDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_DATA_HOME || join(homedir(), '.local/share'), NAME, 'app')
}

/** The command a user runs to update by hand. */
export function updateCommand(kind: InstallKind): string {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | bash${kind === 'appimage' ? ' -s -- --appimage' : ''}`
}

/** Terminals tried in order, with the flag after which they take the command and its arguments. */
const TERMINALS: [string, string[]][] = [
  ['gnome-terminal', ['--']],
  ['ptyxis', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['kgx', ['--']],
  ['tilix', ['-e']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['wezterm', ['start', '--']],
  ['foot', []],
  ['xterm', ['-e']],
  ['x-terminal-emulator', ['-e']]
]

/**
 * Arguments that open `terminal` on a shell showing `command` and running it
 * once Enter is pressed, then waiting before closing.
 */
export function terminalArgs(terminal: string, command: string): string[] {
  const flags = TERMINALS.find(([name]) => name === terminal)?.[1] ?? ['-e']
  const script =
    'printf "\\n  %s\\n\\n" "$1"; read -rp "Press Enter to update Simone (Ctrl+C to cancel)… "; bash -c "$1"; echo; read -rp "Press Enter to close. "'
  return [...flags, 'bash', '-c', script, 'simone-update', command]
}

function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name)
  }
  return null
}

function run(command: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? 1, output }))
  })
}

async function detectInstallKind(): Promise<InstallKind> {
  // install.sh unpacks the AppImage, whose AppRun starts the binary next to it.
  if (dirname(process.execPath) === resolve(appImageInstallDir())) return 'appimage'
  if (process.execPath.startsWith('/opt/')) {
    try {
      const { code, output } = await run('dpkg-query', ['-W', '-f=${Status}', NAME])
      if (code === 0 && output.includes('install ok installed')) return 'deb'
    } catch {
      // No dpkg on this system.
    }
  }
  return 'unknown'
}

async function download(asset: ReleaseAsset, target: string): Promise<void> {
  const response = await fetch(asset.browser_download_url)
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} for ${asset.name}`)
  const hash = createHash('sha256')
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), hashing, createWriteStream(target))
  const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null
  if (expected && hash.digest('hex') !== expected) throw new Error(`${asset.name} is corrupted (checksum mismatch)`)
}

export interface UpdaterOptions {
  version: string
  /** Whether updates are looked for at all (not in development). */
  enabled: boolean
  /** install.sh shipped with the app. */
  installScript: string
  emit: (status: UpdateStatus) => void
}

export class Updater {
  private status: UpdateStatus
  private release: Release | null = null

  constructor(private readonly options: UpdaterOptions) {
    this.status = { current: options.version, latest: null, notesUrl: null, kind: 'unknown', state: 'idle', error: null }
  }

  start(): void {
    if (!this.options.enabled) return
    void detectInstallKind().then((kind) => this.set({ kind }))
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY)
    setInterval(() => void this.check(), CHECK_INTERVAL).unref()
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  async check(): Promise<void> {
    if (this.status.state === 'installing' || this.status.state === 'installed') return
    try {
      const response = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } })
      if (!response.ok) return
      const release = (await response.json()) as Release
      if (!isNewer(release.tag_name, this.options.version)) return
      this.release = release
      if (release.tag_name !== this.status.latest) {
        this.set({ latest: release.tag_name, notesUrl: release.html_url, state: 'available', error: null })
      }
    } catch {
      // Offline, or GitHub unreachable: the next check will tell.
    }
  }

  async install(): Promise<void> {
    const { kind } = this.status
    if (!this.release || this.status.state === 'installing') return
    if (kind === 'unknown') throw new Error('This installation cannot update itself: use the terminal')
    const asset = pickAsset(this.release.assets, kind)
    if (!asset) throw new Error(`Release ${this.release.tag_name} has no ${kind === 'deb' ? '.deb' : 'AppImage'} package`)

    this.set({ state: 'installing', error: null })
    const work = mkdtempSync(join(tmpdir(), 'simone-update-'))
    try {
      // apt reads the package as the _apt user.
      chmodSync(work, 0o755)
      const target = join(work, kind === 'deb' ? `${NAME}.deb` : `${NAME}.AppImage`)
      await download(asset, target)
      chmodSync(target, kind === 'deb' ? 0o644 : 0o755)

      let result: { code: number; output: string }
      if (kind === 'deb') {
        // pkexec asks for the password in a system window.
        result = await run('pkexec', ['apt-get', 'install', '-y', '--allow-downgrades', target])
        if (result.code === 126 || result.code === 127) throw new Error('Authentication was cancelled or refused')
      } else {
        // A copy: install.sh replaces the folder the app (and its own copy of the script) runs from.
        const script = join(work, 'install.sh')
        copyFileSync(this.options.installScript, script)
        result = await run('bash', [script, '--appimage', '--file', target])
      }
      if (result.code !== 0) {
        const lastLine = result.output.trim().split('\n').pop() ?? ''
        throw new Error(`The installation failed (exit code ${result.code})${lastLine ? `: ${lastLine}` : ''}`)
      }
      this.set({ state: 'installed' })
    } catch (error) {
      this.set({ state: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  /** Executable to relaunch: the AppImage's AppRun turns the sandbox off where the system forbids it. */
  relaunchPath(): string {
    return this.status.kind === 'appimage' ? join(dirname(process.execPath), 'AppRun') : process.execPath
  }

  /** Opens a terminal ready to run the update; false when no terminal was found. */
  async openTerminal(): Promise<boolean> {
    const command = updateCommand(this.status.kind)
    for (const [name] of TERMINALS) {
      const path = findExecutable(name)
      if (!path) continue
      const started = await new Promise<boolean>((resolvePromise) => {
        const child = spawn(path, terminalArgs(name, command), { detached: true, stdio: 'ignore' })
        child.once('spawn', () => {
          child.unref()
          resolvePromise(true)
        })
        child.once('error', () => resolvePromise(false))
      })
      if (started) return true
    }
    return false
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.options.emit(this.status)
  }
}
