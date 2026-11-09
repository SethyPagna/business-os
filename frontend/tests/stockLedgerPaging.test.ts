import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { StockLedgerPager, walkLedgerForExport, PAGE_TTL_MS, PREFETCH_AHEAD } from '../src/components/products/stockLedgerPaging.ts'
import type { QueryParams } from '../src/api/query.ts'

// INV-B S8: the Stock Changes list pages by cursor when the Worker's read switch ledger_keyset is ON, and by page number otherwise. Against a fake server that
// behaves as the Worker does (lib/stockLedgerKeyset.ts: page 1 carries total + summary + next_cursor; a cursor page carries rows and the next cursor only), this
// pins what the screen needs: paging sends the cursor and no COUNT after page 1; the total (and so the page count) stays true; Previous costs nothing;
// a read-ahead after the first Next; a write re-reads with its totals; a server that does not page by cursor is asked exactly as before.

const TOTAL = 230
type Row = { id: number }
const rowsOf = (page: number, size: number): Row[] => Array.from({ length: Math.max(0, Math.min(size, TOTAL - (page - 1) * size)) }, (_, i) => ({ id: TOTAL - ((page - 1) * size + i) }))

function server(mode: 'keyset' | 'offset', options: { cap?: number } = {}) {
  const sent: QueryParams[] = []
  const state = { mode, failCursorOnce: false, ids: new Map<string, { page: number; branchId: unknown }>() }
  // a cursor belongs to the scope that was asked when it was handed out
  const token = (page: number, branchId: unknown) => { const t = `cur-${page}-${Math.random().toString(36).slice(2, 8)}`; state.ids.set(t, { page, branchId }); return t }
  const fetch = async (params: QueryParams): Promise<unknown> => {
    sent.push({ ...params })
    const size = Math.min(Number(params.pageSize), options.cap ?? 1000)
    const wantsTotals = !params.cursor || params.totals === 1
    if (state.mode === 'offset' || !('cursor' in params) && false) {
      const page = Number(params.page)
      return { items: rowsOf(page, size), total: TOTAL, page, pageSize: size, totalPages: Math.ceil(TOTAL / size), summary: { inCount: 1, outCount: 2, inQty: 3, outQty: 4, total: TOTAL } }
    }
    let page = Number(params.page)
    if (params.cursor) {
      if (state.failCursorOnce) { state.failCursorOnce = false; throw Object.assign(new Error('invalid_cursor'), { code: 'invalid_cursor', status: 400 }) }
      const from = state.ids.get(String(params.cursor))
      assert.ok(from, 'the cursor was handed out by this server')
      assert.equal(from.page, page, 'the cursor is the one that starts the page asked for')
      assert.equal(from.branchId, params.branchId, 'and was handed out for the scope being asked')
    }
    const hasMore = page * size < TOTAL
    return {
      items: rowsOf(page, size), page, pageSize: size, view: 'all',
      ...(wantsTotals ? { total: TOTAL, totalPages: Math.ceil(TOTAL / size), summary: { inCount: 1, outCount: 2, inQty: 3, outQty: 4, total: TOTAL } } : {}),
      next_cursor: hasMore ? token(page + 1, params.branchId) : null,
    }
  }
  return { fetch, sent, state }
}
const SCOPE: QueryParams = { view: 'all', branchId: 1 }
const SIZE = 25
const LAST_PAGE = Math.ceil(TOTAL / SIZE)
const clock = (start = 1_000_000) => { let t = start; return { now: () => t, tick: (ms: number) => { t += ms } } }

// ---- ON: page 1 asks for totals, every later page asks by cursor and never for the count --------------------------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  const one = await pager.load(SCOPE, 1, SIZE)
  assert.deepEqual(s.sent[0], { ...SCOPE, page: 1, pageSize: SIZE }, 'page 1 is the plain first request: no cursor, no totals flag')
  assert.equal(one.total, TOTAL); assert.equal(one.summary?.total, TOTAL); assert.equal(one.items.length, SIZE); assert.equal(pager.keyset, true)
  const two = await pager.load(SCOPE, 2, SIZE)
  assert.equal(s.sent.length, 2)
  assert.ok(typeof s.sent[1].cursor === 'string', 'page 2 carries the cursor page 1 handed out')
  assert.equal('totals' in s.sent[1], false, 'and does not ask for the count again')
  assert.equal(two.total, TOTAL, 'the total (so the page count) is the one page 1 brought'); assert.equal(two.summary?.total, TOTAL)
  assert.equal(Math.ceil(two.total / SIZE), LAST_PAGE)
  assert.deepEqual(two.items, rowsOf(2, SIZE))
  for (let page = 3; page <= LAST_PAGE; page += 1) { const r = await pager.load(SCOPE, page, SIZE); assert.equal(r.total, TOTAL); assert.deepEqual(r.items, rowsOf(page, SIZE)) }
  assert.equal(s.sent.length, LAST_PAGE, 'one request per page, walking forward')
  assert.deepEqual(s.sent.filter((p) => 'totals' in p || 'summary' in p), [], 'no request after page 1 asked for totals')
  assert.equal(s.sent.slice(1).every((p) => typeof p.cursor === 'string'), true, 'every later request carries a cursor')
  assert.equal((await pager.load(SCOPE, LAST_PAGE, SIZE)).items.length, TOTAL - (LAST_PAGE - 1) * SIZE, 'the last page is short')
}

// ---- Previous costs nothing inside the ttl, one cursor request after it ----------------------------------------------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await pager.load(SCOPE, 1, SIZE); await pager.load(SCOPE, 2, SIZE); await pager.load(SCOPE, 3, SIZE)
  const before = s.sent.length
  const back = await pager.load(SCOPE, 2, SIZE)
  assert.equal(s.sent.length, before, 'Previous inside the ttl is shown from memory'); assert.equal(back.cached, true); assert.deepEqual(back.items, rowsOf(2, SIZE)); assert.equal(back.total, TOTAL)
  c.tick(PAGE_TTL_MS + 1)
  const stale = await pager.load(SCOPE, 2, SIZE)
  assert.equal(s.sent.length, before + 1, 'after the ttl it is read again'); assert.ok(typeof s.sent.at(-1)!.cursor === 'string', 'by its cursor'); assert.equal('totals' in s.sent.at(-1)!, false)
  assert.equal(stale.cached, false); assert.equal(stale.total, TOTAL)
}

// ---- read-ahead: a first Next starts it; it reads PREFETCH_AHEAD pages by cursor and stops at the last page -----------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await pager.load(SCOPE, 1, SIZE)
  assert.equal(s.sent.length, 1, 'opening the list reads the first page and nothing ahead (prefetch is the screen\'s call, after a first Next)')
  await pager.load(SCOPE, 2, SIZE)
  await pager.prefetch(SCOPE, 2)
  assert.equal(PREFETCH_AHEAD, 2)
  assert.deepEqual(s.sent.slice(2).map((p) => p.page), [3, 4], 'two pages ahead of the one on screen')
  assert.equal(s.sent.slice(2).every((p) => typeof p.cursor === 'string' && !('totals' in p)), true)
  const before = s.sent.length
  const next = await pager.load(SCOPE, 3, SIZE)
  assert.equal(next.cached, true); assert.equal(s.sent.length, before, 'the next Next is already here')
  await pager.prefetch(SCOPE, 3)
  assert.deepEqual(s.sent.slice(before).map((p) => p.page), [5], 'only the page that is missing is read ahead')
  await pager.load(SCOPE, LAST_PAGE, SIZE)
  const at = s.sent.length
  await pager.prefetch(SCOPE, LAST_PAGE)
  assert.equal(s.sent.length, at, 'nothing is read past the last page')
}

// ---- a changed scope starts over; a write re-reads the position with its totals --------------------------------------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await pager.load(SCOPE, 1, SIZE); await pager.load(SCOPE, 2, SIZE); await pager.load(SCOPE, 3, SIZE)
  const other = { ...SCOPE, branchId: 2 }
  await pager.load(other, 1, SIZE)
  assert.deepEqual(s.sent.at(-1), { ...other, page: 1, pageSize: SIZE }, 'a new scope asks for page 1 with no cursor, and gets its own total')
  await pager.load(SCOPE, 1, SIZE); await pager.load(SCOPE, 2, SIZE); await pager.load(SCOPE, 3, SIZE)
  const mark = s.sent.length
  const fresh = await pager.load(SCOPE, 3, SIZE, { fresh: true })
  assert.equal(s.sent.length, mark + 1)
  assert.ok(typeof s.sent.at(-1)!.cursor === 'string', 'the page is read again by the cursor it had'); assert.equal(s.sent.at(-1)!.totals, 1, 'with the totals the write may have moved')
  assert.equal(fresh.total, TOTAL); assert.equal(fresh.cached, false)
  const nextAfter = await pager.load(SCOPE, 4, SIZE)
  assert.equal(nextAfter.cached, false); assert.ok(typeof s.sent.at(-1)!.cursor === 'string', 'and the walk goes on by cursor')
  // a fresh read of a page whose cursor was never seen asks by number (the server answers it with the totals)
  const lost = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await lost.load(SCOPE, 5, SIZE, { fresh: true })
  assert.deepEqual(s.sent.at(-1), { ...SCOPE, page: 5, pageSize: SIZE })
}

// ---- a cursor the server refuses starts that page again by number; a write that outruns an answer is dropped ------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await pager.load(SCOPE, 1, SIZE)
  s.state.failCursorOnce = true
  const two = await pager.load(SCOPE, 2, SIZE)
  assert.deepEqual(two.items, rowsOf(2, SIZE)); assert.equal(two.total, TOTAL)
  assert.equal('cursor' in s.sent.at(-1)!, false, 'the retry is by page number')
  // an answer that arrives after the scope changed is not applied
  const slow = server('keyset'); let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const racing = new StockLedgerPager<Row>(async (p) => { if (p.branchId === 1 && p.page === 1) await gate; return slow.fetch(p) }, { now: c.now })
  const late = racing.load({ ...SCOPE, branchId: 1 }, 1, SIZE)
  await racing.load({ ...SCOPE, branchId: 2 }, 1, SIZE)
  release(); await late
  const current = await racing.load({ ...SCOPE, branchId: 2 }, 2, SIZE)
  assert.equal(current.total, TOTAL)
  assert.ok(typeof slow.sent.at(-1)!.cursor === 'string', 'the scope that is on screen kept its own cursors')
}

// ---- OFF (or an older Worker): paged by number exactly as before, the total on every page, no cursor, no read-ahead --------------------------------
{
  const s = server('offset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  for (let page = 1; page <= 4; page += 1) {
    const r = await pager.load(SCOPE, page, SIZE)
    assert.deepEqual(s.sent.at(-1), { ...SCOPE, page, pageSize: SIZE }, `page ${page}: the same params the screen always sent`)
    assert.equal(r.total, TOTAL); assert.deepEqual(r.items, rowsOf(page, SIZE))
  }
  assert.equal(pager.keyset, false)
  const at = s.sent.length
  await pager.prefetch(SCOPE, 4)
  assert.equal(s.sent.length, at, 'no read-ahead where every page carries its own COUNT')
}

// ---- the switch goes OFF under an open tab: the first answer that disagrees makes the pager carry on by number -------------------------------------
{
  const s = server('keyset'); const c = clock()
  const pager = new StockLedgerPager<Row>(s.fetch, { now: c.now })
  await pager.load(SCOPE, 1, SIZE); await pager.load(SCOPE, 2, SIZE)
  s.state.mode = 'offset'
  c.tick(PAGE_TTL_MS + 1)
  const three = await pager.load(SCOPE, 3, SIZE)
  assert.deepEqual(three.items, rowsOf(3, SIZE)); assert.equal(three.total, TOTAL)
  assert.equal(pager.keyset, false)
  await pager.load(SCOPE, 4, SIZE)
  assert.deepEqual(s.sent.at(-1), { ...SCOPE, page: 4, pageSize: SIZE }, 'and the next page is asked by number')
}

// ---- the export: page size is the server's answer; cursors where handed out; the cap holds ---------------------------------------------------------
{
  const big = 1234
  const make = (mode: 'keyset' | 'offset', cap: number) => {
    const sent: QueryParams[] = []; const ids = new Map<string, number>()
    const fetch = async (p: QueryParams) => {
      sent.push({ ...p })
      const size = Math.min(Number(p.pageSize), cap); const page = Number(p.page)
      const items = Array.from({ length: Math.max(0, Math.min(size, big - (page - 1) * size)) }, (_, i) => ({ id: (page - 1) * size + i + 1 }))
      if (p.cursor) assert.equal(ids.get(String(p.cursor)), page)
      const more = page * size < big
      const tok = `x-${page + 1}`; if (more) ids.set(tok, page + 1)
      return { items, total: page === 1 || mode === 'offset' ? big : undefined, pageSize: size, ...(mode === 'keyset' ? { next_cursor: more ? tok : null } : {}) }
    }
    return { fetch, sent }
  }
  const free = make('keyset', 500)
  const out = await walkLedgerForExport<{ id: number }>(free.fetch, { view: 'all' }, 1000, 10_000)
  assert.equal(out.rows.length, big); assert.equal(out.grandTotal, big)
  assert.deepEqual(out.rows.map((r) => r.id), Array.from({ length: big }, (_, i) => i + 1), 'every row, once, in order, with a 500-row page')
  assert.equal(free.sent.length, 3, 'three pages of at most 500 (the server\'s answer decides, not the 1,000 asked)')
  assert.equal(free.sent.every((p) => p.pageSize === 1000), true, 'the client always asks for the biggest page')
  assert.equal('cursor' in free.sent[0], false); assert.equal(free.sent.slice(1).every((p) => typeof p.cursor === 'string'), true)
  const paid = make('keyset', 1000)
  assert.equal((await walkLedgerForExport(paid.fetch, {}, 1000, 10_000)).rows.length, big); assert.equal(paid.sent.length, 2)
  const byNumber = make('offset', 1000)
  assert.equal((await walkLedgerForExport(byNumber.fetch, {}, 1000, 10_000)).rows.length, big)
  assert.equal(byNumber.sent.every((p) => !('cursor' in p)), true, 'a server that sends no cursor is walked by page number')
  const capped = make('keyset', 500)
  const some = await walkLedgerForExport(capped.fetch, {}, 1000, 800)
  assert.equal(some.rows.length, 800, 'the export cap holds'); assert.equal(some.grandTotal, big, 'and the true total is still reported, so the screen can say it was capped')
}

// ---- the screen wires the pager, and reads fresh after its own writes ---------------------------------------------------------------------------------
{
  const read = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8').replace(/\r\n/g, '\n')
  const section = read('src/components/products/StockChangeSection.tsx')
  assert.match(section, /new StockLedgerPager<LedgerRow>\(getStockLedger\)/, 'the list pages through the pager')
  assert.match(section, /pager\.load\(scope, page, PAGE_SIZE, options\)/)
  assert.match(section, /if \(movedForward\) void pager\.prefetch\(scope, page\)/, 'read-ahead starts after a step forward, not on open')
  assert.equal((section.match(/void load\(\{ fresh: true \}\)/g) || []).length, 4, 'a revert, a reason edit, a stock-in and Retry read fresh')
  assert.equal((section.match(/void load\(\)/g) || []).length, 1, 'only the effect reads with the memory')
  assert.match(section, /walkLedgerForExport<LedgerRow>\(getStockLedger,/, 'the export walks through the shared walker')
  assert.doesNotMatch(section, /const pageSize = 1000/, 'no export page size literal left in the screen (the server decides)')
  assert.doesNotMatch(section, /await getStockLedger\(\{\s*view,/, 'no direct page loop left')
}

console.log('stockLedgerPaging passed')
