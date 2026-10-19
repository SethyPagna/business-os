// Audit-trail coverage across route files (I1).
//
// The measured gap: audit(...) was called in 22 of 30 route files. Sweeping
// the other 8 found two different situations, and this test pins BOTH so the
// distinction survives future edits:
//
//   1. Four files carried real, unaudited mutations -- backups (create +
//      restore, the single most consequential action in the app), files
//      (upload / rename / force-delete), notes (create / delete), sync
//      (chunked offline upload -> file_assets via a Durable Object that has
//      no session context, so the route audits it).
//   2. Four files are read-only by design -- catalog, organizations, runtime,
//      notifications. Their lack of audit calls is legitimate, but only for
//      as long as they stay read-only; the file-level rule below turns into a
//      real failure the moment someone adds a mutation handler without one.
//
// Two DELIBERATE non-audits are pinned as hard as the audits themselves:
//   - sync's /outbox replays each queued operation through the real route
//     handler (same cookie, same user), so the target route audits it --
//     auditing the outbox too would double-log every offline mutation.
//   - notes' autosave PUT fires per debounced keystroke; auditing it would
//     write hundreds of rows per editing session, and note content is
//     private to the user while audit_logs is admin-readable.
//
// Run: node scripts/test-audit-coverage-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routesDir = path.join(__dirname, '..', 'src', 'routes')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))
// Floor was 30 until 0efd04bc deliberately DELETED routes/catalog.ts (the
// dead, ungated storefront endpoint) -- 29 is the real count since. The
// floor exists to catch "dir moved / enumeration silently empty", so it
// follows deliberate deletions down rather than pinning a stale census.
ok(files.length >= 29, `route directory enumerates (${files.length} files)`)

// Mutation-handler detection. Matches app.post( / app.patch( / app.put( /
// app.delete( registrations, not R2/KV method names like ASSETS.put(...) --
// those are always called on an UPPER_CASE binding or c.env, never on `app`.
const MUTATION_RE = /\bapp\.(post|patch|put|delete)\(/

const withMutations = []
const readOnly = []
for (const file of files) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8')
  if (MUTATION_RE.test(src)) withMutations.push({ file, src })
  else readOnly.push(file)
}

// Rule 1 -- the general law: every route file that registers a mutation
// handler must contain at least one audit( call. Shifts is the one stronger
// contract: its mutation and guarded audit INSERT share the same D1 batch, so
// it is checked path-by-path below instead of being weakened to an async call.
// POS has the same stronger same-batch contract for its sole mutation and is
// likewise checked by an exact route-specific contract below.
for (const { file, src } of withMutations) {
  if (file === 'shifts.ts' || file === 'pos.ts' || file === 'promotions.ts' || file === 'productCost.ts' || file === 'inventoryChecks.ts') continue
  ok(src.includes('audit('), `${file} registers mutations and calls audit(`)
}

const inventoryChecks = fs.readFileSync(path.join(routesDir, 'inventoryChecks.ts'), 'utf8')
assert.deepEqual([...inventoryChecks.matchAll(/\bapp\.(post|patch|put|delete)\('([^']+)'/g)].map(match => [match[1], match[2]]), [
  ['post', '/sessions'], ['patch', '/sessions/:id/items/:productId'], ['patch', '/sessions/:id'],
])
for (const writer of ['createInventoryCheckSession', 'patchInventoryCheckObservation', 'patchInventoryCheckSession']) {
  ok(inventoryChecks.includes(`await ${writer}(getDb(c.env), await principal(c),`), `Inventory mutation delegates to authenticated ${writer}`)
}
const inventoryWriter = fs.readFileSync(path.join(routesDir, '../lib/inventoryCheckSessions.ts'), 'utf8')
for (const writer of ['createInventoryCheckSession', 'patchInventoryCheckObservation', 'patchInventoryCheckSession']) {
  const body = inventoryWriter.split(`export async function ${writer}(`)[1]?.split('export async function ')[0] || ''
  ok(body.includes('eventStatement(actor, {') && body.includes('await commit(db, principal, actor,'), `${writer} commits its own immutable event with its mutation`)
}
ok(/INSERT INTO inventory_check_events\(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at\)/.test(inventoryWriter),
  'Inventory audit stores actor, request identity, before/after and result in its dedicated event ledger')
ok((inventoryWriter.match(/eventStatement\(actor, \{/g) || []).length === 3 && (inventoryWriter.match(/await commit\(db, principal, actor,/g) || []).length === 3,
  'all three Inventory mutation writers include their event in the atomic commit')
ok(inventoryWriter.includes('await db.batchOnce([authorityGuard(actor), ...statements])'), 'Inventory event and mutation share the authority-guarded transaction')
const inventoryMigration = fs.readFileSync(path.join(routesDir, '../../migrations/0259_inventory_check_sessions.sql'), 'utf8')
ok(/UNIQUE\(actor_id,request_id\)/.test(inventoryMigration) && /inventory_check_events_no_update BEFORE UPDATE/.test(inventoryMigration)
  && /inventory_check_events_no_delete BEFORE DELETE/.test(inventoryMigration), 'Inventory audit is request-unique and immutable')
ok(fs.existsSync(path.join(__dirname, 'test-inventory-check-sessions.cjs')), 'authenticated Inventory rollback, replay, history and permission runtime coverage remains present')

const productCost = fs.readFileSync(path.join(routesDir, 'productCost.ts'), 'utf8')
assert.deepEqual([...productCost.matchAll(/\bapp\.(post|patch|put|delete)\('([^']+)'/g)].map(match => [match[1], match[2]]), [
  ['post', '/:id/cost-review/confirm'], ['post', '/receiving-cost-preview'],
])
const confirmRoute = productCost.slice(productCost.indexOf("app.post('/:id/cost-review/confirm'"), productCost.indexOf("app.post('/receiving-cost-preview'"))
ok(confirmRoute.includes('db.batchOnce(costReviewConfirmationStatements(state,'), 'cost confirmation submits its guarded audit and update together')
const confirmationHelper = fs.readFileSync(path.join(routesDir, '../lib/productCostReview.ts'), 'utf8')
  .split('export function costReviewConfirmationStatements(')[1].split('export function mergeCostOutcome(')[0]
ok(/INSERT INTO audit_logs[\s\S]*WHERE NOT EXISTS\(\$\{prior\}\)/.test(confirmationHelper), 'cost confirmation has an immutable request-bound audit')
ok(/UPDATE products SET cost_review_key=NULL[\s\S]*EXISTS\(SELECT 1 FROM audit_logs[\s\S]*=@nonce/.test(confirmationHelper), 'cost confirmation marker update requires its own audit nonce')
const receivingPreview = productCost.slice(productCost.indexOf("app.post('/receiving-cost-preview'"), productCost.indexOf("app.get('/:id/cost-breakdown'"))
ok(receivingPreview.includes('previewReceivingCosts(getDb(c.env), lines)') && !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|\.batch(?:Once)?\(|\.run\(/.test(receivingPreview), 'receiving preview remains a read-only POST')

// POS currently has exactly one mutation: the address-presets CAS. Its
// guarded settings write and audit INSERT share one D1 batch, and the audit
// SELECT is conditioned on the newly generated revision. Counting mutation
// registrations keeps this a narrow recognition of that route: adding any
// second POS mutation fails until its audit behavior is explicitly covered.
const pos = fs.readFileSync(path.join(routesDir, 'pos.ts'), 'utf8')
const posMutations = [...pos.matchAll(/\bapp\.(post|patch|put|delete)\(/g)]
ok(posMutations.length === 1 && posMutations[0][1] === 'put',
  'pos.ts has only the explicitly covered address-presets mutation')
const posAddressRoute = pos.slice(pos.indexOf("app.put('/address-presets'"), pos.indexOf('export default app'))
ok(/db\.batch\(\[[\s\S]*INSERT INTO settings[\s\S]*INSERT INTO audit_logs/.test(posAddressRoute),
  'pos.ts commits the address-presets CAS and audit in one batch')
ok(/INSERT INTO audit_logs[\s\S]*WHERE EXISTS\(SELECT 1 FROM settings WHERE key=@key AND json_extract\(value,'\$\.revision'\)=@revision\)/.test(posAddressRoute),
  'pos.ts audit is guarded by the winning address-presets revision')
ok(/if \(changes !== 1\)[\s\S]*code: 'write_conflict'/.test(posAddressRoute),
  'pos.ts reports a losing address-presets CAS as a write conflict')

// Shifts deliberately does not call the generic async audit helper. Every
// lifecycle write and its `WHERE changes()=1` audit INSERT must commit or roll
// back together. These checks name every registered mutation route so adding
// a generic exemption cannot silently leave a new shift write unaudited. The
// executable route rollback/concurrency assertions remain in the focused
// shift suites; this file pins the cross-route coverage census.
const shifts = fs.readFileSync(path.join(routesDir, 'shifts.ts'), 'utf8')
const section = (start, end) => {
  const from = shifts.indexOf(start)
  const to = end ? shifts.indexOf(end, from + start.length) : shifts.length
  return from >= 0 && to > from ? shifts.slice(from, to) : ''
}
const continuationWriter = section('async function writeContinuation', 'function currentResponse')
const openRoute = section("app.post('/open'", 'async function writeClose')
const closeWriter = section('async function writeClose', "app.post('/close'")
const currentCloseRoute = section("app.post('/close'", "app.post('/:id/close'")
const historicCloseRoute = section("app.post('/:id/close'", "app.post('/:id/cancel'")
const cancelRoute = section("app.post('/:id/cancel'", "app.post('/:id/reopen'")
const reopenRoute = section("app.post('/:id/reopen'", "app.patch('/:id'")
const amendRoute = section("app.patch('/:id'", 'export default app')

ok(/INSERT INTO audit_logs[\s\S]*WHERE changes\(\)=1/.test(section('function transitionAuditSql', 'function openAuditSql')),
  'shifts.ts transition audit is guarded by the winning mutation')
ok(/db\.batch\(\[[\s\S]*continuationAuditSql\(\)/.test(continuationWriter),
  'shifts.ts continuation/reopen writes audit in the same batch')
ok(/writeContinuation\([\s\S]*auditAction: 'shift\.open_after_cancel'/.test(openRoute)
  && /db\.batch\(\[[\s\S]*openAuditSql\(\)/.test(openRoute),
  'shifts.ts opening paths use same-batch root and continuation audits')
// N4: both close routes go through closeWithFigures, whose every path is
// writeClose (the figures retry recomputes; it never writes on its own).
const closeWithFiguresWriter = section('async function closeWithFigures', "app.post('/close'")
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(closeWriter)
  && currentCloseRoute.includes('closeWithFigures(c.env, db') && historicCloseRoute.includes('closeWithFigures(c.env, db')
  && /return await writeClose\(db, /.test(closeWithFiguresWriter) && /return writeClose\(db, /.test(closeWithFiguresWriter)
  && !/db\.(batch|prepare)\(/.test(closeWithFiguresWriter),
  'shifts.ts current and historic close share the atomic audited writer')
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(cancelRoute),
  'shifts.ts cancellation writes audit in the same batch')
ok(/writeContinuation\([\s\S]*auditAction: 'shift\.reopen'/.test(reopenRoute),
  'shifts.ts reopen uses the atomic audited continuation writer')
ok(/db\.batch\(\[[\s\S]*transitionAuditSql\(\)/.test(amendRoute),
  'shifts.ts amendment writes audit in the same batch')

// Promotions (N13) is the third stronger-contract file: every one of its seven
// writes carries a client_request_id and commits its audit row -- which IS the
// idempotency receipt -- in the same db.batch as the write, through
// lib/auditWriteReceipt.ts (guarded by `WHERE changes() = 1`). Checked per route
// so a new, un-receipted promotions write cannot slip in under a generic exemption.
const promotions = fs.readFileSync(path.join(routesDir, 'promotions.ts'), 'utf8')
const promoWrites = [...promotions.matchAll(/^app\.(post|put|delete)\(('[^']*')/gm)].map((m) => m[1] + ' ' + m[2])
ok(promoWrites.length === 7, 'promotions.ts registers exactly the seven covered writes: ' + promoWrites.join(', '))
const promoBlocks = promotions.split(/^app\.(?=post|put|delete)/m).slice(1)
for (const block of promoBlocks) {
  const name = block.slice(0, block.indexOf(','))
  ok(/db\.batch\(\[[\s\S]*receiptAuditStatement\(/.test(block), 'promotions.ts ' + name + ' commits its audit receipt in the same batch as the write')
  ok(/readWriteRequestId\(body\)/.test(block), 'promotions.ts ' + name + ' requires a client_request_id')
}
const receiptLib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'auditWriteReceipt.ts'), 'utf8')
ok(/INSERT INTO audit_logs[\s\S]*WHERE changes\(\) = 1/.test(receiptLib), 'auditWriteReceipt.ts writes the receipt only when the guarded write changed a row')

// Rule 2 -- the read-only four are actually read-only (no mutation handlers
// AND no direct writes). If one of these grows a write path, this fails and
// forces the audit decision to be made rather than silently skipped.
// catalog.ts left this list when 0efd04bc deleted the route file outright
// (the dead, ungated storefront endpoint) -- the strongest form of staying
// read-only.
const EXPECTED_READ_ONLY = ['notifications.ts', 'organizations.ts', 'runtime.ts']
for (const file of EXPECTED_READ_ONLY) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8')
  ok(!MUTATION_RE.test(src), `${file} stays read-only (no mutation handlers)`)
  ok(!/\b(INSERT INTO|DELETE FROM)\b/.test(src), `${file} contains no direct writes`)
}

// Rule 3 -- the specific new coverage, pinned by shape so a refactor that
// drops the call (or its key detail) fails loudly.
const backups = fs.readFileSync(path.join(routesDir, 'backups.ts'), 'utf8')
ok(/audit\((?:[^()]|\([^()]*\))*'create',\s*'backup'/.test(backups), 'backups.ts audits backup creation')
// K10b: the restore's row is written with auditOrThrow (a restore is not reported done without it).
ok(/audit(?:OrThrow)?\((?:[^()]|\([^()]*\))*'restore',\s*'backup'/.test(backups), 'backups.ts audits the destructive restore')
// The call gained a progress callback (slice C, Part 543) -- match the
// call-site prefix, and assert it was actually FOUND so a future rename
// can't turn this into a vacuous indexOf(-1) comparison.
const restoreCallAt = backups.indexOf('restoreCloudflareBackup(c.env, sourceDir')
ok(restoreCallAt >= 0, 'backups.ts calls restoreCloudflareBackup at the restore branch')
ok(backups.indexOf("'restore', 'backup'") > restoreCallAt,
  'backups.ts restore audit sits after the restore actually ran')

const filesRoute = fs.readFileSync(path.join(routesDir, 'files.ts'), 'utf8')
ok(/audit\((?:[^()]|\([^()]*\))*'upload',\s*'file'/.test(filesRoute), 'files.ts audits uploads')
ok(/audit\((?:[^()]|\([^()]*\))*'rename',\s*'file'/.test(filesRoute), 'files.ts audits renames with from/to')
ok(/from:\s*existing\.original_name/.test(filesRoute), 'files.ts rename audit carries the before value')
ok(/audit\((?:[^()]|\([^()]*\))*'delete',\s*'file'/.test(filesRoute), 'files.ts audits deletes')
ok(/forced:\s*usageCount > 0/.test(filesRoute), 'files.ts delete audit records the CONFIRM DELETE override')

const notes = fs.readFileSync(path.join(routesDir, 'notes.ts'), 'utf8')
ok(/audit\((?:[^()]|\([^()]*\))*'create',\s*'note',(?:[^()]|\([^()]*\))*,\s*null\)/.test(notes), 'notes.ts audits create with NO content in details')

const telegram = fs.readFileSync(path.join(routesDir, 'telegram.ts'), 'utf8')
ok(/audit\((?:[^()]|\([^()]*\))*'test',\s*'telegram'/.test(telegram), 'telegram.ts audits the test message')
ok(/audit\((?:[^()]|\([^()]*\))*'send',\s*'telegram_summary'/.test(telegram), 'telegram.ts audits manual daily summaries')
ok(/audit\((?:[^()]|\([^()]*\))*'connect',\s*'telegram_webhook'/.test(telegram), 'telegram.ts audits command webhook setup')
ok(/audit\((?:[^()]|\([^()]*\))*'delete',\s*'note',(?:[^()]|\([^()]*\))*,\s*null\)/.test(notes), 'notes.ts audits delete with NO content in details')
const notesPutBody = notes.slice(notes.indexOf("app.put('/:id'"), notes.indexOf("app.patch('/reorder'"))
ok(notesPutBody.length > 0 && !notesPutBody.includes('audit('),
  'notes.ts autosave PUT is deliberately unaudited (per-keystroke flood guard)')

const sync = fs.readFileSync(path.join(routesDir, 'sync.ts'), 'utf8')
const outboxBody = sync.slice(sync.indexOf("app.post('/outbox'"), sync.indexOf("app.post('/files/chunks/init'"))
ok(outboxBody.length > 0 && !outboxBody.includes('audit('),
  'sync.ts outbox is deliberately unaudited (replayed routes audit; no double-log)')
ok(/audit\((?:[^()]|\([^()]*\))*'upload',\s*'file'/.test(sync), 'sync.ts audits the chunked-upload complete')
ok(/via:\s*'offline_sync'/.test(sync), 'sync.ts chunked-upload audit is marked offline_sync')

console.log(`\nAll ${checks} audit-coverage checks passed.`)
