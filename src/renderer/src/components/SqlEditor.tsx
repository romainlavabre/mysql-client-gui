// CodeMirror 6 SQL editor with MySQL dialect and schema-aware completion.
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { MySQL, sql, type SQLNamespace } from '@codemirror/lang-sql'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  type KeyBinding
} from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { CompletionSchema } from '@shared/types'
import { useApp } from '../store'

export interface SqlEditorHandle {
  /** Selected text, or null when nothing is selected. */
  selection(): string | null
  cursor(): number
  focus(): void
  replaceAll(text: string): void
}

const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)' }
})

const darkTweaks = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--bg)' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', borderRight: '1px solid var(--border)' },
    '.cm-tooltip-autocomplete': { backgroundColor: 'var(--panel-2)' }
  },
  { dark: true }
)

function themeFor(theme: 'dark' | 'light'): Extension {
  return theme === 'dark' ? [oneDark, darkTweaks] : [lightTheme, syntaxHighlighting(defaultHighlightStyle)]
}

function sqlLanguage(schema: CompletionSchema | undefined, defaultSchema: string | null): Extension {
  return sql({
    dialect: MySQL,
    upperCaseKeywords: true,
    schema: (schema ?? {}) as SQLNamespace,
    defaultSchema: defaultSchema ?? undefined
  })
}

interface Props {
  value: string
  onChange?: (value: string) => void
  schema?: CompletionSchema
  database?: string | null
  readOnly?: boolean
  placeholder?: string
  /** Extra shortcuts (run, save...), evaluated before the defaults. */
  keys?: KeyBinding[]
  className?: string
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(
  { value, onChange, schema, database, readOnly = false, placeholder, keys = [], className },
  ref
) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const theme = useApp((s) => s.theme)
  const compartments = useRef({ theme: new Compartment(), language: new Compartment(), keys: new Compartment(), readOnly: new Compartment() })
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const c = compartments.current
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        c.keys.of(keymap.of(keys)),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        c.language.of(sqlLanguage(schema, database ?? null)),
        c.theme.of(themeFor(theme)),
        c.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        placeholder ? placeholderExtension(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString())
        })
      ]
    })
    view.current = new EditorView({ state, parent: host.current! })
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // The editor is created once; later prop changes go through compartments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.theme.reconfigure(themeFor(theme)) })
  }, [theme])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.language.reconfigure(sqlLanguage(schema, database ?? null)) })
  }, [schema, database])

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.keys.reconfigure(keymap.of(keys)) })
  }, [keys])

  useEffect(() => {
    view.current?.dispatch({
      effects: compartments.current.readOnly.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)])
    })
  }, [readOnly])

  // External value changes (loading a saved query, formatting) replace the document.
  useEffect(() => {
    const current = view.current
    if (current && value !== current.state.doc.toString()) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } })
    }
  }, [value])

  useImperativeHandle(ref, () => ({
    selection() {
      const state = view.current?.state
      if (!state) return null
      const range = state.selection.main
      return range.empty ? null : state.sliceDoc(range.from, range.to)
    },
    cursor() {
      return view.current?.state.selection.main.head ?? 0
    },
    focus() {
      view.current?.focus()
    },
    replaceAll(text: string) {
      const current = view.current
      if (current) current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text } })
    }
  }))

  return <div ref={host} className={className ?? 'h-full'} />
})
