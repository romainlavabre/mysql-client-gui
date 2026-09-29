// Connection editor shown in the main area when not connected.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, Eye, EyeOff, FolderOpen, Plug, Save } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ConnectionDraft, EnvTag } from '@shared/types'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Checkbox, ErrorBox, Field, IconButton, Input, Select, Spinner, Tooltip } from '../../components/ui'
import { connect } from '../../store'
import { useWorkspace } from '../workspace/useWorkspace'
import { useConnectionEditor } from './ConnectionList'
import { CONNECTION_COLORS, ENV_COLORS, ENV_LABELS } from './env'

const emptyDraft = (): ConnectionDraft => ({
  config: {
    id: '',
    slug: '',
    name: '',
    env: 'dev',
    readOnly: false,
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    defaultDatabase: undefined,
    ssl: { enabled: false, rejectUnauthorized: true },
    ssh: { enabled: false, host: '', port: 22, user: '', auth: 'agent' }
  },
  secrets: {},
  override: {}
})

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {aside}
      </div>
      <div className="grid grid-cols-6 gap-3">{children}</div>
    </section>
  )
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
        autoComplete="off"
      />
      <button
        type="button"
        className="absolute right-1.5 top-1.5 text-muted hover:text-fg"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Hide' : 'Show'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function FileInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="flex gap-1">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <IconButton
        label="Browse"
        type="button"
        className="h-8 w-8 border border-border"
        onClick={async () => {
          const file = await api.dialog.openFile({ title: 'Select a file' })
          if (file) onChange(file)
        }}
      >
        <FolderOpen className="size-4" />
      </IconButton>
    </div>
  )
}

function ColorSwatch({
  color,
  label,
  selected,
  onSelect,
  isDefault
}: {
  color: string
  label: string
  selected: boolean
  onSelect: () => void
  isDefault?: boolean
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={onSelect}
        className={clsx(
          'flex size-6 items-center justify-center rounded-full transition hover:scale-110',
          selected && 'ring-2 ring-fg ring-offset-2 ring-offset-panel'
        )}
        style={isDefault ? { background: 'transparent', border: `2px dashed ${color}` } : { background: color }}
      >
        {selected && <Check className="size-3.5" style={{ color: isDefault ? color : '#1a1a1a' }} />}
      </button>
    </Tooltip>
  )
}

export function ConnectionForm({ connectionId }: { connectionId: string | 'new' }) {
  const queryClient = useQueryClient()
  const { data: workspace } = useWorkspace()
  const isNew = connectionId === 'new'
  const { data: loaded, isLoading } = useQuery({
    queryKey: ['connection', connectionId],
    queryFn: () => api.connections.get({ connectionId }),
    enabled: !isNew,
    staleTime: 0,
    gcTime: 0
  })
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    setDraft(isNew ? emptyDraft() : (loaded ?? emptyDraft()))
    setTestResult(null)
  }, [isNew, loaded])

  if (!isNew && isLoading) return <Spinner className="m-auto mt-10" />

  const config = draft.config
  const isCustomColor = !!config.color && !CONNECTION_COLORS.some((c) => c.value === config.color?.toLowerCase())
  const setConfig = (patch: Partial<ConnectionDraft['config']>): void => setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }))
  const setSsh = (patch: Partial<ConnectionDraft['config']['ssh']>): void =>
    setDraft((d) => ({ ...d, config: { ...d.config, ssh: { ...d.config.ssh, ...patch } } }))
  const setSsl = (patch: Partial<ConnectionDraft['config']['ssl']>): void =>
    setDraft((d) => ({ ...d, config: { ...d.config, ssl: { ...d.config.ssl, ...patch } } }))
  const setSecret = (patch: Partial<ConnectionDraft['secrets']>): void => setDraft((d) => ({ ...d, secrets: { ...d.secrets, ...patch } }))

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const { serverVersion } = await api.connections.test(draft)
      setTestResult({ ok: true, message: `Connected: ${serverVersion}` })
    } catch (error) {
      setTestResult({ ok: false, message: errorMessage(error) })
    } finally {
      setTesting(false)
    }
  }

  const save = async (andConnect = false): Promise<void> => {
    if (!config.name.trim()) {
      toast('The connection needs a name', 'error')
      return
    }
    setSaving(true)
    try {
      const saved = await api.connections.save({ ...draft, config: { ...config, name: config.name.trim() } })
      await queryClient.invalidateQueries({ queryKey: ['connections'] })
      useConnectionEditor.setState({ editing: saved.id })
      if (andConnect) await connect(saved, workspace?.activeRepoId ?? null)
      else toast('Connection saved and shared with the workspace', 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <form
        className="mx-auto flex max-w-3xl flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          void save(true)
        }}
      >
        <div className="flex items-center gap-3">
          <span className="h-8 w-1.5 rounded-full" style={{ background: config.color || ENV_COLORS[config.env] }} />
          <h2 className="text-lg font-semibold">{isNew ? 'New connection' : config.name || 'Connection'}</h2>
        </div>

        <Section title="General">
          <Field label="Name" className="col-span-4">
            <Input value={config.name} onChange={(e) => setConfig({ name: e.target.value })} placeholder="Production — main DB" />
          </Field>
          <Field label="Environment" className="col-span-2">
            <Select value={config.env} onChange={(e) => setConfig({ env: e.target.value as EnvTag })}>
              {(Object.keys(ENV_LABELS) as EnvTag[]).map((env) => (
                <option key={env} value={env}>
                  {ENV_LABELS[env]}
                </option>
              ))}
            </Select>
          </Field>
          {/* Not a <label>: it would forward clicks to the first swatch. */}
          <div className="col-span-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Color</span>
            <div className="flex h-8 items-center gap-1.5">
              <ColorSwatch
                color={ENV_COLORS[config.env]}
                label={`Default (${ENV_LABELS[config.env]} color)`}
                selected={!config.color}
                onSelect={() => setConfig({ color: undefined })}
                isDefault
              />
              {CONNECTION_COLORS.map((c) => (
                <ColorSwatch
                  key={c.name}
                  color={c.value}
                  label={c.name}
                  selected={config.color?.toLowerCase() === c.value}
                  onSelect={() => setConfig({ color: c.value })}
                />
              ))}
              <Tooltip content="Custom color">
                <label
                  className={clsx(
                    'relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-border',
                    isCustomColor && 'ring-2 ring-fg ring-offset-2 ring-offset-panel'
                  )}
                  style={{ background: isCustomColor ? config.color : 'conic-gradient(#ff5d59, #fad83b, #15db95, #4ad0ff, #9858ff, #ff78f7, #ff5d59)' }}
                >
                  <input
                    type="color"
                    value={config.color || ENV_COLORS[config.env]}
                    onChange={(e) => setConfig({ color: e.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Custom color"
                  />
                </label>
              </Tooltip>
            </div>
          </div>
          <div className="col-span-2 flex items-end pb-1">
            <Checkbox
              checked={config.readOnly}
              onChange={(readOnly) => setConfig({ readOnly })}
              label="Read-only (no writes)"
            />
          </div>
        </Section>

        <Section title="Server">
          <Field label="Host" className="col-span-4">
            <Input value={config.host} onChange={(e) => setConfig({ host: e.target.value })} />
          </Field>
          <Field label="Port" className="col-span-2">
            <Input type="number" value={config.port} onChange={(e) => setConfig({ port: Number(e.target.value) || 3306 })} />
          </Field>
          <Field label="User (shared)" className="col-span-2">
            <Input value={config.user} onChange={(e) => setConfig({ user: e.target.value })} />
          </Field>
          <Field label="My user (local override)" className="col-span-2" hint="Only on this computer.">
            <Input
              value={draft.override.user ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, override: { user: e.target.value || undefined } }))}
              placeholder={config.user}
            />
          </Field>
          <Field label="Password" className="col-span-2" hint="Stored on this computer only.">
            <SecretInput value={draft.secrets.password ?? ''} onChange={(password) => setSecret({ password })} />
          </Field>
          <Field label="Default database" className="col-span-3">
            <Input
              value={config.defaultDatabase ?? ''}
              onChange={(e) => setConfig({ defaultDatabase: e.target.value || undefined })}
              placeholder="None"
            />
          </Field>
        </Section>

        <Section title="SSH tunnel" aside={<Checkbox checked={config.ssh.enabled} onChange={(enabled) => setSsh({ enabled })} label="Enabled" />}>
          <div className={clsx('col-span-6 grid grid-cols-6 gap-3', !config.ssh.enabled && 'pointer-events-none opacity-40')}>
            <Field label="SSH host" className="col-span-3" hint="Host aliases from ~/.ssh/config work.">
              <Input value={config.ssh.host} onChange={(e) => setSsh({ host: e.target.value })} placeholder="bastion.example.com" />
            </Field>
            <Field label="Port" className="col-span-1">
              <Input type="number" value={config.ssh.port} onChange={(e) => setSsh({ port: Number(e.target.value) || 22 })} />
            </Field>
            <Field label="SSH user" className="col-span-2">
              <Input value={config.ssh.user} onChange={(e) => setSsh({ user: e.target.value })} placeholder="From ~/.ssh/config" />
            </Field>
            <Field label="Authentication" className="col-span-2">
              <Select value={config.ssh.auth} onChange={(e) => setSsh({ auth: e.target.value as 'agent' | 'keyFile' | 'password' })}>
                <option value="agent">SSH agent / ssh config</option>
                <option value="keyFile">Private key file</option>
                <option value="password">Password</option>
              </Select>
            </Field>
            {config.ssh.auth === 'keyFile' && (
              <>
                <Field label="Private key" className="col-span-2">
                  <FileInput value={config.ssh.keyPath ?? ''} onChange={(keyPath) => setSsh({ keyPath })} placeholder="~/.ssh/id_ed25519" />
                </Field>
                <Field label="Key passphrase" className="col-span-2" hint="Local only.">
                  <SecretInput value={draft.secrets.sshPassphrase ?? ''} onChange={(sshPassphrase) => setSecret({ sshPassphrase })} />
                </Field>
              </>
            )}
            {config.ssh.auth === 'password' && (
              <Field label="SSH password" className="col-span-2" hint="Local only.">
                <SecretInput value={draft.secrets.sshPassword ?? ''} onChange={(sshPassword) => setSecret({ sshPassword })} />
              </Field>
            )}
            <p className="col-span-6 text-[11px] text-muted">
              The database host and port above are resolved from the SSH server (often 127.0.0.1).
            </p>
          </div>
        </Section>

        <Section title="SSL / TLS" aside={<Checkbox checked={config.ssl.enabled} onChange={(enabled) => setSsl({ enabled })} label="Enabled" />}>
          <div className={clsx('col-span-6 grid grid-cols-6 gap-3', !config.ssl.enabled && 'pointer-events-none opacity-40')}>
            <Field label="CA certificate" className="col-span-2">
              <FileInput value={config.ssl.caPath ?? ''} onChange={(caPath) => setSsl({ caPath: caPath || undefined })} />
            </Field>
            <Field label="Client certificate" className="col-span-2">
              <FileInput value={config.ssl.certPath ?? ''} onChange={(certPath) => setSsl({ certPath: certPath || undefined })} />
            </Field>
            <Field label="Client key" className="col-span-2">
              <FileInput value={config.ssl.keyPath ?? ''} onChange={(keyPath) => setSsl({ keyPath: keyPath || undefined })} />
            </Field>
            <div className="col-span-6">
              <Checkbox
                checked={config.ssl.rejectUnauthorized}
                onChange={(rejectUnauthorized) => setSsl({ rejectUnauthorized })}
                label="Verify the server certificate"
              />
            </div>
          </div>
        </Section>

        {testResult && (testResult.ok ? <div className="text-xs text-success">{testResult.message}</div> : <ErrorBox>{testResult.message}</ErrorBox>)}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" loading={testing} onClick={() => void test()}>
            Test
          </Button>
          <Button type="button" loading={saving} icon={<Save className="size-4" />} onClick={() => void save(false)}>
            Save
          </Button>
          <Button type="submit" variant="primary" loading={saving} icon={<Plug className="size-4" />}>
            Save & connect
          </Button>
        </div>
      </form>
    </div>
  )
}
