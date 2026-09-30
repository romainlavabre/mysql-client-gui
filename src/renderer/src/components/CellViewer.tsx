// Full view (and editor) of a single cell: long text, JSON, binary.
import { useEffect, useState } from 'react'
import type { CellValue } from '@shared/types'
import { toHex } from '@shared/sql/quote'
import { looksLikeJson } from '../lib/format'
import { SqlEditor } from './SqlEditor'
import { Button, Dialog, SegmentedControl, Textarea } from './ui'

type Mode = 'text' | 'json' | 'hex'

export function CellViewer({
  open,
  onOpenChange,
  column,
  value,
  editable,
  onSave
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  column: string
  value: CellValue
  editable: boolean
  onSave?: (value: CellValue) => void
}) {
  const isBinary = value instanceof Uint8Array
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')

  useEffect(() => {
    if (!open) return
    if (value instanceof Uint8Array) {
      setMode('hex')
      setText(toHex(value).replace(/(.{2})/g, '$1 ').replace(/((?:\S\S ){16})/g, '$1\n'))
    } else if (typeof value === 'string' && looksLikeJson(value)) {
      setMode('json')
      setText(JSON.stringify(JSON.parse(value), null, 2))
    } else {
      setMode('text')
      setText(value === null ? '' : String(value))
    }
  }, [open, value])

  const switchMode = (next: Mode): void => {
    if (next === 'json' && looksLikeJson(text)) setText(JSON.stringify(JSON.parse(text), null, 2))
    if (next === 'text' && mode === 'json' && looksLikeJson(text)) setText(JSON.stringify(JSON.parse(text)))
    setMode(next)
  }

  const save = (next: CellValue): void => {
    onSave?.(next)
    onOpenChange(false)
  }

  const canEdit = editable && !isBinary

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={column}
      width={760}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            {value === null ? 'NULL' : isBinary ? `${value.length} bytes` : `${String(value).length} characters`}
          </span>
          {mode === 'json' && (
            <Button disabled={!looksLikeJson(text)} onClick={() => setText(JSON.stringify(JSON.parse(text), null, 2))}>
              Format
            </Button>
          )}
          <Button onClick={() => void navigator.clipboard.writeText(text)}>Copy</Button>
          {canEdit && (
            <>
              <Button onClick={() => save(null)}>Set NULL</Button>
              <Button
                variant="primary"
                onClick={() => save(mode === 'json' && looksLikeJson(text) ? JSON.stringify(JSON.parse(text)) : text)}
              >
                Apply
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex h-[55vh] flex-col gap-2">
        {!isBinary && (
          <SegmentedControl<Mode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' }
            ]}
          />
        )}
        {mode === 'json' ? (
          <SqlEditor
            language="json"
            value={text}
            onChange={setText}
            readOnly={!canEdit}
            className="min-h-0 flex-1 overflow-hidden rounded-md border border-border"
          />
        ) : (
          <Textarea className="min-h-0 flex-1 resize-none" value={text} readOnly={!canEdit} onChange={(e) => setText(e.target.value)} />
        )}
      </div>
    </Dialog>
  )
}
