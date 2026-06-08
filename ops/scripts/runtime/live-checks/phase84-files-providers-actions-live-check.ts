/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, waitForRead, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-files-providers-actions-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'files-providers-actions.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}
type AiProvidersResponse = { items?: unknown[] }
type SelectCheck = {
  id: string
  optionCount: number
  selectedText: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function openAppSelect(page: Page, selector: string, id: string): Promise<SelectCheck> {
  const button = page.locator(selector)
  await button.waitFor({ state: 'visible', timeout: 10_000 })
  const selectedText = (await button.innerText()).trim()
  await button.click()
  const listbox = page.getByRole('listbox').last()
  await listbox.waitFor({ state: 'visible', timeout: 10_000 })
  const optionCount = await listbox.getByRole('option').count()
  assert(optionCount > 0, `${id} opened with no options`)
  await page.keyboard.press('Escape')
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return { id, optionCount, selectedText }
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
      if (/\/api\/(files|ai\/providers|ai\/responses|action-history)/i.test(url)) {
        observedRequests.push({ status: response.status(), url })
      }
    })

    const filesRead = waitForRead(page, observedRequests, /\/api\/files(?:\?|$)/i, 'Files library read')
    await page.goto('/files', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByRole('heading', { name: /Library/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const filesStatus = await filesRead

    const providersRead = waitForRead(page, observedRequests, /\/api\/ai\/providers(?:\?|$)/i, 'AI providers read')
    const responsesRead = waitForRead(page, observedRequests, /\/api\/ai\/responses(?:\?|$)/i, 'AI responses prefetch')
    await page.getByRole('button', { name: /Providers/i }).click()
    await page.getByRole('heading', { name: /AI Providers/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const providersStatus = await providersRead
    const responsesStatus = await responsesRead

    await page.locator('#provider-form-provider').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('#provider-form-name').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('#provider-form-api-key').waitFor({ state: 'visible', timeout: 15_000 })
    const providerSelect = await openAppSelect(page, '#provider-form-provider', 'provider')
    const providerTypeSelect = await openAppSelect(page, '#provider-form-type', 'provider-type')
    const saveProviderButtonVisible = await page.getByRole('button', { name: /Add provider|Save provider/i }).isVisible()
    assert(saveProviderButtonVisible, 'Provider save button did not render')

    const providers = await page.evaluate(async () => window.api.getAiProviders()) as AiProvidersResponse
    const providerCount = Array.isArray(providers?.items) ? providers.items.length : 0
    const providerActionButtons = {
      edit: await page.getByRole('button', { name: /^Edit$/i }).count(),
      test: await page.getByRole('button', { name: /^Test$/i }).count(),
      delete: await page.getByRole('button', { name: /^Delete$/i }).count(),
    }
    if (providerCount > 0) {
      assert(providerActionButtons.edit > 0, 'Provider edit controls did not render')
      assert(providerActionButtons.test > 0, 'Provider test controls did not render')
      assert(providerActionButtons.delete > 0, 'Provider delete controls did not render')
    }

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
        filesPageVisible: true,
        filesStatus,
        providersStatus,
        responsesStatus,
        providersTabOpened: true,
        providerSelect,
        providerTypeSelect,
        saveProviderButtonVisible,
        providerCount,
        providerActionButtons,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        filesProviders: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: any) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
