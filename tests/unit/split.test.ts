import { describe, expect, it } from 'vitest'
import { StatementSplitter, splitStatements, statementAt } from '@shared/sql/split'

const sqls = (input: string): string[] => splitStatements(input).map((s) => s.sql)

describe('splitStatements', () => {
  it('splits on semicolons and trims', () => {
    expect(sqls('SELECT 1;  SELECT 2 ;\nSELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
  })

  it('ignores delimiters inside quotes and identifiers', () => {
    expect(sqls(`SELECT 'a;b', "c;d", \`e;f\`; SELECT 'it''s;'; SELECT 'x\\';y'`)).toEqual([
      `SELECT 'a;b', "c;d", \`e;f\``,
      `SELECT 'it''s;'`,
      `SELECT 'x\\';y'`
    ])
  })

  it('ignores delimiters inside comments and drops comment-only statements', () => {
    expect(sqls('-- first; comment\nSELECT 1 /* ; */;\n# other;\n;/* only */;SELECT 2')).toEqual([
      'SELECT 1 /* ; */',
      'SELECT 2'
    ])
  })

  it('keeps version-conditional comments as statements', () => {
    expect(sqls('/*!40101 SET NAMES utf8 */;\nSELECT 1;')).toEqual(['/*!40101 SET NAMES utf8 */', 'SELECT 1'])
  })

  it('does not treat -- without a space as a comment', () => {
    expect(sqls('SELECT 1--1;SELECT 2')).toEqual(['SELECT 1--1', 'SELECT 2'])
  })

  it('handles the DELIMITER command', () => {
    const script = [
      'DELIMITER $$',
      'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$',
      'DELIMITER ;',
      'CALL p();'
    ].join('\n')
    expect(sqls(script)).toEqual(['CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END', 'CALL p()'])
  })

  it('reports offsets of each statement', () => {
    const input = '  SELECT 1;\n\nSELECT 2;'
    const [first, second] = splitStatements(input)
    expect(input.slice(first.start, first.end)).toBe('SELECT 1')
    expect(input.slice(second.start, second.end)).toBe('SELECT 2')
  })

  it('gives the same result when fed in chunks', () => {
    const script = "INSERT INTO t VALUES ('a;\nb');\nDELIMITER //\nCREATE TRIGGER x BEFORE INSERT ON t FOR EACH ROW BEGIN SET @a = 1; END//\nDELIMITER ;\nSELECT 1;"
    const whole = splitStatements(script)
    for (const size of [1, 3, 7, 16]) {
      const splitter = new StatementSplitter()
      const out = []
      for (let i = 0; i < script.length; i += size) out.push(...splitter.push(script.slice(i, i + size)))
      out.push(...splitter.end())
      expect(out).toEqual(whole)
    }
  })
})

describe('statementAt', () => {
  const input = 'SELECT 1;\nSELECT 2;\n\nSELECT 3'
  it('finds the statement containing the cursor', () => {
    expect(statementAt(input, input.indexOf('2'))?.sql).toBe('SELECT 2')
  })
  it('falls back to the previous statement when the cursor is between two', () => {
    expect(statementAt(input, input.indexOf('\n\n') + 1)?.sql).toBe('SELECT 2')
  })
})
