// Display helpers.
import type { CellValue } from '@shared/types'
import { toHex } from '@shared/sql/quote'

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return ''
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.toLocaleString('en-US')
}

/** Text shown in a grid cell. */
export function cellText(value: CellValue): string {
  if (value === null) return 'NULL'
  if (value instanceof Uint8Array) {
    const preview = toHex(value.subarray(0, 32))
    return `0x${preview}${value.length > 32 ? '…' : ''}`
  }
  return String(value)
}

/** Text copied to the clipboard / put in an editor. */
export function cellRaw(value: CellValue): string {
  if (value === null) return ''
  if (value instanceof Uint8Array) return `0x${toHex(value)}`
  return String(value)
}

export function isBinary(value: CellValue): value is Uint8Array {
  return value instanceof Uint8Array
}

export function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return new Date(timestamp).toLocaleDateString()
}
