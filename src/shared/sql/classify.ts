// Lightweight statement classification used by the safety guards.

/** Removes comments and string/identifier contents so keywords can be matched safely. */
export function stripLiterals(sql: string): string {
  return sql
    .replace(/\/\*(?!!)[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)(--\s|#)[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``')
}

function firstKeyword(sql: string): string {
  const match = /^[\s(]*([a-z]+)/i.exec(stripLiterals(sql))
  return match ? match[1].toUpperCase() : ''
}

const READ_KEYWORDS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'USE', 'HELP', 'WITH', 'VALUES', 'TABLE', 'SET'])

/** Whether a statement may modify data or structure (conservative: unknown = write). */
export function isWriteStatement(sql: string): boolean {
  const keyword = firstKeyword(sql)
  if (keyword === 'WITH') {
    return /\b(UPDATE|DELETE|INSERT)\b/i.test(stripLiterals(sql))
  }
  if (keyword === 'SET') {
    // SET of session variables is harmless; SET PASSWORD / GLOBAL are not.
    return /^\s*SET\s+(PASSWORD|GLOBAL|PERSIST|@@GLOBAL)/i.test(stripLiterals(sql))
  }
  if (keyword === 'SELECT') return /\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(stripLiterals(sql))
  return !READ_KEYWORDS.has(keyword)
}

/** UPDATE or DELETE without a WHERE clause. */
export function isUnboundedWrite(sql: string): boolean {
  const keyword = firstKeyword(sql)
  if (keyword !== 'UPDATE' && keyword !== 'DELETE') return false
  return !/\bWHERE\b/i.test(stripLiterals(sql))
}

export function isDestructive(sql: string): boolean {
  const keyword = firstKeyword(sql)
  return keyword === 'DROP' || keyword === 'TRUNCATE'
}
