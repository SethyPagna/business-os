/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole, readJson, waitForRead } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-catalog-editor-select-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'catalog-editor-selects.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { method: string; status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}

type SelectCheck = {
  id: string
  optionCount: number
  selectedText: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function openSharedSelect(page: Page, selector: string, id: string, minimumOptions = 1): Promise<SelectCheck> {
  const button = page.locator(selector)
  await button.waitFor({ state: 'visible', timeout: 20_000 })
  const selectedText = (await button.innerText()).trim()
  await button.click()
  const listbox = page.getByRole('listbox').last()
  await listbox.waitFor({ state: 'visible', timeout: 10_000 })
  const optionCount = await listbox.getByRole('option').count()
  assert(optionCount >= minimumOptions, `${id} expected at least ${minimumOptions} options, got ${optionCount}`)
  const menuClass = await listbox.getAttribute('class')
  assert(/\brounded-2xl\b/.test(menuClass || ''), `${id} did not render the shared rounded AppSelect menu`)
  await page.keyboard.press('Escape')
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return { id, optionCount, selectedText }
}

async function showEditorSection(page: Page, label: RegExp, sectionSelector: string): Promise<void> {
  const button = page.getByRole('button', { name: label }).first()
  await button.waitFor({ state: 'visible', timeout: 15_000 })
  await button.click()
  await page.locator(sectionSelector).waitFor({ state: 'visible', timeout: 15_000 })
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(auth\/bootstrap|portal\/bootstrap|portal\/catalog|portal\/submissions\/review|ai\/providers)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const portalBootstrapRead = waitForRead(page, observedRequests, /\/api\/portal\/bootstrap/i, 'Portal bootstrap read')
    const aiProvidersRead = waitForRead(page, observedRequests, /\/api\/ai\/providers/i, 'Catalog AI providers read')
    await page.goto('/catalog', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText(/Customer Portal|Catalog|Live preview/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const portalBootstrapStatus = await portalBootstrapRead
    const aiProvidersStatus = await aiProvidersRead

    await showEditorSection(page, /Display settings/i, '#portal-section-display')
    const priceDisplay = await openSharedSelect(page, '#portal-price-display', 'price-display', 3)

    await showEditorSection(page, /AI assistant/i, '#portal-section-assistant')
    const aiProvider = await openSharedSelect(page, '#portal-ai-provider', 'ai-provider', 1)

    await showEditorSection(page, /Business details/i, '#portal-section-branding')
    const language = await openSharedSelect(page, '#portal-language', 'portal-language', 3)

    await showEditorSection(page, /Media/i, '#portal-section-media')
    const logoFit = await openSharedSelect(page, '#portal-logo-fit', 'logo-fit', 2)

    await showEditorSection(page, /Submission settings/i, '#portal-section-submissions')
    const stockThresholdMode = await openSharedSelect(page, '#portal-stock-threshold-mode', 'stock-threshold-mode', 2)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        portalBootstrapStatus,
        aiProvidersStatus,
        priceDisplay,
        aiProvider,
        language,
        logoFit,
        stockThresholdMode,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        catalogEditor: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
