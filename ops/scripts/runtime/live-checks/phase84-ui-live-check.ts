/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, readJsonStatus, isIgnoredConsole, latestObservedStatus, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-ui-live-check-${TIMESTAMP}`)
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'branches-stock-read.png')
const NOTIFICATION_SCREENSHOT_PATH = path.join(REPORT_DIR, 'notification-summary.png')
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}
type BranchForSelect = {
  id?: number | string
  name?: string
  is_active?: boolean
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function readFirstActiveBranch(page: { evaluate: <T>(callback: () => Promise<T>) => Promise<T> }): Promise<{ id: string; name: string }> {
  const branch = await page.evaluate(async () => {
    const api = (window as Window & { api?: { getBranches?: () => Promise<BranchForSelect[]> } }).api
    const rows = await api?.getBranches?.()
    return (rows || []).find((item) => item?.is_active !== false && item?.id != null && String(item?.name || '').trim())
  })
  assert(branch?.id != null && branch?.name, 'No active branch was available for the transfer select check')
  return { id: String(branch.id), name: String(branch.name) }
}


async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  console.log('[phase84] reading health/build metadata')
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  console.log('[phase84] logging in')
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  console.log('[phase84] probing app shell bootstrap/settings loaders')
  const authedRequest = { headers: session.cookieHeader ? { cookie: session.cookieHeader } : {} }
  const appBootstrapStatus = await readJsonStatus(`${BASE_URL}/api/auth/bootstrap`, authedRequest)
  const appSettingsStatus = await readJsonStatus(`${BASE_URL}/api/settings`, authedRequest)
  const appSettingsMetaStatus = await readJsonStatus(`${BASE_URL}/api/settings/meta`, authedRequest)
  console.log('[phase84] launching browser')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 }, acceptDownloads: true })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()

    const consoleMessages: ConsoleEntry[] = []
    const chunkRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/background-import-tracker|\/api\/import-jobs|\/api\/action-history|\/api\/auth\/bootstrap|\/api\/settings|\/api\/notifications\/summary|\/api\/branches|\/api\/branch-stock|\/api\/branches\/\d+\/stock|\/api\/transfers|\/api\/suppliers|\/api\/inventory\/summary|\/api\/inventory\/reasons|\/api\/inventory\/stats|\/api\/inventory\/products\/search|\/api\/inventory\/movements|\/api\/returns|\/api\/dashboard|\/api\/analytics|\/api\/sales|\/api\/files|\/api\/ai\/providers|\/api\/ai\/responses|\/api\/customers|\/api\/delivery-contacts|\/api\/users|\/api\/roles|\/api\/system\/audit-logs|\/api\/system\/config|\/api\/system\/debug\/log|\/api\/system\/integration-doctor|\/api\/auth\/otp\/status|\/api\/auth\/verification-capabilities|\/api\/portal\/config|\/api\/portal\/submissions\/review|\/api\/portal\/membership|\/api\/portal\/ai\/status|\/api\/portal\/bootstrap|\/api\/portal\/catalog|\/api\/categories|\/api\/units|\/api\/products\/bootstrap|\/api\/products\/search|\/api\/products\/filters|\/api\/products\/lookups\/usage/i.test(url)) {
        chunkRequests.push({ status: response.status(), url })
      }
    })

    console.log('[phase84] exercising dashboard startup and analytics loaders')
    const dashboardStartupResponse = page.waitForResponse(
      (response) => response.url().includes('/api/dashboard/startup') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Dashboard', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const dashboardStartup = await dashboardStartupResponse
    const dashboardStartupStatus = dashboardStartup?.status?.() || latestObservedStatus(chunkRequests, /\/api\/dashboard\/startup/i)
    assert(dashboardStartupStatus === 200, `Dashboard startup read returned HTTP ${dashboardStartupStatus}`)
    const dashboardRangeAnalyticsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/analytics') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.getByRole('button', { name: /7 Days/i }).click()
    await page.getByText(/Revenue|Transactions|Gross Profit|COGS/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const dashboardRangeAnalytics = await dashboardRangeAnalyticsResponse
    const dashboardRangeAnalyticsStatus = dashboardRangeAnalytics?.status?.() || latestObservedStatus(chunkRequests, /\/api\/analytics/i)
    assert(dashboardRangeAnalyticsStatus === 200, `Dashboard range analytics read returned HTTP ${dashboardRangeAnalyticsStatus}`)

    console.log('[phase84] exercising notification summary loader')
    const notificationSummaryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/notifications/summary') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const notificationButtons = page.locator('button[aria-label="Notifications"]').filter({ visible: true })
    const notificationButtonCount = await notificationButtons.count()
    assert(notificationButtonCount > 0, 'No visible notification button was rendered')
    await notificationButtons.first().click()
    await page.getByPlaceholder('Search notifications', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const notificationSummary = await notificationSummaryResponse
    const notificationSummaryStatus = notificationSummary?.status?.() || latestObservedStatus(chunkRequests, /\/api\/notifications\/summary/i)
    assert(notificationSummaryStatus === 200, `Notification summary read returned HTTP ${notificationSummaryStatus}`)
    const notificationPanelVisible = await page.getByPlaceholder('Search notifications', { exact: true }).isVisible()
    assert(notificationPanelVisible, 'Notification panel did not render after clicking the bell')
    await page.screenshot({ path: NOTIFICATION_SCREENSHOT_PATH, fullPage: false })
    await notificationButtons.first().click()

    console.log('[phase84] opening branches route')
    const branchesListResponse = page.waitForResponse(
      (response) => /\/api\/branches(?:\?|$)/.test(response.url()) && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const branchSummaryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/branches/summary') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/branches', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await Promise.race([
      page.getByText('Branches', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByText('Branch', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 }),
    ])
    const branchesList = await branchesListResponse
    const branchSummary = await branchSummaryResponse
    const branchesListStatus = branchesList?.status?.() || latestObservedStatus(chunkRequests, /\/api\/branches(?:\?|$)/i)
    const branchSummaryStatus = branchSummary?.status?.() || latestObservedStatus(chunkRequests, /\/api\/branches\/summary/i)
    assert(branchesListStatus === 200, `Branches list read returned HTTP ${branchesListStatus}`)
    assert(branchSummaryStatus === 200, `Branch summary read returned HTTP ${branchSummaryStatus}`)

    console.log('[phase84] exercising stock button')
    const stockButtons = page.getByRole('button', { name: /stock/i })
    const stockButtonCount = await stockButtons.count()
    assert(stockButtonCount > 0, 'No branch stock buttons were rendered')
    await stockButtons.first().click()

    await Promise.race([
      page.getByRole('button', { name: /transfer stock/i }).first().waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByText('No stock in this branch', { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 }),
    ])

    const expandedStockPanelVisible = await page.getByRole('button', { name: /transfer stock/i }).first().isVisible()
      || await page.getByText('No stock in this branch', { exact: false }).first().isVisible()
    assert(expandedStockPanelVisible, 'Branch stock panel did not render after clicking Stock')

    console.log('[phase84] exercising transfer source stock loader')
    const transferButtons = page.getByRole('button', { name: 'Transfer', exact: true })
    assert(await transferButtons.count() > 0, 'No Transfer button was rendered')
    await transferButtons.first().click()
    await page.getByRole('heading', { name: 'Stock Transfer', exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
    const sourceBranchSelect = page.locator('#transfer-from-branch')
    await sourceBranchSelect.waitFor({ state: 'visible', timeout: 10_000 })
    const firstSourceBranch = await readFirstActiveBranch(page)
    const transferStockResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/branches/${firstSourceBranch.id}/stock`)
        && response.url().includes('pageSize=50')
        && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await sourceBranchSelect.click()
    await page.getByRole('option', { name: firstSourceBranch.name, exact: true }).click()
    const transferStock = await transferStockResponse
    const transferStockStatus = transferStock?.status?.()
      || latestObservedStatus(chunkRequests, new RegExp(`/api/branches/${firstSourceBranch.id}/stock.*pageSize=50`, 'i'))
      || await readJsonStatus(`${BASE_URL}/api/branches/${firstSourceBranch.id}/stock?page=1&pageSize=50`, authedRequest)
    assert(transferStockStatus === 200, `Transfer source branch stock read returned HTTP ${transferStockStatus}`)
    await page.locator('#transfer-product-search').waitFor({ state: 'visible', timeout: 10_000 })
    const visibleCloseButtons = page.getByRole('button', { name: /Close|Cancel/i }).filter({ visible: true })
    assert(await visibleCloseButtons.count() > 0, 'No visible close button was rendered for the transfer modal')
    await visibleCloseButtons.last().click()
    await page.getByRole('heading', { name: 'Stock Transfer', exact: true }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(async () => {
      await page.keyboard.press('Escape')
      await page.getByRole('heading', { name: 'Stock Transfer', exact: true }).waitFor({ state: 'hidden', timeout: 10_000 })
    })

    console.log('[phase84] exercising branch transfer history loader')
    const branchTransfersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/transfers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const transferHistoryTab = page.getByRole('button', { name: /Transfer History/i })
    await transferHistoryTab.focus()
    await page.keyboard.press('Enter')
    await Promise.race([
      page.getByText(/No data/i).first().waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByText(/transfers/i).first().waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByText(/Qty|Quantity/i).first().waitFor({ state: 'visible', timeout: 15_000 }),
    ])
    const branchTransfers = await branchTransfersResponse
    const branchTransfersStatus = branchTransfers?.status?.() || latestObservedStatus(chunkRequests, /\/api\/transfers/i)
    assert(branchTransfersStatus === 200, `Branch transfer history read returned HTTP ${branchTransfersStatus}`)

    console.log('[phase84] exercising sales export preview loader')
    const salesExportPreviewResponse = page.waitForResponse(
      (response) => response.url().includes('/api/sales/export') && !response.url().includes('format=csv') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/sales', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Sales', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /^Export$/i }).click()
    await page.getByText(/Detailed sales report/i).click()
    const salesExportModal = page.locator('.fixed.inset-0').last()
    await salesExportModal.getByText(/Export Sales Report/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /Preview Summary/i }).click()
    const salesExportPreview = await salesExportPreviewResponse
    const salesExportPreviewStatus = salesExportPreview?.status?.() || latestObservedStatus(chunkRequests, /\/api\/sales\/export/i)
    assert(salesExportPreviewStatus === 200, `Sales export preview read returned HTTP ${salesExportPreviewStatus}`)
    await salesExportModal.getByText(/Accounting Summary/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    await salesExportModal.locator('button').first().click()
    await salesExportModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    console.log('[phase84] exercising sales import modal button')
    await page.getByRole('button', { name: /^Import$/i }).click()
    const salesImportModal = page.locator('.fixed.inset-0').filter({ hasText: /Import Sales|Paste CSV/i }).last()
    await salesImportModal.locator('#sales-import-csv').waitFor({ state: 'visible', timeout: 15_000 })
    const salesImportModalOpened = await salesImportModal.getByText(/Import Sales/i).first().isVisible()
    assert(salesImportModalOpened, 'Sales import modal did not render after clicking Import')
    await salesImportModal.locator('button').first().click()
    await salesImportModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    console.log('[phase84] exercising product supplier loader')
    const productSearchResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/search') && response.status() < 500,
      { timeout: 20_000 },
    )
    const productFiltersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/filters') && response.status() < 500,
      { timeout: 20_000 },
    )
    const productActionHistoryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/action-history') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const productSearchStatus = (await productSearchResponse).status()
    const productFiltersStatus = (await productFiltersResponse).status()
    const productActionHistory = await productActionHistoryResponse
    const productActionHistoryStatus = productActionHistory?.status?.() || latestObservedStatus(chunkRequests, /\/api\/action-history/i)
    assert(productSearchStatus === 200, `Products search read returned HTTP ${productSearchStatus}`)
    assert(productFiltersStatus === 200, `Product filters read returned HTTP ${productFiltersStatus}`)
    assert(productActionHistoryStatus === 200, `Products action history read returned HTTP ${productActionHistoryStatus}`)
    await page.getByRole('button', { name: /History/i }).first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const productImportModal = page.locator('.fixed.inset-0').filter({ hasText: /Products \+ CSV|Images Only|Upload CSV/i }).last()
    await productImportModal.getByText(/Products \+ CSV|Upload CSV/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    const productImportModalOpened = await productImportModal.getByText(/Products \+ CSV|Upload CSV/i).first().isVisible()
    assert(productImportModalOpened, 'Product import modal did not render after clicking Import')
    await productImportModal.locator('button').first().click()
    await productImportModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
    const productSupplierResponse = page.waitForResponse(
      (response) => response.url().includes('/api/suppliers') && response.status() < 500,
      { timeout: 20_000 },
    )
    const productButtons = page.getByRole('button', { name: 'Product', exact: true })
    assert(await productButtons.count() > 0, 'No Product add button was rendered')
    await productButtons.first().click()
    await page.getByText('Add Product', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const productSupplierStatus = (await productSupplierResponse).status()
    assert(productSupplierStatus === 200, `Product supplier read returned HTTP ${productSupplierStatus}`)
    await page.locator('#product-supplier').waitFor({ state: 'visible', timeout: 10_000 })
    const filePickerResponse = page.waitForResponse(
      (response) => response.url().includes('/api/files') && response.url().includes('mediaType=image') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: /^(Open Files|Files)$/ }).click()
    await page.getByText('Choose product image', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const filePickerStatus = (await filePickerResponse).status()
    assert(filePickerStatus === 200, `File picker image library read returned HTTP ${filePickerStatus}`)

    console.log('[phase84] exercising supplier return setup loader')
    await page.goto('/returns', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Returns', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const supplierReturnSetupResponse = page.waitForResponse(
      (response) => response.url().includes('/api/suppliers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const supplierReturnInventoryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/inventory/summary') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('button', { name: 'Supplier Returns', exact: true }).click()
    await page.getByRole('button', { name: 'Return to Supplier', exact: true }).click()
    await page.getByText('Return to Supplier', { exact: true }).first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('#supplier-return-branch').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('#supplier-return-supplier').waitFor({ state: 'visible', timeout: 10_000 })
    const supplierReturnSetup = await supplierReturnSetupResponse
    const supplierReturnInventory = await supplierReturnInventoryResponse
    const supplierReturnSetupStatus = supplierReturnSetup?.status?.() || null
    const supplierReturnInventoryStatus = supplierReturnInventory?.status?.() || null
    await page.locator('#supplier-return-branch').click()
    const supplierReturnBranchOptions = await page.getByRole('option').count()
    await page.keyboard.press('Escape')
    await page.locator('#supplier-return-supplier').click()
    const supplierReturnSupplierOptions = await page.getByRole('option').count()
    await page.keyboard.press('Escape')
    assert(supplierReturnBranchOptions > 1, 'Supplier return branch options did not render')
    assert(supplierReturnSupplierOptions >= 1, 'Supplier return supplier selector did not render')
    if (supplierReturnSetupStatus != null) {
      assert(supplierReturnSetupStatus === 200, `Supplier return setup supplier read returned HTTP ${supplierReturnSetupStatus}`)
    }
    if (supplierReturnInventoryStatus != null) {
      assert(supplierReturnInventoryStatus === 200, `Supplier return inventory read returned HTTP ${supplierReturnInventoryStatus}`)
    }

    console.log('[phase84] exercising files AI provider and response loaders')
    await page.goto('/files', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Library', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const aiProvidersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/ai/providers') && response.status() < 500,
      { timeout: 20_000 },
    )
    const aiResponsesResponse = page.waitForResponse(
      (response) => response.url().includes('/api/ai/responses') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: /^(AI Providers|Providers)$/ }).click()
    await page.getByText(/AI Providers|Add provider/).first().waitFor({ state: 'visible', timeout: 15_000 })
    const aiProvidersStatus = (await aiProvidersResponse).status()
    assert(aiProvidersStatus === 200, `Files AI providers read returned HTTP ${aiProvidersStatus}`)
    const aiResponsesStatus = (await aiResponsesResponse).status()
    assert(aiResponsesStatus === 200, `Files AI responses read returned HTTP ${aiResponsesStatus}`)
    await page.getByRole('button', { name: /^(AI Responses|Responses)$/ }).click()
    await page.getByText(/AI Responses|No AI responses saved yet/).first().waitFor({ state: 'visible', timeout: 15_000 })

    console.log('[phase84] exercising catalog portal editor helper loaders')
    const catalogAiProvidersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/ai/providers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const catalogReviewItemsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/portal/submissions/review') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/catalog', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText(/Customer Portal|Catalog|Branding|Live preview/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const catalogAiProvidersRead = await catalogAiProvidersResponse
    const catalogReviewItemsRead = await catalogReviewItemsResponse
    const catalogAiProvidersStatus = catalogAiProvidersRead?.status?.() || latestObservedStatus(chunkRequests, /\/api\/ai\/providers/i)
    const catalogReviewItemsStatus = catalogReviewItemsRead?.status?.() || latestObservedStatus(chunkRequests, /\/api\/portal\/submissions\/review/i)
    assert(catalogAiProvidersStatus === 200, `Catalog AI providers read returned HTTP ${catalogAiProvidersStatus}`)
    assert(catalogReviewItemsStatus === 200, `Catalog review items read returned HTTP ${catalogReviewItemsStatus}`)

    console.log('[phase84] exercising public portal bootstrap loader')
    const publicPortalBootstrapResponse = page.waitForResponse(
      (response) => response.url().includes('/api/portal/bootstrap') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.goto('/public', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText(/Leang|Products|Catalog|Membership|Search/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const publicPortalBootstrapStatus = (await publicPortalBootstrapResponse).status()
    assert(publicPortalBootstrapStatus === 200, `Public portal bootstrap returned HTTP ${publicPortalBootstrapStatus}`)

    console.log('[phase84] exercising receipt settings preview loader')
    await page.goto('/receipt-settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText(/Receipt Template|Receipt|Live Preview/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText('RCP-PREVIEW-0001', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const receiptPreviewVisible = await page.getByText('RCP-PREVIEW-0001', { exact: false }).first().isVisible()
    assert(receiptPreviewVisible, 'Receipt settings preview did not render')

    console.log('[phase84] exercising POS catalog, customer, and delivery option loaders')
    const posProductBootstrapResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/bootstrap')
        && response.url().includes('sort=name_asc')
        && response.status() < 500,
      { timeout: 20_000 },
    )
    const posCategoriesResponse = page.waitForResponse(
      (response) => /\/api\/categories(?:\?|$)/.test(response.url()) && response.status() < 500,
      { timeout: 20_000 },
    )
    const posProductFiltersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/filters') && response.status() < 500,
      { timeout: 20_000 },
    )
    const posCustomersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/customers') && response.status() < 500,
      { timeout: 20_000 },
    )
    const posDeliveryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/delivery-contacts') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.goto('/pos', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Point of Sale', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const posProductBootstrapStatus = (await posProductBootstrapResponse).status()
    const posCategoriesStatus = (await posCategoriesResponse).status()
    const posProductFiltersStatus = (await posProductFiltersResponse).status()
    const posCustomersStatus = (await posCustomersResponse).status()
    const posDeliveryStatus = (await posDeliveryResponse).status()
    assert(posProductBootstrapStatus === 200, `POS product bootstrap read returned HTTP ${posProductBootstrapStatus}`)
    assert(posCategoriesStatus === 200, `POS categories read returned HTTP ${posCategoriesStatus}`)
    assert(posProductFiltersStatus === 200, `POS product filters read returned HTTP ${posProductFiltersStatus}`)
    assert(posCustomersStatus === 200, `POS customers read returned HTTP ${posCustomersStatus}`)
    assert(posDeliveryStatus === 200, `POS delivery contacts read returned HTTP ${posDeliveryStatus}`)
    const posMember = await page.evaluate(async () => {
      const result = await window.api.getCustomers({ page: 1, pageSize: 100, includePoints: 1 })
      const rows = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : [])
      const match = rows.find((customer) => String(customer?.membership_number || '').trim() && String(customer?.name || '').trim())
      return match
        ? { name: String(match.name || '').trim(), membershipNumber: String(match.membership_number || '').trim() }
        : null
    })
    assert(posMember?.name && posMember?.membershipNumber, 'No customer membership number was available for the POS membership lookup check')
    const posCustomerSearch = page.locator('#pos-customer-search')
    if (!(await posCustomerSearch.isVisible().catch(() => false))) {
      const posCustomerToggle = page.locator('button')
        .filter({ hasText: /Customer/i })
        .filter({ hasText: /Show|Hide/i })
        .first()
      await posCustomerToggle.click()
    }
    await posCustomerSearch.waitFor({ state: 'visible', timeout: 10_000 })
    const posMembershipLookupResponse = page.waitForResponse(
      (response) => response.url().includes('/api/portal/membership/')
        && response.url().includes(encodeURIComponent(posMember.membershipNumber))
        && response.status() < 500,
      { timeout: 20_000 },
    )
    await posCustomerSearch.fill(posMember.name)
    const posCustomerSuggestion = page.locator('.absolute.top-full button').filter({ hasText: posMember.name }).first()
    await posCustomerSuggestion.waitFor({ state: 'visible', timeout: 10_000 })
    await posCustomerSuggestion.click()
    const posMembershipLookupStatus = (await posMembershipLookupResponse).status()
    assert(posMembershipLookupStatus === 200, `POS membership lookup returned HTTP ${posMembershipLookupStatus}`)
    await page.getByText(posMember.membershipNumber, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('button').filter({ hasText: /\+ New|Add New/i }).first().click()
    const posCustomerQuickAddModal = page.locator('.fixed.inset-0').filter({ has: page.locator('#pos-quick-customer-name') }).last()
    await posCustomerQuickAddModal.locator('#pos-quick-customer-name').waitFor({ state: 'visible', timeout: 15_000 })
    await posCustomerQuickAddModal.getByRole('button', { name: /Cancel/i }).click()
    const posDeliveryToggle = page.locator('button.relative.ml-2.w-9.h-5').first()
    if (!(await page.locator('#pos-delivery-search').isVisible().catch(() => false))) {
      await page.locator('button').filter({ hasText: /Delivery/i }).filter({ hasText: /Show|Hide/i }).first().click()
    }
    if (!(await page.locator('#pos-delivery-search').isVisible().catch(() => false))) {
      await posDeliveryToggle.click()
    }
    await page.locator('#pos-delivery-search').waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator('button').filter({ hasText: /\+ New|Add New/i }).last().click()
    const posDeliveryQuickAddModal = page.locator('.fixed.inset-0').filter({ has: page.locator('#pos-quick-delivery-name') }).last()
    await posDeliveryQuickAddModal.locator('#pos-quick-delivery-name').waitFor({ state: 'visible', timeout: 15_000 })
    await posDeliveryQuickAddModal.getByRole('button', { name: /Cancel/i }).click()

    console.log('[phase84] exercising product lookup manager loaders')
    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Products', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const categoryLookupUsageResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/lookups/usage') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: 'Manage', exact: true }).click()
    await page.getByRole('button', { name: 'Categories', exact: true }).click()
    await page.getByText(/Manage Categories|Review products|product\(s\)/).first().waitFor({ state: 'visible', timeout: 15_000 })
    const categoryLookupUsageStatus = (await categoryLookupUsageResponse).status()
    assert(categoryLookupUsageStatus === 200, `Category lookup usage read returned HTTP ${categoryLookupUsageStatus}`)

    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    const unitLookupUsageResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/lookups/usage') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: 'Manage', exact: true }).click()
    await page.getByRole('button', { name: 'Units', exact: true }).click()
    await page.getByText(/Manage Units|Review products|product\(s\)/).first().waitFor({ state: 'visible', timeout: 15_000 })
    const unitLookupUsageStatus = (await unitLookupUsageResponse).status()
    const unitLookupStatus = latestObservedStatus(chunkRequests, /\/api\/units/i)
    assert(unitLookupUsageStatus === 200, `Unit lookup usage read returned HTTP ${unitLookupUsageStatus}`)
    assert(unitLookupStatus === 200, `Unit lookup read returned HTTP ${unitLookupStatus || 'no observed response'}`)

    await page.goto('/products', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    const brandLookupUsageResponse = page.waitForResponse(
      (response) => response.url().includes('/api/products/lookups/usage') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: 'Manage', exact: true }).click()
    await page.getByRole('button', { name: 'Brand', exact: true }).click()
    await page.getByText(/Brand Manage|Review products|No ambiguous brands need review/).first().waitFor({ state: 'visible', timeout: 15_000 })
    const brandLookupUsageStatus = (await brandLookupUsageResponse).status()
    assert(brandLookupUsageStatus === 200, `Brand lookup usage read returned HTTP ${brandLookupUsageStatus}`)

    console.log('[phase84] exercising inventory saved reason loader')
    const inventoryBootstrapResponse = page.waitForResponse(
      (response) => response.url().includes('/api/inventory/bootstrap') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const inventoryReasonsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/inventory/reasons') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Inventory', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const inventoryBootstrap = await inventoryBootstrapResponse
    const inventoryBootstrapStatus = inventoryBootstrap?.status?.() || latestObservedStatus(chunkRequests, /\/api\/inventory\/bootstrap/i)
    assert(inventoryBootstrapStatus === 200, `Inventory bootstrap read returned HTTP ${inventoryBootstrapStatus}`)
    const inventoryCheckboxes = page.getByRole('checkbox')
    assert(await inventoryCheckboxes.count() > 0, 'No inventory select checkbox rendered')
    await inventoryCheckboxes.first().check()
    await page.getByRole('button', { name: /Reasons/i }).first().click()
    await page.getByText(/Saved reasons|Reuse common reasons|No saved reasons yet/).first().waitFor({ state: 'visible', timeout: 15_000 })
    const inventoryReasonsStatus = (await inventoryReasonsResponse).status()
    assert(inventoryReasonsStatus === 200, `Inventory reasons read returned HTTP ${inventoryReasonsStatus}`)
    const reasonManagerOverlay = page.locator('.fixed.inset-0.z-50').last()
    await reasonManagerOverlay.locator('button').first().click()
    await reasonManagerOverlay.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
    const inventoryStatsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/inventory/stats') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const inventoryReturnsStatsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/returns') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const inventoryDashboardStatsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/dashboard') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.getByRole('button', { name: 'Stats', exact: true }).click()
    await page.getByText(/Stock Value|Returns|Fees collected/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    const inventoryStats = await inventoryStatsResponse
    const inventoryReturnsStats = await inventoryReturnsStatsResponse
    const inventoryDashboardStats = await inventoryDashboardStatsResponse
    const inventoryStatsStatus = inventoryStats?.status?.() || latestObservedStatus(chunkRequests, /\/api\/inventory\/stats/i)
    const inventoryReturnsStatsStatus = inventoryReturnsStats?.status?.() || latestObservedStatus(chunkRequests, /\/api\/returns/i)
    const inventoryDashboardStatsStatus = inventoryDashboardStats?.status?.() || latestObservedStatus(chunkRequests, /\/api\/dashboard/i)
    assert(inventoryStatsStatus === 200, `Inventory stats read returned HTTP ${inventoryStatsStatus}`)
    assert(inventoryReturnsStatsStatus === 200, `Inventory returns stats read returned HTTP ${inventoryReturnsStatsStatus}`)
    assert(inventoryDashboardStatsStatus === 200, `Inventory dashboard stats read returned HTTP ${inventoryDashboardStatsStatus}`)

    const inventoryMovementsResponse = page.waitForResponse(
      (response) => response.url().includes('/api/inventory/movements') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.getByRole('button', { name: 'Movements', exact: true }).click()
    await page.getByText(/Grouped movement history|Loading movements/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByRole('button', { name: /Related stock changes are bundled/i }).first().waitFor({ state: 'visible', timeout: 15_000 })
    const inventoryMovements = await inventoryMovementsResponse
    const inventoryMovementsStatus = inventoryMovements?.status?.() || latestObservedStatus(chunkRequests, /\/api\/inventory\/movements/i)
    assert(inventoryMovementsStatus === 200, `Inventory movements read returned HTTP ${inventoryMovementsStatus}`)

    console.log('[phase84] exercising inventory import modal button')
    await page.getByRole('button', { name: /^Import$/i }).click()
    const inventoryImportModal = page.locator('.fixed.inset-0').filter({ hasText: /Import Inventory|Paste CSV/i }).last()
    await inventoryImportModal.locator('#inventory-import-csv').waitFor({ state: 'visible', timeout: 15_000 })
    const inventoryImportModalOpened = await inventoryImportModal.getByText(/Import Inventory/i).first().isVisible()
    assert(inventoryImportModalOpened, 'Inventory import modal did not render after clicking Import')
    await inventoryImportModal.locator('button').first().click()
    await inventoryImportModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    console.log('[phase84] exercising contacts export loader')
    await page.goto('/contacts', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Contacts', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const contactsExportCustomersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/customers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const contactsExportSuppliersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/suppliers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const contactsExportDeliveryResponse = page.waitForResponse(
      (response) => response.url().includes('/api/delivery-contacts') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.locator('button[title="Export All Contacts"], button[title="Export all contacts as CSVs"]').first().click()
    const contactsExportCustomers = await contactsExportCustomersResponse
    const contactsExportSuppliers = await contactsExportSuppliersResponse
    const contactsExportDelivery = await contactsExportDeliveryResponse
    const contactsExportCustomersStatus = contactsExportCustomers?.status?.() || latestObservedStatus(chunkRequests, /\/api\/customers/i)
    const contactsExportSuppliersStatus = contactsExportSuppliers?.status?.() || latestObservedStatus(chunkRequests, /\/api\/suppliers/i)
    const contactsExportDeliveryStatus = contactsExportDelivery?.status?.() || latestObservedStatus(chunkRequests, /\/api\/delivery-contacts/i)
    assert(contactsExportCustomersStatus === 200, `Contacts export customer read returned HTTP ${contactsExportCustomersStatus}`)
    assert(contactsExportSuppliersStatus === 200, `Contacts export supplier read returned HTTP ${contactsExportSuppliersStatus}`)
    assert(contactsExportDeliveryStatus === 200, `Contacts export delivery read returned HTTP ${contactsExportDeliveryStatus}`)

    console.log('[phase84] exercising contacts import modal button')
    await page.getByRole('button', { name: /Imports/i }).click()
    const contactImportTypeModal = page.locator('.fixed.inset-0').filter({ hasText: /Import All Contacts/i }).last()
    await contactImportTypeModal.getByRole('button', { name: /Customers/i }).click()
    const contactsImportModal = page.locator('.fixed.inset-0').filter({ hasText: /Import Customers|Choose CSV/i }).last()
    await contactsImportModal.getByText(/Import Customers/i).first().waitFor({ state: 'visible', timeout: 15_000 })
    const contactsImportModalOpened = await contactsImportModal.getByText(/Import Customers/i).first().isVisible()
    assert(contactsImportModalOpened, 'Contacts import modal did not render after choosing Customers import')
    await contactsImportModal.locator('button').first().click()
    await contactsImportModal.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})

    console.log('[phase84] exercising loyalty customer points loader')
    const loyaltyCustomersResponse = page.waitForResponse(
      (response) => response.url().includes('/api/customers') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/loyalty-points', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Loyalty Points', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: 'Top Points', exact: true }).click().catch(() => {})
    await page.getByText(/Customer lookup|Customer preview|Customers with the highest point balances/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const loyaltyCustomers = await loyaltyCustomersResponse
    const loyaltyCustomersStatus = loyaltyCustomers?.status?.() || latestObservedStatus(chunkRequests, /\/api\/customers/i)
    assert(loyaltyCustomersStatus === 200, `Loyalty customer points read returned HTTP ${loyaltyCustomersStatus}`)
    await page.getByRole('button', { name: 'Lookup', exact: true }).click().catch(() => {})
    await page.locator('#membership-lookup').waitFor({ state: 'visible', timeout: 10_000 })
    const loyaltyMembershipNumber = await page.evaluate(async () => {
      const result = await window.api.getCustomers({ page: 1, pageSize: 50, includePoints: 1 })
      const rows = Array.isArray(result) ? result : (Array.isArray(result?.items) ? result.items : [])
      const match = rows.find((customer) => String(customer?.membership_number || '').trim())
      return String(match?.membership_number || '').trim()
    })
    assert(loyaltyMembershipNumber, 'No customer membership number was available for the loyalty lookup check')
    const loyaltyMembershipLookupResponse = page.waitForResponse(
      (response) => response.url().includes('/api/portal/membership/') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.locator('#membership-lookup').fill(loyaltyMembershipNumber)
    await page.getByRole('button', { name: /Check (points|membership)/i }).click()
    const loyaltyMembershipLookupStatus = (await loyaltyMembershipLookupResponse).status()
    assert(loyaltyMembershipLookupStatus === 200, `Loyalty membership lookup returned HTTP ${loyaltyMembershipLookupStatus}`)

    console.log('[phase84] exercising users and roles loaders')
    const usersListResponse = page.waitForResponse(
      (response) => response.url().includes('/api/users') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const rolesListResponse = page.waitForResponse(
      (response) => response.url().includes('/api/roles') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Users', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: 'Roles', exact: true }).click()
    await page.getByText(/Roles|Create role|Administrator/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const usersList = await usersListResponse
    const rolesList = await rolesListResponse
    const usersListStatus = usersList?.status?.() || latestObservedStatus(chunkRequests, /\/api\/users/i)
    const rolesListStatus = rolesList?.status?.() || latestObservedStatus(chunkRequests, /\/api\/roles/i)
    assert(usersListStatus === 200, `Users list read returned HTTP ${usersListStatus}`)
    assert(rolesListStatus === 200, `Roles list read returned HTTP ${rolesListStatus}`)

    console.log('[phase84] exercising profile modal hydration loaders')
    const profileDetailsResponse = page.waitForResponse(
      (response) => /\/api\/users\/\d+\/profile/.test(response.url()) && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const profileOtpResponse = page.waitForResponse(
      (response) => response.url().includes('/api/auth/otp/status') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const profileCapabilitiesResponse = page.waitForResponse(
      (response) => response.url().includes('/api/auth/verification-capabilities') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    const profileAuthMethodsResponse = page.waitForResponse(
      (response) => /\/api\/users\/\d+\/auth-methods/.test(response.url()) && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.getByRole('button', { name: /^Profile$/i }).click()
    await page.locator('#profile-name').waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText(/Login methods|Security|Organization/i).first().waitFor({ state: 'visible', timeout: 10_000 })
    const profileDetails = await profileDetailsResponse
    const profileOtp = await profileOtpResponse
    const profileCapabilities = await profileCapabilitiesResponse
    const profileAuthMethods = await profileAuthMethodsResponse
    const profileDetailsStatus = profileDetails?.status?.() || latestObservedStatus(chunkRequests, /\/api\/users\/\d+\/profile/i)
    const profileOtpStatus = profileOtp?.status?.() || latestObservedStatus(chunkRequests, /\/api\/auth\/otp\/status/i)
    const profileCapabilitiesStatus = profileCapabilities?.status?.() || latestObservedStatus(chunkRequests, /\/api\/auth\/verification-capabilities/i)
    const profileAuthMethodsStatus = profileAuthMethods?.status?.() || latestObservedStatus(chunkRequests, /\/api\/users\/\d+\/auth-methods/i)
    assert(profileDetailsStatus === 200, `Profile details read returned HTTP ${profileDetailsStatus}`)
    assert(profileOtpStatus === 200, `Profile OTP status read returned HTTP ${profileOtpStatus}`)
    assert(profileCapabilitiesStatus === 200, `Profile verification capabilities read returned HTTP ${profileCapabilitiesStatus}`)
    assert(profileAuthMethodsStatus === 200, `Profile sign-in methods read returned HTTP ${profileAuthMethodsStatus}`)
    await page.keyboard.press('Escape').catch(() => {})

    console.log('[phase84] exercising audit/settings/server admin helper loaders')
    const auditLogResponse = page.waitForResponse(
      (response) => response.url().includes('/api/system/audit-logs') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/audit-log', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Audit Log', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const auditLogRead = await auditLogResponse
    const auditLogStatus = auditLogRead?.status?.() || latestObservedStatus(chunkRequests, /\/api\/system\/audit-logs/i)
    assert(auditLogStatus === 200, `Audit log read returned HTTP ${auditLogStatus}`)

    const otpStatusResponse = page.waitForResponse(
      (response) => response.url().includes('/api/auth/otp/status') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Settings', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const otpStatusRead = await otpStatusResponse
    const otpStatusStatus = otpStatusRead?.status?.() || latestObservedStatus(chunkRequests, /\/api\/auth\/otp\/status/i)
    assert(otpStatusStatus === 200, `Settings OTP status read returned HTTP ${otpStatusStatus}`)

    console.log('[phase84] exercising backup integration doctor loader')
    const integrationDoctorResponse = page.waitForResponse(
      (response) => response.url().includes('/api/system/integration-doctor') && response.status() < 500,
      { timeout: 20_000 },
    ).catch(() => null)
    await page.goto('/backup', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Backup', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /^Doctor$/i }).click()
    await page.getByTestId('backup-doctor-refresh').waitFor({ state: 'visible', timeout: 20_000 })
    const integrationDoctorRead = await integrationDoctorResponse
    const integrationDoctorStatus = integrationDoctorRead?.status?.() || latestObservedStatus(chunkRequests, /\/api\/system\/integration-doctor/i)
    assert(integrationDoctorStatus === 200, `Integration doctor read returned HTTP ${integrationDoctorStatus}`)

    const serverBootstrapResponse = page.waitForResponse(
      (response) => response.url().includes('/api/system/bootstrap') && response.status() < 500,
      { timeout: 20_000 },
    )
    await page.goto('/server', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText(/Sync Server|Diagnostics/).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByText(/Pending|No pending offline actions|Queue/i).first().waitFor({ state: 'visible', timeout: 20_000 })
    const serverBootstrapStatus = (await serverBootstrapResponse).status()
    assert(serverBootstrapStatus === 200, `Server bootstrap read returned HTTP ${serverBootstrapStatus}`)

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
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
        pageIdentity: true,
        notBlank: true,
        appBootstrapStatus,
        appSettingsStatus,
        appSettingsMetaStatus,
        dashboardStartupStatus,
        dashboardRangeAnalyticsStatus,
        notificationSummaryStatus,
        notificationPanelVisible,
        branchesListStatus,
        branchSummaryStatus,
        branchStockButtons: stockButtonCount,
        expandedStockPanelVisible,
        transferStockStatus,
        branchTransfersStatus,
        salesExportPreviewStatus,
        salesImportModalOpened,
        productSupplierStatus,
        productImportModalOpened,
        productSearchStatus,
        productFiltersStatus,
        productActionHistoryStatus,
        filePickerStatus,
        supplierReturnSetupStatus,
        supplierReturnInventoryStatus,
        aiProvidersStatus,
        aiResponsesStatus,
        catalogAiProvidersStatus,
        catalogReviewItemsStatus,
        publicPortalBootstrapStatus,
        receiptPreviewVisible,
        posProductBootstrapStatus,
        posCategoriesStatus,
        posProductFiltersStatus,
        posCustomersStatus,
        posDeliveryStatus,
        posMembershipLookupStatus,
        categoryLookupUsageStatus,
        unitLookupStatus,
        unitLookupUsageStatus,
        brandLookupUsageStatus,
        inventoryBootstrapStatus,
        inventoryReasonsStatus,
        inventoryStatsStatus,
        inventoryReturnsStatsStatus,
        inventoryDashboardStatsStatus,
        inventoryMovementsStatus,
        inventoryImportModalOpened,
        contactsExportCustomersStatus,
        contactsExportSuppliersStatus,
        contactsExportDeliveryStatus,
        contactsImportModalOpened,
        loyaltyCustomersStatus,
        loyaltyMembershipLookupStatus,
        usersListStatus,
        rolesListStatus,
        profileDetailsStatus,
        profileOtpStatus,
        profileCapabilitiesStatus,
        profileAuthMethodsStatus,
        auditLogStatus,
        otpStatusStatus,
        integrationDoctorStatus,
        serverBootstrapStatus,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests: chunkRequests,
      screenshots: {
        branches: SCREENSHOT_PATH,
        notifications: NOTIFICATION_SCREENSHOT_PATH,
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
