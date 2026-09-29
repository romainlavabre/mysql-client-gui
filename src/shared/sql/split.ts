// SQL statement splitter aware of quotes, comments and the mysql client's
// DELIMITER command. Works incrementally so large dump files can be streamed.

export interface SplitStatement {
  sql: string
  /** Absolute offset of the first character of `sql` in the input. */
  start: number
  /** Absolute offset just after the last character of `sql`. */
  end: number
}

type State = 'normal' | 'single' | 'double' | 'backtick' | 'lineComment' | 'blockComment'

const DELIMITER_LINE = /^[ \t]*delimiter[ \t]+(\S+)[ \t]*\r?$/i

export class StatementSplitter {
  private pending = ''
  /** Absolute offset of pending[0]. */
  private pendingOffset = 0
  /** Text of the statement being read, from `statementStart`, for the parts already consumed. */
  private current = ''
  private statementStart = -1
  private state: State = 'normal'
  private delimiter = ';'
  private atLineStart = true

  get currentDelimiter(): string {
    return this.delimiter
  }

  /** Feeds a chunk; returns the statements completed so far. */
  push(chunk: string): SplitStatement[] {
    this.pending += chunk
    // Only whole lines are processed so DELIMITER lines are always seen complete.
    const lastNewline = this.pending.lastIndexOf('\n')
    if (lastNewline < 0) return []
    return this.process(lastNewline + 1)
  }

  /** Flushes the remaining input; returns the last statement if any. */
  end(): SplitStatement[] {
    const out = this.process(this.pending.length)
    const last = this.finish()
    if (last) out.push(last)
    return out
  }

  private process(limit: number): SplitStatement[] {
    const out: SplitStatement[] = []
    const text = this.pending
    // Index in `text` where the not yet copied part of the current statement starts.
    let segmentStart = this.statementStart >= 0 ? 0 : -1
    let i = 0

    const startStatement = (at: number): void => {
      if (this.statementStart < 0) {
        this.statementStart = this.pendingOffset + at
        segmentStart = at
      }
    }

    while (i < limit) {
      const ch = text[i]
      const next = text[i + 1]

      switch (this.state) {
        case 'normal': {
          if (this.atLineStart && this.statementStart < 0) {
            const lineEnd = text.indexOf('\n', i)
            const line = text.slice(i, lineEnd < 0 || lineEnd > limit ? limit : lineEnd)
            const match = DELIMITER_LINE.exec(line)
            if (match) {
              this.delimiter = match[1]
              i += line.length
              continue
            }
          }
          this.atLineStart = false
          if (text.startsWith(this.delimiter, i)) {
            if (this.statementStart >= 0) {
              this.current += text.slice(segmentStart, i)
              const statement = this.finish()
              if (statement) out.push(statement)
              segmentStart = -1
            }
            i += this.delimiter.length
            continue
          }
          if (ch === '\n') {
            this.atLineStart = true
          } else if (ch === "'") {
            startStatement(i)
            this.state = 'single'
          } else if (ch === '"') {
            startStatement(i)
            this.state = 'double'
          } else if (ch === '`') {
            startStatement(i)
            this.state = 'backtick'
          } else if (ch === '#' || (ch === '-' && next === '-' && isCommentSpace(text[i + 2]))) {
            this.state = 'lineComment'
          } else if (ch === '/' && next === '*') {
            // `/*!...*/` is executable (version-conditional) SQL, keep it as content.
            if (text[i + 2] === '!' || text[i + 2] === '+') startStatement(i)
            this.state = 'blockComment'
            i += 2
            continue
          } else if (!isSpace(ch)) {
            startStatement(i)
          }
          i++
          break
        }
        case 'single':
        case 'double':
        case 'backtick': {
          const quote = this.state === 'single' ? "'" : this.state === 'double' ? '"' : '`'
          if (ch === '\\' && this.state !== 'backtick') {
            i += 2
            continue
          }
          if (ch === quote) this.state = 'normal'
          i++
          break
        }
        case 'lineComment': {
          if (ch === '\n') {
            this.state = 'normal'
            this.atLineStart = true
          }
          i++
          break
        }
        case 'blockComment': {
          if (ch === '*' && next === '/') {
            this.state = 'normal'
            i += 2
            continue
          }
          i++
          break
        }
      }
    }

    if (this.statementStart >= 0 && segmentStart >= 0) {
      this.current += text.slice(segmentStart, limit)
    }
    this.pending = text.slice(limit)
    this.pendingOffset += limit
    return out
  }

  private finish(): SplitStatement | null {
    if (this.statementStart < 0) return null
    const sql = this.current.replace(/\s+$/, '')
    const statement = { sql, start: this.statementStart, end: this.statementStart + sql.length }
    this.current = ''
    this.statementStart = -1
    return sql.length > 0 ? statement : null
  }
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
}

function isCommentSpace(ch: string | undefined): boolean {
  return ch === undefined || isSpace(ch)
}

/** Splits a whole script into statements. */
export function splitStatements(sql: string): SplitStatement[] {
  const splitter = new StatementSplitter()
  return [...splitter.push(sql), ...splitter.end()]
}

/** Statement under the cursor: the one containing it, else the closest one before it. */
export function statementAt(sql: string, offset: number): SplitStatement | null {
  const statements = splitStatements(sql)
  let candidate: SplitStatement | null = null
  for (const statement of statements) {
    if (statement.start <= offset) candidate = statement
    if (offset >= statement.start && offset <= statement.end) return statement
  }
  return candidate ?? statements[0] ?? null
}
