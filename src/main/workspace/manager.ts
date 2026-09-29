// Registry of workspace repositories and everything stored in the active one:
// connections and saved queries. Every change is committed, then pushed in the background.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ConflictChoice,
  ConnectionConfig,
  ConnectionDraft,
  SavedQuery,
  SyncStatus,
  WorkspaceRepo,
  WorkspaceState
} from '@shared/types'
import { JsonStore } from '../jsonStore'
import type { SecretStore } from '../secrets'
import * as gitOps from './git'
import * as layout from './layout'

export interface WorkspaceEvents {
  status(status: SyncStatus): void
  changed(state: WorkspaceState): void
}

/** Delay before pushing after a change, so quick successive saves make one push. */
const PUSH_DELAY_MS = 1500

export class WorkspaceManager {
  private readonly registry: JsonStore<WorkspaceState>
  private readonly statuses = new Map<string, SyncStatus>()
  /** Per-repo queue so git commands never overlap. */
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly pushTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    registryFile: string,
    private readonly workspacesDir: string,
    private readonly secrets: SecretStore,
    private readonly events: WorkspaceEvents,
    private readonly pushDelayMs = PUSH_DELAY_MS
  ) {
    this.registry = new JsonStore<WorkspaceState>(registryFile, () => ({ repos: [], activeRepoId: null }))
  }

  // ------------------------------------------------------------- registry

  state(): WorkspaceState {
    return this.registry.read()
  }

  private repo(repoId: string): WorkspaceRepo {
    const repo = this.state().repos.find((r) => r.id === repoId)
    if (!repo) throw new Error('Unknown workspace')
    return repo
  }

  active(): WorkspaceRepo {
    const { activeRepoId } = this.state()
    if (!activeRepoId) throw new Error('No workspace selected: add or select a workspace first')
    return this.repo(activeRepoId)
  }

  defaultClonePath(name: string): string {
    const base = join(this.workspacesDir, layout.slugify(name))
    let path = base
    for (let n = 2; existsSync(path); n++) path = `${base}-${n}`
    return path
  }

  private register(repo: WorkspaceRepo): WorkspaceRepo {
    const state = this.registry.update((s) => {
      if (s.repos.some((r) => resolve(r.path) === resolve(repo.path))) {
        throw new Error(`This folder is already registered as a workspace: ${repo.path}`)
      }
      s.repos.push(repo)
      s.activeRepoId = repo.id
    })
    this.events.changed(state)
    return repo
  }

  async clone(name: string, remoteUrl: string, path?: string): Promise<WorkspaceRepo> {
    const target = resolve(path || this.defaultClonePath(name))
    if (existsSync(target) && readdirSync(target).length > 0) throw new Error(`The folder is not empty: ${target}`)
    await gitOps.clone(remoteUrl, target)
    const repo = this.register({ id: randomUUID(), name, path: target, remoteUrl })
    await this.initialize(repo)
    return repo
  }

  async open(name: string, path: string): Promise<WorkspaceRepo> {
    const target = resolve(path)
    const repo = this.register({
      id: randomUUID(),
      name,
      path: target,
      remoteUrl: gitOps.isGitRepo(target) ? await gitOps.remoteUrl(target) : undefined
    })
    await this.initialize(repo)
    return repo
  }

  async create(name: string, path?: string): Promise<WorkspaceRepo> {
    const target = resolve(path || this.defaultClonePath(name))
    if (existsSync(target) && readdirSync(target).length > 0) throw new Error(`The folder is not empty: ${target}`)
    layout.ensureLayout(target, name)
    await gitOps.init(target)
    const repo = this.register({ id: randomUUID(), name, path: target })
    await this.initialize(repo)
    return repo
  }

  /** Creates the layout files when missing and commits them. */
  private async initialize(repo: WorkspaceRepo): Promise<void> {
    await this.enqueue(repo.id, async () => {
      layout.ensureLayout(repo.path, repo.name)
      await gitOps.ensureBranch(repo.path)
      await gitOps.commit(repo.path, ['.'], 'Initialize workspace')
    })
    this.schedulePush(repo.id, 0)
  }

  rename(repoId: string, name: string): WorkspaceState {
    const state = this.registry.update((s) => {
      const repo = s.repos.find((r) => r.id === repoId)
      if (repo) repo.name = name
    })
    this.events.changed(state)
    return state
  }

  remove(repoId: string, deleteFiles: boolean): WorkspaceState {
    const repo = this.repo(repoId)
    const state = this.registry.update((s) => {
      s.repos = s.repos.filter((r) => r.id !== repoId)
      if (s.activeRepoId === repoId) s.activeRepoId = s.repos[0]?.id ?? null
    })
    this.secrets.forget(repoId)
    this.statuses.delete(repoId)
    // Only folders created by the app are deleted; a folder the user opened is left alone.
    if (deleteFiles && resolve(repo.path).startsWith(resolve(this.workspacesDir) + sep)) {
      rmSync(repo.path, { recursive: true, force: true })
    }
    this.events.changed(state)
    return state
  }

  async activate(repoId: string): Promise<WorkspaceState> {
    this.repo(repoId)
    const state = this.registry.update((s) => {
      s.activeRepoId = repoId
    })
    this.events.changed(state)
    // Fetch the colleagues' changes; failures only show in the status badge.
    await this.sync(repoId).catch(() => undefined)
    return this.state()
  }

  async setRemote(repoId: string, remoteUrl: string): Promise<WorkspaceRepo> {
    const repo = this.repo(repoId)
    await this.enqueue(repoId, async () => {
      if (!gitOps.isGitRepo(repo.path)) {
        await gitOps.init(repo.path)
        await gitOps.commit(repo.path, ['.'], 'Initialize workspace')
      }
      await gitOps.setRemote(repo.path, remoteUrl)
    })
    this.registry.update((s) => {
      const target = s.repos.find((r) => r.id === repoId)
      if (target) target.remoteUrl = remoteUrl
    })
    this.events.changed(this.state())
    this.schedulePush(repoId, 0)
    return this.repo(repoId)
  }

  // ------------------------------------------------------------------ sync

  private enqueue<T>(repoId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repoId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    this.queues.set(repoId, next)
    return next
  }

  private publish(repoId: string, patch: Partial<SyncStatus>): SyncStatus {
    const current: SyncStatus = this.statuses.get(repoId) ?? {
      repoId,
      isGitRepo: false,
      hasRemote: false,
      branch: null,
      ahead: 0,
      behind: 0,
      dirty: false,
      syncing: false,
      conflicts: [],
      lastSyncAt: null,
      error: null
    }
    const next = { ...current, ...patch, repoId }
    this.statuses.set(repoId, next)
    this.events.status(next)
    return next
  }

  async status(repoId: string): Promise<SyncStatus> {
    const repo = this.repo(repoId)
    const st = await this.enqueue(repoId, () => gitOps.status(repo.path))
    return this.publish(repoId, st)
  }

  async sync(repoId: string): Promise<SyncStatus> {
    const repo = this.repo(repoId)
    this.publish(repoId, { syncing: true })
    try {
      const outcome = await this.enqueue(repoId, () => gitOps.sync(repo.path))
      const st = await this.enqueue(repoId, () => gitOps.status(repo.path))
      return this.publish(repoId, { ...st, syncing: false, conflicts: outcome.conflicts, lastSyncAt: Date.now(), error: null })
    } catch (error) {
      const st = await gitOps.status(repo.path).catch(() => ({}))
      return this.publish(repoId, { ...st, syncing: false, error: gitErrorMessage(error) })
    }
  }

  async resolveConflicts(repoId: string, choices: Record<string, ConflictChoice>): Promise<SyncStatus> {
    const repo = this.repo(repoId)
    this.publish(repoId, { syncing: true })
    try {
      const outcome = await this.enqueue(repoId, () => gitOps.resolveConflicts(repo.path, choices))
      const st = await this.enqueue(repoId, () => gitOps.status(repo.path))
      return this.publish(repoId, { ...st, syncing: false, conflicts: outcome.conflicts, lastSyncAt: Date.now(), error: null })
    } catch (error) {
      return this.publish(repoId, { syncing: false, error: gitErrorMessage(error) })
    }
  }

  private schedulePush(repoId: string, delay = this.pushDelayMs): void {
    clearTimeout(this.pushTimers.get(repoId))
    this.pushTimers.set(
      repoId,
      setTimeout(() => {
        this.pushTimers.delete(repoId)
        void this.sync(repoId)
      }, delay)
    )
  }

  /** Waits for pending pushes (used by tests and on quit). */
  async flush(): Promise<void> {
    const pending = [...this.pushTimers.keys()]
    for (const repoId of pending) {
      clearTimeout(this.pushTimers.get(repoId))
      this.pushTimers.delete(repoId)
    }
    await Promise.all(pending.map((repoId) => this.sync(repoId)))
    await Promise.all([...this.queues.values()].map((p) => p.catch(() => undefined)))
  }

  /**
   * Writes files and commits them as one step of the repo queue: a sync
   * queued in between would otherwise commit them under a generic message,
   * or pull while the files are half written.
   */
  private async change<T>(repo: WorkspaceRepo, apply: () => { result: T; paths: string[]; message: string }): Promise<T> {
    const result = await this.enqueue(repo.id, async () => {
      const { result, paths, message } = apply()
      await gitOps.commit(repo.path, paths, message)
      return result
    })
    this.schedulePush(repo.id)
    return result
  }

  // ----------------------------------------------------------- connections

  listConnections(): ConnectionConfig[] {
    return layout.listConnections(this.active().path)
  }

  connection(connectionId: string): ConnectionConfig {
    const found = this.listConnections().find((c) => c.id === connectionId)
    if (!found) throw new Error('Connection not found')
    return found
  }

  draft(connectionId: string): ConnectionDraft {
    const repo = this.active()
    const { secrets, unreadable } = this.secrets.readSecrets(repo.id, connectionId)
    return {
      config: this.connection(connectionId),
      secrets,
      secretsUnreadable: unreadable,
      override: this.secrets.getOverride(repo.id, connectionId)
    }
  }

  /** Connection with local overrides applied, plus its secrets: what is needed to connect. */
  resolved(connectionId: string): ConnectionDraft {
    const draft = this.draft(connectionId)
    return { ...draft, config: { ...draft.config, user: draft.override.user || draft.config.user } }
  }

  async saveConnection(draft: ConnectionDraft): Promise<ConnectionConfig> {
    const repo = this.active()
    const saved = await this.change(repo, () => {
      const isNew = !draft.config.id || !this.listConnections().some((c) => c.id === draft.config.id)
      const config = { ...draft.config, id: draft.config.id || randomUUID() }
      const { config: written, paths, renamedFrom } = layout.writeConnection(repo.path, config)
      // Queries bound to the old file name follow the rename.
      if (renamedFrom) paths.push(...layout.rebindQueries(repo.path, renamedFrom, written.slug))
      const verb = isNew ? 'Add' : renamedFrom ? 'Rename' : 'Update'
      return { result: written, paths, message: `${verb} connection "${written.name}"` }
    })
    this.secrets.setSecrets(repo.id, saved.id, draft.secrets)
    this.secrets.setOverride(repo.id, saved.id, draft.override)
    return saved
  }

  async removeConnection(connectionId: string): Promise<void> {
    const repo = this.active()
    await this.change(repo, () => {
      const { config, paths } = layout.deleteConnection(repo.path, connectionId)
      return { result: undefined, paths, message: `Remove connection "${config.name}"` }
    })
    this.secrets.forget(repo.id, connectionId)
  }

  async duplicateConnection(connectionId: string): Promise<ConnectionConfig> {
    const draft = this.draft(connectionId)
    return this.saveConnection({
      ...draft,
      config: { ...draft.config, id: randomUUID(), slug: '', name: `${draft.config.name} (copy)` }
    })
  }

  // --------------------------------------------------------- saved queries

  listQueries(): SavedQuery[] {
    return layout.listQueries(this.active().path)
  }

  async saveQuery(query: SavedQuery, previousPath?: string): Promise<SavedQuery> {
    const repo = this.active()
    return this.change(repo, () => {
      const existed = existsSync(layout.queryFile(repo.path, previousPath ?? query.path))
      const { query: saved, paths } = layout.writeQuery(repo.path, query, previousPath)
      const verb = !existed ? 'Add' : previousPath && previousPath !== query.path ? 'Move' : 'Update'
      return { result: saved, paths, message: `${verb} query "${saved.name}"` }
    })
  }

  async removeQuery(path: string): Promise<void> {
    const repo = this.active()
    await this.change(repo, () => ({ result: undefined, paths: layout.deleteQuery(repo.path, path), message: `Remove query "${path}"` }))
  }
}

function gitErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Permission denied \(publickey/.test(message)) {
    return 'Git authentication failed: check that your SSH key is loaded in the agent (ssh-add).'
  }
  if (/could not read Username|terminal prompts disabled/.test(message)) {
    return 'Git authentication failed: configure a credential helper or use an SSH remote URL.'
  }
  return message.trim().split('\n').slice(-3).join('\n')
}
