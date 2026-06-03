/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page, type Response } from 'playwright'
import { applySessionToPlaywrightContext, hydratePlaywrightPage, loginWithFetch } from '../audits/audit-auth.ts'

type BurstResult = {
  profile: string
  route: string
  burstClicks: number
  productSearchResponses: number
  statuses: number[]
  searches: string[]
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/filter-burst-check-latest.json')

async function waitForPage(page: Page, slot: string, readyText: string): Promise<void> {
  await page.waitForFunction(({ slot, readyText }) => {
    const root = document.querySelector(`[data-bos-active-page="true"][data-bos-page-slot="${slot}"]`)
    return !!root && (root.textContent || '').includes(readyText)
  }, { slot, readyText }, { timeout: 18_000 })
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

async function clickIfPresent(page: Page, label: RegExp): Promise<boolean> {
  const button = page.getByRole('button', { name: label }).first()
  if (!(await button.count().catch(() => 0))) return false
  await button.click({ timeout: 1_500 }).catch(() => {})
  return true
}

async function runBurst(page: Page, profile: string, route: string, pathName: string, readyText: string, labels: RegExp[]): Promise<BurstResult> {
  const events: Array<{ url: string, status: number }> = []
  const onResponse = (response: Response) => {
    const url = response.url()
    if (/\/api\/products\/search/.test(url)) events.push({ url, status: response.status() })
  }
  page.on('response', onResponse)
  try {
    await page.goto(pathName, { waitUntil: 'domcontentloaded' })
    await waitForPage(page, route, readyText)
    events.length = 0
    let clicked = 0
    for (const label of labels) {
      if (await clickIfPresent(page, label)) clicked += 1
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.waitForTimeout(800)
    return {
      profile,
      route,
      burstClicks: clicked,
      productSearchResponses: events.length,
      statuses: events.map((event) => event.status),
      searches: events.map((event) => new URL(event.url).search),
    }
  } finally {
    page.off('response', onResponse)
  }
}

async function main(): Promise<void> {
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const results: BurstResult[] = []
    const profiles = [
      { name: 'desktop', viewport: { width: 1280, height: 900 }, isMobile: false },
      { name: 'mobile', viewport: { width: 390, height: 780 }, isMobile: true },
    ]
    for (const profile of profiles) {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        viewport: profile.viewport,
        isMobile: profile.isMobile,
        hasTouch: profile.isMobile,
        deviceScaleFactor: profile.isMobile ? 2 : 1,
      })
      const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
      const page = await context.newPage()
      await hydratePlaywrightPage(page, storageState)
      results.push(
        await runBurst(page, profile.name, 'products', '/products', 'Products', [
          /^OR$/,
          /^AND$/,
          /^C\s*\(/,
          /^E\s*\(/,
          /^All$/,
        ]),
        await runBurst(page, profile.name, 'pos', '/pos', 'Cart', [
          /^OR$/,
          /^AND$/,
          /^C\s*\(/,
          /^E\s*\(/,
          /^All$/,
        ]),
      )
      await context.close().catch(() => {})
    }
    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      maxExpectedSearchResponsesPerBurst: 2,
      ok: results.every((result) => result.productSearchResponses <= 2 && result.statuses.every((status) => status < 400)),
      results,
    }
    await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
    if (!report.ok) process.exitCode = 1
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
