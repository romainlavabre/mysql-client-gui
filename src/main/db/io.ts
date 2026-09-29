// Import and export: SQL dumps, result/table exports and file imports.
// Long operations run as jobs reporting their progress.
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import type {
  CellValue,
  CsvPreview,
  DumpOptions,
  ExportFormat,
  ExportRowsRequest,
  ExportTableRequest,
  ImportCsvRequest,
  ImportSqlRequest,
  JobProgress
} from '@shared/types'
import { qualified, quoteIdent, quoteValue, toHex } from '@shared/sql/quote'
import { StatementSplitter } from '@shared/sql/split'
import * as schema from './schema'
import { coreOf, normalizeCell } from './query'

// ---------------------------------------------------------------------- jobs

export type ProgressListener = (progress: JobProgress) => void

export class JobRunner {
  private readonly cancelled = new Set<string>()

  constructor(private readonly listener: ProgressListener) {}

  start(label: string, task: (job: Job) => Promise<void>): string {
    const jobId = randomUUID()
    const job = new Job(jobId, label, this.listener, () => this.cancelled.has(jobId))
    job.report()
    void task(job)
      .then(() => job.finish(null))
      .catch((error: unknown) => job.finish(error instanceof Error ? error.message : String(error)))
      .finally(() => this.cancelled.delete(jobId))
    return jobId
  }

  cancel(jobId: string): void {
    this.cancelled.add(jobId)
  }
}

export class Job {
  done = 0
  total: number | null = null
  readonly warnings: string[] = []
  private lastReport = 0

  constructor(
    readonly jobId: string,
    readonly label: string,
    private readonly listener: ProgressListener,
    private readonly isCancelled: () => boolean
  ) {}

  checkCancelled(): void {
    if (this.isCancelled()) throw new Error('Cancelled')
  }

  warn(message: string): void {
    if (this.warnings.length < 200) this.warnings.push(message)
  }

  /** Reports progress, throttled to a few events per second. */
  report(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastReport < 200) return
    this.lastReport = now
    this.listener({
      jobId: this.jobId,
      label: this.label,
      done: this.done,
      total: this.total,
      finished: false,
      error: null,
      warnings: [...this.warnings]
    })
  }

  finish(error: string | null): void {
    this.listener({
      jobId: this.jobId,
      label: this.label,
      done: this.done,
      total: this.total,
      finished: true,
      error,
      warnings: [...this.warnings]
    })
  }
}

/** Writes text; returns a promise only when the stream asks to wait (backpressure). */
function write(stream: WriteStream, text: string): Promise<void> | undefined {
  if (!stream.write(text)) return once(stream, 'drain').then(() => undefined)
  return undefined
}

async function closeStream(stream: WriteStream): Promise<void> {
  stream.end()
  await once(stream, 'finish')
}

/** Streams the rows of a query, pausing the socket while the consumer is busy. */
async function streamRows(
  connection: PoolConnection,
  sql: string,
  onRow: (row: CellValue[]) => Promise<void> | void,
  onFields?: (fields: string[]) => void
): Promise<void> {
  const query = coreOf(connection).query({ sql, rowsAsArray: true })
  await new Promise<void>((resolve, reject) => {
    let pending: Promise<void> = Promise.resolve()
    let failed = false
    query.on('fields', (fields: { name: string }[] | undefined) => fields && onFields?.(fields.map((f) => f.name)))
    query.on('result', (row: unknown) => {
      if (!Array.isArray(row) || failed) return
      const result = onRow(row.map(normalizeCell))
      if (result instanceof Promise) {
        coreOf(connection).pause()
        pending = pending
          .then(() => result)
          .then(() => coreOf(connection).resume())
          .catch((error: unknown) => {
            failed = true
            reject(error)
          })
      }
    })
    query.on('error', reject)
    query.on('end', () => {
      pending.then(() => resolve(), reject)
    })
  })
}

// ---------------------------------------------------------------------- dump

export function runDump(pool: Pool, options: DumpOptions, job: Job): Promise<void> {
  return (async () => {
    const out = createWriteStream(options.filePath, { encoding: 'utf8' })
    const connection = await pool.getConnection()
    try {
      const objects = await schema.objects(pool, options.database)
      const selected = objects.tables.filter((t) => options.tables.length === 0 || options.tables.includes(t.name))
      const tables = selected.filter((t) => t.kind === 'table')
      const views = selected.filter((t) => t.kind === 'view')
      job.total = tables.reduce((sum, t) => sum + (options.data ? (t.rows ?? 0) : 0), 0) || null

      await write(
        out,
        [
          `-- Simone dump`,
          `-- Database: ${options.database}`,
          `-- Date: ${new Date().toISOString()}`,
          '',
          'SET NAMES utf8mb4;',
          'SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS = 0;',
          "SET @OLD_SQL_MODE = @@SQL_MODE, SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';",
          'SET @OLD_TIME_ZONE = @@TIME_ZONE, TIME_ZONE = \'+00:00\';',
          '',
          ''
        ].join('\n')
      )
      // Timestamps are dumped in UTC, restored in UTC.
      await connection.query("SET TIME_ZONE = '+00:00'")

      for (const table of tables) {
        job.checkCancelled()
        const target = quoteIdent(table.name)
        await write(out, `--\n-- Table ${target}\n--\n\n`)
        if (options.structure) {
          if (options.dropStatements) await write(out, `DROP TABLE IF EXISTS ${target};\n`)
          await write(out, `${await schema.createStatement(connection, options.database, table.name, 'table')};\n\n`)
        }
        if (options.data) {
          let batch: string[] = []
          let columns = ''
          const flush = (): Promise<void> | undefined => {
            if (batch.length === 0) return undefined
            const text = `INSERT INTO ${target} ${columns} VALUES\n${batch.join(',\n')};\n`
            batch = []
            return write(out, text)
          }
          await streamRows(
            connection,
            `SELECT * FROM ${qualified(options.database, table.name)}`,
            (row) => {
              batch.push(`(${row.map((v) => quoteValue(v)).join(', ')})`)
              job.done++
              if (batch.length < options.rowsPerInsert) return undefined
              job.checkCancelled()
              job.report()
              return flush()
            },
            (names) => {
              columns = `(${names.map(quoteIdent).join(', ')})`
            }
          )
          await flush()
          await write(out, '\n')
        }
      }

      if (options.structure) {
        for (const view of views) {
          job.checkCancelled()
          const target = quoteIdent(view.name)
          await write(out, `--\n-- View ${target}\n--\n\n`)
          if (options.dropStatements) await write(out, `DROP VIEW IF EXISTS ${target};\n`)
          const create = await schema.createStatement(connection, options.database, view.name, 'view')
          // DEFINER would fail on another server with other accounts.
          await write(out, `${stripDefiner(create)};\n\n`)
        }
      }

      const blocks: { kind: 'procedure' | 'function' | 'trigger' | 'event'; name: string }[] = []
      if (options.routines) blocks.push(...objects.routines.map((r) => ({ kind: r.kind, name: r.name })))
      if (options.triggers) {
        blocks.push(
          ...objects.triggers
            .filter((t) => options.tables.length === 0 || options.tables.includes(t.table))
            .map((t) => ({ kind: 'trigger' as const, name: t.name }))
        )
      }
      if (options.events) blocks.push(...objects.events.map((e) => ({ kind: 'event' as const, name: e.name })))
      if (blocks.length > 0) {
        await write(out, 'DELIMITER ;;\n')
        for (const block of blocks) {
          job.checkCancelled()
          if (options.dropStatements) await write(out, `DROP ${block.kind.toUpperCase()} IF EXISTS ${quoteIdent(block.name)};;\n`)
          const create = await schema.createStatement(connection, options.database, block.name, block.kind)
          await write(out, `${stripDefiner(create)};;\n`)
        }
        await write(out, 'DELIMITER ;\n\n')
      }

      await write(
        out,
        'SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;\nSET SQL_MODE = @OLD_SQL_MODE;\nSET TIME_ZONE = @OLD_TIME_ZONE;\n'
      )
      job.report(true)
    } finally {
      // USE and TIME_ZONE changed the session: do not hand the connection back to the pool.
      connection.destroy()
      await closeStream(out)
    }
  })()
}

export function stripDefiner(sql: string): string {
  return sql.replace(/\s+DEFINER\s*=\s*(`[^`]*`|'[^']*'|\S+)@(`[^`]*`|'[^']*'|\S+)/i, '')
}

// -------------------------------------------------------------------- export

function cellToText(value: CellValue): string {
  if (value === null) return ''
  if (value instanceof Uint8Array) return `0x${toHex(value)}`
  return String(value)
}

function cellToJson(value: CellValue): string | number | null {
  if (value instanceof Uint8Array) return `0x${toHex(value)}`
  return value
}

/** Incremental writer for one export format. */
interface RowWriter {
  begin(columns: string[]): Promise<void> | undefined
  row(row: CellValue[]): Promise<void> | undefined
  end(): Promise<void>
}

function createRowWriter(format: ExportFormat, filePath: string, tableName: string): RowWriter {
  if (format === 'xlsx') {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useSharedStrings: false })
    const sheet = workbook.addWorksheet(tableName.slice(0, 31) || 'Export')
    return {
      begin(columns) {
        sheet.addRow(columns).commit()
        return undefined
      },
      row(row) {
        sheet.addRow(row.map((v) => (v instanceof Uint8Array ? `0x${toHex(v)}` : v))).commit()
        return undefined
      },
      async end() {
        sheet.commit()
        await workbook.commit()
      }
    }
  }

  const out = createWriteStream(filePath, { encoding: 'utf8' })
  let columns: string[] = []
  let first = true
  const target = quoteIdent(tableName || 'export')
  return {
    begin(names) {
      columns = names
      if (format === 'csv') return write(out, Papa.unparse([names]) + '\r\n')
      if (format === 'json') return write(out, '[\n')
      return undefined
    },
    row(row) {
      const wasFirst = first
      first = false
      if (format === 'csv') return write(out, Papa.unparse([row.map(cellToText)]) + '\r\n')
      if (format === 'json') {
        const object = Object.fromEntries(columns.map((name, i) => [name, cellToJson(row[i])]))
        return write(out, (wasFirst ? '  ' : ',\n  ') + JSON.stringify(object))
      }
      return write(
        out,
        `INSERT INTO ${target} (${columns.map(quoteIdent).join(', ')}) VALUES (${row.map((v) => quoteValue(v)).join(', ')});\n`
      )
    },
    async end() {
      if (format === 'json') await write(out, first ? ']\n' : '\n]\n')
      await closeStream(out)
    }
  }
}

export async function exportRows(request: ExportRowsRequest): Promise<void> {
  const writer = createRowWriter(request.format, request.filePath, request.tableName ?? 'export')
  await writer.begin(request.columns)
  for (const row of request.rows) await writer.row(row)
  await writer.end()
}

export async function exportTable(pool: Pool, request: ExportTableRequest, job: Job): Promise<void> {
  const writer = createRowWriter(request.format, request.filePath, request.table)
  const connection = await pool.getConnection()
  try {
    const [count] = await connection.query<RowDataPacket[]>(
      'SELECT TABLE_ROWS AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [request.database, request.table]
    )
    job.total = count[0]?.total ? Number(count[0].total) : null
    await streamRows(
      connection,
      `SELECT * FROM ${qualified(request.database, request.table)}`,
      (row) => {
        job.done++
        if (job.done % 1000 === 0) {
          job.checkCancelled()
          job.report()
        }
        return writer.row(row)
      },
      (names) => {
        // Header writes never wait on an empty stream.
        void writer.begin(names)
      }
    )
  } finally {
    connection.release()
    await writer.end()
  }
}

// -------------------------------------------------------------------- import

export async function importSql(pool: Pool, request: ImportSqlRequest, fileSize: number, job: Job): Promise<void> {
  const connection = await pool.getConnection()
  job.total = fileSize
  try {
    if (request.database) await connection.query(`USE ${quoteIdent(request.database)}`)
    const splitter = new StatementSplitter()
    const stream = createReadStream(request.filePath, { encoding: 'utf8', highWaterMark: 1 << 20 })
    let statementCount = 0
    const run = async (sql: string): Promise<void> => {
      statementCount++
      try {
        await connection.query(sql)
      } catch (error) {
        const message = `Statement ${statementCount}: ${(error as Error).message}`
        if (request.stopOnError) throw new Error(message, { cause: error })
        job.warn(message)
      }
    }
    for await (const chunk of stream) {
      job.checkCancelled()
      for (const statement of splitter.push(chunk as string)) await run(statement.sql)
      job.done = stream.bytesRead
      job.report()
    }
    for (const statement of splitter.end()) await run(statement.sql)
    job.done = fileSize
  } finally {
    // The connection may hold session changes made by the script: do not reuse it.
    connection.destroy()
  }
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/)[0] ?? ''
  const candidates = [',', ';', '\t', '|']
  return candidates.reduce((best, c) => (firstLine.split(c).length > firstLine.split(best).length ? c : best), ',')
}

export async function previewCsv(filePath: string, delimiter?: string): Promise<CsvPreview> {
  const stream = createReadStream(filePath, { encoding: 'utf8', start: 0, end: 256 * 1024 })
  let sample = ''
  for await (const chunk of stream) sample += chunk
  const used = delimiter || detectDelimiter(sample)
  const parsed = Papa.parse<string[]>(sample, { delimiter: used, preview: 21, skipEmptyLines: true })
  const [headers = [], ...rows] = parsed.data
  return { headers, rows, delimiter: used }
}

export async function importCsv(pool: Pool, request: ImportCsvRequest, job: Job): Promise<void> {
  const mapped = request.mapping
    .map((column, index) => ({ column, index }))
    .filter((m): m is { column: string; index: number } => !!m.column)
  if (mapped.length === 0) throw new Error('Map at least one CSV column to a table column')
  const verb = request.mode === 'replace' ? 'REPLACE' : request.mode === 'insertIgnore' ? 'INSERT IGNORE' : 'INSERT'
  const head = `${verb} INTO ${qualified(request.database, request.table)} (${mapped.map((m) => quoteIdent(m.column)).join(', ')}) VALUES\n`
  const cell = (row: string[], index: number): string =>
    row[index] === undefined || row[index] === request.nullValue ? 'NULL' : quoteValue(row[index])

  const connection = await pool.getConnection()
  let batch: string[] = []
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    await connection.query(head + batch.join(',\n'))
    batch = []
  }
  try {
    await connection.beginTransaction()
    const rows = createReadStream(request.filePath, { encoding: 'utf8' }).pipe(
      Papa.parse(Papa.NODE_STREAM_INPUT, { delimiter: request.delimiter, skipEmptyLines: true })
    )
    let line = 0
    for await (const row of rows as AsyncIterable<string[]>) {
      line++
      if (line === 1 && request.hasHeader) continue
      batch.push(`(${mapped.map((m) => cell(row, m.index)).join(', ')})`)
      job.done++
      if (batch.length >= request.batchSize) {
        await flush()
        job.checkCancelled()
        job.report()
      }
    }
    await flush()
    await connection.commit()
    job.total = job.done
  } catch (error) {
    await connection.rollback().catch(() => undefined)
    throw error
  } finally {
    connection.release()
  }
}
