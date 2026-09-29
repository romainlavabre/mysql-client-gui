// Small UI primitives shared by every screen.
import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Loader2, X } from 'lucide-react'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'

/** Joins classes, later ones overriding conflicting earlier ones (w-24 over w-full). */
export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes))
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 font-medium',
  secondary: 'bg-panel-2 text-fg border border-border hover:bg-hover',
  ghost: 'text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110 font-medium'
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3',
        VARIANTS[variant],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
})

export function IconButton({
  label,
  className,
  children,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40 disabled:pointer-events-none',
          active && 'bg-hover text-fg',
          className
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={400}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={4}
          className="z-50 rounded bg-panel-2 px-2 py-1 text-xs text-fg shadow-lg border border-border"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

const fieldClass =
  'w-full rounded-md border border-border bg-bg px-2 text-fg placeholder:text-muted/70 outline-none focus:border-accent disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(fieldClass, 'h-8', className)} spellCheck={false} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} className={cn(fieldClass, 'py-1.5 font-mono text-xs', className)} spellCheck={false} {...props} />
})

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClass, 'h-8 pr-6', className)} {...props}>
      {children}
    </select>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  indeterminate = false
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  disabled?: boolean
  /** Partly checked: shown as a dash (for a box that checks a whole group). */
  indeterminate?: boolean
}) {
  return (
    <label className={clsx('inline-flex items-center gap-2 cursor-pointer', disabled && 'opacity-50 pointer-events-none')}>
      <input
        type="checkbox"
        className="accent-[var(--accent)] size-3.5"
        checked={checked}
        ref={(input) => {
          if (input) input.indeterminate = indeterminate
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin text-muted', className)} />
}

export function Badge({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide', className)}
      style={color ? { background: `${color}33`, color } : undefined}
    >
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
      {icon && <div className="text-muted/60">{icon}</div>}
      <div className="text-base font-medium text-fg">{title}</div>
      {children}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="selectable whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger text-xs font-mono">
      {children}
    </div>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  width = 520
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <RadixDialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-panel shadow-2xl outline-none"
          style={{ width: `min(${width}px, 94vw)` }}
          onOpenAutoFocus={(e) => {
            // Focus the first field rather than the close button.
            const target = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('input, textarea, select')
            if (target) {
              e.preventDefault()
              target.focus()
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <RadixDialog.Title className="text-sm font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close className="rounded p-1 text-muted hover:bg-hover hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </RadixDialog.Close>
          </div>
          <RadixDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RadixDialog.Description>
          <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-bg p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          className={clsx(
            'rounded px-2.5 py-1 text-xs transition',
            value === option.value ? 'bg-panel-2 text-fg shadow' : 'text-muted hover:text-fg'
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
