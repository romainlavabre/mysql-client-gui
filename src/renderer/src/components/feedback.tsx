// Toasts and promise-based confirmation / prompt dialogs.
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Button, Dialog, Input } from './ui'

// -------------------------------------------------------------------- toasts

type ToastKind = 'info' | 'success' | 'error' | 'warning'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let nextToastId = 1

export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = nextToastId++
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
  setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4000)
}

function dismiss(id: number): void {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

const ICONS: Record<ToastKind, ReactNode> = {
  info: <Info className="size-4 text-accent" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  error: <XCircle className="size-4 text-danger" />,
  warning: <AlertTriangle className="size-4 text-warning" />
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-9 right-3 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 shadow-xl"
        >
          <div className="mt-0.5">{ICONS[t.kind]}</div>
          <div className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">{t.message}</div>
          <button className="text-muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ dialogs

interface ConfirmRequest {
  kind: 'confirm'
  title: string
  body: ReactNode
  confirmLabel: string
  danger: boolean
  /** Text the user must type to confirm (production safety). */
  typeToConfirm?: string
  resolve: (value: boolean) => void
}

interface PromptRequest {
  kind: 'prompt'
  title: string
  label: string
  initial: string
  confirmLabel: string
  resolve: (value: string | null) => void
}

const useDialogs = create<{ current: ConfirmRequest | PromptRequest | null }>(() => ({ current: null }))

export function confirm(options: {
  title: string
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  typeToConfirm?: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.setState({
      current: {
        kind: 'confirm',
        title: options.title,
        body: options.body,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        danger: options.danger ?? false,
        typeToConfirm: options.typeToConfirm,
        resolve
      }
    })
  })
}

export function prompt(options: { title: string; label: string; initial?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.setState({
      current: {
        kind: 'prompt',
        title: options.title,
        label: options.label,
        initial: options.initial ?? '',
        confirmLabel: options.confirmLabel ?? 'OK',
        resolve
      }
    })
  })
}

export function DialogHost() {
  const current = useDialogs((s) => s.current)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(current?.kind === 'prompt' ? current.initial : '')
  }, [current])

  if (!current) return null

  const close = (confirmed: boolean): void => {
    useDialogs.setState({ current: null })
    if (current.kind === 'confirm') current.resolve(confirmed)
    else current.resolve(confirmed ? text : null)
  }

  const blocked = current.kind === 'confirm' && !!current.typeToConfirm && text !== current.typeToConfirm

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close(false)}
      title={current.title}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button
            variant={current.kind === 'confirm' && current.danger ? 'danger' : 'primary'}
            disabled={blocked}
            onClick={() => close(true)}
          >
            {current.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!blocked) close(true)
        }}
        className="flex flex-col gap-3"
      >
        {current.kind === 'confirm' ? (
          <>
            <div className={clsx('selectable text-sm leading-relaxed')}>{current.body}</div>
            {current.typeToConfirm && (
              <label className="flex flex-col gap-1 text-xs text-muted">
                Type <span className="font-mono text-fg">{current.typeToConfirm}</span> to confirm
                <Input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
              </label>
            )}
          </>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-muted">
            {current.label}
            <Input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
        )}
      </form>
    </Dialog>
  )
}
