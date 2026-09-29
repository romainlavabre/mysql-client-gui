// Which import / export dialog is open.
import { create } from 'zustand'
import type { CellValue } from '@shared/types'

export type IoDialog =
  | { kind: 'dump'; database: string; tables?: string[] }
  | { kind: 'exportTable'; database: string; table: string }
  | { kind: 'exportRows'; columns: string[]; rows: CellValue[][]; tableName?: string }
  | { kind: 'importSql'; database: string | null }
  | { kind: 'importCsv'; database: string; table: string }

export const useIoDialog = create<{ dialog: IoDialog | null }>(() => ({ dialog: null }))

export function openIo(dialog: IoDialog): void {
  useIoDialog.setState({ dialog })
}

export function closeIo(): void {
  useIoDialog.setState({ dialog: null })
}
