// Runs against the servers of docker-compose.test.yml:
//   docker compose -f docker-compose.test.yml up -d --wait && npm run test:integration
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectionDraft, RowsResult, StatementResult } from '@shared/types'
import { buildAlterTable, detailsToDefinition } from '@shared/sql/ddl'
import { SessionManager, type DbSession } from '../../src/main/db/session'
import { runScript, runStatement } from '../../src/main/db/query'
import * as schema from '../../src/main/db/schema'
import * as data from '../../src/main/db/data'
import * as admin from '../../src/main/db/admin'
import * as io from '../../src/main/db/io'

const SERVERS = [
  { name: 'MySQL 8.4', port: Number(process.env.MYSQL_TEST_PORT ?? 33306) },
  { name: 'MariaDB 11', port: Number(process.env.MARIADB_TEST_PORT ?? 33307) }
]

const draft = (port: number, readOnly = false): ConnectionDraft => ({
  config: {
    id: 'test',
    slug: 'test',
    name: 'Test',
    env: 'dev',
    readOnly,
    host: '127.0.0.1',
    port,
    user: 'root',
    ssl: { enabled: false, rejectUnauthorized: true },
    ssh: { enabled: false, host: '', port: 22, user: '', auth: 'agent' }
  },
  secrets: { password: 'test' },
  override: {}
})

const DB = 'mcg_test'
const job = (): io.Job => new io.Job('job', 'test', () => undefined, () => false)

function rowsOf(results: StatementResult[]): RowsResult {
  const result = results.find((r) => r.kind === 'rows')
  if (!result || result.kind !== 'rows') throw new Error(`No rows in ${JSON.stringify(results)}`)
  return result
}

async function waitForJob(run: (j: io.Job) => Promise<void>): Promise<io.Job> {
  const j = job()
  await run(j)
  return j
}

describe.each(SERVERS)('$name', ({ port }) => {
  let dir: string
  let sessions: SessionManager
  let session: DbSession

  const exec = async (sql: string): Promise<StatementResult[]> => {
    const tab = await sessions.tab(session.info.sessionId, 'tab')
    const results = await runScript(tab.connection, sql, 1000, true)
    const error = results.find((r) => r.kind === 'error')
    if (error && error.kind === 'error') throw new Error(error.message)
    return results
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcg-it-'))
    sessions = new SessionManager(dir)
    const info = await sessions.open('test', draft(port))
    session = sessions.get(info.sessionId)
    await exec(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci; USE ${DB};`)
    await exec(`
      CREATE TABLE accounts (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL DEFAULT 'none',
        balance DECIMAL(10,2) NULL,
        data JSON NULL,
        avatar BLOB NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_name (name)
      ) ENGINE=InnoDB;
      CREATE TABLE orders (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        account_id INT UNSIGNED NOT NULL,
        amount INT NOT NULL,
        note TEXT,
        CONSTRAINT fk_orders_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
      INSERT INTO accounts (name, balance, data, avatar) VALUES
        ('alice', 10.50, '{"a": 1}', X'00FF10'),
        ('bob', NULL, NULL, NULL),
        ('it''s; tricky', -3, '[1,2]', NULL);
      INSERT INTO orders (account_id, amount, note) VALUES (1, 5, 'first'), (1, 7, NULL), (2, 1, 'line\\nbreak');
      CREATE VIEW big_orders AS SELECT id, amount FROM orders WHERE amount > 4;
    `)
    await exec(`
      DELIMITER $$
      CREATE PROCEDURE two_results() BEGIN SELECT 1 AS a; SELECT 2 AS b, 3 AS c; END$$
      CREATE TRIGGER orders_bi BEFORE INSERT ON orders FOR EACH ROW BEGIN SET NEW.amount = ABS(NEW.amount); END$$
      DELIMITER ;
    `)
  })

  afterAll(async () => {
    if (session) {
      const pool = session.pool
      if (!process.env.KEEP_TEST_DB) await pool.query(`DROP DATABASE IF EXISTS ${DB}`).catch(() => undefined)
      if (!process.env.KEEP_TEST_DB) await pool.query(`DROP DATABASE IF EXISTS ${DB}_restored`).catch(() => undefined)
      await pool.query(`DROP USER IF EXISTS 'mcg_user'@'%'`).catch(() => undefined)
    }
    await sessions?.closeAll()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('queries', () => {
    it('returns typed values as strings, numbers and bytes', async () => {
      const result = rowsOf(await exec(`SELECT id, name, balance, data, avatar, created_at FROM ${DB}.accounts ORDER BY id`))
      expect(result.columns.map((c) => c.name)).toEqual(['id', 'name', 'balance', 'data', 'avatar', 'created_at'])
      expect(result.columns[0]).toMatchObject({ primaryKey: true, nullable: false, table: 'accounts' })
      const [alice, bob] = result.rows
      expect(alice[0]).toBe(1)
      expect(alice[2]).toBe('10.50')
      expect(JSON.parse(alice[3] as string)).toEqual({ a: 1 })
      expect(alice[4]).toEqual(new Uint8Array([0, 255, 16]))
      expect(alice[5]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      expect(bob[2]).toBeNull()
    })

    it('limits the rows kept', async () => {
      const tab = await sessions.tab(session.info.sessionId, 'tab')
      const [result] = await runStatement(tab.connection, 'SELECT * FROM information_schema.COLUMNS', 5)
      expect(result).toMatchObject({ kind: 'rows', truncated: true })
      expect((result as RowsResult).rows).toHaveLength(5)
    })

    it('returns every result set of a procedure', async () => {
      const results = await exec(`CALL ${DB}.two_results()`)
      const rows = results.filter((r) => r.kind === 'rows') as RowsResult[]
      expect(rows.map((r) => r.rows)).toEqual([[[1]], [[2, 3]]])
      expect(results.at(-1)?.kind).toBe('ok')
    })

    it('reports errors and stops', async () => {
      const tab = await sessions.tab(session.info.sessionId, 'tab')
      const results = await runScript(tab.connection, 'SELECT 1; SELECT * FROM nope_missing; SELECT 2', 10, true)
      expect(results.map((r) => r.kind)).toEqual(['rows', 'error'])
    })

    it('keeps USE on the tab connection', async () => {
      await exec('USE mysql')
      const tab = await sessions.tab(session.info.sessionId, 'tab')
      const [result] = await runStatement(tab.connection, 'SELECT DATABASE()', 1)
      expect((result as RowsResult).rows[0][0]).toBe('mysql')
    })

    it('cancels a running statement', async () => {
      const tab = await sessions.tab(session.info.sessionId, 'slow')
      const started = Date.now()
      const running = runStatement(tab.connection, 'SELECT SLEEP(20)', 1)
      await new Promise((r) => setTimeout(r, 300))
      await sessions.cancel(session.info.sessionId, 'slow')
      const results = await running
      expect(Date.now() - started).toBeLessThan(10_000)
      // MySQL returns 1 for an interrupted SLEEP, MariaDB an error.
      expect(['rows', 'error']).toContain(results[0].kind)
    })
  })

  describe('schema', () => {
    it('lists objects', async () => {
      const objects = await schema.objects(session.pool, DB)
      expect(objects.tables.map((t) => [t.name, t.kind])).toEqual([
        ['accounts', 'table'],
        ['big_orders', 'view'],
        ['orders', 'table']
      ])
      expect(objects.routines).toMatchObject([{ name: 'two_results', kind: 'procedure' }])
      expect(objects.triggers).toMatchObject([{ name: 'orders_bi', table: 'orders', timing: 'BEFORE', event: 'INSERT' }])
    })

    it('describes columns, keys and normalised defaults', async () => {
      const details = await schema.tableDetails(session.pool, DB, 'accounts', session.info.isMariaDb)
      expect(details.primaryKey).toEqual(['id'])
      const byName = Object.fromEntries(details.columns.map((c) => [c.name, c]))
      expect(byName.name).toMatchObject({ default: 'none', defaultIsExpression: false, nullable: false })
      expect(byName.created_at.defaultIsExpression).toBe(true)
      expect(byName.created_at.default?.toLowerCase()).toMatch(/^current_timestamp/)
      expect(byName.balance).toMatchObject({ default: null, nullable: true })
      expect(details.indexes.map((i) => i.name)).toEqual(['PRIMARY', 'uniq_name'])
      expect(details.referencedBy).toMatchObject([
        { name: 'fk_orders_account', refTable: 'orders', columns: ['account_id'], refColumns: ['id'], onDelete: 'CASCADE' }
      ])
      const orders = await schema.tableDetails(session.pool, DB, 'orders', session.info.isMariaDb)
      expect(orders.foreignKeys).toMatchObject([{ name: 'fk_orders_account', refTable: 'accounts', columns: ['account_id'], refColumns: ['id'] }])
    })

    it('round-trips an existing table through the structure editor without changes', async () => {
      for (const table of ['accounts', 'orders']) {
        const definition = detailsToDefinition(await schema.tableDetails(session.pool, DB, table, session.info.isMariaDb))
        expect(buildAlterTable(definition, structuredClone(definition))).toEqual([])
      }
    })

    it('applies the ALTER statements generated by the structure editor', async () => {
      const original = detailsToDefinition(await schema.tableDetails(session.pool, DB, 'orders', session.info.isMariaDb))
      const modified = structuredClone(original)
      modified.columns.splice(2, 0, { name: 'status', type: 'varchar(20)', nullable: false, default: 'new', autoIncrement: false })
      modified.columns = modified.columns.map((c) => (c.name === 'note' ? { ...c, name: 'comment', comment: 'Free text' } : c))
      modified.indexes.push({ name: 'idx_status', kind: 'INDEX', columns: [{ name: 'status' }] })
      modified.foreignKeys[0].onDelete = 'RESTRICT'
      const statements = buildAlterTable(original, modified)
      await exec(statements.join(';\n'))

      const after = detailsToDefinition(await schema.tableDetails(session.pool, DB, 'orders', session.info.isMariaDb))
      expect(after.columns.map((c) => c.name)).toEqual(['id', 'account_id', 'status', 'amount', 'comment'])
      expect(after.columns.find((c) => c.name === 'comment')?.comment).toBe('Free text')
      expect(after.foreignKeys[0].onDelete).toBe('RESTRICT')
      // Re-applying the same target is a no-op.
      expect(buildAlterTable(after, { ...modified, columns: modified.columns.map((c) => ({ ...c, originalName: c.name })) })).toEqual([])
    })

    it('reads CREATE statements', async () => {
      expect(await schema.createStatementFromPool(session.pool, DB, 'orders', 'table')).toMatch(/^CREATE TABLE `orders`/)
      expect(await schema.createStatementFromPool(session.pool, DB, 'two_results', 'procedure')).toMatch(/PROCEDURE `two_results`/)
      expect(await schema.createStatementFromPool(session.pool, DB, 'orders_bi', 'trigger')).toMatch(/TRIGGER `?orders_bi`?/)
    })

    it('builds the completion schema', async () => {
      const completion = await schema.completion(session.pool, DB)
      expect(completion.accounts).toContain('balance')
    })
  })

  describe('table data', () => {
    it('filters, sorts and paginates', async () => {
      const page = await data.fetchTableData(session.pool, {
        sessionId: '',
        database: DB,
        table: 'accounts',
        filters: [{ column: 'name', operator: 'CONTAINS', value: "'s;" }],
        sort: [{ column: 'id', direction: 'DESC' }],
        limit: 10,
        offset: 0
      })
      expect(page.rows.map((r) => r[1])).toEqual(["it's; tricky"])
      const count = await data.countRows(session.pool, { sessionId: '', database: DB, table: 'accounts', filters: [], rawWhere: 'balance IS NULL' })
      expect(count).toBe(1)
    })

    it('applies edits in one transaction', async () => {
      await data.applyRowChanges(session.pool, {
        sessionId: '',
        database: DB,
        table: 'accounts',
        changes: [
          { type: 'update', key: { id: 2 }, values: { balance: '99.99', name: 'bobby' } },
          { type: 'insert', values: { name: 'carol', avatar: new Uint8Array([1, 2]) } },
          { type: 'delete', key: { id: 3 } }
        ]
      })
      const rows = rowsOf(await exec(`SELECT name, balance, HEX(avatar) FROM ${DB}.accounts ORDER BY id`)).rows
      expect(rows).toEqual([
        ['alice', '10.50', '00FF10'],
        ['bobby', '99.99', null],
        ['carol', null, '0102']
      ])
    })

    it('rolls back every change when one fails', async () => {
      await expect(
        data.applyRowChanges(session.pool, {
          sessionId: '',
          database: DB,
          table: 'accounts',
          changes: [
            { type: 'update', key: { id: 1 }, values: { name: 'changed' } },
            { type: 'insert', values: { name: 'bobby' } }
          ]
        })
      ).rejects.toThrow(/Duplicate/)
      expect(rowsOf(await exec(`SELECT name FROM ${DB}.accounts WHERE id = 1`)).rows).toEqual([['alice']])
    })
  })

  describe('import / export', () => {
    it('dumps a database and restores it identically', async () => {
      const file = join(dir, 'dump.sql')
      await waitForJob((j) =>
        io.runDump(
          session.pool,
          {
            sessionId: '',
            database: DB,
            tables: [],
            structure: true,
            data: true,
            dropStatements: true,
            routines: true,
            triggers: true,
            events: true,
            rowsPerInsert: 2,
            filePath: file
          },
          j
        )
      )
      const dump = readFileSync(file, 'utf8')
      expect(dump).toContain('CREATE TABLE `accounts`')
      expect(dump).toContain('DELIMITER ;;')
      expect(dump).not.toMatch(/DEFINER=/)
      // References to the dumped database are not qualified, so it restores anywhere.
      expect(dump).not.toContain(`\`${DB}\`.`)

      await exec(`CREATE DATABASE ${DB}_restored`)
      const importJob = await waitForJob((j) =>
        io.importSql(session.pool, { sessionId: '', database: `${DB}_restored`, filePath: file, stopOnError: true }, statSync(file).size, j)
      )
      expect(importJob.warnings).toEqual([])
      for (const table of ['accounts', 'orders']) {
        // CHECKSUM TABLE is not comparable across tables on MariaDB: compare the rows.
        const content = async (db: string): Promise<unknown> => rowsOf(await exec(`SELECT * FROM ${db}.${table} ORDER BY id`)).rows
        const original = await content(DB)
        expect(original).not.toEqual([])
        expect(await content(`${DB}_restored`)).toEqual(original)
      }
      const objects = await schema.objects(session.pool, `${DB}_restored`)
      expect(objects.routines.map((r) => r.name)).toEqual(['two_results'])
      expect(objects.triggers.map((t) => t.name)).toEqual(['orders_bi'])
      expect(objects.tables.map((t) => t.name)).toContain('big_orders')
    })

    it('exports a table in every format', async () => {
      for (const format of ['csv', 'json', 'xlsx', 'sql'] as const) {
        const file = join(dir, `accounts.${format}`)
        await waitForJob((j) => io.exportTable(session.pool, { sessionId: '', database: DB, table: 'accounts', format, filePath: file }, j))
        expect(existsSync(file)).toBe(true)
        if (format === 'json') {
          const rows = JSON.parse(readFileSync(file, 'utf8'))
          expect(rows[0]).toMatchObject({ id: 1, name: 'alice', avatar: '0x00ff10' })
        }
        if (format === 'csv') expect(readFileSync(file, 'utf8').split('\r\n')[0]).toBe('id,name,balance,data,avatar,created_at')
      }
    })

    it('imports a CSV file with a column mapping', async () => {
      const file = join(dir, 'import.csv')
      writeFileSync(file, 'label;ignored;money\n"dave; jr";x;12.5\nerin;y;NULL\n')
      const preview = await io.previewCsv(file)
      expect(preview).toMatchObject({ delimiter: ';', headers: ['label', 'ignored', 'money'] })
      const j = await waitForJob((jb) =>
        io.importCsv(
          session.pool,
          {
            sessionId: '',
            database: DB,
            table: 'accounts',
            filePath: file,
            delimiter: ';',
            hasHeader: true,
            mapping: ['name', null, 'balance'],
            nullValue: 'NULL',
            batchSize: 1,
            mode: 'insert'
          },
          jb
        )
      )
      expect(j.done).toBe(2)
      const rows = rowsOf(await exec(`SELECT name, balance FROM ${DB}.accounts WHERE name IN ('dave; jr', 'erin') ORDER BY name`)).rows
      expect(rows).toEqual([
        ['dave; jr', '12.50'],
        ['erin', null]
      ])
    })
  })

  describe('administration', () => {
    it('lists processes, variables and status', async () => {
      expect((await admin.processes(session.pool, true)).length).toBeGreaterThan(0)
      expect((await admin.variables(session.pool, 'GLOBAL')).some((v) => v.name === 'max_connections')).toBe(true)
      expect((await admin.status(session.pool)).some((v) => v.name === 'Uptime')).toBe(true)
    })

    it('manages users and privileges', async () => {
      await admin.createUser(session.pool, 'mcg_user', '%', 'p@ss')
      await admin.grant(session.pool, {
        sessionId: '',
        user: 'mcg_user',
        host: '%',
        level: { kind: 'database', database: DB },
        privileges: ['SELECT', 'INSERT'],
        withGrantOption: false
      })
      expect((await admin.grants(session.pool, 'mcg_user', '%')).join('\n')).toMatch(/GRANT SELECT, INSERT ON `mcg_test`\.\*/)
      await admin.revoke(session.pool, {
        sessionId: '',
        user: 'mcg_user',
        host: '%',
        level: { kind: 'database', database: DB },
        privileges: ['INSERT'],
        withGrantOption: false
      })
      expect((await admin.grants(session.pool, 'mcg_user', '%')).join('\n')).not.toMatch(/INSERT/)
      expect((await admin.users(session.pool)).some((u) => u.user === 'mcg_user')).toBe(true)
      await admin.dropUser(session.pool, 'mcg_user', '%')
    })

    it('runs table maintenance', async () => {
      const results = await admin.maintenance(session.pool, DB, ['accounts'], 'ANALYZE')
      expect(rowsOf(results).rows[0][0]).toBe(`${DB}.accounts`)
    })
  })

  describe('read-only connections', () => {
    it('refuses writes', async () => {
      const info = await sessions.open('ro', draft(port, true))
      const readOnly = sessions.get(info.sessionId)
      expect(() => sessions.assertWritable(readOnly, ['SELECT 1'])).not.toThrow()
      expect(() => sessions.assertWritable(readOnly, [`DELETE FROM ${DB}.accounts`])).toThrow(/read-only/)
      // The server refuses writes too, even if a statement slipped through.
      await expect(readOnly.pool.query(`UPDATE ${DB}.accounts SET name = name`)).rejects.toThrow(/READ ONLY/i)
      await sessions.close(info.sessionId)
    })
  })
})
