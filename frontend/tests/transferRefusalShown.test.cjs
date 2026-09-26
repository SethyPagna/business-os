// U-transfer2 Finding 1 (26 Sep 2026): every transfer refusal is a 4xx with a
// stable code and a sentence the operator can read in their own language.
//
// Before, a transfer the Worker's guards refused (a product whose received
// lots add up to more than its branch stock, a race with a sale, maintenance)
// escaped the routes as a 500 "Something went wrong processing that request",
// in English, with the write's outcome reported as unknown. Now
// cloudflare/src/lib/transferOperation.ts's TRANSFER_REFUSALS names each
// refusal; the three transfer routes answer 409 { error, code } (503 with code
// maintenance_active for maintenance), and the error is the exact English of
// a pack key so the client can read it back out of the packs.
//
// This test drives that response through every transfer surface's real error
// path: the branch TransferModal's one write path (one checked row, several
// checked rows, and the Retry of a saved run -- the draft-resume case), and the
// Inventory transfer form's submit and Retry. Branches' toolbar, branch cards,
// transfers view and minimized-draft restore all mount that same TransferModal.
//
// Run: node tests/transferRefusalShown.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const en = JSON.parse(read('../src/lang/en.json'))
const km = JSON.parse(read('../src/lang/km.json'))

// 1. The Worker's refusal sentences, read from the Worker itself.
const worker = read('../../cloudflare/src/lib/transferOperation.ts')
const block = worker.match(/export const TRANSFER_REFUSALS = \{\n([\s\S]*?)\n\} as const/)
assert.ok(block, 'cloudflare/src/lib/transferOperation.ts exports TRANSFER_REFUSALS')
const refusals = [...block[1].matchAll(/^\s*(\w+): '([^'\n]+)',$/gm)].map(([, key, sentence]) => ({ key, sentence }))
assert.deepEqual(refusals.map(({ key }) => key).sort(),
  ['transfer_maintenance_active', 'transfer_selected_lot_short', 'transfer_stock_changed', 'transfer_too_many_lots'])
// What each refusal answers on the wire (transferRefusal in the same file).
assert.match(worker, /return \{ status: 409, body: \{ error: error\.message, code: error\.code \} \}/)
assert.match(worker, /return \{ status: 503, body: \{ error: TRANSFER_REFUSALS\.transfer_maintenance_active, code: 'maintenance_active' \} \}/)
assert.match(worker, /return \{ status: 409, body: \{ error: TRANSFER_REFUSALS\.transfer_stock_changed, code: 'transfer_stock_changed' \} \}/)
const wire = ({ key, sentence }) => (key === 'transfer_maintenance_active'
  ? { status: 503, body: { error: sentence, code: 'maintenance_active' } }
  : { status: 409, body: { error: sentence, code: key } })
// api/http.ts createApiError: the Error's message is body.error; a mutation's
// 5xx is additionally marked outcome 'unknown' by apiFetch.
const apiError = ({ status, body }) => Object.assign(new Error(body.error), { status, code: body.code }, status >= 500 ? { outcome: 'unknown' } : {})

// 2. Both packs carry each sentence: English exactly, Khmer translated.
for (const { key, sentence } of refusals) {
  assert.equal(en[key], sentence, `en.json ${key} is the exact sentence the Worker sends`)
  assert.ok(typeof km[key] === 'string' && km[key].trim(), `km.json has ${key}`)
  assert.notEqual(km[key], en[key], `km.json ${key} is translated`)
}

const rules = {}
new Function('exports', 'require', compile(read('../src/api/branchRuleErrors.ts')))(rules, () => ({}))
// U-transfer3: Inventory's transferErrorMessage reads a definitive refusal first.
const refusalHelpers = {}
new Function('exports', 'require', compile(read('../src/api/transferRunRefusal.ts')))(refusalHelpers, (id) => (id === './branchRuleErrors.ts' ? rules : {}))
const tKm = (key) => km[key]
const tEn = (key) => en[key]

function extractConst(source, start, end, context) {
  const from = source.indexOf(start)
  assert.ok(from > 0, `missing ${start}`)
  const to = source.indexOf(end, from)
  assert.ok(to > from, `missing the end of ${start}`)
  const name = start.match(/const (\w+)/)[1]
  return new Function(...Object.keys(context), compile(`${source.slice(from, to)}; return ${name}`))(...Object.values(context))
}

// 3. The branch TransferModal: its one write path, runPendingTransfer.
const modal = read('../src/components/branches/TransferModal.tsx')
const getErrorMessageAt = modal.indexOf('function getErrorMessage(')
assert.ok(getErrorMessageAt > 0, 'TransferModal has its own getErrorMessage')
const getErrorMessage = new Function(compile(`${modal.slice(getErrorMessageAt, modal.indexOf('\n}\n', getErrorMessageAt) + 2)}; return getErrorMessage`))()

async function modalRetryError({ refusal, t, savedRun, pending }) {
  let retryError = ''
  let posts = 0
  const runPendingTransfer = extractConst(modal, 'const runPendingTransfer = async', '\n  return createPortal(', {
    canTransferStock: true, retryStorageError: '', savedRun,
    requireTransferReason: () => true, requireCanonicalTransferDirection: () => true,
    beginSingleAction: () => true, finishSingleAction: () => {}, transferBulkInFlightRef: { current: false }, savingBulk: false,
    setSavingBulk: () => {}, fromBranch: '1', toBranch: '2', reason: 'Restock shop', TRANSFER_BULK_CHUNK_SIZE: 100,
    user: { id: 5, name: 'Dara' },
    prepareTransferRun: (actorId, requests) => ({ actorId: String(actorId), next: 0, transferred: 0, merges: 0, requests }),
    saveTransferRun: () => {}, setSavedRun: () => {}, setPendingTransfer: () => {}, setChunkProgress: () => {},
    setRetryError: (value) => { retryError = value },
    // api/branchTransport.ts executeTransferRun rethrows the transport's error unchanged.
    executeTransferRun: async (run, checkpoint, send) => { await send(run.requests[run.next]); return run },
    transferStockBulkRequest: async () => { posts += 1; throw apiError(wire(refusal)) },
    transferStockRequest: async () => { posts += 1; throw apiError(wire(refusal)) },
    aliveRef: { current: true }, transferAuthorityRef: { current: { allowed: true, actorId: '5' } },
    completeTransferDraft: () => { throw new Error('a refused transfer must not complete its draft') },
    draftKey: 'draft', draftFinishedRef: { current: false },
    notify: () => { throw new Error('a refused transfer must not announce success') }, onDone: () => {},
    localizeBranchRuleError: rules.localizeBranchRuleError, getErrorMessage, t,
  })
  await runPendingTransfer(pending)
  assert.equal(posts, 1, 'the request went out once')
  return retryError
}

const oneRow = { scope: 'selected', items: [{ productId: 7, quantity: 5 }] }
const severalRows = { scope: 'selected', items: [{ productId: 7, quantity: 5 }, { productId: 8, quantity: 2, batchId: 81 }] }
const saved = { actorId: '5', next: 0, transferred: 0, merges: 0, requests: [{ bulk: true, body: { fromBranchId: 1, toBranchId: 2, reason: 'Restock shop', items: oneRow.items } }] }

async function main() {
  for (const refusal of refusals) {
    for (const [surface, input] of [
      ['one checked product', { savedRun: null, pending: oneRow }],
      ['several checked products', { savedRun: null, pending: severalRows }],
      ['Retry of a saved run (draft resume)', { savedRun: saved, pending: null }],
    ]) {
      assert.equal(await modalRetryError({ refusal, t: tKm, ...input }), km[refusal.key],
        `TransferModal ${surface}: ${refusal.key} is shown in Khmer`)
      assert.equal(await modalRetryError({ refusal, t: tEn, ...input }), en[refusal.key],
        `TransferModal ${surface}: ${refusal.key} is shown in English`)
    }
  }
  // Where retryError is shown: the amber banner above the form, including the
  // partial-run line that embeds it as {reason}.
  assert.match(modal, /\{savedRun \|\| retryError \|\| retryStorageError \? \(/)
  assert.match(modal, /\.replace\('\{reason\}', retryError\)/)
  for (const pack of [en, km]) assert.match(pack.transfer_bulk_partial, /\{reason\}/, 'transfer_bulk_partial embeds the refusal')

  // Every Branches entry point opens that same TransferModal.
  const branches = read('../src/components/branches/Branches.tsx')
  assert.match(branches, /const LazyTransferModal = lazyRetry\(async \(\) => \(\{ default: \(await import\('\.\/TransferModal'\)\)\.default \}\)/)
  assert.match(branches, /\{modal === 'transfer' \? \(\s*<Suspense fallback=\{null\}>\s*<LazyTransferModal/)
  assert.ok((branches.match(/setModal\('transfer'\)/g) || []).length >= 3, 'toolbar, branch card, transfers view and draft restore open it')
  const hub = read('../src/components/branches/BranchesHubPage.tsx')
  assert.match(hub, /const BranchesSection = lazy\(\(\) => import\('\.\/Branches'\)\)/, 'the Branches hub renders the same Branches section')

  // 4. The Inventory transfer form (POST /inventory/transfer).
  const inventory = read('../src/components/inventory/Inventory.tsx')
  const makeTr = (pack) => (key, fallback) => pack[key] || fallback
  const transferErrorMessageFor = (pack) => extractConst(inventory, 'const transferErrorMessage =', '\n\n  const completeInventoryTransfer', {
    localizeBranchRuleError: rules.localizeBranchRuleError, tr: makeTr(pack),
    localizeTransferRefusal: refusalHelpers.localizeTransferRefusal, transferRefusalFromError: refusalHelpers.transferRefusalFromError,
  })
  for (const refusal of refusals) {
    for (const pack of [km, en]) {
      const transferErrorMessage = transferErrorMessageFor(pack)
      const tr = makeTr(pack)
      let panel = ''
      const common = {
        beginSingleAction: () => true, finishSingleAction: () => {}, transferStockInFlightRef: { current: false },
        transferSaving: false, setTransferSaving: () => {}, setTransferRetryError: (value) => { panel = value },
        transferErrorMessage, tr, completeInventoryTransfer: async () => { throw apiError(wire(refusal)) },
      }
      // Submit: the intent sets the retry panel and rethrows for the notify.
      const run = { actorId: '5', next: 0, transferred: 0, merges: 0, context: { kind: 'submit', productName: 'Tea' }, requests: [{ body: { productId: 7, quantity: 5 } }] }
      const runInventoryTransferIntent = extractConst(inventory, 'const runInventoryTransferIntent = async', '\n\n  const retryInventoryTransfer', {
        ...common, transferAuthorityRef: { current: { allowed: true, actorId: '5' } },
        loadInventoryWriteTransport: async () => ({ loadInventoryTransfer: () => null, prepareInventoryTransfer: () => run, saveInventoryTransfer: () => {} }),
        setPendingTransfer: () => {},
      })
      await assert.rejects(runInventoryTransferIntent('submit', { userId: 5 }, { productName: 'Tea' }), (error) => {
        assert.equal(error.message, pack[refusal.key], `Inventory submit notifies ${refusal.key} from the pack`)
        return true
      })
      assert.equal(panel, pack[refusal.key], `Inventory retry panel shows ${refusal.key} from the pack`)
      // Retry of the saved Inventory transfer.
      panel = ''
      const retryInventoryTransfer = extractConst(inventory, 'const retryInventoryTransfer = async', '\n\n  const handleTransferStock', {
        ...common, pendingTransfer: run, canTransferStock: true,
      })
      await retryInventoryTransfer()
      assert.equal(panel, pack[refusal.key], `Inventory Retry shows ${refusal.key} from the pack`)
    }
  }
  assert.match(inventory, /notify\(error instanceof Error \? error\.message : tr\('stock_transfer_failed', 'Stock transfer failed'\), 'error'\)/,
    'the Inventory submit handler notifies the localized message it was rethrown with')
  assert.match(inventory, /\{transferRetryError \? <p className="mt-1 text-sm text-red-700 dark:text-red-300">\{transferRetryError\}<\/p> : null\}/)

  // 5. Control: an unrelated server error is shown as sent, never swapped for
  //    a transfer sentence.
  const unrelated = { key: 'x', sentence: 'Insufficient stock in source branch' }
  assert.equal(await modalRetryError({ refusal: { ...unrelated }, t: tKm, savedRun: null, pending: oneRow }), unrelated.sentence)

  console.log(`PASS transfer refusals are 409/503 with a code and shown from both packs on TransferModal (one row, several rows, saved-run Retry) and Inventory (submit, Retry): ${refusals.length} refusals`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
