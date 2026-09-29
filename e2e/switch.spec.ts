// Switching between the MySQL and MariaDB servers of docker-compose.test.yml.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

async function addConnection(page: Page, name: string, port: string) {
  await page.getByRole('button', { name: 'New connection' }).first().click()
  await page.getByPlaceholder('Production — main DB').fill(name)
  const form = page.locator('form')
  await form.locator('input[type=number]').first().fill(port)
  await form.locator('input[type=password]').first().fill('test')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Connection saved')).toBeVisible()
}

test('switches between connections without disconnecting', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mcg-shot-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, SIMONE_DATA_DIR: dataDir } })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'Add workspace' }).click()
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByPlaceholder('Client A').fill('A')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await addConnection(page, 'MySQL test', '33306')
  await addConnection(page, 'MariaDB test', '33307')
  await page.getByRole('button', { name: 'Save & connect' }).click()
  await expect(page.getByTitle('Switch connection (Ctrl+Shift+K)')).toContainText('MariaDB test')
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('SELECT VERSION();')

  // Switch with the header list, without disconnecting.
  await page.getByTitle('Switch connection (Ctrl+Shift+K)').click()
  await page.getByPlaceholder('Switch to connection…').fill('mysql')
  await page.keyboard.press('Enter')
  await expect(page.getByTitle('Switch connection (Ctrl+Shift+K)')).toContainText('MySQL test')
  await expect(page.getByText('MySQL 8.4').first()).toBeVisible()

  // Back with the shortcut: the query tab of MariaDB is restored.
  await page.keyboard.press('Control+Shift+K')
  await page.getByPlaceholder('Switch to connection…').fill('maria')
  await page.keyboard.press('Enter')
  await expect(page.getByTitle('Switch connection (Ctrl+Shift+K)')).toContainText('MariaDB test')
  await expect(page.locator('.cm-content').first()).toContainText('SELECT VERSION();')
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})
