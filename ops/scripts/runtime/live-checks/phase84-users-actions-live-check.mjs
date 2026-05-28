/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, closeTopModal, attachConsoleCollector } from './live-check-utils.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-users-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'users-actions.png')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}





async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`)
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages = []
    const observedRequests = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(users|roles|action-history)/i.test(url)) observedRequests.push({ status: response.status(), url })
    })

    const usersRead = waitForRead(page, observedRequests, /\/api\/users(?:\?|$)/i, 'Users list read')
    const rolesRead = waitForRead(page, observedRequests, /\/api\/roles(?:\?|$)/i, 'Roles list read')
    await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByRole('heading', { name: /Users/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const usersStatus = await usersRead
    const rolesStatus = await rolesRead

    const users = await page.evaluate(async () => window.api.getUsers())
    assert(Array.isArray(users) && users.length > 0, 'No users were available for the Users action UI check')
    const currentUser = session.payload.user || {}
    const currentSearch = String(currentUser.username || currentUser.name || USERNAME).trim()
    if (currentSearch) {
      await page.locator('#users-search').fill(currentSearch)
      await page.waitForTimeout(200)
    }
    const firstUserRow = page.locator('tbody tr.table-row').first()
    await firstUserRow.waitFor({ state: 'visible', timeout: 20_000 })
    const renderedUserRows = await page.locator('tbody tr.table-row').count()
    assert(renderedUserRows > 0, 'No user rows were rendered after search')

    await page.getByRole('button', { name: /Add user/i }).click()
    const addUserModal = page.locator('.fixed.inset-0').last()
    await addUserModal.locator('#user-name').waitFor({ state: 'visible', timeout: 15_000 })
    await addUserModal.locator('#user-password').waitFor({ state: 'visible', timeout: 15_000 })
    const addUserSaveVisible = await addUserModal.getByRole('button', { name: /^Save$/i }).isVisible()
    assert(addUserSaveVisible, 'Add user save button did not render')
    await closeTopModal(page)

    await firstUserRow.locator('.three-dot-btn').click()
    await page.getByRole('button', { name: /Change password/i }).click()
    const passwordModal = page.locator('.fixed.inset-0').last()
    await passwordModal.locator('#reset-password-current').waitFor({ state: 'visible', timeout: 15_000 })
    await passwordModal.locator('#reset-password-new').waitFor({ state: 'visible', timeout: 15_000 })
    await passwordModal.locator('#reset-password-confirm').waitFor({ state: 'visible', timeout: 15_000 })
    const changePasswordButtonVisible = await passwordModal.getByRole('button', { name: /Change password/i }).isVisible()
    assert(changePasswordButtonVisible, 'Change password submit button did not render')
    await closeTopModal(page)

    await page.getByRole('button', { name: /^Roles$/i }).click()
    await page.getByRole('button', { name: /Create role/i }).waitFor({ state: 'visible', timeout: 15_000 })
    const roleCards = await page.locator('.card').filter({ hasText: /user\(s\) still assigned|Full access|No permissions/i }).count()
    assert(roleCards > 0, 'No role cards were rendered')
    const roleEditButtons = await page.getByRole('button', { name: /^Edit$/i }).count()
    assert(roleEditButtons > 0, 'Role edit controls did not render')
    const roleDeleteButtons = await page.getByRole('button', { name: /^Delete$/i }).count()

    await page.getByRole('button', { name: /Create role/i }).click()
    const createRoleModal = page.locator('.fixed.inset-0').last()
    await createRoleModal.locator('#role-name').waitFor({ state: 'visible', timeout: 15_000 })
    await createRoleModal.getByText('Permissions', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const createRoleSaveVisible = await createRoleModal.getByRole('button', { name: /^Save$/i }).isVisible()
    assert(createRoleSaveVisible, 'Create role save button did not render')
    await closeTopModal(page)

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        usersPageVisible: true,
        usersStatus,
        rolesStatus,
        userRows: renderedUserRows,
        addUserModalOpened: true,
        addUserSaveVisible,
        passwordModalOpened: true,
        changePasswordButtonVisible,
        rolesTabOpened: true,
        roleCards,
        roleEditButtons,
        roleDeleteButtons,
        createRoleModalOpened: true,
        createRoleSaveVisible,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        users: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
