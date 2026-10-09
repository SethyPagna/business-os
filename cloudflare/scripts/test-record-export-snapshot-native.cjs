const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { fixture } = require('./test-sales-export-snapshot-native.cjs')

const worker = `
import reports from './src/routes/reports.ts';
import { __resetPlanTierCacheForTests, resolvePlanTier } from './src/lib/planTier.ts';
export default { async fetch(request, env) {
  const input = await request.json();
  if (input.seed) {
    for (const sql of input.seed) await env.DB.prepare(sql).run();
    return Response.json({ ok: true });
  }
  const reads = [];
  const wrap = (sql, statement) => ({
    bind(...values) { return wrap(sql, statement.bind(...values)); },
    async all() { const result = await statement.all(); reads.push(result.meta); return result; },
    async run() { const result = await statement.run(); reads.push(result.meta); return result; },
    async first(key) { const result = await this.all(); return key ? result.results[0]?.[key] ?? null : result.results[0] ?? null; }
  });
  const db = { prepare(sql) { return wrap(sql, env.DB.prepare(sql)); } };
  __resetPlanTierCacheForTests();
  const bindings = { ...env, DB: db, PLAN_TIER: input.plan, TEST_ACTOR: input.actor };
  const plan = resolvePlanTier(bindings);
  const start = Date.now();
  const response = await reports.fetch(new Request('http://reports.local/business-summary/' + input.kind + '?' + new URLSearchParams(input.query)),
    bindings);
  return Response.json({ status: response.status, body: await response.json(), plan, reads, wallMs: Date.now() - start });
} };
`

async function main() {
  const bundle = await build({ stdin: { contents: worker, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'test-auth-only', setup(build) {
      build.onResolve({ filter: /^\.\.\/lib\/auth$/ }, () => ({ path: 'test-auth', namespace: 'test-auth' }))
      build.onLoad({ filter: /.*/, namespace: 'test-auth' }, () => ({ contents:
        `export async function requireAuth(c, next) { c.set('user', c.env.TEST_ACTOR); return next(); }`, loader: 'ts' }))
    } }],
  })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', port: 0,
    d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  const h = fixture()
  const call = async input => {
    const response = await mf.dispatchFetch('http://reports.local/', { method: 'POST', body: JSON.stringify(input) })
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    const schema = h.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.sql)
    await call({ seed: schema.concat([
      "INSERT INTO branches(id,name) VALUES(2,'Synthetic Branch')",
      "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM n WHERE id<603) INSERT INTO returns(id,created_at,branch_id,return_number,return_scope,status,total_refund_usd,total_refund_khr) SELECT id,'2026-09-04 03:00:00',2,'RET'||id,'customer','completed',0.105,420 FROM n",
      "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM n WHERE id<603) INSERT INTO fees(id,created_at,fee_date,branch_id,fee_type,label,amount_usd,amount_khr) SELECT id,'2026-09-04 03:00:00','2026-09-04',2,'expense','Expense'||id,0.105,7 FROM n",
    ]) })
    const measurements = []
    for (const plan of ['free', 'paid']) for (const kind of ['returns', 'expenses']) {
      const request = query => call({ plan, kind, actor: h.staff({ all: true }), query: { intent: 'export', order: 'desc', pageSize: '250', ...query } })
      const first = await request()
      assert.equal(first.plan, plan)
      assert.equal(first.status, 200)
      assert.equal(first.body.row_count, 603)
      assert.equal(first.reads.length, 1)
      assert.equal(first.reads[0].rows_written, 0)
      const frozen = { exportToken: first.body.export_token, snapshotMaxId: String(first.body.snapshot_max_id) }
      let page = first.body
      const ids = []
      while (true) {
        ids.push(...page.rows.map(row => row.id))
        assert.deepEqual(page.totals, first.body.totals)
        if (!page.has_more) break
        const next = await request({ ...frozen, afterId: String(page.next_cursor.id), afterCreatedAt: page.next_cursor.created_at })
        assert.equal(next.status, 200)
        assert.equal(next.reads.length, 1)
        page = next.body
      }
      assert.deepEqual(ids, Array.from({ length: 603 }, (_, index) => 603 - index))
      assert.equal((await request({ ...frozen, verifyOnly: '1' })).body.verified, true)
      const denied = await call({ plan, kind, actor: h.staff({ [kind === 'returns' ? 'returns' : 'fees']: true }, { [`${kind === 'returns' ? 'returns' : 'fees'}:export`]: false }), query: { intent: 'export' } })
      assert.equal(denied.status, 403)
      assert.equal(denied.reads.length, 0)
      measurements.push({ plan, kind, rows: 603, queryCount: first.reads.length, rowsRead: first.reads[0].rows_read,
        writes: first.reads[0].rows_written, d1Duration: first.reads[0].duration, wallMs: first.wallMs })
    }
    await call({ seed: ["UPDATE fees SET notes=printf('%08000d',0)"] })
    const large = await call({ kind: 'expenses', plan: 'free', actor: h.staff({ all: true }), query: { intent: 'export' } })
    assert.equal(large.status, 413)
    assert.equal(large.reads.length, 1)
    console.log(JSON.stringify({ status: 'PASS', boundary: 'actual reports route and D1; authentication supplied, not full entrypoint or billed CPU certification', measurements }))
  } finally { h.sql.close(); await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
