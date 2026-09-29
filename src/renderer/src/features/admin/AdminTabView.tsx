// Server administration: processes, variables, status, users and privileges.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { KeyRound, Plus, RefreshCw, Search, ShieldCheck, Skull, Trash2, XOctagon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { PrivilegeLevel, PrivilegeSet, UserAccount } from '@shared/types'
import { PRIVILEGES_BY_LEVEL, privilegeChangesSql, privilegesForLevel } from '@shared/sql/admin'
import { api, errorMessage } from '../../lib/bridge'
import { runStatements } from '../../lib/actions'
import { confirm, prompt, toast } from '../../components/feedback'
import { Button, Checkbox, Dialog, ErrorBox, Field, IconButton, Input, SegmentedControl, Select, Spinner } from '../../components/ui'
import { updateTab, useApp, type AdminTab } from '../../store'
import { quoteString } from '@shared/sql/quote'

export function AdminTabView({ tab }: { tab: AdminTab }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
        <span className="text-[13px] font-semibold">Server</span>
        <SegmentedControl<AdminTab['section']>
          value={tab.section}
          onChange={(section) => updateTab<AdminTab>(tab.id, { section })}
          options={[
            { value: 'processes', label: 'Processes' },
            { value: 'variables', label: 'Variables' },
            { value: 'status', label: 'Status' },
            { value: 'users', label: 'Users & privileges' }
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab.section === 'processes' && <Processes />}
        {tab.section === 'variables' && <Variables />}
        {tab.section === 'status' && <Status />}
        {tab.section === 'users' && <Users />}
      </div>
    </div>
  )
}

function useSessionId(): string {
  return useApp((s) => s.session!.info.sessionId)
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted" />
      <Input className="h-8 pl-7" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

const th = 'sticky top-0 border-b border-border bg-panel px-3 py-1.5 text-left font-semibold text-muted'
const td = 'selectable border-b border-border/60 px-3 py-1'

function Processes() {
  const sessionId = useSessionId()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [hideSleep, setHideSleep] = useState(true)
  const [full, setFull] = useState(false)
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['processes', sessionId, full],
    queryFn: () => api.admin.processes({ sessionId, full }),
    refetchInterval: autoRefresh ? 2000 : false,
    staleTime: 0
  })
  const processes = (data ?? []).filter((p) => !hideSleep || p.command !== 'Sleep')

  const kill = async (id: number, queryOnly: boolean): Promise<void> => {
    const ok = await confirm({
      title: queryOnly ? `Kill query of process ${id}` : `Kill connection ${id}`,
      body: queryOnly ? 'The running statement is interrupted; the connection stays open.' : 'The client connection is closed.',
      confirmLabel: 'Kill',
      danger: true
    })
    if (!ok) return
    try {
      await api.admin.kill({ sessionId, id, queryOnly })
      void refetch()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b border-border px-3 text-xs">
        <Checkbox checked={autoRefresh} onChange={setAutoRefresh} label="Auto refresh" />
        <Checkbox checked={hideSleep} onChange={setHideSleep} label="Hide sleeping" />
        <Checkbox checked={full} onChange={setFull} label="Full queries" />
        <IconButton label="Refresh" onClick={() => void refetch()}>
          <RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} />
        </IconButton>
        <span className="text-muted">{processes.length} process(es)</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <ErrorBox>{errorMessage(error)}</ErrorBox>}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {['Id', 'User', 'Host', 'Database', 'Command', 'Time', 'State', 'Query', ''].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processes.map((p) => (
              <tr key={p.id} className="hover:bg-hover">
                <td className={`${td} font-mono`}>{p.id}</td>
                <td className={td}>{p.user}</td>
                <td className={td}>{p.host}</td>
                <td className={td}>{p.db}</td>
                <td className={td}>{p.command}</td>
                <td className={clsx(td, 'text-right font-mono', p.time > 30 && p.command !== 'Sleep' && 'text-warning')}>{p.time}s</td>
                <td className={td}>{p.state}</td>
                <td className={`${td} max-w-xl truncate font-mono`} title={p.info ?? ''}>
                  {p.info}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <IconButton label="Kill query" className="size-6" onClick={() => void kill(p.id, true)}>
                    <XOctagon className="size-3.5" />
                  </IconButton>
                  <IconButton label="Kill connection" className="size-6 hover:text-danger" onClick={() => void kill(p.id, false)}>
                    <Skull className="size-3.5" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NameValueTable({ rows, onEdit }: { rows: { name: string; value: string }[]; onEdit?: (name: string, value: string) => void }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className={th}>Name</th>
          <th className={th}>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className={clsx('hover:bg-hover', onEdit && 'cursor-pointer')} onDoubleClick={() => onEdit?.(r.name, r.value)}>
            <td className={`${td} font-mono`}>{r.name}</td>
            <td className={`${td} max-w-3xl break-all font-mono`}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Variables() {
  const sessionId = useSessionId()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<'GLOBAL' | 'SESSION'>('GLOBAL')
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['variables', sessionId, scope], queryFn: () => api.admin.variables({ sessionId, scope }) })
  const rows = useMemo(() => (data ?? []).filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase())), [data, search])

  const edit = async (name: string, value: string): Promise<void> => {
    const next = await prompt({ title: `SET ${scope} ${name}`, label: 'New value', initial: value, confirmLabel: 'Set' })
    if (next === null || next === value) return
    const literal = /^-?\d+(\.\d+)?$/.test(next) || /^(ON|OFF|DEFAULT)$/i.test(next) ? next : quoteString(next)
    // Session variables would be set on a pooled connection, which is meaningless: only GLOBAL is editable.
    const done = await runStatements([`SET GLOBAL ${name} = ${literal}`], null, undefined, { force: true, success: `${name} updated` })
    if (done) void queryClient.invalidateQueries({ queryKey: ['variables', sessionId] })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3 text-xs">
        <SegmentedControl<'GLOBAL' | 'SESSION'>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'GLOBAL', label: 'Global' },
            { value: 'SESSION', label: 'Session' }
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Filter variables" />
        {scope === 'GLOBAL' && <span className="text-muted">Double-click a value to change it.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? <Spinner className="m-6" /> : <NameValueTable rows={rows} onEdit={scope === 'GLOBAL' ? (n, v) => void edit(n, v) : undefined} />}
      </div>
    </div>
  )
}

function Status() {
  const sessionId = useSessionId()
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['status', sessionId],
    queryFn: () => api.admin.status({ sessionId }),
    refetchInterval: autoRefresh ? 3000 : false,
    staleTime: 0
  })
  const rows = useMemo(() => (data ?? []).filter((v) => !search || v.name.toLowerCase().includes(search.toLowerCase())), [data, search])
  const get = (name: string): number => Number(data?.find((v) => v.name === name)?.value ?? 0)
  const uptime = get('Uptime')

  return (
    <div className="flex h-full flex-col">
      {data && (
        <div className="grid shrink-0 grid-cols-5 gap-3 border-b border-border p-3">
          {[
            ['Uptime', `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`],
            ['Connections', `${get('Threads_connected')} / max used ${get('Max_used_connections')}`],
            ['Running threads', String(get('Threads_running'))],
            ['Queries / s', uptime ? (get('Questions') / uptime).toFixed(1) : '—'],
            ['Slow queries', String(get('Slow_queries'))]
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-panel p-3">
              <div className="text-[11px] text-muted">{label}</div>
              <div className="mt-1 font-mono text-sm">{value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3 text-xs">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter status variables" />
        <Checkbox checked={autoRefresh} onChange={setAutoRefresh} label="Auto refresh" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{isLoading ? <Spinner className="m-6" /> : <NameValueTable rows={rows} />}</div>
    </div>
  )
}

function Users() {
  const sessionId = useSessionId()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<UserAccount | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingPrivileges, setEditingPrivileges] = useState(false)
  const { data: users, error, isLoading } = useQuery({ queryKey: ['users', sessionId], queryFn: () => api.admin.users({ sessionId }) })
  const { data: grants, refetch: refetchGrants } = useQuery({
    queryKey: ['grants', sessionId, selected?.user, selected?.host],
    queryFn: () => api.admin.grants({ sessionId, user: selected!.user, host: selected!.host }),
    enabled: !!selected,
    staleTime: 0
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users', sessionId] })
    void refetchGrants()
  }

  const setPassword = async (): Promise<void> => {
    if (!selected) return
    const password = await prompt({ title: `Password of ${selected.user}@${selected.host}`, label: 'New password', confirmLabel: 'Change' })
    if (password === null) return
    try {
      await api.admin.setPassword({ sessionId, user: selected.user, host: selected.host, password })
      toast('Password changed', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const drop = async (): Promise<void> => {
    if (!selected) return
    const ok = await confirm({ title: `Drop user ${selected.user}@${selected.host}`, body: 'The account and its privileges are deleted.', confirmLabel: 'Drop', danger: true })
    if (!ok) return
    try {
      await api.admin.dropUser({ sessionId, user: selected.user, host: selected.host })
      setSelected(null)
      refresh()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="text-xs text-muted">{users?.length ?? 0} account(s)</span>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            User
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {isLoading && <Spinner className="m-6" />}
          {error && <ErrorBox>{errorMessage(error)}</ErrorBox>}
          {users?.map((u) => (
            <button
              key={`${u.user}@${u.host}`}
              className={clsx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-hover',
                selected?.user === u.user && selected.host === u.host && 'bg-hover'
              )}
              onClick={() => setSelected(u)}
            >
              <span className="font-mono">{u.user || '(anonymous)'}</span>
              <span className="text-muted">@{u.host}</span>
              {u.locked && <span className="ml-auto text-[10px] text-warning">locked</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!selected ? (
          <div className="text-xs text-muted">Select an account to see its privileges.</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">
                {selected.user}@{selected.host}
              </span>
              <div className="flex-1" />
              <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => setEditingPrivileges(true)}>
                Privileges
              </Button>
              <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => void setPassword()}>
                Password
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => void drop()}>
                Drop
              </Button>
            </div>
            <div className="rounded-md border border-border bg-panel p-3">
              {grants?.map((g, i) => (
                <div key={i} className="selectable py-0.5 font-mono text-xs">
                  {g}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <CreateUserDialog open={creating} onOpenChange={setCreating} onCreated={refresh} />
      {selected && editingPrivileges && (
        <PrivilegesDialog key={`${selected.user}@${selected.host}`} user={selected} onClose={() => setEditingPrivileges(false)} onChanged={refresh} />
      )}
    </div>
  )
}

function CreateUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const sessionId = useSessionId()
  const [user, setUser] = useState('')
  const [host, setHost] = useState('%')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    try {
      await api.admin.createUser({ sessionId, user, host, password })
      onCreated()
      onOpenChange(false)
      setUser('')
      setPassword('')
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create user"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!user} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="User">
            <Input value={user} onChange={(e) => setUser(e.target.value)} />
          </Field>
          <Field label="Host" hint="% for any host">
            <Input value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
        </div>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Dialog>
  )
}

function levelKey(level: PrivilegeLevel): string {
  return level.kind === 'global' ? '*.*' : level.kind === 'database' ? `${level.database}.*` : `${level.database}.${level.table}`
}

/**
 * Edits the privileges of an account at one level: the current ones are
 * pre-checked, and saving runs the GRANT / REVOKE statements of the difference.
 */
function PrivilegesDialog({ user, onClose, onChanged }: { user: UserAccount; onClose: () => void; onChanged: () => void }) {
  const sessionId = useSessionId()
  const queryClient = useQueryClient()
  const [level, setLevel] = useState<PrivilegeLevel | null>(null)
  const [desired, setDesired] = useState<PrivilegeSet | null>(null)
  const [applying, setApplying] = useState(false)

  const { data: levels } = useQuery({
    queryKey: ['privilegeLevels', sessionId, user.user, user.host],
    queryFn: () => api.admin.privilegeLevels({ sessionId, user: user.user, host: user.host }),
    staleTime: 0
  })
  const { data: databases } = useQuery({ queryKey: ['databases', sessionId], queryFn: () => api.schema.databases({ sessionId }) })
  const levelDatabase = level && level.kind !== 'global' ? level.database : ''
  const { data: objects } = useQuery({
    queryKey: ['objects', sessionId, levelDatabase],
    queryFn: () => api.schema.objects({ sessionId, database: levelDatabase }),
    enabled: !!levelDatabase
  })
  const complete = !!level && (level.kind === 'global' || (!!level.database && (level.kind === 'database' || !!level.table)))
  const { data: current, error, isFetching } = useQuery({
    queryKey: ['privileges', sessionId, user.user, user.host, level],
    queryFn: () => api.admin.privileges({ sessionId, user: user.user, host: user.host, level: level! }),
    enabled: complete,
    staleTime: 0,
    gcTime: 0
  })

  // Start on the first level where the account already has privileges.
  useEffect(() => {
    if (!level && levels) setLevel(levels[0] ?? { kind: 'global' })
  }, [levels, level])

  // Pre-check what the account has at this level.
  useEffect(() => {
    setDesired(current ? { privileges: [...current.privileges], grantOption: current.grantOption } : null)
  }, [current])

  const statements = useMemo(
    () => (level && complete && current && desired ? privilegeChangesSql(user.user, user.host, level, current, desired) : []),
    [level, complete, current, desired, user]
  )

  const changeLevel = async (next: PrivilegeLevel): Promise<void> => {
    if (
      statements.length > 0 &&
      !(await confirm({ title: 'Unsaved changes', body: 'Discard the privilege changes of this level?', confirmLabel: 'Discard', danger: true }))
    ) {
      return
    }
    setDesired(null)
    setLevel(next)
  }

  const toggle = (privilege: string): void =>
    setDesired((d) =>
      d ? { ...d, privileges: d.privileges.includes(privilege) ? d.privileges.filter((p) => p !== privilege) : [...d.privileges, privilege] } : d
    )

  const apply = async (): Promise<void> => {
    setApplying(true)
    const done = await runStatements(statements, null, undefined, {
      force: true,
      title: `Privileges of ${user.user}@${user.host}`,
      success: 'Privileges updated'
    })
    setApplying(false)
    if (!done) return
    onChanged()
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['privileges', sessionId, user.user, user.host] }),
      queryClient.invalidateQueries({ queryKey: ['privilegeLevels', sessionId, user.user, user.host] })
    ])
  }

  const groups = level ? PRIVILEGES_BY_LEVEL[level.kind] : []
  const had = new Set(current?.privileges ?? [])
  const managed = level ? new Set(privilegesForLevel(level.kind)) : new Set<string>()
  // Privileges the account has here that this editor does not manage (dynamic privileges...).
  const unmanaged = (current?.privileges ?? []).filter((p) => !managed.has(p))

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Privileges of ${user.user}@${user.host}`}
      width={760}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            {statements.length === 0 ? 'No change' : `${statements.length} statement(s) to run`}
          </span>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={applying} disabled={statements.length === 0} onClick={() => void apply()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {levels && levels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Has privileges on:</span>
            {levels.map((l) => (
              <button
                key={levelKey(l)}
                className={clsx(
                  'rounded border px-2 py-0.5 font-mono text-[11px]',
                  level && levelKey(level) === levelKey(l) ? 'border-accent text-accent' : 'border-border text-fg hover:bg-hover'
                )}
                onClick={() => void changeLevel(l)}
              >
                {levelKey(l)}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Level">
            <Select
              value={level?.kind ?? 'global'}
              onChange={(e) => {
                const kind = e.target.value as PrivilegeLevel['kind']
                const database = level && level.kind !== 'global' ? level.database : ''
                void changeLevel(kind === 'global' ? { kind } : kind === 'database' ? { kind, database } : { kind, database, table: '' })
              }}
            >
              <option value="global">Global (*.*)</option>
              <option value="database">Database</option>
              <option value="table">Table</option>
            </Select>
          </Field>
          {level && level.kind !== 'global' && (
            <Field label="Database">
              <Select
                value={level.database}
                onChange={(e) =>
                  void changeLevel(level.kind === 'table' ? { kind: 'table', database: e.target.value, table: '' } : { kind: 'database', database: e.target.value })
                }
              >
                <option value="">Select…</option>
                {databases?.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {level?.kind === 'table' && (
            <Field label="Table">
              <Select value={level.table} disabled={!level.database} onChange={(e) => void changeLevel({ ...level, table: e.target.value })}>
                <option value="">Select…</option>
                {objects?.tables.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {!complete ? (
          <div className="text-xs text-muted">Select the database{level?.kind === 'table' ? ' and the table' : ''}.</div>
        ) : error ? (
          <ErrorBox>{errorMessage(error)}</ErrorBox>
        ) : !desired || isFetching ? (
          <Spinner />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              {groups
                .filter((g) => g.privileges.length > 0)
                .map((group) => (
                  <div key={group.group}>
                    <div className="mb-2 text-xs font-semibold text-muted">{group.group}</div>
                    <div className="flex flex-col gap-1.5 text-xs">
                      {group.privileges.map((p) => {
                        const checked = desired.privileges.includes(p)
                        const changed = checked !== had.has(p)
                        return (
                          <Checkbox
                            key={p}
                            checked={checked}
                            onChange={() => toggle(p)}
                            label={
                              <span className={clsx(changed && (checked ? 'text-success' : 'text-danger line-through'))}>
                                {p}
                                {changed && <span className="ml-1 no-underline">{checked ? '(+)' : '(−)'}</span>}
                              </span>
                            }
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <Checkbox
                checked={desired.grantOption}
                onChange={(grantOption) => setDesired({ ...desired, grantOption })}
                label={
                  <span className={clsx(desired.grantOption !== current?.grantOption && (desired.grantOption ? 'text-success' : 'text-danger line-through'))}>
                    GRANT OPTION (can give its privileges to others)
                  </span>
                }
              />
              <Button size="sm" variant="ghost" onClick={() => setDesired({ ...desired, privileges: privilegesForLevel(level!.kind) })}>
                All
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDesired({ ...desired, privileges: [] })}>
                None
              </Button>
              {current && (
                <Button size="sm" variant="ghost" disabled={statements.length === 0} onClick={() => setDesired({ ...current, privileges: [...current.privileges] })}>
                  Reset
                </Button>
              )}
            </div>
            {unmanaged.length > 0 && (
              <p className="text-[11px] text-muted">Also has, left untouched: {unmanaged.join(', ')}</p>
            )}
            {statements.length > 0 && (
              <pre className="selectable max-h-32 overflow-auto rounded bg-bg p-2 font-mono text-[11px] text-muted">{statements.join(';\n')};</pre>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
