// SSH tunnels through the system `ssh` binary, so ~/.ssh/config (aliases,
// ProxyJump, IdentityFile...), the agent and known_hosts all apply.
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshTunnelConfig } from '@shared/types'

export interface Tunnel {
  localPort: number
  close(): void
}

const READY_TIMEOUT_MS = 20_000

export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No free port'))))
    })
  })
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** Script handing the secret from the environment to ssh, which runs it instead of prompting. */
function askPassScript(dataDir: string): string {
  const path = join(dataDir, 'ssh-askpass.sh')
  if (!existsSync(path)) {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path, '#!/bin/sh\nprintf "%s\\n" "$SIMONE_SSH_SECRET"\n')
    chmodSync(path, 0o700)
  }
  return path
}

export function sshArgs(config: SshTunnelConfig, localPort: number, targetHost: string, targetPort: number, interactive: boolean): string[] {
  const args = [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    '-o', `BatchMode=${interactive ? 'no' : 'yes'}`,
    '-L', `127.0.0.1:${localPort}:${targetHost}:${targetPort}`
  ]
  if (config.port && config.port !== 22) args.push('-p', String(config.port))
  if (config.user) args.push('-l', config.user)
  if (config.auth === 'keyFile' && config.keyPath) args.push('-i', expandHome(config.keyPath), '-o', 'IdentitiesOnly=yes')
  if (config.auth === 'password') args.push('-o', 'PreferredAuthentications=keyboard-interactive,password', '-o', 'PubkeyAuthentication=no')
  args.push('--', config.host)
  return args
}

export async function openTunnel(
  config: SshTunnelConfig,
  targetHost: string,
  targetPort: number,
  secret: string | undefined,
  dataDir: string
): Promise<Tunnel> {
  if (!config.host.trim()) throw new Error('SSH tunnel: the SSH host is required')
  const localPort = await freePort()
  const interactive = !!secret
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (interactive) {
    env.SSH_ASKPASS = askPassScript(dataDir)
    env.SSH_ASKPASS_REQUIRE = 'force'
    env.DISPLAY = env.DISPLAY || ':0'
    env.SIMONE_SSH_SECRET = secret
  }
  const child: ChildProcess = spawn('ssh', sshArgs(config, localPort, targetHost, targetPort, interactive), {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    // No controlling terminal, so ssh uses SSH_ASKPASS rather than /dev/tty.
    detached: true
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  let exited = false
  let spawnError: Error | null = null
  child.once('exit', () => {
    exited = true
  })
  child.once('error', (error) => {
    spawnError = error
    exited = true
  })

  const close = (): void => {
    if (!exited) child.kill('SIGTERM')
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exited) {
      const reason = spawnError ? (spawnError as Error).message : stderr.trim().split('\n').slice(-2).join(' ')
      throw new Error(`SSH tunnel failed: ${reason || 'ssh exited'}`)
    }
    if (await canConnect(localPort)) return { localPort, close }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  close()
  throw new Error(`SSH tunnel failed: no answer from ${config.host} after ${READY_TIMEOUT_MS / 1000}s`)
}
