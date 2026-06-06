/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { attachConsoleCollector, isIgnoredConsole, readJson, waitForRead } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const PUBLIC_URL = process.env.BOS_PUBLIC_URL || `${BASE_URL}/public`
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-public-assistant-select-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'public-assistant-selects.png')

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

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/portal\/(bootstrap|catalog|ai\/status)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const bootstrapRead = waitForRead(page, observedRequests, /\/api\/portal\/bootstrap/i, 'Public portal bootstrap read')
    await page.goto(PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByText(/Leang|Products|Catalog|Membership|Search/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const bootstrapStatus = await bootstrapRead

    const aiStatusRead = waitForRead(page, observedRequests, /\/api\/portal\/ai\/status/i, 'Public portal AI status read')
    const assistantTab = page.locator('button').filter({ hasText: /AI assistant|Assistant/i }).first()
    await assistantTab.waitFor({ state: 'visible', timeout: 20_000 })
    await assistantTab.click()
    await page.locator('#portal-assistant-question').waitFor({ state: 'visible', timeout: 20_000 })
    const aiStatus = await aiStatusRead

    const brand = await openSharedSelect(page, '#portal-assistant-brand', 'assistant-brand', 1)
    const skinType = await openSharedSelect(page, '#portal-assistant-skin-type', 'assistant-skin-type', 7)
    const shoppingFor = await openSharedSelect(page, '#portal-assistant-shopping-for', 'assistant-shopping-for', 1)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    const report = {
      publicUrl: PUBLIC_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        bootstrapStatus,
        aiStatus,
        brand,
        skinType,
        shoppingFor,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        publicAssistant: SCREENSHOT_PATH,
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
