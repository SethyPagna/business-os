// Website Editor lane: the announcement strip (GET /api/portal/promotions)
// honours its "Show from" / "Show until" dates on the Phnom Penh business day.
//
// The strip editor (ManagePromotionsModal) collects DATES and stores them as
// ISO strings: the start as UTC midnight of the chosen day, the end as
// 23:59:59 in the editing browser. The public route compared those strings
// with the UTC clock, so a strip set to start on the 25th stayed hidden until
// 07:00 Phnom Penh time, and a date-only end expired at 07:00 on its last
// day. The route now compares the date as written with today's business date.
//
// The REAL portal.ts route runs against SQLite with every real migration; the
// clock is frozen at instants where the UTC date and the Phnom Penh date
// differ.
//
// Run (from cloudflare/): node scripts/test-portal-posts-strip-dates-pure.cjs
const assert = require('assert')
const { createWorker } = require('./harness/real_worker_routes.cjs')

const RealDate = Date
function atInstant(iso, fn) {
  const fixed = RealDate.parse(iso)
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])) }
    static now() { return fixed }
  }
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate })
}

const worker = createWorker()
const portal = worker.load('routes/portal.ts').default

const insert = worker.rawDb.db.prepare(`
  INSERT INTO promotions (title, is_active, sort_order, starts_at, ends_at)
  VALUES (?, ?, ?, ?, ?)
`)
const strips = [
  // title, active, starts_at, ends_at -- start/end as the editor writes them
  ['starts on the 25th', 1, '2026-09-25T00:00:00.000Z', null],
  ['ends on the 24th', 1, null, '2026-09-24T16:59:59.000Z'],
  ['ends on the 25th, date only', 1, null, '2026-09-25'],
  ['ends on the 25th', 1, null, '2026-09-25T16:59:59.000Z'],
  ['switched off', 0, null, null],
  ['no dates', 1, null, null],
  ['starts on the 26th', 1, '2026-09-26T00:00:00.000Z', null],
  ['blank bounds', 1, '', ''],
]
strips.forEach(([title, active, startsAt, endsAt], index) => insert.run(title, active, index, startsAt, endsAt))

async function visibleAt(iso) {
  return atInstant(iso, async () => {
    const res = await worker.call(portal, 'GET', '/promotions')
    assert.strictEqual(res.status, 200)
    return res.body.items.map((item) => item.title)
  })
}

let checks = 0
async function check(label, fn) { await fn(); checks++; console.log(`PASS ${label}`) }

;(async () => {
  await check('00:30 on the 25th in Phnom Penh (17:30 UTC on the 24th): a strip starting on the 25th is already up', async () => {
    const titles = await visibleAt('2026-09-24T17:30:00.000Z')
    assert.ok(titles.includes('starts on the 25th'), titles.join(' | '))
    assert.ok(!titles.includes('ends on the 24th'), 'the 24th is over in Phnom Penh')
  })

  await check('23:59 on the 24th in Phnom Penh: the 25th strip is not up yet, the 24th strip still is', async () => {
    const titles = await visibleAt('2026-09-24T16:59:00.000Z')
    assert.ok(!titles.includes('starts on the 25th'), titles.join(' | '))
    assert.ok(titles.includes('ends on the 24th'), titles.join(' | '))
  })

  await check('09:00 on the 25th in Phnom Penh: a date-only end on the 25th still shows for the whole day', async () => {
    const titles = await visibleAt('2026-09-25T02:00:00.000Z')
    assert.ok(titles.includes('ends on the 25th, date only'), titles.join(' | '))
    assert.ok(titles.includes('ends on the 25th'), titles.join(' | '))
  })

  await check('00:00 on the 26th in Phnom Penh: both 25th ends are over and the 26th strip is up', async () => {
    const titles = await visibleAt('2026-09-25T17:00:00.000Z')
    assert.ok(!titles.includes('ends on the 25th, date only'), titles.join(' | '))
    assert.ok(!titles.includes('ends on the 25th'), titles.join(' | '))
    assert.ok(titles.includes('starts on the 26th'), titles.join(' | '))
  })

  await check('undated and blank-dated strips always show, a switched-off one never does, order is kept', async () => {
    for (const iso of ['2026-09-24T17:30:00.000Z', '2026-09-25T17:00:00.000Z']) {
      const titles = await visibleAt(iso)
      assert.ok(titles.includes('no dates') && titles.includes('blank bounds'), titles.join(' | '))
      assert.ok(!titles.includes('switched off'), titles.join(' | '))
      assert.ok(titles.indexOf('no dates') < titles.indexOf('blank bounds'), 'sort_order order')
    }
  })

  console.log(`\nALL ${checks} CHECKS PASSED`)
})().catch((error) => { console.error(error); process.exit(1) })
