const assert = require('node:assert/strict')
const { fixture } = require('./test-sales-export-snapshot-native.cjs')

async function main() {
  for (const kind of ['returns', 'expenses']) {
    const h = fixture()
    try {
      h.sql.exec('DELETE FROM return_items; DELETE FROM returns; DELETE FROM fees;')
      for (let id = 1; id <= 603; id++) {
        if (kind === 'returns') h.sql.prepare(`INSERT INTO returns(id,created_at,branch_id,return_number,customer_name,return_scope,status,total_refund_usd,total_refund_khr)
          VALUES(?,'2026-09-04 03:00:00',2,?,'Customer','customer','completed',0.105,420)`).run(id, `RET${id}`)
        else h.sql.prepare(`INSERT INTO fees(id,created_at,fee_date,branch_id,fee_type,label,amount_usd,amount_khr)
          VALUES(?,'2026-09-04 03:00:00','2026-09-04',2,'expense',?,0.105,7)`).run(id, `Expense${id}`)
      }
      async function get(query = {}) {
        const params = new URLSearchParams({ intent: 'export', order: 'desc', pageSize: '250', ...query })
        const response = await h.app.request(`http://local/business-summary/${kind}?${params}`, {}, {})
        return { status: response.status, body: await response.json() }
      }
      const first = await get()
      assert.equal(first.status, 200)
      assert.equal(first.body.export_version, 1, `${kind}: loaded-page export is not a complete frozen cohort`)
      assert.equal(first.body.row_count, 603)
      assert.deepEqual(first.body.totals, kind === 'returns' ? { count: 603, refund_usd: 63.32 }
        : { count: 603, amount_usd: 63.32, amount_khr: 4221 })
      const frozen = { exportToken: first.body.export_token, snapshotMaxId: String(first.body.snapshot_max_id) }
      let page = first.body
      const ids = []
      while (true) {
        ids.push(...page.rows.map(row => row.id))
        assert.equal(page.export_token, first.body.export_token)
        assert.deepEqual(page.totals, first.body.totals)
        if (!page.has_more) break
        const next = await get({ ...frozen, afterId: String(page.next_cursor.id), afterCreatedAt: page.next_cursor.created_at })
        assert.equal(next.status, 200)
        page = next.body
      }
      assert.deepEqual(ids, Array.from({ length: 603 }, (_, index) => 603 - index))
      assert.equal((await get({ ...frozen, verifyOnly: '1' })).body.verified, true)
      assert.equal((await get({ ...frozen, pageSize: '17' })).body.export_token, frozen.exportToken)
      const table = kind === 'returns' ? 'returns' : 'fees'
      const field = kind === 'returns' ? 'reason' : 'notes'
      h.sql.exec(`UPDATE ${table} SET ${field}='changed after collection' WHERE id=1`)
      const changed = await get({ ...frozen, verifyOnly: '1' })
      assert.equal(changed.status, 409)
      assert.equal(changed.body.code, 'report_export_changed')
      assert.equal((await get()).body.row_count, 603)
      h.sql.exec(`UPDATE ${table} SET ${field}=NULL WHERE id=1`)
      assert.equal((await get({ ...frozen, verifyOnly: '1' })).status, 200)
      for (const malformed of [
        { snapshotMaxId: '603' }, { exportToken: frozen.exportToken },
        { ...frozen, snapshotMaxId: '-1' }, { ...frozen, exportToken: 'g'.repeat(64) },
        { afterId: '1', afterCreatedAt: '2026-09-04 03:00:00' },
        { ...frozen, afterId: '1' }, { ...frozen, afterCreatedAt: '2026-09-04 03:00:00' },
        { ...frozen, afterId: '1', afterCreatedAt: 'wrong' },
        { ...frozen, verifyOnly: '0' }, { verifyOnly: '1' },
        { pageSize: '501' }, { pageSize: '1.5' }, { order: 'invalid' },
        { ...frozen, verifyOnly: '1', afterId: '1', afterCreatedAt: '2026-09-04 03:00:00' },
      ]) {
        const before = h.stats().reads
        assert.equal((await get(malformed)).status, 400, JSON.stringify(malformed))
        assert.equal(h.stats().reads, before, 'invalid continuation must not read records')
      }
      const duplicate = await h.app.request(`http://local/business-summary/${kind}?intent=export&pageSize=1&pageSize=2`, {}, {})
      assert.equal(duplicate.status, 400)
      assert.equal((await get({ ...frozen, exportToken: 'a'.repeat(64) })).status, 409)
      assert.equal((await get({ ...frozen, afterId: '9999', afterCreatedAt: '2026-09-04 03:00:00' })).status, 400)
      assert.equal((await get({ ...frozen, q: 'no match' })).status, 409)
      const none = await get({ q: 'no match' })
      assert.equal(none.body.row_count, 0)
      assert.equal(none.body.snapshot_max_id, 0)
      assert.deepEqual(none.body.rows, [])
      assert.equal(none.body.has_more, false)
      const asc = await get({ order: 'asc', pageSize: '1' })
      assert.equal(asc.body.rows[0].id, 1)
      assert.notEqual(asc.body.export_token, first.body.export_token)
      assert.equal((await get({ ...frozen, order: 'asc' })).status, 409)
      h.setUser({ ...h.staff({ all: true }), id: 18 })
      assert.equal((await get({ ...frozen, verifyOnly: '1' })).status, 409, 'same permission does not transfer an actor-bound export')
      h.setUser(h.staff({ all: true }))
      const maxColumn = kind === 'returns' ? 'return_number' : 'label'
      h.sql.exec(`INSERT INTO ${table}(id,created_at,branch_id,${maxColumn}) VALUES(604,'2026-01-01 03:00:00',2,'Later backdated row')`)
      assert.equal((await get({ ...frozen, verifyOnly: '1' })).status, 200, 'new backdated IDs stay outside the captured ceiling')
      assert.equal((await get()).body.row_count, 604)
      h.sql.exec(`DELETE FROM ${table} WHERE id=604`)
      h.sql.exec(`UPDATE ${table} SET ${kind === 'returns' ? 'total_refund_usd' : 'amount_usd'}=19 WHERE id=1`)
      assert.equal((await get({ ...frozen, verifyOnly: '1' })).status, 409, 'money update on last page must invalidate first-page token')
      h.sql.exec(`UPDATE ${table} SET ${kind === 'returns' ? 'total_refund_usd' : 'amount_usd'}=0.105 WHERE id=1`)
      h.sql.exec(`UPDATE ${table} SET branch_id=3 WHERE id=1`)
      const branch = await get({ branchId: '2' })
      assert.equal(branch.body.row_count, 602)
      assert.equal((await get({ q: `${kind === 'returns' ? 'RET' : 'Expense'}603` })).body.row_count, 1)
      assert.equal((await get({ startDate: '2026-09-05', endDate: '2026-09-05' })).body.row_count, 0)
      h.sql.exec(`UPDATE ${table} SET branch_id=2 WHERE id=1`)
      h.sql.exec(`UPDATE ${table} SET created_at='invalid timestamp' WHERE id=1`)
      assert.equal((await get()).status, 422, 'unsupported cursor data refuses rather than producing an incomplete walk')
      h.sql.exec(`UPDATE ${table} SET created_at='2026-09-04 03:00:00' WHERE id=1`)
      if (kind === 'returns') {
        h.sql.exec("UPDATE returns SET return_scope='supplier' WHERE id=1; UPDATE returns SET status='cancelled' WHERE id=2")
        assert.equal((await get()).body.row_count, 601)
        h.sql.exec("UPDATE returns SET return_scope='customer' WHERE id=1; UPDATE returns SET status='completed' WHERE id=2")
      }
      const full = await get()
      h.sql.exec(`DELETE FROM ${table} WHERE id=1`)
      assert.equal((await get({ exportToken: full.body.export_token, snapshotMaxId: String(full.body.snapshot_max_id), verifyOnly: '1' })).status, 409)
      h.sql.exec(`UPDATE ${table} SET ${field}=printf('%08000d', 0)`)
      const oversized = await get()
      assert.equal(oversized.status, 413, 'byte limit is independent of row count')
      assert.equal(oversized.body.code, 'report_export_too_large')
      h.sql.exec(`UPDATE ${table} SET ${field}=NULL;
        WITH RECURSIVE ids(n) AS (SELECT 604 UNION ALL SELECT n+1 FROM ids WHERE n<10002)
        INSERT INTO ${table}(id,created_at,branch_id) SELECT n,'2026-09-04 03:00:00',2 FROM ids`)
      assert.equal((await get()).status, 413, '10001 rows refuse without a partial export')
      h.sql.exec(`DELETE FROM ${table} WHERE id=10002`)
      assert.equal((await get({ pageSize: '1' })).body.row_count, 10000, 'exact row ceiling is accepted')
      console.log(`PASS ${kind}: 603-row frozen full export, exact totals, all pages, stable page-size and changed-final-read refusal`)
    } finally { h.sql.close() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
