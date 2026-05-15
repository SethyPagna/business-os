/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { ADMIN_ROUTES, PUBLIC_ROUTES, getAuditProfiles } from './audit-manifest.mjs'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from './audit-auth.mjs'
import { writeBrowserActionHtmlReport } from './audit-report-html.mjs'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const PROFILE = readArg('--profile') || 'exhaustive'
const REPORT_DIR = process.env.BOS_BROWSER_ACTION_REPORT_DIR
  ? path.resolve(process.env.BOS_BROWSER_ACTION_REPORT_DIR)
  : path.join(ROOT_DIR, 'ops/runtime/reports', `browser-action-smoke-${TIMESTAMP}`)
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots')
const PROFILES = getAuditProfiles(PROFILE)
const ROUTES = [...ADMIN_ROUTES, ...PUBLIC_ROUTES]
const ROUTE_READY_TIMEOUT_MS = 15_000
const ACTION_TIMEOUT_MS = 2_500
const SETTLE_WAIT_MS = 200

const summary = {
  audit: {
    baseUrl: BASE_URL,
    reportDir: REPORT_DIR,
    startedAt: new Date().toISOString(),
    profile: PROFILE,
  },
  health: {},
  routes: [],
  actions: [],
  findings: [],
  artifacts: {
    screenshots: [],
  },
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1] || ''
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed ? prefixed.slice(name.length + 1) : ''
}

function safeName(value) {
  return String(value || 'artifact').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'artifact'
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function addFinding(priority, area, message, extra = {}) {
  summary.findings.push({
    priority,
    area,
    message,
    ...extra,
  })
}

function isExternalConsoleNoise(message) {
  return /chrome-extension:|No Listener: tabs:outgoing|Statsig|ab\.chatgpt\.com|ERR_BLOCKED_BY_CLIENT/i.test(String(message || ''))
}

function isAppConsoleIssue(entry) {
  const type = String(entry.type || '').toLowerCase()
  if (!['error', 'warning', 'warn', 'pageerror'].includes(type)) return false
  return !isExternalConsoleNoise(entry.text)
}

async function requestJson(url) {
  const started = performance.now()
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  const body = await response.json().catch(() => ({}))
  return {
    status: response.status,
    ok: response.ok,
    ms: Math.round(performance.now() - started),
    body,
  }
}

async function captureHealth(phase) {
  const health = await requestJson(`${BASE_URL}/health`)
  if (!health.ok || health.body?.status !== 'ok') {
    throw new Error(`Health check failed during ${phase}`)
  }
  summary.health[phase] = {
    status: health.body?.status || 'unknown',
    frontendHash: health.body?.runtime?.frontend?.hash || null,
    sourceHash: health.body?.runtime?.sourceHash || null,
    drivers: health.body?.drivers || {},
  }
}

function buildContextOptions(profile) {
  return {
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.isMobile,
    deviceScaleFactor: profile.isMobile ? 2 : 1,
  }
}

async function attachConsoleCapture(page) {
  const entries = []
  page.on('console', (msg) => {
    entries.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      ts: new Date().toISOString(),
    })
  })
  page.on('pageerror', (error) => {
    entries.push({
      type: 'pageerror',
      text: error?.message || String(error),
      location: {},
      ts: new Date().toISOString(),
    })
  })
  return entries
}

async function saveScreenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${safeName(name)}.png`)
  await page.screenshot({ path: file, fullPage: false })
  summary.artifacts.screenshots.push(file)
  return file
}

async function waitForRouteReady(page, route) {
  const started = performance.now()
  await page.waitForFunction(({ readyTexts, routeName }) => {
    const text = document.body?.innerText || ''
    const hasRoot = !!document.querySelector('#app-root, #root')
    const activeSlot = document.querySelector('[data-bos-active-page="true"]')
    const activePage = activeSlot?.getAttribute('data-bos-page-slot') || ''
    const activeText = activeSlot?.innerText || ''
    const expectedPage = routeName === 'public_catalog' ? '' : routeName
    const hasExpectedSlot = expectedPage && activePage === expectedPage
    const scanText = expectedPage ? activeText : text
    const hasReadyText = readyTexts.some((value) => scanText.includes(value))
    const isLoginScreen = !!document.querySelector('#login-username, #login-password')
    const hasSubstantiveActiveText = activeText.trim().length >= 40 && !/\bLoading\.\.\./i.test(activeText)
    return hasRoot && !isLoginScreen && (
      expectedPage ? (hasExpectedSlot && (hasReadyText || hasSubstantiveActiveText)) : hasReadyText
    )
  }, { readyTexts: route.ready, routeName: route.name }, { timeout: ROUTE_READY_TIMEOUT_MS })
  return Math.round(performance.now() - started)
}

async function dismissTransientUi(page) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(120)
  const dismissButtons = [
    page.getByRole('button', { name: /^Close$/i }).first(),
    page.getByRole('button', { name: /^Cancel$/i }).first(),
    page.getByRole('button', { name: /^Back$/i }).first(),
    page.locator('button[aria-label*="Close" i]').first(),
  ]
  for (const button of dismissButtons) {
    if (!(await button.count().catch(() => 0))) continue
    if (!(await button.isVisible().catch(() => false))) continue
    await button.click({ timeout: 1_500 }).catch(() => {})
    await page.waitForTimeout(120)
    break
  }
}

async function clickWithFallback(locator, timeout = ACTION_TIMEOUT_MS) {
  try {
    await locator.click({ timeout })
    return
  } catch (error) {
    if (!/intercepts pointer events|Timeout/i.test(String(error?.message || ''))) throw error
    await locator.click({ timeout, force: true })
  }
}

async function countVisibleDialogs(page) {
  const modalSelectors = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    '.fixed.inset-0',
  ]
  let count = 0
  for (const selector of modalSelectors) {
    count += await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => {
      const style = window.getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }).length).catch(() => 0)
  }
  return count
}

async function countVisibleNamedButtons(page, labels = []) {
  let count = 0
  for (const label of labels) {
    const buttons = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') })
    const total = await buttons.count().catch(() => 0)
    for (let index = 0; index < total; index += 1) {
      if (await buttons.nth(index).isVisible().catch(() => false)) count += 1
    }
  }
  return count
}

async function countVisiblePortalLayers(page) {
  return await page.evaluate(() => {
    return Array.from(document.body.querySelectorAll('div'))
      .filter((node) => {
        const style = window.getComputedStyle(node)
        return style.position === 'fixed'
          && Number.parseInt(style.zIndex || '0', 10) >= 999
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      }).length
  }).catch(() => 0)
}

async function clickVisibleButton(page, label) {
  const exact = new RegExp(`^${escapeRegExp(label)}$`, 'i')
  const exactButtons = page.getByRole('button', { name: exact })
  const exactCount = await exactButtons.count().catch(() => 0)
  for (let index = 0; index < exactCount; index += 1) {
    const candidate = exactButtons.nth(index)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }

  const fuzzyButtons = page.getByRole('button', { name: new RegExp(escapeRegExp(label), 'i') })
  const fuzzyCount = await fuzzyButtons.count().catch(() => 0)
  for (let index = 0; index < fuzzyCount; index += 1) {
    const candidate = fuzzyButtons.nth(index)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }

  return page.getByRole('button', { name: exact }).first()
}

async function findButtonInLocator(locator, label) {
  const exact = new RegExp(`^${escapeRegExp(label)}$`, 'i')
  const exactButtons = locator.getByRole('button', { name: exact })
  const exactCount = await exactButtons.count().catch(() => 0)
  for (let index = 0; index < exactCount; index += 1) {
    const candidate = exactButtons.nth(index)
    if (await candidate.isVisible().catch(() => false)) return candidate
  }
  const fallbackSelectors = [
    `button[aria-label="${label}"]`,
    `button[title="${label}"]`,
    `button[aria-label="${label.toLowerCase()}"]`,
    `button[title="${label.toLowerCase()}"]`,
  ]
  for (const selector of fallbackSelectors) {
    const candidate = locator.locator(selector).first()
    if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) return candidate
  }
  return locator.getByRole('button', { name: exact }).first()
}

async function openMobileMoreDrawer(page) {
  const nav = page.locator('nav').filter({ has: page.getByRole('button', { name: /^More$/i }) }).first()
  const moreButton = await findButtonInLocator(nav, 'More')
  if (!(await moreButton.count().catch(() => 0))) return false
  await clickWithFallback(moreButton, ACTION_TIMEOUT_MS).catch(() => {})
  await page.waitForTimeout(160)
  return true
}

async function navigateViaUi(page, route, profileName) {
  if (route.scope === 'public') {
    const started = performance.now()
    await page.goto(`${BASE_URL}${route.path}?__bos_browser_action=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const readyMs = await waitForRouteReady(page, route)
    return {
      ok: true,
      ms: Math.round(performance.now() - started),
      readyMs,
      reason: '',
    }
  }
  await dismissTransientUi(page)
  const started = performance.now()
  let button = null
  if (profileName === 'mobile') {
    const mobileNav = page.locator('nav').filter({ has: page.getByRole('button', { name: /^More$/i }) }).first()
    button = await findButtonInLocator(mobileNav, route.navLabel)
    if (!(await button.count().catch(() => 0))) {
      const opened = await openMobileMoreDrawer(page)
      if (opened) {
        const drawer = page.locator('div.fixed.bottom-16').first()
        button = await findButtonInLocator(drawer, route.navLabel)
      }
    }
  } else {
    const sidebar = page.locator('aside').first()
    button = await findButtonInLocator(sidebar, route.navLabel)
  }
  if (!(await button.count().catch(() => 0)) && profileName === 'mobile') {
    const opened = await openMobileMoreDrawer(page)
    if (opened) {
      const drawer = page.locator('div.fixed.bottom-16').first()
      button = await findButtonInLocator(drawer, route.navLabel)
    }
  }
  if (!(await button.count().catch(() => 0))) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      readyMs: 0,
      reason: 'Navigation button not found',
    }
  }
  await clickWithFallback(button, ACTION_TIMEOUT_MS)
  const navMs = Math.round(performance.now() - started)
  let readyMs = 0
  try {
    readyMs = await waitForRouteReady(page, route)
  } catch (error) {
    const fallback = await page.evaluate(() => {
      const active = document.querySelector('[data-bos-active-page="true"]')
      return {
        pathname: window.location.pathname,
        activePage: active?.getAttribute('data-bos-page-slot') || '',
        activeText: (active?.innerText || '').trim(),
      }
    }).catch(() => ({ pathname: '', activePage: '', activeText: '' }))
    const expectedPage = route.name === 'public_catalog' ? '' : route.name
    const expectedPath = route.path || '/'
    const pathOk = expectedPath === '/' ? fallback.pathname === '/' : fallback.pathname.startsWith(expectedPath)
    const pageOk = expectedPage ? fallback.activePage === expectedPage : true
    const textOk = fallback.activeText.length >= 24 && !/\bLoading\.\.\./i.test(fallback.activeText)
    if (pathOk && pageOk && textOk) {
      return {
        ok: true,
        ms: navMs,
        readyMs: ROUTE_READY_TIMEOUT_MS,
        reason: 'fallback-route-detected',
      }
    }
    return {
      ok: false,
      ms: navMs,
      readyMs,
      reason: error?.message || String(error),
    }
  }
  const pathname = new URL(page.url()).pathname
  const expectedPath = route.path || '/'
  const pathOk = expectedPath === '/' ? pathname === '/' : pathname.startsWith(expectedPath)
  return {
    ok: pathOk,
    ms: navMs,
    readyMs,
    reason: pathOk ? '' : `Unexpected pathname ${pathname}`,
  }
}

async function verifyExpectation(page, button, expect, baseline = {}) {
  if (!expect || expect === 'stable') {
    await page.waitForTimeout(SETTLE_WAIT_MS)
    return { ok: true, proof: 'route-stable' }
  }
  if (expect === 'menu') {
    const beforePortals = Number(baseline.beforePortals || 0)
    const beforeExpanded = baseline.beforeExpanded || ''
    await page.waitForFunction(
      ({ beforePortals }) => {
        const portals = Array.from(document.body.querySelectorAll('div')).filter((node) => {
          const style = window.getComputedStyle(node)
          return style.position === 'fixed'
            && Number.parseInt(style.zIndex || '0', 10) >= 999
            && style.display !== 'none'
            && style.visibility !== 'hidden'
        }).length
        const expanded = document.activeElement?.getAttribute?.('aria-expanded')
        return portals > beforePortals || expanded === 'true'
      },
      { beforePortals },
      { timeout: ACTION_TIMEOUT_MS },
    ).catch(() => {})
    const afterExpanded = await button.getAttribute('aria-expanded').catch(() => '')
    const afterPortals = await countVisiblePortalLayers(page)
    const ok = afterExpanded === 'true' || afterPortals > beforePortals || beforeExpanded !== afterExpanded
    return { ok, proof: ok ? `menu:${afterExpanded === 'true' ? 'expanded' : 'portal-open'}` : 'menu-not-opened' }
  }
  if (expect === 'dialog') {
    const beforeDialogs = Number(baseline.beforeDialogs || 0)
    const beforeNamedButtons = Number(baseline.beforeNamedButtons || 0)
    await page.waitForFunction(
      ({ beforeDialogs, beforeNamedButtons }) => {
        const dialogCount = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .fixed.inset-0')).filter((node) => {
          const style = window.getComputedStyle(node)
          return style.display !== 'none' && style.visibility !== 'hidden'
        }).length
        const saveCancelCount = Array.from(document.querySelectorAll('button')).filter((node) => {
          const style = window.getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          const text = (node.innerText || '').trim()
          return text === 'Save' || text === 'Cancel'
        }).length
        return dialogCount > beforeDialogs || saveCancelCount > beforeNamedButtons
      },
      { beforeDialogs, beforeNamedButtons },
      { timeout: ACTION_TIMEOUT_MS },
    ).catch(() => {})
    const afterDialogs = await countVisibleDialogs(page)
    const afterNamedButtons = await countVisibleNamedButtons(page, ['Save', 'Cancel'])
    const ok = afterDialogs > beforeDialogs || afterNamedButtons > beforeNamedButtons
    return { ok, proof: ok ? 'dialog-opened' : 'dialog-not-opened' }
  }
  if (expect === 'progress') {
    const progress = page.locator('[data-testid="backup-job-progress"]').first()
    await progress.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).catch(() => {})
    const ok = await progress.isVisible().catch(() => false)
    return { ok, proof: ok ? 'progress-visible' : 'progress-not-visible' }
  }
  return { ok: true, proof: 'clicked' }
}

async function clickNamedButton(page, route, action) {
  await dismissTransientUi(page)
  const label = typeof action === 'string' ? action : action?.label
  const expect = typeof action === 'object' ? action?.expect : ''
  const name = `${route.name}:button:${label}`
  const button = await clickVisibleButton(page, label)
  if (!(await button.count().catch(() => 0))) {
    return { name, kind: 'button', ok: false, ms: 0, reason: 'Button not found' }
  }
  const started = performance.now()
  try {
    const baseline = expect === 'menu'
      ? {
          beforePortals: await countVisiblePortalLayers(page),
          beforeExpanded: await button.getAttribute('aria-expanded').catch(() => ''),
        }
      : expect === 'dialog'
        ? {
            beforeDialogs: await countVisibleDialogs(page),
            beforeNamedButtons: await countVisibleNamedButtons(page, ['Save', 'Cancel']),
          }
        : {}
    await clickWithFallback(button, ACTION_TIMEOUT_MS)
    const ms = Math.round(performance.now() - started)
    const proof = await verifyExpectation(page, button, expect, baseline)
    await page.waitForTimeout(SETTLE_WAIT_MS)
    await dismissTransientUi(page)
    return {
      name,
      kind: 'button',
      ok: proof.ok,
      ms,
      settleMs: Math.round(performance.now() - started),
      proof: proof.proof,
      reason: proof.ok ? '' : proof.proof,
    }
  } catch (error) {
    await dismissTransientUi(page)
    return {
      name,
      kind: 'button',
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    }
  }
}

async function clickTestIdButton(page, route, action) {
  await dismissTransientUi(page)
  const name = `${route.name}:testid:${action.testId}`
  const button = page.locator(`[data-testid="${action.testId}"]`).first()
  if (!(await button.count().catch(() => 0)) || !(await button.isVisible().catch(() => false))) {
    return { name, kind: 'testid', ok: false, ms: 0, reason: 'Button not found' }
  }
  const started = performance.now()
  try {
    const baseline = action.expect === 'menu'
      ? {
          beforePortals: await countVisiblePortalLayers(page),
          beforeExpanded: await button.getAttribute('aria-expanded').catch(() => ''),
        }
      : action.expect === 'dialog'
        ? {
            beforeDialogs: await countVisibleDialogs(page),
            beforeNamedButtons: await countVisibleNamedButtons(page, ['Save', 'Cancel']),
          }
        : {}
    await clickWithFallback(button, ACTION_TIMEOUT_MS)
    const ms = Math.round(performance.now() - started)
    const proof = await verifyExpectation(page, button, action.expect, baseline)
    await page.waitForTimeout(SETTLE_WAIT_MS)
    await dismissTransientUi(page)
    return {
      name,
      kind: 'testid',
      ok: proof.ok,
      ms,
      settleMs: Math.round(performance.now() - started),
      proof: proof.proof,
      reason: proof.ok ? '' : proof.proof,
    }
  } catch (error) {
    await dismissTransientUi(page)
    return {
      name,
      kind: 'testid',
      ok: false,
      ms: Math.round(performance.now() - started),
      error: error?.message || String(error),
    }
  }
}

async function performSearchInteraction(page, route) {
  const started = performance.now()
  async function findSearchInput() {
    const candidates = [
      'input[type="search"]',
      'input[placeholder*="Search" i]',
      'input[aria-label*="Search" i]',
      'input[placeholder*="search" i]',
    ]
    for (const selector of candidates) {
      const input = page.locator(selector).first()
      if (!(await input.count().catch(() => 0))) continue
      if (!(await input.isVisible().catch(() => false))) continue
      return input
    }
    return null
  }

  let input = await findSearchInput()
  if (!input) {
    const searchButton = await clickVisibleButton(page, 'Search')
    if (await searchButton.count().catch(() => 0)) {
      await clickWithFallback(searchButton, ACTION_TIMEOUT_MS).catch(() => {})
      await page.waitForTimeout(150)
      input = await findSearchInput()
    }
  }

  if (input) {
    if (!(await input.isVisible().catch(() => false))) {
    return {
      name: `${route.name}:search`,
      kind: 'search',
      ok: true,
      skipped: true,
      ms: Math.round(performance.now() - started),
      proof: 'search-input-hidden',
    }
  }
    await input.fill('QA')
    const ms = Math.round(performance.now() - started)
    await page.waitForTimeout(SETTLE_WAIT_MS)
    const value = await input.inputValue().catch(() => '')
    await input.fill('')
    return {
      name: `${route.name}:search`,
      kind: 'search',
      ok: value === 'QA',
      ms,
      settleMs: Math.round(performance.now() - started),
      proof: value === 'QA' ? 'search-filled' : 'search-value-mismatch',
    }
  }

  return {
    name: `${route.name}:search`,
    kind: 'search',
    ok: true,
    skipped: true,
    ms: Math.round(performance.now() - started),
    proof: 'search-not-exposed',
  }
}

async function runRouteInteractions(page, route) {
  const actions = []
  if (route?.interactions?.search) {
    actions.push(await performSearchInteraction(page, route))
  }
  for (const action of route?.interactions?.primaryButtons || []) {
    actions.push(await clickNamedButton(page, route, action))
  }
  for (const action of route?.interactions?.testIdButtons || []) {
    actions.push(await clickTestIdButton(page, route, action))
  }
  return actions
}

async function bootstrapProfile(profile) {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(buildContextOptions(profile))
  const session = await loginWithFetch({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: 20_000,
  })
  const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/?__bos_browser_action=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await hydratePlaywrightPage(page, storageState)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  return { browser, context, page }
}

async function runProfile(profile) {
  const { browser, context, page } = await bootstrapProfile(profile)
  const consoleEntries = await attachConsoleCapture(page)
  try {
    for (const route of ROUTES) {
      if (!route.navLabel) continue
      const nav = await navigateViaUi(page, route, profile.name)
      const screenshot = await saveScreenshot(page, `${profile.name}-${route.name}`)
      const routeConsoleIssues = consoleEntries.filter(isAppConsoleIssue)
      const interactions = nav.ok ? await runRouteInteractions(page, route) : []
      const notes = []
      if (!nav.ok) {
        notes.push(nav.reason || 'navigation failed')
        addFinding(1, 'navigation', `${profile.name}/${route.name} navigation failed`, {
          profile: profile.name,
          route: route.name,
          reason: nav.reason || '',
        })
      }
      for (const action of interactions) {
        summary.actions.push({
          profile: profile.name,
          route: route.name,
          ...action,
        })
        if (!action.ok) {
          addFinding(1, 'interaction', `${profile.name}/${action.name} failed`, {
            profile: profile.name,
            route: route.name,
            action: action.name,
            reason: action.reason || action.error || '',
          })
        }
      }
      if (routeConsoleIssues.length) {
        notes.push(`${routeConsoleIssues.length} console issues`)
        addFinding(2, 'console', `${profile.name}/${route.name} produced console issues`, {
          profile: profile.name,
          route: route.name,
          issues: routeConsoleIssues.slice(-5),
        })
      }
      summary.routes.push({
        profile: profile.name,
        route: route.name,
        path: route.path,
        navMs: nav.ms,
        readyMs: nav.readyMs,
        navOk: nav.ok,
        passedInteractions: interactions.filter((item) => item.ok).length,
        totalInteractions: interactions.length,
        consoleIssues: routeConsoleIssues.length,
        screenshot,
        notes,
      })
      consoleEntries.length = 0
    }
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
  await captureHealth('before')
  for (const profile of PROFILES) {
    await runProfile(profile)
  }
  await captureHealth('after')
  summary.audit.finishedAt = new Date().toISOString()
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  await writeBrowserActionHtmlReport({
    reportDir: REPORT_DIR,
    summary,
  })
  console.log(JSON.stringify({
    reportDir: REPORT_DIR,
    findings: summary.findings.length,
    routes: summary.routes.length,
    actions: summary.actions.length,
  }, null, 2))
  if (summary.findings.some((finding) => Number(finding.priority || 9) <= 1)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
