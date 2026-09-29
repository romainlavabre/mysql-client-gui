// Single-line SQL field with highlighting and schema completion (filter bar WHERE condition).
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { MySQL, sql } from '@codemirror/lang-sql'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { sqlCompletionSources, type CompletionData } from '../lib/sqlCompletion'
import { useApp } from '../store'
import { cn } from './ui'

const inputTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'hidden', lineHeight: '26px', fontFamily: 'var(--font-mono)' },
  '.cm-content': { padding: '0 8px', caretColor: 'var(--fg)' },
  '.cm-line': { padding: 0 },
  '.cm-placeholder': { color: 'color-mix(in srgb, var(--muted) 70%, transparent)' },
  '.cm-tooltip-autocomplete': { backgroundColor: 'var(--panel-2)', border: '1px solid var(--border)' }
})

/** Newlines typed or pasted become spaces: the field stays on one line. */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr
  return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: tr.newDoc.toString().replace(/\s*\n\s*/g, ' ') }, sequential: true }]
})

export function SqlInput({
  value,
  onChange,
  onSubmit,
  completion,
  placeholder,
  className
}: {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  completion?: CompletionData | null
  placeholder?: string
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const theme = useApp((s) => s.theme)
  const latest = useRef({ onChange, onSubmit, completion })
  latest.current = { onChange, onSubmit, completion }

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          closeBrackets(),
          autocompletion({ activateOnTyping: true, override: sqlCompletionSources(() => latest.current.completion ?? null) }),
          // Enter submits, unless the completion list is open (its keymap takes precedence).
          keymap.of([
            { key: 'Enter', run: () => (latest.current.onSubmit?.(), true) },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap
          ]),
          sql({ dialect: MySQL, upperCaseKeywords: true }),
          syntaxHighlighting(theme === 'dark' ? oneDarkHighlightStyle : defaultHighlightStyle),
          inputTheme,
          singleLine,
          placeholder ? placeholderExtension(placeholder) : [],
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          })
        ]
      })
    })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // Created once per theme; value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  useEffect(() => {
    const current = view.current
    if (current && value !== current.state.doc.toString()) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } })
    }
  }, [value])

  return (
    <div
      ref={host}
      className={cn(
        'h-7 min-w-0 flex-1 cursor-text overflow-hidden rounded-md border border-border bg-bg focus-within:border-accent',
        className
      )}
    />
  )
}
