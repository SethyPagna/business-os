'use strict'
// A migrated node:sqlite world for the stored-daily-totals cron tests: every migration (incl. 0308), the Worker's db seam replaced by the world's database,
// the cron / totals / plan modules loaded from src, and a fake kernel whose payload is a pure function of the day's raw sales (so a changed sale changes
// the payload, as the real kernel's would). Shared by test-sales-daily-budget / alert / poison / quarantine / epoch tests.
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./d1compat.cjs')
const { createLoader, SRC } = require('./sales-daily-load.cjs')

const ROOT = path.join(__dirname, '..', '..')
const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8').replace(/\r\n/g, '\n'))

function createWorld() {
  let rawDb = null
  const dbShim = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => { const r = stmt.run(p); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
  const { src } = createLoader(new Map([[path.normalize(path.join(SRC, 'lib/db.ts')), { getDb: () => dbShim }]]))
  const T = src('lib/salesDailyTotals.ts')
  const cron = src('lib/salesDailyCron.ts')
  const tiers = src('lib/planTier.ts')
  const { ReportExactDecimal } = src('lib/reportMoneyPrecision.ts')

  const NOW = Date.parse('2026-11-14T05:00:00Z') // 12:00 in Cambodia, business date 2026-11-14
  const DAYS = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
  const saleSql = (receipt, createdAt) => `INSERT INTO sales(receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,branch_id,created_at) VALUES('${receipt}','req-${receipt}',0,10,10,1,'${createdAt}')`
  const world = {
    T, cron, tiers, ReportExactDecimal, NOW, DAYS, saleSql,
    db: () => rawDb,
    fresh(days) {
      rawDb = openDb(migrations)
      rawDb.exec("INSERT INTO branches(name) VALUES('LC Store')")
      days.forEach((d, i) => rawDb.exec(saleSql(`S${i}`, `${d} 03:00:00`)))
      return { DB: {}, Business_OS_Analytics: { points: [], writeDataPoint(p) { this.points.push(p) } } }
    },
    rows: () => rawDb.prepare('SELECT * FROM sales_daily_totals ORDER BY business_date').all().map((r) => ({ ...r })),
    stateOf: (d) => world.rows().find((r) => r.business_date === d),
    epochNow: () => rawDb.prepare("SELECT value FROM system_flags WHERE key='data_epoch'").get().value,
    flag: (key) => rawDb.prepare('SELECT value FROM system_flags WHERE key = ?').get([key])?.value ?? null,
    flagsNow: () => T.salesDailyFlagsFromRows(rawDb.prepare(T.SALES_DAILY_FLAGS_SQL).all()),
    kernelOf(hooks = {}, version = T.SALES_DAILY_KERNEL_VERSION) {
      return {
        version,
        async computeDays(_env, days) {
          if (hooks.beforeRead) hooks.beforeRead(days)
          const out = new Map()
          for (const d of days) {
            const sums = rawDb.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_usd),0) t FROM sales WHERE COALESCE(date(created_at,'+7 hours'),'') = ?").get([d])
            const base = { payload: { v: 1, branches: { 1: { bucket: { money: { revenue: `${sums.t}` }, counts: { tx: sums.n } } } } }, sourceRows: hooks.sourceRows ?? sums.n, refusal: null }
            out.set(d, hooks.result ? hooks.result(d, sums) : { ...base, ...(hooks.queries ? { queries: hooks.queries } : {}) })
          }
          if (hooks.afterRead) hooks.afterRead(days)
          return out
        },
      }
    },
    dep: (over = {}) => ({ mode: 'on', nowMs: NOW, kernel: world.kernelOf(), ...over }),
    setTier(env, tier) { if (tier) env.PLAN_TIER = tier; else delete env.PLAN_TIER; tiers.__resetPlanTierCacheForTests() },
    corruptStored: (day, from = '"revenue":"10"', to = '"revenue":"11"') => rawDb.exec(`UPDATE sales_daily_totals SET payload = replace(payload, '${from}', '${to}') WHERE business_date = '${day}'`),
    manyDays: (n, start = '2026-09-01') => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)),
  }
  return world
}
module.exports = { createWorld }
