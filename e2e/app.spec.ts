// End-to-end smoke test of the packaged renderer against the MySQL server of
// docker-compose.test.yml. Run with: npm run test:e2e
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const MYSQL_PORT = process.env.MYSQL_TEST_PORT ?? '33306'

let app: ElectronApplication
let page: Page
let dataDir: string

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'mcg-e2e-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, MYSQL_CLIENT_GUI_DATA_DIR: dataDir, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@example.com' }
  })
  page = await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('creates a workspace and a connection, runs a query and edits a row', async () => {
  // Workspace.
  await page.getByRole('button', { name: 'Add workspace' }).click()
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByPlaceholder('Client A').fill('E2E workspace')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('E2E workspace').first()).toBeVisible()

  // Connection.
  await page.getByRole('button', { name: 'New connection' }).first().click()
  await page.getByPlaceholder('Production — main DB').fill('Local MySQL')
  const form = page.locator('form')
  await form.locator('input').nth(3).fill('127.0.0.1') // host
  await form.locator('input[type=number]').first().fill(MYSQL_PORT)
  await form.locator('input[type=password]').first().fill('test')
  await page.getByRole('button', { name: 'Test' }).click()
  await expect(page.getByText(/^Connected: /)).toBeVisible()
  await page.getByRole('button', { name: 'Save & connect' }).click()
  await expect(page.getByLabel('Disconnect')).toBeVisible()

  // The connection is a file of the workspace repository, without the password.
  const workspaces = join(dataDir, 'workspaces')
  const repo = join(workspaces, readdirSync(workspaces)[0])
  const connectionFile = join(repo, 'connections', 'local-mysql.json')
  expect(existsSync(connectionFile)).toBe(true)
  expect(readFileSync(connectionFile, 'utf8')).not.toContain('"password"')

  // Query.
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.type(
    "CREATE DATABASE IF NOT EXISTS e2e_db; DROP TABLE IF EXISTS e2e_db.items; CREATE TABLE e2e_db.items (id INT PRIMARY KEY, label VARCHAR(20)); INSERT INTO e2e_db.items VALUES (1, 'one'), (2, 'two'); SELECT label FROM e2e_db.items ORDER BY id;"
  )
  await page.keyboard.press('Control+Shift+Enter')
  // DROP asks for a confirmation.
  await expect(page.getByRole('dialog', { name: 'Confirm' })).toContainText('DROP TABLE IF EXISTS e2e_db.items')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.locator('.ag-cell').filter({ hasText: 'two' })).toBeVisible()

  // Edit a row from the table view.
  await page.getByRole('button', { name: 'Refresh' }).first().click()
  const treeItem = (name: string) => page.locator('span.truncate').getByText(name, { exact: true }).first()
  await treeItem('e2e_db').click()
  await treeItem('items').click()
  const cell = page.getByRole('gridcell', { name: 'one', exact: true }).filter({ visible: true })
  await cell.dblclick()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('uno')
  await page.keyboard.press('Enter')
  await expect(page.getByText('1 pending')).toBeVisible()
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByText(/1 change\(s\) applied/)).toBeVisible()

  // Tabs are grouped by database: the table in e2e_db, the query without database.
  const group = (name: string) => page.getByTitle(name === 'No database' ? name : `Database ${name}`, { exact: true })
  await expect(group('e2e_db')).toBeVisible()
  await expect(group('No database')).toBeVisible()
  await page.screenshot({ path: 'test-results/tab-groups.png' })

  // A query follows the database selected in its editor.
  await group('No database').click()
  await page.locator('select').filter({ hasText: 'No database' }).selectOption('e2e_db')
  await expect(group('No database')).toHaveCount(0)
  await expect(group('e2e_db')).toContainText('2')

  // Privileges: a whole group at once, and the SSL requirement of the account.
  await page.getByLabel('Server').click()
  await page.getByRole('button', { name: 'Users & privileges' }).click()
  await page.getByRole('button', { name: 'User', exact: true }).click()
  const createDialog = page.getByRole('dialog', { name: 'Create user' })
  const user = `e2e_${Date.now()}` // the test server outlives a run
  await createDialog.locator('input').first().fill(user)
  await createDialog.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: `${user} @%` }).click()
  await page.getByRole('button', { name: 'Privileges', exact: true }).click()
  const privileges = page.getByRole('dialog', { name: `Privileges of ${user}@%` })
  await privileges.getByLabel('Data', { exact: true }).check()
  await expect(privileges.getByLabel(/^FILE/)).toBeChecked()
  await privileges.getByLabel(/^FILE/).uncheck()
  expect(await privileges.getByLabel('Data', { exact: true }).evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true)
  await privileges.getByLabel(/REQUIRE SSL/).check()
  await expect(privileges.locator('pre')).toContainText(`ALTER USER '${user}'@'%' REQUIRE SSL`)
  await page.screenshot({ path: 'test-results/privileges.png' })
  await privileges.getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('SSL required')).toBeVisible()
  await expect(privileges.locator('pre')).toHaveCount(0) // nothing left to apply
})
