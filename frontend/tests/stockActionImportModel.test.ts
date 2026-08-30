// Tests the unified stock-action import's remaining pure helper and guards
// the wiring that keeps it on the review-first direct-apply contract (the
// user's standing import flow: upload → client-side review → analyze →
// apply directly in the background). The old two-screen server review
// ("analyze → review table → Confirm & Import") is deliberately GONE -- if
// any assertion here regresses, either the modal grew a second review hop
// back or the confirm flag stopped riding the approve and stock jobs
// dead-end on the server's 409 again.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { unwrapImportJob } from '../src/components/products/import/stockActionImportModel.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('unwrapImportJob accepts {job:{id}}, a bare job, and rejects id-less/garbage', () => {
  assert.equal(unwrapImportJob({ job: { id: 7, status: 'analyzing' } })?.id, 7)
  assert.equal(unwrapImportJob({ id: 9 })?.id, 9)
  assert.equal(unwrapImportJob({}), null)
  assert.equal(unwrapImportJob(null), null)
  assert.equal(unwrapImportJob('nope'), null)
})

// ---- wiring guards (cross-file) -------------------------------------------
test('StockActionImportModal is ONE screen: client-side row review, then direct apply', () => {
  const src = read('src/components/products/import/StockActionImportModal.tsx')
  assert.ok(/type:\s*'stock_actions'/.test(src), 'creates a stock_actions job')
  assert.ok(src.includes('stock_action_mode: mode'), 'sends the Direct/Reconcile mode in the policy')
  assert.ok(src.includes('auto_approve: true'), 'flags the job for direct apply, same as every sibling importer')
  assert.ok(src.includes('<CsvImportPreview'), 'the rows are reviewed CLIENT-SIDE before upload')
  assert.ok(src.includes('<ServerImportReviewScreen'), 'dispatch hands off to the shared direct-apply screen')
  assert.ok(src.includes('confirmStockActions'), 'the approve carries the stock confirm flag')
  assert.ok(!src.includes('getImportJobReview'), 'no second server-side review table')
  assert.ok(!src.includes("useState<Step>"), 'no upload/review step machine any more')
  assert.ok(!src.includes('Confirm & Import'), 'no post-analyze confirm button')
})

test('ServerImportReviewScreen forwards the stock confirm flag on approve', () => {
  const screen = read('src/components/imports/ServerImportReviewScreen.tsx')
  assert.ok(screen.includes("'stock_action_modal'"), 'accepts the stock modal as a source')
  assert.ok(/confirmStockActions \? \{ confirmStockActions: true \}/.test(screen), 'approve carries confirm_stock_actions when asked')
})

test('ImportModeWizard is only a mode owner; it does not render a duplicate setup/upload screen', () => {
  const src = read('src/components/products/import/ImportModeWizard.tsx')
  assert.ok(src.includes('StockActionImportModal'), 'wires in the server-backed modal')
  assert.ok(src.includes('BulkImportModal'), 'wires in the real product/image importer')
  assert.ok(!/import\(['"]\.\/AddSaleImportModal['"]\)/.test(src), 'no longer launches the retired client-side AddSaleImportModal')
  assert.ok(!src.includes('<Modal'), 'wrapper must not create a second modal screen')
  assert.ok(!src.includes('Upload file &'), 'wrapper must not render a fake upload handoff')
  assert.ok(!src.includes('TemplateUploadInfo'), 'wrapper must not duplicate the real template/information controls')
})

test('real Screen 1 keeps the wrapper section design and owns upload, template, images and information', () => {
  const bulk = read('src/components/products/import/BulkImportModal.tsx')
  const stock = read('src/components/products/import/StockActionImportModal.tsx')
  const shared = read('src/components/products/import/ProductImportModeTabs.tsx')
  assert.ok(shared.includes('ProductImportOptionCard'), 'wrapper-style compact option cards are shared by real importers')
  assert.ok(shared.includes('InfoHint'), 'option explanations stay in the wrapper-style info affordance')
  assert.ok(bulk.includes('<ProductImportModeTabs'), 'real product Screen 1 owns the mode section')
  assert.ok(bulk.includes('<ProductImportOptionCard'), 'real product Screen 1 uses wrapper-style options')
  assert.ok(bulk.includes("T('csv_template_download'"), 'real template download remains on Screen 1')
  assert.ok(bulk.includes("T('images_screen_one_hint'"), 'image selection explicitly belongs to Screen 1')
  assert.equal((bulk.match(/T\('images_optional'/g) || []).length, 1, 'image picker must not be duplicated on review')
  assert.ok(bulk.includes('order-1 rounded-xl'), 'options render before the real template/upload controls')
  assert.ok(stock.includes('<ProductImportModeTabs'), 'real stock-action Screen 1 owns the same mode section')
  assert.ok(stock.includes('<ProductImportOptionCard'), 'Direct/Reconcile use the same wrapper option design')
})

test('approveImportJob forwards confirm_stock_actions', () => {
  const src = read('src/api/importJobsTransport.ts')
  assert.ok(src.includes('confirm_stock_actions: true'), 'transport can send the confirmation flag')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll stockActionImportModel tests passed')
