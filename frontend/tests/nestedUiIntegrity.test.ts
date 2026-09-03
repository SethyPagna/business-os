import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

const app = read('App.tsx')
const registeredPages = [...app.matchAll(/(\w+):\s*asPageModule\(\(\)\s*=>\s*import\('([^']+)'\)\)/g)].map((match) => match[1])
const expectedPages = ['dashboard', 'notes', 'products', 'pos', 'sales', 'branches', 'contacts', 'catalog', 'promotions', 'review', 'receipt_settings', 'settings', 'files', 'server']
assert.deepEqual(registeredPages, expectedPages, 'every main admin page must remain represented in the nested UI audit')

// Stable state/component identifiers pin mini-sections that are easy to miss
// when a test only opens a page's default landing section.
const sectionMatrix: Record<string, { file: string; tokens: string[] }> = {
  dashboard: { file: 'components/dashboard/Dashboard.tsx', tokens: ['recentSalesOpen', 'recentSaleDetail', 'setProductDetail', 'setCustomerDetail', 'setKpiDetail'] },
  notes: { file: 'components/notes/NotesPage.tsx', tokens: ['NotesWidget', 'page-scroll'] },
  products: { file: 'components/products/Products.tsx', tokens: ["'products' | 'stock_changes' | 'stock_in_sessions' | 'duplicates'", 'HeaderActions', 'ManageBatchesModal', 'ProductDetailModal'] },
  pos: { file: 'components/pos/POS.tsx', tokens: ['FilterPanel', 'ProductDetailSheet', 'QuickAddModal', 'PaginationControls'] },
  sales: { file: 'components/sales/SalesHubPage.tsx', tokens: ["'sales'", "'returns'", "'fees'", "'reports'"] },
  branches: { file: 'components/branches/BranchesHubPage.tsx', tokens: ["'overview'", "'products'", "'transfers'", "'rfid'", 'showSectionNavigation={false}', 'overflow-x-auto'] },
  contacts: { file: 'components/contacts/Contacts.tsx', tokens: ["'customers'", "'suppliers'", "'delivery'", "'duplicates'", 'overflow-x-auto'] },
  catalog: { file: 'components/catalog/CatalogPage.tsx', tokens: ["activeTab === 'products'", "activeTab === 'about'", "activeTab === 'faq'", "activeTab === 'ai'"] },
  promotions: { file: 'components/promotions/PromotionsPage.tsx', tokens: ["id: 'rules'", "id: 'discounts'", "id: 'loyalty'", 'overflow-x-auto'] },
  review: { file: 'components/review/ReviewLogsPage.tsx', tokens: ["key: 'review'", "key: 'audit'", "key: 'deleted'", 'overflow-x-auto'] },
  receipt_settings: { file: 'components/receipt-settings/ReceiptSettings.tsx', tokens: ["id: 'fields'", "id: 'order'", "id: 'delivery'", "id: 'style'", "id: 'language'", "id: 'footer'", "id: 'qr'", "id: 'print'", 'overflow-x-auto'] },
  settings: { file: 'components/utils-settings/SettingsHubPage.tsx', tokens: ["id: 'settings'", "id: 'users'", "id: 'backup'", 'overflow-x-auto'] },
  files: { file: 'components/files/FilesPage.tsx', tokens: ["tabButton('assets'", "tabButton('providers'", "tabButton('responses'", 'PageHeader'] },
  server: { file: 'components/server/ServerPage.tsx', tokens: ['page-scroll', 'PageHeader', 'card flex'] },
}

// The section chip row moved out of the hub pages and into the shared
// HubSectionNav (the 3-layer mobile navigation). A hub that renders it
// satisfies the row's viewport-bounded / scrollable pin through that
// component, so the row tokens are looked up there instead of in the hub.
const hubSectionNav = read('components/shared/HubSectionNav.tsx')
const delegatesRow = (source: string): boolean => /<HubSectionNav\b/.test(source)
const rowSource = (source: string): string => (delegatesRow(source) ? hubSectionNav : source)

for (const [page, contract] of Object.entries(sectionMatrix)) {
  const source = read(contract.file)
  for (const token of contract.tokens) {
    const haystack = token === 'overflow-x-auto' ? rowSource(source) : source
    assert.ok(haystack.includes(token), `${page}: missing nested surface/action token ${token}`)
  }
}

const branchesHub = read('components/branches/BranchesHubPage.tsx')
assert.doesNotMatch(branchesHub, /id: 'movements'/, 'Branches hub must not restore a separate generic Movement mini-section')
assert.doesNotMatch(branchesHub, /hostSection="movements"/, 'the redundant Inventory movement ledger must stay removed from Branches')
assert.match(branchesHub, /active === 'transfers'[\s\S]*view="transfers"/, 'Transfer must own transfer history without a second movement ledger')
assert.match(branchesHub, /active === 'products'[\s\S]*hostSection="stats"/, 'Products must render the ranged COGS, revenue, profit, sales and inventory statistics workspace')
assert.doesNotMatch(branchesHub, /active === 'inventory'/, 'Branches must not restore the redundant branch-inventory duplicate section')

for (const file of ['components/branches/BranchesHubPage.tsx', 'components/review/ReviewLogsPage.tsx', 'components/utils-settings/SettingsHubPage.tsx', 'components/promotions/PromotionsPage.tsx']) {
  const source = rowSource(read(file))
  assert.match(source, /max-w-full[^"']*overflow-x-auto|overflow-x-auto[^"']*max-w-full/, `${file}: section row must be viewport bounded and horizontally scrollable`)
  assert.doesNotMatch(source, /inline-flex flex-wrap rounded-xl/, `${file}: section row must not push into extra rows`)
}

const pageHeader = read('components/shared/PageHeader.tsx')
assert.match(pageHeader, /overflow-x-auto/, 'shared page actions must stay on one compact scrollable row')
assert.match(pageHeader, /max-w-full/, 'shared page actions must be bounded by the viewport')

const sectionSwitcher = read('components/shared/SectionSwitcher.tsx')
assert.match(sectionSwitcher, /max-w-full min-w-0 overflow-x-auto/, 'shared section switcher must be viewport bounded')

const pagination = read('components/shared/PaginationControls.tsx')
assert.equal((pagination.match(/hidden sm:inline">\{(?:back|next)Label\}/g) || []).length, 2, 'compact pager labels must collapse to icon-only on narrow screens')
assert.match(pagination, /onPageChange\?\.\(safePage\)/, 'pager must repair stale out-of-range controlled pages')

const modal = read('components/shared/Modal.tsx')
for (const token of ['modal-viewport-safe', 'modal-panel-safe', 'modal-scroll', 'detail-scroll-text min-w-0 flex-1', 'createPortal']) assert.ok(modal.includes(token), `shared modal is missing ${token}`)

const login = read('components/auth/Login.tsx')
const mainCss = read('styles/main.css')
assert.match(login, /auth-frame grid w-full min-w-0 max-w-5xl/, 'login frame must be allowed to shrink to iPhone widths')
assert.match(login, /auth-card min-w-0 max-w-full/, 'login card must not preserve a desktop intrinsic width on phones')
assert.match(login, /min-w-0 break-words text-center text-2xl/, 'long business names must wrap inside the login card')
assert.match(mainCss, /\.auth-frame \{[\s\S]*min-width: 0;[\s\S]*max-width: 100%;/)
assert.match(mainCss, /\.auth-card \.input \{[\s\S]*min-width: 0;[\s\S]*max-width: 100%;[\s\S]*box-sizing: border-box;/)

for (const file of ['components/shared/InfoHint.tsx', 'components/shared/TruncatedText.tsx']) {
  const source = read(file)
  assert.match(source, /createPortal\([\s\S]*document\.body/, `${file}: explanatory content must portal to the viewport layer`)
  assert.match(source, /fixed z-\[1200\]/, `${file}: explanatory content must render above z-[1050] modals and z-[1100] notifications`)
}

// The rename-cascade prompt is awaited by saves that run INSIDE a z-[1050]
// shared Modal; below that layer it is invisible and the save never resolves.
// Accept the literal layer or the token alias the RC branch introduces.
const renameCascade = read('components/shared/RenameCascadeModal.tsx')
assert.match(renameCascade, /createPortal\(/, 'RenameCascadeModal must portal to the viewport layer')
assert.match(renameCascade, /fixed inset-0 z-\[(?:1060|var\(--z-modal-2\))\]/, 'RenameCascadeModal must layer above the z-[1050] shared Modal it is opened from')

for (const file of ['components/products/forms/BulkAddStockModal.tsx', 'components/promotions/PromotionsPage.tsx']) {
  const source = read(file)
  assert.match(source, /modal-viewport-safe/, `${file}: nested dialog viewport must respect safe areas`)
  assert.match(source, /modal-panel-safe/, `${file}: nested dialog must stay within the dynamic viewport`)
  assert.match(source, /overflow-y-auto/, `${file}: dialog content must remain reachable on short screens`)
}

console.log(`PASS nested UI integrity matrix: ${expectedPages.length} main pages, ${Object.values(sectionMatrix).reduce((sum, row) => sum + row.tokens.length, 0)} nested contracts`)
