/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page, Response } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole, readJson } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `move766-product-write-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/move766-product-write-live-check-latest.json')

type ConsoleEntry = { type: string; text: string }
type ObservedResponse = { method: string; resourceType: string; status: number; url: string }
type RuntimeHealth = { status?: string; runtime?: { sourceHash?: string; frontend?: { hash?: string } } }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assetName(url: string): string {
  try {
    return path.basename(new URL(url).pathname)
  } catch {
    return path.basename(url)
  }
}

function observeResponse(response: Response, responses: ObservedResponse[], scripts: Set<string>): void {
  const request = response.request()
  const resourceType = request.resourceType()
  const url = response.url()
  if (resourceType === 'script') scripts.add(assetName(url))
  if (/\/api\/products|\/api\/action-history|\/api\/users/i.test(url)) {
    responses.push({
      method: request.method(),
      resourceType,
      status: response.status(),
      url,
    })
  }
}

async function openAddProductModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Product$/i }).last().click()
  const addModal = page.locator('.fixed.inset-0').last()
  await addModal.getByRole('heading', { name: /Add Product/i }).waitFor({ state: 'visible', timeout: 20_000 })
  await addModal.locator('#product-name').waitFor({ state: 'visible', timeout: 10_000 })
}

async function saveNewProduct(page: Page, productName: string): Promise<void> {
  const addModal = page.locator('.fixed.inset-0').last()
  await addModal.locator('#product-name').fill(productName)
  await addModal.locator('#product-sku').fill(`QA-${Date.now()}`)
  const saveResponse = page.waitForResponse(
    (response) => /\/api\/products$/i.test(response.url()) && response.request().method() === 'POST',
    { timeout: 20_000 },
  )
  await addModal.getByRole('button', { name: /^Save$/i }).click()
  const response = await saveResponse
  assert(response.status() >= 200 && response.status() < 300, `Create product returned HTTP ${response.status()}`)
  await addModal.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
}

async function searchProduct(page: Page, productName: string): Promise<void> {
  const search = page.getByPlaceholder(/search products/i).first()
  await search.fill(productName)
  await page.waitForResponse(
    (response) => /\/api\/products\/search/i.test(response.url()) && response.status() === 200,
    { timeout: 20_000 },
  ).catch(() => {})
  await page.getByText(productName, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function deleteVisibleProduct(page: Page): Promise<void> {
  const actionButtons = page.getByRole('button', { name: /Open actions menu|Actions/i })
  const actionCount = await actionButtons.count()
  assert(actionCount > 0, 'No product row action button was rendered for the created product')
  await actionButtons.first().click()
  await page.getByRole('button', { name: /^Delete$/i }).first().waitFor({ state: 'visible', timeout: 10_000 })
  const deleteResponse = page.waitForResponse(
    (response) => /\/api\/products\/\d+$/i.test(response.url()) && response.request().method() === 'DELETE',
    { timeout: 20_000 },
  )
  await page.getByRole('button', { name: /^Delete$/i }).first().click()
  const response = await deleteResponse
  assert(response.status() >= 200 && response.status() < 300, `Delete product returned HTTP ${response.status()}`)
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  assert(health.status === 'ok', 'Runtime health is not ok')

  const productName = `QA Product Move766 ${Date.now()}`
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedResponses: ObservedResponse[] = []
    const loadedScripts = new Set<string>()
    attachConsoleCollector(page, consoleMessages, {
      ignoreConsole: (message) => isIgnoredConsole(message) || /ResizeObserver loop/i.test(String(message || '')),
    })
    page.on('response', (response) => observeResponse(response, observedResponses, loadedScripts))
    page.on('dialog', async (dialog) => {
      if (/delete|remove/i.test(dialog.message())) await dialog.accept()
      else await dialog.dismiss()
    })

    const navStarted = Date.now()
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const readyMs = Date.now() - navStarted
    await page.waitForTimeout(400)
    const scriptsBeforeWrite = [...loadedScripts].sort()

    await openAddProductModal(page)
    await saveNewProduct(page, productName)
    await searchProduct(page, productName)
    await deleteVisibleProduct(page)
    await page.waitForTimeout(600)
    const scriptsAfterWrite = [...loadedScripts].sort()

    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    const createCalls = observedResponses.filter((entry) => /\/api\/products$/i.test(entry.url) && entry.method === 'POST')
    const deleteCalls = observedResponses.filter((entry) => /\/api\/products\/\d+$/i.test(entry.url) && entry.method === 'DELETE')
    const broadApiMethodsBeforeWrite = scriptsBeforeWrite.some((name) => /^app-api-methods-/i.test(name))
    const broadApiMethodsLoaded = scriptsAfterWrite.some((name) => /^app-api-methods-/i.test(name))
    const broadApiMethodsNewlyLoaded = scriptsAfterWrite
      .filter((name) => /^app-api-methods-/i.test(name))
      .some((name) => !scriptsBeforeWrite.includes(name))
    const productWriteLoaded = scriptsAfterWrite.some((name) => /^product-write-api-/i.test(name))

    const screenshotPath = path.join(REPORT_DIR, 'products-after-delete.png')
    await page.screenshot({ path: screenshotPath, fullPage: false })
    const report = {
      baseUrl: BASE_URL,
      productName,
      health: {
        status: health.status,
        frontendHash: health.runtime?.frontend?.hash || null,
        sourceHash: health.runtime?.sourceHash || null,
      },
      timings: { productsReadyMs: readyMs },
      checks: {
        createCalls: createCalls.length,
        deleteCalls: deleteCalls.length,
        productWriteLoaded,
        broadApiMethodsBeforeWrite,
        broadApiMethodsLoaded,
        broadApiMethodsNewlyLoaded,
        relevantConsoleMessages: relevantConsole.length,
      },
      scriptsBeforeWrite,
      scriptsAfterWrite,
      observedResponses,
      screenshotPath,
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    assert(createCalls.length >= 1, 'Product create API call was not observed')
    assert(deleteCalls.length >= 1, 'Product delete API call was not observed')
    assert(productWriteLoaded, 'Product write chunk was not loaded during create/delete intent')
    assert(!broadApiMethodsNewlyLoaded, 'Broad app-api-methods chunk loaded during product write intent')
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
