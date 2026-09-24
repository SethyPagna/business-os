const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const sourcePath = path.join(root, 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const req = (name) => name.startsWith('.')
    ? load(path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts')
    : require(name)
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const { planSaleSettlement, renameSalePaymentMethod, SettlementValidationError } = load('lib/paymentSettlement.ts')

// Execute the actual receipt route callbacks and canonicalizers against an
// actor-scoped receipt store. No HTTP/auth or SQL mutation is substituted here.
async function verifyReceiptRoutes() {
  const routeText = fs.readFileSync(path.join(root, 'src/routes/sales.ts'), 'utf8')
  const ast = ts.createSourceFile('sales.ts', routeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const helperNames = new Set(['normalizeClientRequestId', 'saleMutationDigest', 'saleStatusReceiptCanonical', 'saleLineReceiptCanonical'])
  const routePaths = new Set(['/:id/status-receipt', '/:id/line-receipt/:kind'])
  const extracted = ast.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return helperNames.has(statement.name?.text)
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false
    const call = statement.expression
    return ts.isPropertyAccessExpression(call.expression) && call.expression.expression.getText(ast) === 'app'
      && call.expression.name.text === 'post' && ts.isStringLiteral(call.arguments[0]) && routePaths.has(call.arguments[0].text)
  }).map(statement => statement.getText(ast)).join('\n')
  const output = ts.transpileModule(extracted, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const handlers = new Map(), receipts = new Map(), exported = {}
  let reads = 0
  const db = { prepare(sql) {
    assert.match(sql, /^SELECT /, 'receipt lookup must never write data')
    return { async get(params) {
      reads++
      const actor = params.actor ?? Number(params.source.match(/^actor:(\d+):/)[1])
      const request = params.request ?? params.source.split(':request:')[1]
      const kind = params.kind ?? (sql.includes('sale_record_events') ? 'status' : 'settlement')
      return receipts.get(`${actor}:${kind}:${request}`) ?? null
    } }
  } }
  const { getActionTier } = load('lib/permissions.ts')
  const { getExpectedUpdatedAt } = load('lib/conflictControl.ts')
  const { normalizeCancelReason } = load('lib/saleTransitions.ts')
  const { round2 } = load('lib/saleTotals.ts')
  new Function('exports', 'app', 'getDb', 'getActionTier', 'getExpectedUpdatedAt', 'normalizeCancelReason', 'round2', output)(exported, { post: (name, fn) => handlers.set(name, fn) }, () => db, getActionTier, getExpectedUpdatedAt, normalizeCancelReason, round2)
  const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))).toString('hex')
  const actor = { id: 7, username: 'cashier', role_code: 'employee', permissions: { sales: true } }
  const request = { client_request_id: 'screenshot-20260910-171258', sale_status: 'completed', payment_details: [{ method: 'ABA', amount_usd: 7, amount_khr: 0 }], expected_exchange_rate: 4100 }
  const invoke = async (body = request, user = actor, kind = null, id = 171258) => {
    const headers = {}
    const result = await handlers.get(kind ? '/:id/line-receipt/:kind' : '/:id/status-receipt')({
      env: {}, get: () => ({ ...user, permissions: JSON.stringify(user.permissions) }), req: { json: async () => body, param: name => name === 'id' ? String(id) : kind },
      header: (name, value) => { headers[name] = value }, json: (body, status = 200) => ({ body, status }),
    })
    return { ...result, headers }
  }
  assert.deepEqual((await invoke()).body, { committed: false }, 'uncommitted/lost response stays unknown')
  const snapshot = { id: 171258, sale_status: 'completed', updated_at: '2026-09-10 10:13:00', actionHistoryId: 77 }
  receipts.set(`7:settlement:${request.client_request_id}`, { request_digest: await digest(exported.saleStatusReceiptCanonical(171258, request)), response_json: JSON.stringify(snapshot) })
  assert.deepEqual((await invoke()).body, { committed: true, response: snapshot }, 'committed ABA $7 lost response resolves by receipt')
  assert.equal((await invoke()).headers['Cache-Control'], 'no-store')
  assert.deepEqual((await invoke(request, { ...actor, id: 8 })).body, { committed: false }, 'another actor with identical sale fields cannot claim the receipt')
  assert.equal((await invoke({ ...request, payment_details: [{ method: 'ABA', amount_usd: 8, amount_khr: 0 }] })).status, 409)
  assert.equal((await invoke(request, actor, null, 999)).status, 409, 'same request on a different sale conflicts')
  const beforeDenied = reads
  assert.equal((await invoke(request, { ...actor, permissions: { sales: true, 'sales:status': false } })).status, 403)
  assert.equal(reads, beforeDenied, 'revocation is enforced before receipt access')
  const statusRequest = { client_request_id: 'plain-status', sale_status: 'awaiting_payment', expected_updated_at: snapshot.updated_at, notes: 'Correction' }
  receipts.set('7:status:plain-status', { request_digest: await digest(exported.saleStatusReceiptCanonical(171258, statusRequest)), response_json: JSON.stringify(snapshot) })
  assert.equal((await invoke(statusRequest)).body.committed, true)
  assert.equal((await invoke({ ...statusRequest, notes: 'Different operation' })).status, 409)
  for (const kind of ['add_items', 'amendment']) {
    const line = {
      client_request_id: kind, kind: 'line_updated', sale_item_id: 4, quantity: 2,
      applied_price_usd: 27, ...(kind === 'amendment' ? {
        base_price_usd: 30, manual_discount_type: 'fixed', manual_discount_value: 3, manual_discount_usd: 3,
      } : {}),
      items: [{ product_id: 4, quantity: 2 }], expected_exchange_rate: 4100,
    }
    receipts.set(`7:${kind}:${kind}`, { request_digest: await digest(exported.saleLineReceiptCanonical(171258, kind, line)), response_json: JSON.stringify(snapshot) })
    assert.equal((await invoke(line, actor, kind)).body.committed, true)
    assert.equal((await invoke({ ...line, expected_exchange_rate: 4200 }, actor, kind)).status, 409)
    if (kind === 'amendment') {
      assert.equal((await invoke({ ...line, manual_discount_type: null }, actor, kind)).status, 409, 'omitted and explicit-null discount intent cannot share one receipt identity')
    }
    const action = kind === 'add_items' ? 'add_items' : 'amend'
    assert.equal((await invoke(line, { ...actor, permissions: { sales: true, [`sales:${action}`]: false } }, kind)).status, 403)
  }
  console.log('PASS actual receipt routes: screenshot ABA $7, committed/uncommitted lost response, actor isolation, same-ID conflict, revocation and line receipt parity')
}
verifyReceiptRoutes().catch(error => { console.error(error); process.exitCode = 1 })

const plan = planSaleSettlement({
  configuredMethodsRaw: '["Cash","ABA Bank"]',
  paymentDetailsRaw: [
    { method: ' cash ', amount_usd: '1.2346', amount_khr: 0 },
    { method: 'CASH', amount_usd: '1.00', amount_khr: 0 },
    { method: 'aba bank', amount_usd: 0, amount_khr: 12600 },
  ],
  existingPaidUsd: 1.2346,
  existingPaidKhr: 0,
  existingPaymentDetailsRaw: '[{"method":"Cash","amount_usd":1.2346,"amount_khr":0}]',
  existingPaymentMethodRaw: 'Cash',
  totalUsd: 5,
  exchangeRate: 4200,
  changeExchangeRateRaw: 4000,
})
assert.deepEqual(plan.paymentDetails, [
  { method: 'Cash', amount_usd: 1.2346, amount_khr: 0 },
  { method: 'Cash', amount_usd: 1, amount_khr: 0 },
  { method: 'ABA Bank', amount_usd: 0, amount_khr: 12600 },
])
assert.equal(plan.amountPaidUsd, 2.2346)
assert.equal(plan.amountPaidKhr, 12600)
assert.equal(plan.paymentMethod, 'Cash + ABA Bank')
assert.equal(plan.paymentCurrency, 'MIXED')
assert.equal(plan.changeUsd, 0.23)
assert.equal(plan.changeKhr, 938)
console.log('PASS canonical configured methods, repeated rows, native 4dp USD + whole KHR and derived totals')

const legacyKhr = planSaleSettlement({
  configuredMethodsRaw: '["Cash"]',
  paymentDetailsRaw: [
    { method: 'Legacy KHR', amount_usd: 0, amount_khr: 4100.1234 },
    { method: 'cash', amount_usd: 0, amount_khr: 4200 },
  ],
  existingPaidUsd: 0,
  existingPaidKhr: 4100.1234,
  existingPaymentDetailsRaw: '[{"method":"Legacy KHR","amount_usd":0,"amount_khr":4100.1234}]',
  existingPaymentMethodRaw: 'Legacy KHR',
  totalUsd: 1,
  exchangeRate: 4200,
})
assert.equal(legacyKhr.paymentDetails[0].amount_khr, 4100.1234)
assert.equal(legacyKhr.amountPaidKhr, 8300.1234)
assert.equal(legacyKhr.paymentMethod, 'Legacy KHR + Cash')
console.log('PASS recorded legacy 4dp KHR remains exact while a new whole-riel tender is appended')

for (const [label, patch, code] of [
  ['malformed config', { configuredMethodsRaw: '{' }, 'invalid_payment_methods_setting'],
  ['unknown method', { paymentDetailsRaw: [{ method: 'Wing', amount_usd: 6 }] }, 'inactive_payment_method'],
  ['negative amount', { paymentDetailsRaw: [{ method: 'Cash', amount_usd: -1 }] }, 'invalid_payment_amount'],
  ['fractional cent', { paymentDetailsRaw: [{ method: 'Cash', amount_usd: 0.005 }, { method: 'ABA Bank', amount_khr: 21000 }] }, 'invalid_payment_amount'],
  ['hidden fifth-decimal cent', { existingPaidUsd: 0, existingPaymentDetailsRaw: null, paymentDetailsRaw: [{ method: 'Cash', amount_usd: '1.00001' }, { method: 'ABA Bank', amount_khr: 16800 }] }, 'invalid_payment_amount'],
  ['tiny negative KHR', { existingPaidUsd: 0, existingPaymentDetailsRaw: null, paymentDetailsRaw: [{ method: 'Cash', amount_usd: 5, amount_khr: '-0.000000000001' }] }, 'invalid_payment_amount'],
  ['forged fifth decimal on recorded row', { paymentDetailsRaw: [{ method: 'Cash', amount_usd: '1.234599999', amount_khr: 0 }, { method: 'Cash', amount_usd: 1 }, { method: 'ABA Bank', amount_khr: 12600 }] }, 'invalid_payment_amount'],
  ['fractional new riel', { paymentDetailsRaw: [{ method: 'Cash', amount_usd: 1.2346 }, { method: 'ABA Bank', amount_khr: 12600.5 }] }, 'invalid_payment_amount'],
  ['partial reduction', { existingPaidUsd: 3, existingPaymentDetailsRaw: '[{"method":"Cash","amount_usd":3,"amount_khr":0}]', paymentDetailsRaw: [{ method: 'Cash', amount_usd: 2 }, { method: 'ABA Bank', amount_khr: 12600 }] }, 'partial_payment_reduced'],
  ['underpayment', { totalUsd: 99 }, 'insufficient_payment'],
  ['too many rows', { paymentDetailsRaw: Array.from({ length: 13 }, () => ({ method: 'Cash', amount_usd: 1 })) }, 'payment_details_limit'],
]) {
  assert.throws(() => planSaleSettlement({
    configuredMethodsRaw: '["Cash","ABA Bank"]',
    paymentDetailsRaw: [{ method: 'Cash', amount_usd: 1.2346 }, { method: 'Cash', amount_usd: 1 }, { method: 'ABA Bank', amount_khr: 12600 }],
    existingPaidUsd: 1.2346,
    existingPaymentDetailsRaw: '[{"method":"Cash","amount_usd":1.2346,"amount_khr":0}]',
    existingPaymentMethodRaw: 'Cash',
    existingPaidKhr: 0,
    totalUsd: 5,
    exchangeRate: 4200,
    ...patch,
  }), (error) => error instanceof SettlementValidationError && error.code === code, label)
}
console.log('PASS invalid config/method/amount, partial reduction, underpayment and bounds reject before writes')

// Settlement uses the one definition of paid: covered to within half a US cent
// (PAID_STATUS_SHORTFALL_TOLERANCE_UNITS), in exact integer units. At a very
// large rate half a cent is 100,000 riel, so the edge is exact: 19,900,000
// riel for $1 is short by exactly $0.005 and settles; one riel less is past
// the band and is refused. (Before the single definition this case asserted
// that 19,999,999 riel -- $0.00000005 short -- was refused, the exact rule
// that let the POS record a tender Completed which settlement then refused.)
const bigRate = { configuredMethodsRaw: '["Cash"]', existingPaidUsd: 0, existingPaidKhr: 0, totalUsd: 1, exchangeRate: 20_000_000 }
assert.equal(planSaleSettlement({ ...bigRate, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 19_900_000 }] }).amountPaidKhr, 19_900_000)
assert.throws(() => planSaleSettlement({ ...bigRate, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 19_899_999 }] }),
  (error) => error instanceof SettlementValidationError && error.code === 'insufficient_payment')
console.log('PASS exact rational coverage: half a cent short settles, one riel past the band is refused at a very large exchange rate')

// The owner's tender: 39,400 riel for a $9.61 sale at 4,100 is one riel short
// of 39,401. The POS records it Completed, so settling a Not Paid sale with the
// same tender must succeed too (it answered insufficient_payment before).
const ownerSettle = { configuredMethodsRaw: '["Cash"]', existingPaidUsd: 0, existingPaidKhr: 0, totalUsd: 9.61, exchangeRate: 4100, moneyPrecisionVersion: 1 }
for (const version of [1, 0]) {
  const settled = planSaleSettlement({ ...ownerSettle, moneyPrecisionVersion: version, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 39400 }] })
  assert.equal(settled.amountPaidKhr, 39400, `owner tender settles (v${version})`)
  assert.equal(settled.changeUsd, 0, 'a tender inside the band gives no change')
  assert.equal(settled.changeKhr, 0, 'a tender inside the band gives no change')
}
// Exact payment settles.
assert.equal(planSaleSettlement({ ...ownerSettle, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 39401 }] }).amountPaidKhr, 39401)
// 50 units ($0.0050) short on $10 at 4,100 is 20.5 riel: 40,980 riel is 20
// riel short (inside) and settles; 40,979 riel is 21 riel ($0.00512) short and
// is refused.
const tenAt4100 = { ...ownerSettle, totalUsd: 10 }
assert.equal(planSaleSettlement({ ...tenAt4100, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 40980 }] }).amountPaidKhr, 40980)
assert.throws(() => planSaleSettlement({ ...tenAt4100, paymentDetailsRaw: [{ method: 'Cash', amount_khr: 40979 }] }),
  (error) => error instanceof SettlementValidationError && error.code === 'insufficient_payment')
console.log('PASS settlement accepts the owner tender and the band edge, refuses one step past it')

const renamed = renameSalePaymentMethod(
  'Cash + Fcb',
  JSON.stringify([
    { method: 'Cash', amount_usd: 2, amount_khr: 0 },
    { method: 'Fcb', amount_usd: 1, amount_khr: 0 },
    { method: 'fcb', amount_usd: 0, amount_khr: 4000 },
  ]),
  'fcb',
  'FCB',
)
assert.equal(renamed.ok, true)
assert.equal(renamed.paymentMethod, 'Cash + FCB')
assert.deepEqual(JSON.parse(renamed.paymentDetails), [
  { method: 'Cash', amount_usd: 2, amount_khr: 0 },
  { method: 'FCB', amount_usd: 1, amount_khr: 0 },
  { method: 'FCB', amount_usd: 0, amount_khr: 4000 },
])
assert.equal(renameSalePaymentMethod('Cash + Fcb', '{{{', 'Fcb', 'FCB').ok, false)
assert.equal(renameSalePaymentMethod('Cash + Fcb', '[{"method":"Fcb","amount_usd":1},7]', 'Fcb', 'FCB').ok, false)
assert.equal(renameSalePaymentMethod('Cash + Fcb', '[{"method":"Fcb","amount_usd":1},{"amount_usd":2}]', 'Fcb', 'FCB').ok, false)
console.log('PASS case-only rename rebuilds split summary, preserves repeated tender rows/amounts, blocks malformed detail JSON')
