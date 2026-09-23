// S1 (owner, 23 Sep 2026): "also make sure when entering shift, i can search
// the cashier, or id."
//
// The shift list is paged by the Worker, so a search that only filtered the
// rows already on screen would miss every shift on another page. The search
// therefore travels to GET /api/shifts as `q` (the Worker matches cashier name
// or shift ID before paging). This pins the transport half through the REAL
// listShifts and the REAL cached transport, with only fetch replaced:
//   - `q` is sent trimmed, and not at all when blank;
//   - the search is part of the cache key, so one search's cached page can
//     never answer another search (or the unsearched list);
//   - the input limit matches the Worker's 80-character bound.
//
// Run: node tests/shiftSearchTransport.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

const storage = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, String(v)), removeItem: (k: string) => values.delete(k) } }

async function withTransport(run: (tools: { transport: typeof import('../src/api/shiftTransport.ts'); urls: URL[] }) => Promise<void>) {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  globalThis.window = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() }) as any
  const http = await import('../src/api/http.ts')
  const transport = await import('../src/api/shiftTransport.ts')
  const previousUrl = http.getSyncServerUrl()
  http.setSyncServerUrl('https://shift-search.test'); http.cacheClearAll(); http.__resetApiHealthForTests()
  const urls: URL[] = []
  // The fake Worker answers with rows named after the search it received, so a
  // cached page from another search is visible in the RESULT, not only in the
  // request count.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    urls.push(url)
    const q = url.searchParams.get('q')
    const shifts = [{ id: urls.length, shift_code: `S-20260922-0807-${q ?? 'all'}`, user_name: q ?? 'everyone', business_date: '2026-09-22', opened_at: '2026-09-22T00:00:00Z', closed_at: null }]
    return new Response(JSON.stringify({ shifts, scope: 'all', page: 1, page_size: 20, total: 1 }), { headers: { 'Content-Type': 'application/json' } })
  }
  try { await run({ transport, urls }) } finally {
    http.cacheClearAll(); http.setSyncServerUrl(previousUrl); globalThis.window = previousWindow; globalThis.fetch = previousFetch
  }
}

test('a search reaches the Worker as a trimmed q and a blank search sends none', async () => {
  await withTransport(async ({ transport, urls }) => {
    await transport.listShifts({ branchId: 1, page: 1, pageSize: 20, q: '  Sokha  ' })
    assert.equal(urls.at(-1)!.pathname, '/api/shifts')
    assert.equal(urls.at(-1)!.searchParams.get('q'), 'Sokha', 'the typed cashier is sent, without the padding')
    assert.equal(urls.at(-1)!.searchParams.get('page'), '1', 'the search composes with paging')
    assert.equal(urls.at(-1)!.searchParams.get('branch_id'), '1', 'the search composes with the branch')

    await transport.listShifts({ branchId: 1, page: 1, pageSize: 20, q: 'S-20260922-0807' })
    assert.equal(urls.at(-1)!.searchParams.get('q'), 'S-20260922-0807', 'a shift ID is sent as typed')

    for (const blank of ['', '   ', undefined]) {
      await transport.listShifts({ branchId: 2, page: 1, pageSize: 20, q: blank }, { fresh: true })
      assert.equal(urls.at(-1)!.searchParams.has('q'), false, `a blank search (${JSON.stringify(blank)}) sends no q at all`)
    }
  })
})

test('each search is its own cached page and never answers another search', async () => {
  await withTransport(async ({ transport, urls }) => {
    const filters = { branchId: 1, page: 1, pageSize: 20 }
    const sokha = await transport.listShifts({ ...filters, q: 'sokha' })
    assert.equal(sokha.shifts[0].user_name, 'sokha')
    assert.equal(urls.length, 1)

    // Same search again: the cache is genuinely warm (the positive control
    // that proves the next assertions are about the KEY, not a cold cache).
    const again = await transport.listShifts({ ...filters, q: ' sokha ' })
    assert.equal(urls.length, 1, 'the same search, padded or not, reuses its cached page')
    assert.equal(again.shifts[0].user_name, 'sokha')

    const dara = await transport.listShifts({ ...filters, q: 'dara' })
    assert.equal(urls.length, 2, 'a different search is a different request')
    assert.equal(dara.shifts[0].user_name, 'dara', 'the cached "sokha" page must not answer "dara"')

    const all = await transport.listShifts(filters)
    assert.equal(urls.length, 3, 'clearing the search reads the unsearched list')
    assert.equal(all.shifts[0].user_name, 'everyone', 'a searched page must not answer the unsearched list')

    // And the other way round: the unsearched page, now cached, must not
    // answer a search either.
    const back = await transport.listShifts({ ...filters, q: 'sokha' })
    assert.equal(back.shifts[0].user_name, 'sokha', 'a search is never served the unsearched page')
  })
})

test('the search limit is the Worker bound, shared by both search boxes', async () => {
  const transport = await import('../src/api/shiftTransport.ts')
  assert.equal(transport.SHIFT_SEARCH_MAX_LENGTH, 80, 'GET /api/shifts answers 400 past 80 characters')
  assert.equal(transport.SHIFT_SEARCH_DEBOUNCE_MS, 250)
})
