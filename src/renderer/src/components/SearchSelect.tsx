// Searchable dropdown list, with groups, descriptions and optional free text.
import * as Popover from '@radix-ui/react-popover'
import clsx from 'clsx'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from './ui'

export interface SearchOption {
  value: string
  label?: string
  group?: string
  description?: string
  /** Dimmed, still selectable (e.g. a type of the other server flavour). */
  muted?: boolean
}

/** The list part: search field and filtered, keyboard-navigable options. */
export function SearchList({
  options,
  value,
  onSelect,
  allowCustom,
  placeholder = 'Search…',
  emptyText = 'No match'
}: {
  options: SearchOption[]
  value?: string
  onSelect: (value: string) => void
  allowCustom?: boolean
  placeholder?: string
  emptyText?: string
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    // Names starting with the text first, then names containing it, then descriptions.
    const score = (o: SearchOption): number => {
      const name = (o.label ?? o.value).toLowerCase()
      if (name.startsWith(needle)) return 0
      if (name.includes(needle)) return 1
      if (o.description?.toLowerCase().includes(needle)) return 2
      return 3
    }
    return options
      .map((o) => ({ o, s: score(o) }))
      .filter((x) => x.s < 3)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.o)
  }, [options, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const custom = allowCustom && query.trim() && !filtered.some((o) => o.value.toLowerCase() === query.trim().toLowerCase())
  const pick = (index: number): void => {
    if (filtered[index]) onSelect(filtered[index].value)
    else if (custom) onSelect(query.trim())
  }

  // Group headers only when not searching: results are ordered by relevance.
  const showGroups = !query.trim()
  const rows: ReactNode[] = []
  let lastGroup: string | undefined
  filtered.forEach((option, index) => {
    if (showGroups && option.group && option.group !== lastGroup) {
      rows.push(
        <div key={`group-${option.group}`} className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {option.group}
        </div>
      )
      lastGroup = option.group
    }
    rows.push(
      <div
        key={option.value}
        data-index={index}
        className={clsx(
          'flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs',
          index === active ? 'bg-hover' : '',
          option.muted && 'opacity-60'
        )}
        onMouseEnter={() => setActive(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(index)}
      >
        <Check className={clsx('mt-0.5 size-3 shrink-0', option.value === value ? 'text-accent' : 'opacity-0')} />
        <div className="min-w-0">
          <div className="font-mono">{option.label ?? option.value}</div>
          {option.description && <div className="text-[11px] text-muted">{option.description}</div>}
        </div>
      </div>
    )
  })

  return (
    <div className="flex max-h-80 w-72 flex-col">
      <div className="relative border-b border-border p-1.5">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 size-3.5 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="h-7 w-full rounded border border-border bg-bg pl-7 pr-2 text-xs text-fg outline-none focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(filtered.length > 0 ? active : -1)
            }
          }}
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1">
        {rows}
        {custom && (
          <div
            className={clsx('cursor-pointer rounded px-2 py-1 text-xs', filtered.length === 0 && 'bg-hover')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(query.trim())}
          >
            Use <span className="font-mono">{query.trim()}</span>
          </div>
        )}
        {filtered.length === 0 && !custom && <div className="px-2 py-3 text-center text-xs text-muted">{emptyText}</div>}
      </div>
    </div>
  )
}

/** A field showing the value, opening the searchable list. */
export function SearchSelect({
  value,
  options,
  onChange,
  allowCustom,
  placeholder,
  className,
  disabled
}: {
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  allowCustom?: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          'flex h-7 w-full items-center justify-between gap-1 rounded-md border border-border bg-bg px-2 text-left font-mono text-xs text-fg outline-none focus:border-accent disabled:opacity-50',
          className
        )}
      >
        <span className={clsx('truncate', !value && 'text-muted')}>{value ? (current?.label ?? value) : (placeholder ?? 'Select…')}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 rounded-md border border-border bg-panel-2 shadow-xl">
          <SearchList
            options={options}
            value={value}
            allowCustom={allowCustom}
            onSelect={(next) => {
              onChange(next)
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
