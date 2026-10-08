// R-transfer3 (27 Sep 2026): a transfer answer may unlock the client's
// "Edit transfer" -- which resends the lines under a NEW idempotency key --
// only when it PROVES the saved request was never applied.
//
// The three transfer routes (/branches/transfer, /branches/transfer-bulk,
// /inventory/transfer) look the request's idempotency receipt up part-way
// through. The receipt is written in the same atomic batch as the stock
// movement, so an answer sent AFTER that lookup found nothing proves the key
// was never applied. An answer sent BEFORE it (403 permission, 400 field or
// unreadable body, 409 client_upgrade_required, 503) proves nothing: the key
// may have been applied by an earlier send whose reply was lost. The refuter's
// sequence: apply, lose the reply, revoke permission, Retry -> 403 -> the
// client offered Edit -> permission restored -> Edit resent 5 as a new
// transfer: moved 10.
//
// frontend/src/api/transferRunRefusal.ts's DEFINITIVE_TRANSFER_REFUSAL_CODES
// is that proof. This file pins it to the route sources in both directions:
//   1. no allowlisted code is emitted before a route's receipt lookup;
//   2. every 4xx a route emits after the lookup carries an allowlisted code
//      (or is the idempotency_conflict / replay answer), and every code the
//      planner's transferRefusal can emit on the forward path is allowlisted
//      (maintenance excepted: 503, never a refusal);
// and runs the real routes against the real client classifier:
//   3. post-receipt refusals on all three routes classify as definitive;
//   4. the refuter's sequence: after an applied send, a permission-revoked
//      Retry answers 403, which the client classifies as UNKNOWN (no Edit),
//      and the Retry after the permission returns replays -- moved stays 5.
//
// Mutant check (not part of the gate): add 'transfer_permission_denied' or
// drop the status check in transferRunRefusal.ts, or move a coded refusal
// above findTransferReceipt in a route, and this file goes red.
//
// Run: node scripts/test-transfer-refusal-after-receipt-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const h = require('./test-transfer-operation-receipt-pure.cjs')

const repo = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8').replace(/\r\n/g, '\n')

// The client's classifier, loaded for real.
function loadFrontend(relative, resolve) {
  const module = { exports: {} }
  const code = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'require', 'module', code)(module.exports, (id) => {
    const found = resolve(id)
    if (!found) throw new Error(`Unexpected dependency ${id}`)
    return found
  }, module)
  return module.exports
}
const rules = loadFrontend('frontend/src/api/branchRuleErrors.ts', () => null)
const client = loadFrontend('frontend/src/api/transferRunRefusal.ts', (id) => (id === './branchRuleErrors.ts' ? rules : null))
const ALLOW = client.DEFINITIVE_TRANSFER_REFUSAL_CODES
// What http.ts's createApiError turns a JSON answer into.
const asClientError = (response) => Object.assign(new Error(response.body.error || `HTTP ${response.status}`), { status: response.status, code: response.body.code || null })

let checks = 0
const pass = (name) => { checks += 1; console.log(`PASS ${name}`) }

// ---------------------------------------------------------------------------
// 1 + 2: the route sources.
const canonicalCode = /export const CANONICAL_BRANCH_CONFIGURATION_CODE = '([a-z_]+)'/.exec(read('cloudflare/src/lib/canonicalBranchIdentity.ts'))[1]
function handler(file, route) {
  const source = read(file)
  const start = source.indexOf(`app.post('${route}', async (c) => {`)
  assert.ok(start >= 0, `${file} has ${route}`)
  const end = source.indexOf('\napp.', start + 1)
  return source.slice(start, end < 0 ? undefined : end)
}
function codesIn(text) {
  return [...text.matchAll(/code: (?:'([a-z_]+)'|(CANONICAL_BRANCH_CONFIGURATION_CODE))/g)].map((m) => m[1] || canonicalCode)
}
const HANDLERS = [
  ['cloudflare/src/routes/branches.ts', '/transfer'],
  ['cloudflare/src/routes/branches.ts', '/transfer-bulk'],
  ['cloudflare/src/routes/inventory.ts', '/transfer'],
]
for (const [file, route] of HANDLERS) {
  const text = handler(file, route)
  const lookup = text.indexOf('findTransferReceipt(')
  assert.ok(lookup > 0, `${file} ${route} looks its receipt up`)
  const before = text.slice(0, lookup)
  const after = text.slice(lookup)
  const early = codesIn(before).filter((code) => ALLOW.has(code))
  assert.deepEqual(early, [], `${file} ${route}: no allowlisted code is answered before the receipt lookup`)
  assert.ok(/, 403\)/.test(before), `${file} ${route}: the permission 403 is (still) answered before the lookup -- the case the allowlist exists for`)
  // Every 4xx answer after the lookup.
  const answers = [...after.matchAll(/c\.json\(\{([\s\S]*?)\},\s*(4\d\d)\)/g)]
  assert.ok(answers.length >= 3, `${file} ${route}: found its post-receipt refusals`)
  for (const [, body, status] of answers) {
    if (/code: stockGuard\.code/.test(body)) {
      assert.equal(Number(status), 409, 'the shared product stock boundary is a typed conflict')
      assert.match(after, /productStockGuardError\(error\)/, 'the dynamic code comes only from the real shared mapper')
      assert.equal(client.transferRefusalFromError({ status:409,code:'product_has_stock',message:'x' }), null, 'new general stock conflicts remain conservative until explicitly included in the transfer receipt contract')
      continue
    }
    const codes = codesIn(`{${body}}`)
    if (codes.includes('idempotency_conflict')) continue
    assert.equal(codes.length, 1, `${file} ${route}: post-receipt ${status} has exactly one code: {${body.trim().slice(0, 120)}}`)
    assert.ok(ALLOW.has(codes[0]), `${file} ${route}: post-receipt code ${codes[0]} is on the client allowlist`)
    assert.ok(client.transferRefusalFromError({ status: Number(status), code: codes[0], message: 'x' }), `${codes[0]} with ${status} classifies as definitive`)
  }
  // The planner's refusals come back through transferRefusal(), after a second receipt lookup in the catch.
  assert.match(after, /const retryReceipt = await findTransferReceipt\([\s\S]{0,600}const refusal = transferRefusal\(error\)/, `${file} ${route}: transferRefusal answers only after the catch re-checks the receipt`)
}
pass('no allowlisted refusal code is answered before any route\'s receipt lookup, and every post-receipt 4xx carries one')

const operation = read('cloudflare/src/lib/transferOperation.ts')
const refusalCodes = [...operation.slice(operation.indexOf('export const TRANSFER_REFUSALS = {'), operation.indexOf('} as const')).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1])
assert.ok(refusalCodes.includes('transfer_stock_changed'))
for (const code of refusalCodes.filter((code) => code !== 'transfer_maintenance_active')) assert.ok(ALLOW.has(code), `planner refusal ${code} is allowlisted`)
const planner = operation.slice(operation.indexOf('export async function planTransferOperation'), operation.indexOf('export type TransferRefusal ='))
assert.ok(planner.length > 100, 'found planTransferOperation')
assert.doesNotMatch(planner, /new TransferConflictError\(/, 'the forward planner refuses only through refuse(code), never an uncoded conflict')
assert.ok(!ALLOW.has('maintenance_active') && !ALLOW.has('request_body_unreadable') && !ALLOW.has('client_upgrade_required') && !ALLOW.has('idempotency_conflict'))
const bodyGuard = read('cloudflare/src/lib/requestBodyGuard.ts')
assert.match(bodyGuard, /code: 'request_body_unreadable' \}, 400\)/, 'the body guard still answers 400 request_body_unreadable (a pre-receipt 400)')
pass('every forward planner refusal is allowlisted; maintenance, unreadable body, upgrade and idempotency answers are not')

// ---------------------------------------------------------------------------
// 3 + 4: the real routes.
const ROUTES = [['branches', '/transfer'], ['branches', '/transfer-bulk'], ['inventory', '/transfer']]
const S = 2
const D = 1
function body(route, key, line) {
  const common = { transfer_provenance_version: 1, fromBranchId: S, toBranchId: D, reason: 'Restock', client_request_id: key }
  return route === '/transfer-bulk' ? { ...common, items: [line] } : { ...common, ...line }
}
const branchQty = (product, branch) => h.getDb().prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?').get(product, branch)?.quantity ?? 0
const operator = () => ({ id: 7, name: 'Operator', permissions: JSON.stringify({ branches: true, inventory: true }) })
const revoked = () => ({ id: 7, name: 'Operator', permissions: JSON.stringify({ branches: false, inventory: false }) })

async function main() {
  for (const [app, route] of ROUTES) {
    const name = `${app}${route}`
    h.fresh(1, S)
    const tag = name.replace(/\W/g, '_')
    // Post-receipt refusals: definitive to the client.
    const short = await h.request(app, route, body(route, `short${tag}`, { productId: 1, quantity: 50 }))
    assert.equal(short.status, 400, `${name} short: ${JSON.stringify(short.body)}`)
    assert.equal(short.body.code, 'transfer_insufficient_stock', `${name} short`)
    assert.ok(client.transferRefusalFromError(asClientError(short)), `${name}: insufficient stock is a definitive refusal`)
    const missing = await h.request(app, route, body(route, `missing${tag}`, { productId: 999, quantity: 1 }))
    assert.equal(missing.status, 404, `${name} missing: ${JSON.stringify(missing.body)}`)
    assert.equal(missing.body.code, 'transfer_product_missing')
    assert.ok(client.transferRefusalFromError(asClientError(missing)), `${name}: a missing product is a definitive refusal`)
    const wrongWay = await h.request(app, route, { ...body(route, `direction${tag}`, { productId: 1, quantity: 1 }), toBranchId: 3 })
    assert.equal(wrongWay.status, 400, `${name} direction: ${JSON.stringify(wrongWay.body)}`)
    assert.equal(wrongWay.body.code, 'transfer_direction_invalid')
    assert.ok(client.transferRefusalFromError(asClientError(wrongWay)))
    assert.equal(branchQty(1, S), 10, `${name}: no refusal moved stock`)

    // The refuter's sequence, on the real route.
    const request = body(route, `applied${tag}`, { productId: 1, quantity: 5 })
    const first = await h.request(app, route, request)
    assert.equal(first.status, 200, `${name} first: ${JSON.stringify(first.body)}`)
    assert.equal(branchQty(1, D), 5)
    // ...its reply is lost; the operator's permission is revoked; Retry:
    h.setUser(revoked())
    const denied = await h.request(app, route, request)
    assert.equal(denied.status, 403, `${name}: the Retry is refused before the receipt lookup`)
    assert.equal(client.transferRefusalFromError(asClientError(denied)), null, `${name}: that 403 is an UNKNOWN result -- no Edit, no resend under a new key`)
    // Permission back; the only offered action is Retry under the SAME key.
    h.setUser(operator())
    const replay = await h.request(app, route, request)
    assert.equal(replay.status, 200, JSON.stringify(replay.body))
    assert.equal(replay.body.replayed, true)
    assert.equal(branchQty(1, D), 5, `${name}: moved stays 5`)
    assert.equal(branchQty(1, S), 5)
    pass(`${name}: post-receipt refusals are definitive (coded); a permission-revoked Retry of an applied key is unknown, and its later Retry replays (moved 5, not 10)`)
  }
  assert.equal(checks, 5)
  console.log(`${checks} transfer refusal-after-receipt checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
