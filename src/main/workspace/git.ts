// Git operations on a workspace repository, through the system git binary so
// the user's SSH config, agent and credential helpers apply.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import type { ConflictChoice } from '@shared/types'

export const REMOTE = 'origin'
/** Workspaces always live on this branch, whatever the remote's default branch. */
export const BRANCH = 'master'

export interface GitStatus {
  isGitRepo: boolean
  hasRemote: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
}

/**
 * The user's own environment is trusted (askpass helpers, SSH command, git
 * config paths): simple-git blocks these by default because they are unsafe
 * with untrusted input, which environment variables are not here.
 */
const TRUSTED_ENVIRONMENT = {
  allowUnsafeAskPass: true,
  allowUnsafeConfigEnvCount: true,
  allowUnsafeConfigPaths: true,
  allowUnsafeEditor: true,
  allowUnsafePager: true,
  allowUnsafeSshCommand: true
}

function gitEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    // Never hang on an interactive prompt: the app has no terminal.
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes'
  }
}

function git(dir?: string): SimpleGit {
  const env = gitEnv()
  const guarded = Object.keys(env).filter((key) => /^(GIT_|EDITOR$|VISUAL$|PAGER$|SSH_ASKPASS$|PREFIX$)/.test(key))
  return simpleGit({
    baseDir: dir,
    timeout: { block: 60_000 },
    unsafe: TRUSTED_ENVIRONMENT,
    allowEnvironment: guarded
  }).env(env)
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

/** Identity used when the user has no git identity configured. */
async function identityArgs(repo: SimpleGit): Promise<string[]> {
  const name = (await repo.raw(['config', '--get', 'user.name']).catch(() => '')).trim()
  const email = (await repo.raw(['config', '--get', 'user.email']).catch(() => '')).trim()
  const args: string[] = []
  if (!name) args.push('-c', 'user.name=Simone')
  if (!email) args.push('-c', 'user.email=simone@localhost')
  return args
}

export async function init(dir: string): Promise<void> {
  await git(dir).raw(['init', `--initial-branch=${BRANCH}`])
}

export async function clone(remoteUrl: string, dir: string): Promise<void> {
  await git().clone(remoteUrl, dir)
  await ensureBranch(dir)
}

/**
 * Puts the repository on BRANCH: switches to it when it exists, otherwise
 * renames the current branch (e.g. `main` from a GitHub default), which
 * keeps local commits; they are rebased on origin/master at the next sync.
 */
export async function ensureBranch(dir: string): Promise<void> {
  if (!isGitRepo(dir)) return
  const repo = git(dir)
  const current = (await repo.raw(['symbolic-ref', '--short', 'HEAD']).catch(() => '')).trim()
  if (current === BRANCH) return
  const hasCommits = await repo
    .raw(['rev-parse', '--verify', '--quiet', 'HEAD'])
    .then(() => true)
    .catch(() => false)
  if (!hasCommits) {
    // Unborn branch (empty repository): just point HEAD at BRANCH.
    await repo.raw(['symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`])
    return
  }
  const localExists = (await repo.raw(['branch', '--list', BRANCH])).trim().length > 0
  if (localExists) {
    await repo.raw(['checkout', BRANCH])
    return
  }
  await repo.raw(['branch', '-m', BRANCH])
  // The renamed branch still tracks the old remote branch: drop it, sync sets origin/master.
  await repo.raw(['branch', '--unset-upstream', BRANCH]).catch(() => undefined)
}

export async function setRemote(dir: string, remoteUrl: string): Promise<void> {
  const repo = git(dir)
  const remotes = await repo.getRemotes()
  if (remotes.some((r) => r.name === REMOTE)) await repo.remote(['set-url', REMOTE, remoteUrl])
  else await repo.addRemote(REMOTE, remoteUrl)
}

export async function remoteUrl(dir: string): Promise<string | undefined> {
  const remotes = await git(dir).getRemotes(true)
  return remotes.find((r) => r.name === REMOTE)?.refs.fetch || undefined
}

/** Stages the given paths (including deletions) and commits them if anything changed. */
export async function commit(dir: string, paths: string[], message: string): Promise<boolean> {
  if (!isGitRepo(dir)) return false
  const repo = git(dir)
  await repo.raw(['add', '-A', '--', ...paths])
  const staged = (await repo.raw(['diff', '--cached', '--name-only'])).trim()
  if (!staged) return false
  await repo.raw([...(await identityArgs(repo)), 'commit', '-m', message])
  return true
}

export async function status(dir: string): Promise<GitStatus> {
  if (!isGitRepo(dir)) {
    return { isGitRepo: false, hasRemote: false, branch: null, ahead: 0, behind: 0, dirty: false }
  }
  const repo = git(dir)
  const [st, remotes] = await Promise.all([repo.status(), repo.getRemotes()])
  const hasRemote = remotes.some((r) => r.name === REMOTE)
  let ahead = st.ahead
  // Without upstream, count the commits not on the remote branch yet (or all of them).
  if (hasRemote && !st.tracking && st.current) {
    const remoteRef = `${REMOTE}/${st.current}`
    const hasRemoteBranch = (await repo.raw(['branch', '-r', '--list', remoteRef])).trim().length > 0
    const range = hasRemoteBranch ? `${remoteRef}..HEAD` : 'HEAD'
    ahead = Number((await repo.raw(['rev-list', '--count', range]).catch(() => '0')).trim()) || 0
  }
  return {
    isGitRepo: true,
    hasRemote,
    branch: st.current,
    ahead,
    behind: st.behind,
    dirty: !st.isClean()
  }
}

export interface SyncOutcome {
  conflicts: string[]
}

/**
 * Commits stray local edits, rebases on the remote branch and pushes.
 * On conflict the rebase is aborted and the conflicting files are returned,
 * leaving the repository as it was before the sync.
 */
export async function sync(dir: string): Promise<SyncOutcome> {
  const repo = git(dir)
  await ensureBranch(dir)
  const st = await status(dir)
  if (st.dirty) await commit(dir, ['.'], 'Update workspace')
  if (!st.hasRemote || !st.branch) return { conflicts: [] }

  await repo.fetch(REMOTE, { '--prune': null })
  const remoteRef = `${REMOTE}/${st.branch}`
  const hasRemoteBranch = (await repo.raw(['branch', '-r', '--list', remoteRef])).trim().length > 0

  if (hasRemoteBranch) {
    const tracking = (await repo.status()).tracking
    if (!tracking) await repo.raw(['branch', `--set-upstream-to=${remoteRef}`, st.branch])
    const behind = Number((await repo.raw(['rev-list', '--count', `HEAD..${remoteRef}`])).trim())
    if (behind > 0) {
      try {
        await repo.raw([...(await identityArgs(repo)), 'rebase', remoteRef])
      } catch (error) {
        const conflicts = (await repo.status()).conflicted
        await repo.raw(['rebase', '--abort']).catch(() => undefined)
        if (conflicts.length === 0) throw error
        return { conflicts }
      }
    }
    const ahead = Number((await repo.raw(['rev-list', '--count', `${remoteRef}..HEAD`])).trim())
    if (ahead > 0) await repo.push(REMOTE, st.branch)
  } else {
    await repo.push(['-u', REMOTE, st.branch])
  }
  return { conflicts: [] }
}

/** Merges the remote branch, resolving each conflicting file with the given side, then pushes. */
export async function resolveConflicts(dir: string, choices: Record<string, ConflictChoice>): Promise<SyncOutcome> {
  const repo = git(dir)
  await ensureBranch(dir)
  const st = await status(dir)
  if (!st.branch) throw new Error('No current branch')
  const remoteRef = `${REMOTE}/${st.branch}`
  const identity = await identityArgs(repo)
  try {
    await repo.raw([...identity, 'merge', '--no-ff', '--no-commit', remoteRef])
  } catch {
    // Conflicts are expected here.
  }
  const conflicted = (await repo.status()).conflicted
  const missing = conflicted.filter((file) => !choices[file])
  if (missing.length > 0) {
    await repo.raw(['merge', '--abort']).catch(() => undefined)
    return { conflicts: conflicted }
  }
  for (const file of conflicted) {
    const side = choices[file] === 'mine' ? '--ours' : '--theirs'
    try {
      await repo.raw(['checkout', side, '--', file])
      await repo.raw(['add', '--', file])
    } catch {
      // The chosen side deleted the file.
      await repo.raw(['rm', '--quiet', '--', file])
    }
  }
  await repo.raw(['add', '-A'])
  await repo.raw([...identity, 'commit', '--no-edit', '-m', 'Merge remote workspace changes'])
  await repo.push(REMOTE, st.branch)
  return { conflicts: [] }
}
