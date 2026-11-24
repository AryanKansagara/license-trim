import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const text = (name: string) => readFileSync(fixture(name), 'utf8')
const money = /\$[\d,]+/

// The synthetic Fabrikam tenant is generated from a fixed seed, so the engine's output on it is exact.
const FABRIKAM = { spend: '$7,841', savings: '$24,624/yr', recs: 70, inactive: 23 }

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Tenant sections' }).getByRole('link', { name: new RegExp(`^${name}`) })

async function openSample(page: Page, tab = '') {
  await page.goto('/app?sample=fabrikam' + (tab ? `&tab=${tab}` : ''))
  await expect(page.getByRole('heading', { level: 1, name: /Fabrikam Engineering/ })).toBeVisible()
}

test('landing page leads to the sample tenant with unused and over-tiered licences and their savings', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Stop paying for seats nobody uses.' })).toBeVisible()
  await page.getByRole('link', { name: 'Try the sample tenant' }).first().click()
  await expect(page).toHaveURL(/\/app\/p\/[\w-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: /Fabrikam Engineering/ })).toBeVisible()
  await expect(page.getByText('Synthetic', { exact: false }).first()).toBeVisible()

  const savings = page.locator('.kpi', { hasText: 'Savings identified' })
  await expect(page.locator('.kpi', { hasText: 'Monthly licence spend' })).toContainText(FABRIKAM.spend)
  await expect(savings).toContainText(FABRIKAM.savings)
  await expect(page.locator('.kpi', { hasText: 'Approved so far' })).toContainText(`0 of ${FABRIKAM.recs} recommendations`)
  const byFinding = page.locator('.card', { has: page.getByRole('heading', { name: 'Savings by finding' }) })
  await expect(byFinding).toContainText('Inactive · 23$10,764')
  await expect(byFinding).toContainText('E5 features unused · 8$2,016')
  await expect(byFinding).toContainText('Disabled but licensed · 4$1,872')
  await expect(page.locator('.kpi', { hasText: 'Inactive accounts' })).toContainText(String(FABRIKAM.inactive))
  await expect(page.getByRole('table').filter({ hasText: 'Monthly now' })).toContainText('Microsoft 365 E5')
})

test('recommendations list the unused and over-tiered licences with a saving each', async ({ page }) => {
  await openSample(page, 'recommendations')
  await expect(page.getByText(`${FABRIKAM.recs} shown · ${FABRIKAM.savings}.`)).toBeVisible()
  const rows = page.locator('.rec')
  await expect(rows).toHaveCount(FABRIKAM.recs)
  await page.getByLabel('Finding').selectOption({ label: 'Inactive' })
  await expect(rows).toHaveCount(FABRIKAM.inactive)
  const inactive = rows.first()
  await expect(inactive.locator('.pill')).toHaveText('Inactive')
  await expect(inactive).toContainText('no paid licence')
  await page.getByLabel('Finding').selectOption({ label: 'E5 features unused' })
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toContainText('E5')
  await expect(rows.first()).toContainText('E3')
  await expect(rows.first().locator('.rec-save')).toContainText(money)
})

test('approving and rejecting a recommendation makes the change script follow', async ({ page }) => {
  await openSample(page, 'recommendations')
  await page.getByLabel('Finding').selectOption({ label: 'Disabled but licensed' })
  const rows = page.locator('.rec')
  const first = rows.nth(0), second = rows.nth(1)
  const upn1 = (await first.locator('.rec-who .small').innerText()).trim()
  const upn2 = (await second.locator('.rec-who .small').innerText()).trim()
  expect(upn1).toMatch(/@fabrikam-eng\.example$/)
  expect(upn2).not.toBe(upn1)

  // Nothing approved yet: the script tab asks for a decision.
  await tab(page, 'Change script').click()
  await expect(page.getByRole('heading', { name: 'Approve some changes first' })).toBeVisible()

  await tab(page, 'Recommendations').click()
  await page.getByLabel('Finding').selectOption({ label: 'Disabled but licensed' })
  await first.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Approve', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await second.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(second.getByRole('button', { name: 'Reject', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await tab(page, 'Change script').click()
  await expect(page.getByText('1 approved changes')).toBeVisible()
  const code = page.locator('.code pre code')
  await expect(code).toContainText(`Upn = '${upn1}'`)
  await expect(code).not.toContainText(upn2)
  await expect(code).toContainText('Set-MgUserLicense')
  // A blocked leaver loses the E3 and gets nothing back; the rollback script does the reverse.
  await expect(code).toContainText(`Upn = '${upn1}'; Add = @(); Remove = @('SPE_E3`)
  await page.getByRole('button', { name: 'Rollback', exact: true }).click()
  await expect(code).toContainText('License Trim ROLLBACK script')
  await expect(code).toContainText(`Upn = '${upn1}'; Add = @('SPE_E3`)
  await expect(code).toContainText('; Remove = @(); Note = \'rollback\'')
  await page.getByRole('button', { name: /^CSV/ }).click()
  const csv = page.locator('.code pre code')
  await expect(csv).toContainText(upn1)
  await expect(csv).toContainText(upn2)

  // Swap the decisions: the script follows.
  await tab(page, 'Recommendations').click()
  await page.getByLabel('Finding').selectOption({ label: 'Disabled but licensed' })
  await first.getByRole('button', { name: 'Reject', exact: true }).click()
  await second.getByRole('button', { name: 'Approve', exact: true }).click()
  await tab(page, 'Change script').click()
  await expect(code).toContainText(`Upn = '${upn2}'`)
  await expect(code).not.toContainText(upn1)

  // Rejecting the last approved change empties the script again.
  await tab(page, 'Recommendations').click()
  await page.getByLabel('Finding').selectOption({ label: 'Disabled but licensed' })
  await second.getByRole('button', { name: 'Reject', exact: true }).click()
  await tab(page, 'Change script').click()
  await expect(page.getByRole('heading', { name: 'Approve some changes first' })).toBeVisible()
})

test('decisions and the tenant survive a reload', async ({ page }) => {
  await openSample(page, 'recommendations')
  await page.getByLabel('Search').fill('')
  await page.getByLabel('Finding').selectOption({ label: 'Disabled but licensed' })
  const first = page.locator('.rec').first()
  const upn = (await first.locator('.rec-who .small').innerText()).trim()
  await first.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText(/^1 of \d+ approved/)).toBeVisible()

  await page.reload()
  await page.getByLabel('Search').fill(upn)
  const again = page.locator('.rec').filter({ hasText: upn })
  await expect(again).toHaveCount(1)
  await expect(again.getByRole('button', { name: 'Approve', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/^1 of \d+ approved/)).toBeVisible()

  await page.goto('/app')
  await expect(page.getByRole('heading', { level: 3, name: /Fabrikam Engineering/ })).toBeVisible()
  await page.getByRole('link', { name: /Fabrikam Engineering/ }).click()
  await expect(page.locator('.kpi', { hasText: 'Approved so far' })).toContainText('1 of')
})

test('importing a small synthetic Active users export creates recommendations and persists', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'New tenant' }).click()
  await page.getByLabel('Tenant or client name').fill('E2E Contoso')
  await page.getByRole('button', { name: 'Create and import' }).click()
  await expect(page).toHaveURL(/\/data$/)

  const dialog = page.getByRole('dialog', { name: 'Import Microsoft 365 exports' })
  await expect(dialog).toBeVisible()
  await dialog.locator('input[type=file]').setInputFiles(fixture('active-users.csv'))
  await expect(dialog.getByText('active-users.csv')).toBeVisible()
  await expect(dialog.getByText('4 users')).toBeVisible()
  await expect(dialog.getByText('Ready')).toBeVisible()
  await expect(dialog.getByLabel('Report type')).toHaveValue('users')
  await dialog.getByRole('button', { name: 'Import 1 report' }).click()

  await expect(page.getByText(/Imported 1 report\. 2 recommendations\./)).toBeVisible()
  await expect(page).toHaveURL(/\/overview$/)
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Contoso' })).toBeVisible()
  await expect(page.getByText('4 accounts')).toBeVisible()
  await expect(page.getByText('1 reports imported')).toBeVisible()
  await expect(page.locator('.kpi', { hasText: 'Savings identified' })).toContainText(money)

  await tab(page, 'Recommendations').click()
  await expect(page.locator('.rec')).toHaveCount(2)
  await expect(page.locator('.rec', { hasText: 'leaver.one@e2e-fixture.example' })).toContainText('Disabled but licensed')
  await expect(page.locator('.rec', { hasText: 'leaver.two@e2e-fixture.example' })).toContainText('Disabled but licensed')
  await expect(page.getByText('active.three@e2e-fixture.example')).toHaveCount(0)

  await tab(page, 'Data').click()
  const imports = page.locator('table', { hasText: 'Imported' })
  await expect(imports).toContainText('active-users.csv')
  await expect(imports).toContainText('Admin center: Active users export')

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Contoso' })).toBeVisible()
  await expect(imports).toContainText('active-users.csv')
  await tab(page, 'Users').click()
  await expect(page.getByRole('button', { name: 'Leaver One' })).toBeVisible()
  await page.goto('/app')
  await expect(page.getByRole('link', { name: /E2E Contoso/ })).toContainText('4 accounts')
})

test('pasted CSV text imports like a file', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'New tenant' }).click()
  await page.getByRole('button', { name: 'Create and import' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Microsoft 365 exports' })
  await dialog.getByText('Or paste CSV text').click()
  await dialog.getByLabel('Paste CSV').fill(text('active-users.csv'))
  await dialog.getByRole('button', { name: 'Add pasted text' }).click()
  await expect(dialog.getByText('4 users')).toBeVisible()
  await dialog.getByRole('button', { name: 'Import 1 report' }).click()
  await expect(page.getByText(/Imported 1 report\. 2 recommendations\./)).toBeVisible()
})

const unreadable: { name: string; file: { name: string; mimeType: string; buffer: Buffer } }[] = [
  { name: 'plain prose', file: { name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('this is not a csv export\njust some words\n') } },
  { name: 'a CSV that is not a licence export', file: { name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('Product,Quantity\nWidget,3\nGadget,9\n') } },
  { name: 'an empty file', file: { name: 'empty.csv', mimeType: 'text/csv', buffer: Buffer.alloc(0) } },
  { name: 'binary bytes', file: { name: 'blob.csv', mimeType: 'text/csv', buffer: Buffer.from([0, 255, 254, 0, 1, 2, 3, 0, 200, 10, 0, 0]) } },
]

for (const bad of unreadable) {
  test(`unreadable input (${bad.name}) is flagged, cannot be imported, and the app stays usable`, async ({ page }) => {
    await page.goto('/app')
    await page.getByRole('button', { name: 'New tenant' }).click()
    await page.getByRole('button', { name: 'Create and import' }).click()
    const dialog = page.getByRole('dialog', { name: 'Import Microsoft 365 exports' })
    await dialog.locator('input[type=file]').setInputFiles(bad.file)
    await expect(dialog.getByText(bad.file.name)).toBeVisible()
    await expect(dialog.getByText('Nothing to import')).toBeVisible()
    await expect(dialog.getByText('Ready')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled()

    // A good file added next to the bad one still imports, and only that one.
    await dialog.locator('input[type=file]').setInputFiles(fixture('active-users.csv'))
    await expect(dialog.getByRole('button', { name: 'Import 1 report' })).toBeEnabled()
    await dialog.getByRole('button', { name: `Remove ${bad.file.name}` }).click()
    await expect(dialog.getByText('Nothing to import')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Import 1 report' }).click()
    await expect(page.getByText(/Imported 1 report\. 2 recommendations\./)).toBeVisible()
  })
}

test('a file without a user column explains how to fix it in the validation report', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'New tenant' }).click()
  await page.getByRole('button', { name: 'Create and import' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Microsoft 365 exports' })
  await dialog.locator('input[type=file]').setInputFiles({ name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('Product,Quantity\nWidget,3\n') })
  await expect(dialog.getByText('1 error')).toBeVisible()
  await dialog.getByText('Validation report (1)').click()
  await expect(dialog.getByText(/No user principal name column found/)).toBeVisible()
  await expect(dialog.getByText('Line 1')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await page.goto('/app')
  await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible()
})

test('an Excel workbook is rejected with the instruction to export CSV', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'New tenant' }).click()
  await page.getByRole('button', { name: 'Create and import' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Microsoft 365 exports' })
  await dialog.locator('input[type=file]').setInputFiles({ name: 'users.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\u0003\u0004') })
  await expect(page.getByText('users.xlsx: export as CSV from the admin center (Export > CSV).')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled()
  await expect(dialog.getByText('users.xlsx', { exact: true })).toHaveCount(0)
})

test('an unknown route shows the not-found page and the app recovers', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page has no licence')
  await page.goto('/app/p/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Tenant not found' })).toBeVisible()
  await page.getByRole('link', { name: 'All tenants' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible()
})
