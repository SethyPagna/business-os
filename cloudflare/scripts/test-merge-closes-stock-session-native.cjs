// MERGE-UNBLOCK (owner-urgent, 1 Oct 2026): Keep / Merge on the Products
// conflicts pages failed for any product received by a recent stock-in session.
// The Worker refused every merge path while a member product belonged to a
// session whose history status was undoable or redoable, and nothing ever
// settles such a session (only the 180-day retention sweep), so recently
// received duplicates could never be merged.
//
// The rule now: the merge proceeds and CLOSES that session's Undo in the same
// D1 batch -- history status 'recorded', reversible 0, the reason in last_error,
// one audit row per closed session -- and nothing else drifts. The merge
// itself stays undoable; undoing it does not reopen a closed session.
//
// Real routes/products.ts, real fold, real stock-session commit/replay and the
// full migration chain in SQLite. All data is synthetic.
//
// Run (from cloudflare/): node scripts/test-merge-closes-stock-session-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const MARKER = 'undo_closed:products_merged'
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  }
}

function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  h.setUser(ADMIN)
  h.raw.db.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1), (2, 'Warehouse', 0, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES
      (1, 'Gloss One', '8850000000011', 2, 5, 0, 1),
      (2, 'Gloss One', '8850000000011', 3, 5, 0, 1),
      (3, 'Serum Other', '8850000000033', 4, 9, 0, 1),
      (4, 'Tint Solo', '8850000000044', 1, 4, 0, 1),
      (5, 'Tint Solo', '8850000000044', 1, 4, 0, 1);
  `)
  const sessions = h.load('lib/stockSession.ts')
  const env = { DB: h.raw }
  let counter = 0
  const receive = async (lines, branchId = 1) => sessions.commitStockSession(env, ADMIN, {
    client_request_id: `req-merge-unblock-${String(counter += 1).padStart(4, '0')}`,
    mode: 'stock_in',
    defaults: { branch_id: branchId, received_date: '2026-09-29', supplier_name: 'Synthetic Supplier' },
    items: lines.map((line, index) => ({ line_id: `l${counter}-${index}`, kind: 'receive', unit_cost_usd: 3, ...line })),
  })
  return { h, sessions, env, receive }
}

const history = (f, id) => f.h.raw.prepare('SELECT id, status, reversible, last_error FROM action_history WHERE id = ?').get([id])
const auditRows = (f, action) => f.h.raw.prepare('SELECT entity_id, details FROM audit_logs WHERE action = ? ORDER BY id').all([action])

// The two stock ledgers: branch_stock (the shelf) and the lots (branch_batch_stock).
function ledgers(f, productIds) {
  const one = (sql, id) => f.h.raw.prepare(sql).all([id])
  return productIds.map((id) => ({
    id,
    shelf: one('SELECT branch_id, quantity FROM branch_stock WHERE product_id = ? ORDER BY branch_id', id).map((r) => `${r.branch_id}:${r.quantity}`).join(','),
    lots: one(`SELECT bbs.branch_id, SUM(bbs.quantity) AS quantity FROM branch_batch_stock bbs
      JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = ? GROUP BY bbs.branch_id ORDER BY bbs.branch_id`, id)
      .filter((r) => Number(r.quantity) !== 0).map((r) => `${r.branch_id}:${r.quantity}`).join(','),
  }))
}
const assertLedgersAgree = (f, productIds, label) => {
  for (const row of ledgers(f, productIds)) {
    const shelf = row.shelf.split(',').filter((part) => !part.endsWith(':0')).join(',')
    assert.equal(row.lots, shelf, `${label}: product ${row.id} shelf ${row.shelf} must equal its lots ${row.lots}`)
  }
}
const totalUnits = (f, ids) => f.h.raw.prepare(`SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id IN (${ids.join(',')})`).get().n

async function mergePair(f, keepId, mergeId, extra = {}) {
  return f.h.request('POST', '/possible-duplicates/merge', { keepId, mergeId, stock: 'merge', ...extra })
}

const memberMovementId = (f, operationId) => f.h.raw.prepare('SELECT movement_id FROM stock_session_members WHERE operation_id = ? LIMIT 1').get([operationId]).movement_id
const historyApp = (f) => f.h.load('routes/actionHistory.ts').default
const historyRequest = async (f, method, path, body) => {
  const res = await historyApp(f).request(`http://local${path}`, {
    method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }, { DB: f.h.raw }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const DIGEST_TABLES = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'action_history', 'audit_logs', 'undo_snapshots']
const digest = (f) => JSON.stringify(DIGEST_TABLES.map((table) => [table, f.h.raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all([])]))

async function main() {
  await check('the native adapter once methods make one attempt and preserve bound parameters', async () => {
    const h = createProductsRouteHarness({ user: ADMIN })
    assert.equal((await h.db.prepare('SELECT ? AS value').bind([7]).getOnce()).value, 7)
    assert.deepEqual((await h.db.prepare('SELECT ? AS value').bind([8]).allOnce()).map(row => row.value), [8])
    const prepare = h.raw.prepare.bind(h.raw)
    let attempts = 0
    const error = new Error('D1 transient once probe')
    h.raw.prepare = () => ({ get() { attempts++; throw error }, all() { attempts++; throw error } })
    await assert.rejects(h.db.prepare('probe').getOnce(), failure => failure === error)
    assert.equal(attempts,1)
    await assert.rejects(h.db.prepare('probe').allOnce(), failure => failure === error)
    assert.equal(attempts,2)
    h.raw.prepare = prepare
  })
  await check('DISCRIMINATING: a merge of two products, one with an undoable stock-in session, completes and closes that session', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const unrelated = await f.receive([{ product_id: 3, quantity: 6 }])
    assert.equal(history(f, open.actionHistoryId).status, 'undoable')
    assertLedgersAgree(f, [1, 2, 3], 'before')
    const unitsBefore = totalUnits(f, [1, 2])

    const res = await mergePair(f, 1, 2)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.success, true)

    const closed = history(f, open.actionHistoryId)
    assert.equal(closed.status, 'recorded', 'the session Undo is closed')
    assert.equal(closed.reversible, 0)
    assert.equal(closed.last_error, MARKER, 'with the reason, not a silent failure')
    const untouched = history(f, unrelated.actionHistoryId)
    assert.equal(untouched.status, 'undoable', 'a session on a product outside the merge keeps its Undo')
    assert.equal(untouched.reversible, 1)
    assert.equal(untouched.last_error, null)

    const rows = auditRows(f, 'stock_session_undo_closed')
    assert.equal(rows.length, 1, 'one audit row per closed session, none for the unrelated one')
    assert.equal(rows[0].entity_id, open.operationId)
    assert.deepEqual(
      (({ reason, previousStatus, mergedIntoProductId }) => ({ reason, previousStatus, mergedIntoProductId }))(JSON.parse(rows[0].details)),
      { reason: 'products merged', previousStatus: 'undoable', mergedIntoProductId: 1 },
    )
    assert.equal(auditRows(f, 'merge_duplicate').length, 1)
    assert.equal(JSON.parse(rows[0].details).mergeOperationId, res.json.operationId, 'the close row points at the merge that caused it')

    assertLedgersAgree(f, [1, 3], 'after merge')
    assert.equal(totalUnits(f, [1, 2]), unitsBefore, 'the merge moved every unit and lost none')
    assert.equal(f.h.raw.prepare('SELECT is_active FROM products WHERE id = 2').get().is_active, 0)
  })

  await check('a redoable (already undone) session is closed too, and a replay of a closed session is refused', async () => {
    const f = fixture()
    const receipt = await f.receive([{ product_id: 3, quantity: 2 }, { product_id: 2, quantity: 5 }])
    const payload = JSON.parse(history(f, receipt.actionHistoryId) && f.h.raw.prepare('SELECT undo_payload FROM action_history WHERE id = ?').get([receipt.actionHistoryId]).undo_payload)
    await f.sessions.replayStockSession(f.env, ADMIN, 'undo', receipt.actionHistoryId, 0, payload)
    assert.equal(history(f, receipt.actionHistoryId).status, 'redoable')

    const res = await mergePair(f, 1, 2)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const closed = history(f, receipt.actionHistoryId)
    assert.equal(closed.status, 'recorded')
    assert.equal(closed.last_error, MARKER)
    assert.equal(JSON.parse(auditRows(f, 'stock_session_undo_closed')[0].details).previousStatus, 'redoable')

    const redo = JSON.parse(f.h.raw.prepare('SELECT redo_payload FROM action_history WHERE id = ?').get([receipt.actionHistoryId]).redo_payload)
    await assert.rejects(() => f.sessions.replayStockSession(f.env, ADMIN, 'redo', receipt.actionHistoryId, 1, redo), 'a closed session must not replay')
  })

  await check('the History route answers a closed session with its own reason and code, not "recorded only"', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    assert.equal((await mergePair(f, 1, 2)).status, 200)
    const historyApp = f.h.load('routes/actionHistory.ts').default
    const res = await historyApp.request(`http://local/${open.actionHistoryId}/undo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ require_applied: true }),
    }, { DB: f.h.raw }, { waitUntil() {}, passThroughOnException() {} })
    const body = await res.json()
    assert.equal(res.status, 409, JSON.stringify(body))
    assert.equal(body.code, 'undo_closed_products_merged')
    assert.match(body.error, /Undo closed: products were merged/)
  })

  await check('the merge stays undoable; undoing it moves stock back, both ledgers agree, and the closed session stays closed', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const other = await f.receive([{ product_id: 1, quantity: 3 }])
    const shelfBefore = ledgers(f, [1, 2])
    const mergeRes = await mergePair(f, 1, 2)
    assert.equal(mergeRes.status, 200, JSON.stringify(mergeRes.json))
    const other_closed = history(f, other.actionHistoryId)
    assert.equal(other_closed.status, 'recorded', 'a session on the KEEPER is closed as well')

    const mergeHistory = f.h.raw.prepare("SELECT * FROM action_history WHERE undo_payload LIKE '%product.merge%' ORDER BY id DESC LIMIT 1").get()
    assert.ok(mergeHistory, 'the merge wrote its own undoable history row')
    assert.equal(mergeHistory.status, 'undoable')
    const appliers = f.h.load('lib/undoAppliers.ts')
    const undoPayload = JSON.parse(mergeHistory.undo_payload)
    await appliers.resolveUndoApplier(undoPayload).run(undoPayload, {
      env: { DB: f.h.raw }, user: ADMIN, direction: 'undo', historyId: mergeHistory.id, generation: undoPayload.generation,
    })

    assert.equal(f.h.raw.prepare('SELECT is_active FROM products WHERE id = 2').get().is_active, 1, 'the merged product is back')
    assert.deepEqual(ledgers(f, [1, 2]), shelfBefore, 'stock is back exactly where it was')
    assertLedgersAgree(f, [1, 2], 'after merge undo')
    for (const receipt of [open, other]) {
      const row = history(f, receipt.actionHistoryId)
      assert.equal(row.status, 'recorded', 'closed sessions are not resurrected by undoing the merge')
      assert.equal(row.reversible, 0)
      assert.equal(row.last_error, MARKER)
    }
    assert.equal(auditRows(f, 'stock_session_undo_closed').length, 2, 'undoing the merge writes no extra close audit rows')
  })

  await check('CONTROL: a merge with no stock-in session closes nothing and writes no session audit rows', async () => {
    const f = fixture()
    const bystander = await f.receive([{ product_id: 3, quantity: 1 }])
    const res = await mergePair(f, 4, 5, { stock: undefined })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(auditRows(f, 'stock_session_undo_closed').length, 0)
    assert.equal(history(f, bystander.actionHistoryId).status, 'undoable')
  })

  await check('the Resolve (keep) merge and its preview no longer report a blocking session', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const preview = await f.h.request('GET', '/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1')
    assert.equal(preview.status, 200, JSON.stringify(preview.json))
    assert.notEqual(preview.json.blocked?.code, 'stock_session_reversible')
    assert.deepEqual(preview.json.closesStockSessions, [open.operationId], 'the preview says which session Undo the merge will close')
    const res = await mergePair(f, 1, 2, { keep: true })
    assert.equal(res.status, 200, JSON.stringify(res.json))
  })

  await check('the whole-catalog merge (POST /merge-duplicates) merges a pair that has a live session', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const res = await f.h.request('POST', '/merge-duplicates', {})
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal((res.json.refusals || []).filter((r) => r.code === 'stock_session_reversible').length, 0)
    assert.equal(history(f, open.actionHistoryId).status, 'recorded')
    assert.equal(f.h.raw.prepare('SELECT COUNT(*) AS n FROM products WHERE id IN (1, 2) AND is_active = 1').get().n, 1, 'one of the pair was folded into the other')
  })

  await check('a retry after a lost answer (same Resolve request id) is a replay: one merge, one close, same answer', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const preview = await f.h.request('GET', '/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1')
    assert.equal(preview.status, 200, JSON.stringify(preview.json))
    const body = {
      keepId: 1, mergeId: 2, stock: 'merge', keep: true,
      resolve: { requestId: 'resolve-request-0001', reviewedDigest: preview.json.reviewedDigest, steps: [{ mergeId: 2, stock: 'merge' }] },
    }
    const first = await f.h.request('POST', '/possible-duplicates/merge', body)
    assert.equal(first.status, 200, JSON.stringify(first.json))
    const unitsAfterFirst = totalUnits(f, [1, 2])
    const second = await f.h.request('POST', '/possible-duplicates/merge', body)
    assert.equal(second.status, 200, JSON.stringify(second.json))
    assert.equal(second.json.replayed, true, 'the Worker recognises the request id and does not merge again')
    assert.equal(auditRows(f, 'merge_duplicate').length, 1)
    assert.equal(auditRows(f, 'stock_session_undo_closed').length, 1)
    assert.equal(totalUnits(f, [1, 2]), unitsAfterFirst)
    assert.equal(history(f, open.actionHistoryId).status, 'recorded')
    assertLedgersAgree(f, [1], 'after the replay')
  })

  // The close is only safe because it commits WITH the merge. Each trigger makes one
  // statement of the fold's single D1 batch fail; the statements after the close
  // (the merge's own snapshot, history row and audit row) are in that batch too, so
  // a close committed on its own would show here as a session closed by a merge
  // that never happened, or the reverse.
  const injections = [
    ['the close audit insert', "BEFORE INSERT ON audit_logs WHEN NEW.action = 'stock_session_undo_closed'"],
    ['the close status update', `BEFORE UPDATE ON action_history WHEN NEW.last_error = '${MARKER}'`],
    ['the merge undo snapshot insert', "BEFORE INSERT ON undo_snapshots WHEN NEW.kind = 'product.merge'"],
    ['the merge history row insert', "BEFORE INSERT ON action_history WHEN NEW.scope = 'products' AND NEW.entity = 'product'"],
    ['the merge audit row insert', "BEFORE INSERT ON audit_logs WHEN NEW.action = 'merge_duplicate'"],
  ]
  for (const [point, when] of injections) {
    await check(`DISCRIMINATING: a failure at ${point} leaves the merge AND the close unwritten, and a retry does both`, async () => {
      const f = fixture()
      const open = await f.receive([{ product_id: 2, quantity: 4 }])
      const before = digest(f)
      f.h.raw.db.exec(`CREATE TRIGGER injected_fault ${when} BEGIN SELECT RAISE(ABORT, 'probe_injected'); END;`)
      const failedRes = await mergePair(f, 1, 2)
      assert.equal(failedRes.status, 409, JSON.stringify(failedRes.json))
      assert.deepEqual([failedRes.json.code, failedRes.json.outcome], ['merge_failed', 'not_applied'], 'a rolled-back fold answers a definite refusal, never a raw 500')
      assert.equal(digest(f), before, 'not one row of the merge or the close survived')
      assert.equal(history(f, open.actionHistoryId).status, 'undoable', 'the session kept its Undo')
      assert.equal(f.h.raw.prepare('SELECT is_active FROM products WHERE id = 2').get().is_active, 1)
      f.h.raw.db.exec('DROP TRIGGER injected_fault')
      const retry = await mergePair(f, 1, 2)
      assert.equal(retry.status, 200, JSON.stringify(retry.json))
      assert.equal(history(f, open.actionHistoryId).last_error, MARKER)
      assert.equal(auditRows(f, 'stock_session_undo_closed').length, 1)
      assertLedgersAgree(f, [1], 'after the retry')
    })
  }

  await check('the revert-preview door answers a closed session with its own reason (and an open one still previews)', async () => {
    const f = fixture()
    const open = await f.receive([{ product_id: 2, quantity: 4 }])
    const movementId = memberMovementId(f, open.operationId)
    const control = await historyRequest(f, 'GET', `/movements/${movementId}/revert-preview`)
    assert.equal(control.status, 200, JSON.stringify(control.json))
    assert.equal(control.json.revert.kind, 'stock_session')
    assert.equal((await mergePair(f, 1, 2)).status, 200)
    const closed = await historyRequest(f, 'GET', `/movements/${movementId}/revert-preview`)
    assert.equal(closed.status, 409, JSON.stringify(closed.json))
    assert.equal(closed.json.code, 'undo_closed_products_merged')
    assert.match(closed.json.error, /Undo closed: products were merged/)
  })

  await check('a session undone and then closed by a merge refuses a line edit with the merge reason, not "Redo it first"', async () => {
    const f = fixture()
    const receipt = await f.receive([{ product_id: 2, quantity: 4 }])
    const payload = JSON.parse(f.h.raw.prepare('SELECT undo_payload FROM action_history WHERE id = ?').get([receipt.actionHistoryId]).undo_payload)
    await f.sessions.replayStockSession(f.env, ADMIN, 'undo', receipt.actionHistoryId, 0, payload)
    const { applyStockInLineEdit } = f.h.load('lib/stockInLineEdit.ts')
    const movementId = memberMovementId(f, receipt.operationId)
    const edit = (id) => applyStockInLineEdit(f.h.db, ADMIN, movementId, { quantity: 3, expected_batch_revision: 0, client_request_id: `line-edit-${id}-000000` })

    const plain = await edit('plain')
    assert.equal(plain.status, 409)
    assert.equal(plain.body.code, 'session_undone')
    assert.match(plain.body.error, /Redo it first/, 'an undone session that can still be redone keeps the old advice')

    assert.equal((await mergePair(f, 1, 2)).status, 200)
    const closed = await edit('closed')
    assert.equal(closed.status, 409)
    assert.equal(closed.body.code, 'session_undo_closed')
    assert.match(closed.body.error, /product merge closed its Undo/)
    assert.doesNotMatch(closed.body.error, /Redo it first/, 'Redo is no longer possible, so it must not be offered')
  })

  await check("OWNER-ACCEPTED: a product edit that folds a twin closes another user's stock-in Undo without inventory rights, and the audit row names who and which session", async () => {
    const f = fixture()
    f.h.raw.db.exec(`INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active)
      VALUES(6, 'Gloss Renamed', '8850000000066', 2, 5, 0, 1)`)
    const others = await f.receive([{ product_id: 6, quantity: 4 }])
    const EDITOR = { id: 12, username: 'editor', name: 'Edith Editor', role_code: 'staff', permissions: '{}' }
    assert.notEqual(EDITOR.id, ADMIN.id, 'the session belongs to somebody else')
    f.h.setUser(EDITOR)
    f.h.setActionTier((_user, scope) => (scope === 'inventory' ? 'none' : 'full'))
    const res = await f.h.request('PUT', '/6', { name: 'Gloss One', barcode: '8850000000011' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.merged_into, 1)
    assert.equal(history(f, others.actionHistoryId).last_error, MARKER, 'accepted by the owner: merges always work with product edit rights')

    const rows = f.h.raw.prepare('SELECT user_id, user_name, entity, entity_id, details FROM audit_logs WHERE action = ?').all(['stock_session_undo_closed'])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].user_id, EDITOR.id, 'the actor is recorded, not the session creator')
    assert.match(rows[0].user_name, /Edith Editor|editor/)
    assert.equal(rows[0].entity, 'stock_session')
    assert.equal(rows[0].entity_id, others.operationId, 'the closed session is named')
    const mergeAudit = f.h.raw.prepare("SELECT user_id, details FROM audit_logs WHERE action = 'merge_duplicate'").get()
    assert.equal(mergeAudit.user_id, EDITOR.id)
    const mergeHistory = f.h.raw.prepare("SELECT undo_payload FROM action_history WHERE undo_payload LIKE '%product.merge%'").get()
    assert.equal(JSON.parse(rows[0].details).mergeOperationId, JSON.parse(mergeHistory.undo_payload).operation_id, 'and the merge that caused it')
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
