'use strict'
// P2.8 (6.0.1046): zero full phone numbers reach an account without `contacts_full_phone`, on EVERY route.
//
// Drives the REAL Worker under Miniflare (every middleware, route and lib, bundled with esbuild) on a database that holds
// synthetic people with phones in every place the app keeps one (customers and their Contact Options, a supplier, a
// delivery contact, sales with delivery snapshots, a return, audit rows, undo payloads, a contact saved under its own
// number). Every GET route the Worker registers (read from Hono's route table through a test-only probe injected into the
// in-memory bundle; src/ is untouched) is requested, with each :param filled by every seeded id, as five accounts that
// lack the grant and four that hold it. A response body is scanned as text for every fixture number in every written
// form (plain, compact, dashed, +855, 855, 00855, Khmer digits, inside JSON text inside JSON text).
//
//   - the five without the grant: zero leaks over every route and query shape (this is the leak test);
//   - positive controls: the administrator must read the numbers on a known set of routes, or a green run proves nothing;
//   - holder versus non-holder of the SAME role: they differ in nothing but the numbers (no lost function: a holder sees
//     today's output), over every route that carries a number;
//   - the cached path, both orders: a holder warms the Cache API first and an account without the grant must read masked
//     numbers from its own entry (proved by a stale-name probe that shows the two entries are separate), and the other
//     way round: an account without the grant warms first and the holder still reads in full.
//
// Variants (environment), used by test-phone-leak-mutants-native.cjs:
//   PHONE_WORLD=egress-off   the c.json projection (lib/phoneMaskMiddleware.ts) is removed, so the cache layer is the only wall
//   PHONE_MODE=cache         only the cached-path checks
//   PHONE_MUTANT=<name>      one defect applied to a source file in the in-memory bundle (src/ is untouched)
//   PHONE_CRAWL_FILTER=<s>   only routes containing <s>
//
// Must be RED on cbff55c8e (no masking anywhere) and GREEN on the slice.
//
// Run (from cloudflare/): node scripts/test-phone-leak-crawl-native.cjs
const { createReporter } = require('./harness/real_worker_world.cjs')
const { bootPhoneWorld, PHONES, leaksIn, snippetOf, variantsOf } = require('./harness/phone_leak_world.cjs')

const REQUEST_TIMEOUT_MS = 30000
const PARAM_VALUES = (ids) => [...new Set([1, 2, 3, 4, 5, 6, ids.customer, ids.sale, ids.return])].map(String)

const MIDDLEWARE_LINE = "app.use('/api/*', phoneMaskResponses)"
const sub = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.replace(needle, replacement)
}
// Each mutant: the file it rewrites and how. `cacheOnly` ones run in the egress-off world (the cache layer is the only wall).
const MUTANTS = {
  'no-egress-projection': { file: 'index.ts', rewrite: sub(MIDDLEWARE_LINE, '') },
  'one-route-bypasses-c-json': {
    file: 'routes/sales.ts',
    rewrite: sub("return c.json({ items: rows })\n", "return new Response(JSON.stringify({ items: rows }), { headers: { 'content-type': 'application/json' } })\n"),
    alt: sub("return c.json({ items: rows })\r\n", "return new Response(JSON.stringify({ items: rows }), { headers: { 'content-type': 'application/json' } })\r\n"),
    filter: 'api/sales/delivery-options',
  },
  'cache-shared-key': { file: 'lib/phoneCache.ts', rewrite: sub('phoneCacheVariant(user))', 'undefined)'), world: 'egress-off', mode: 'cache' },
  'cache-stores-full-body': { file: 'lib/phoneCache.ts', rewrite: sub('async () => projectPhones(await producer(), user)', 'async () => producer()'), world: 'egress-off', mode: 'cache' },
  'cache-variant-ignores-grant': { file: 'lib/phoneCache.ts', rewrite: sub("canSeeFullPhones(user) ? 'phone-full' : 'phone-masked'", "'phone-full'"), world: 'egress-off', mode: 'cache' },
}

async function main() {
  const mutantName = process.env.PHONE_MUTANT || ''
  const mutant = mutantName ? MUTANTS[mutantName] : null
  if (mutantName && !mutant) throw new Error(`unknown PHONE_MUTANT ${mutantName}`)
  const egressOff = process.env.PHONE_WORLD === 'egress-off'
  const cacheMode = process.env.PHONE_MODE === 'cache'
  const only = process.env.PHONE_CRAWL_FILTER || ''

  const world = await bootPhoneWorld({
    extraTransform: egressOff ? sub(MIDDLEWARE_LINE, '') : undefined,
    transformSources: mutant ? (file, source) => {
      if (file !== mutant.file) return undefined
      try { return mutant.rewrite(source) } catch (error) { if (mutant.alt) return mutant.alt(source); throw error }
    } : undefined,
  })
  const { check, finish } = createReporter()
  const ids = world.ids

  async function get(route, as) {
    const request = world.api('GET', route, undefined, { as })
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS) })
    const response = await Promise.race([request, timeout])
    clearTimeout(timer)
    return response || { status: 0, text: '', json: null }
  }

  const results = {}
  const phoneQuery = encodeURIComponent(PHONES.customer)
  let routes = []

  if (!cacheMode) {
    const table = (await world.api('GET', '/api/__routes')).json || []
    const staticGets = [...new Set(table.filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.startsWith('/api/__') && !r.path.includes('*') && !r.path.includes(':')).map((r) => r.path))].sort()
    const paramGets = [...new Set(table.filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.includes('*') && r.path.includes(':')).map((r) => r.path))].sort()
    const concreteParamRoutes = []
    for (const route of paramGets) {
      if (route.startsWith('/api/portal/')) continue
      const values = route.includes(':membershipNumber') ? ['LC-P28-1', 'LC-P28-2', 'LC-P28-3'] : PARAM_VALUES(ids)
      for (const value of values) concreteParamRoutes.push(route.replace(/:membershipNumber/, value).replace(/:[A-Za-z0-9_]+/g, value))
    }
    const shapes = [
      '/api/customers?fields=sales_picker', '/api/customers?fields=picker', '/api/customers?fields=names', '/api/customers?page=1&pageSize=50', '/api/customers?limit=100',
      `/api/customers?ids=${ids.customer},${ids.customer2},${ids.customerPhoneName}`, `/api/customers?search=${phoneQuery}`, `/api/customers?fields=sales_picker&search=${phoneQuery}`,
      `/api/customers?fields=sales_picker&ids=${ids.customer}`, '/api/customers?search=Fixture', '/api/customers?search=LC-P28-1',
      '/api/suppliers?fields=picker', '/api/suppliers?fields=names', '/api/suppliers?page=1&pageSize=50', `/api/suppliers?search=${encodeURIComponent(PHONES.supplier)}`,
      '/api/delivery-contacts?fields=picker', '/api/delivery-contacts?page=1&pageSize=50', `/api/delivery-contacts?search=${encodeURIComponent(PHONES.delivery)}`,
      `/api/customers/check-duplicate?name=Fixture%20Dara&phone=${phoneQuery}`, `/api/suppliers/check-duplicate?name=Fixture%20Supplies&phone=${encodeURIComponent(PHONES.supplier)}`,
      `/api/delivery-contacts/check-duplicate?name=Fixture%20Courier&phone=${encodeURIComponent(PHONES.delivery)}`,
      '/api/sales?page=1&pageSize=50', `/api/sales?search=${phoneQuery}`, `/api/sales?search=${encodeURIComponent(PHONES.saleTyped)}`, `/api/sales?customerId=${ids.customer}`,
      '/api/sales/export', '/api/returns?page=1&pageSize=50', '/api/returns/export', '/api/returns/receipt-lookup?receipt=P28-0001', '/api/returns/receipt-lookup?q=P28-0001',
      '/api/sales/create-receipt', `/api/sales/customer-report?customerId=${ids.customer}`, '/api/sales/customer-report', '/api/sales/delivery-contact-report',
      '/api/reports/grouped?groupBy=customer', '/api/reports/grouped?group=customer', '/api/reports/overview', '/api/dashboard/insight-list?kind=customers', '/api/dashboard/startup',
      '/api/system/audit-logs?limit=200', '/api/system/audit-logs?limit=200&search=Fixture', '/api/action-history?limit=200', '/api/review?status=pending', '/api/review/mine',
      '/api/notifications/summary', '/api/notifications/summary/items', '/api/auth/bootstrap', '/api/auth/me', '/api/settings', '/api/branches', '/api/users',
      '/api/customers/link-conflicts', '/api/customers/duplicates', '/api/suppliers/duplicates', '/api/delivery-contacts/duplicates',
    ]
    routes = [...new Set([...staticGets, ...concreteParamRoutes, ...shapes])].filter((route) => !only || route.includes(only))
    console.log(`crawl: ${staticGets.length} static GET routes, ${paramGets.length} parameterised (${concreteParamRoutes.length} concrete), ${shapes.length} shapes; ${routes.length} requests per account`)

    // Ids of rows other routes name (action history), then their detail routes.
    if (!only) {
      const history = await get('/api/action-history?limit=200', 'admin')
      for (const row of (history.json && (history.json.rows || history.json.items || history.json)) || []) if (row && row.id != null) routes.push(`/api/action-history/${row.id}/details`)
    }

    for (const account of [...world.accounts.allowed, ...world.accounts.denied]) {
      const out = []
      for (const route of routes) {
        const r = await get(route, account)
        out.push({ route, account, status: r.status, text: r.text, json: r.json, leaks: leaksIn(r.text) })
      }
      results[account] = out
    }

    await check('the crawl reached the surface it claims (a crawl of nothing proves nothing)', async (t) => {
      t.ok(`at least ${only ? 1 : 150} distinct routes requested (got ${routes.length})`, routes.length >= (only ? 1 : 150))
      t.ok('administrator got 200s', results.admin.filter((r) => r.status === 200).length >= (only ? 1 : 100), results.admin.filter((r) => r.status === 200).length)
      t.ok('no request timed out', Object.values(results).every((list) => list.every((r) => r.status !== 0)), Object.values(results).flat().filter((r) => r.status === 0).map((r) => `${r.account} ${r.route}`).slice(0, 5))
      t.ok('no response is a 500 for the administrator', results.admin.every((r) => r.status !== 500), results.admin.filter((r) => r.status === 500).map((r) => r.route).slice(0, 8))
    })

    const phoneBearing = new Set(results.admin.filter((r) => r.leaks.length).map((r) => r.route))
    console.log(`phone-bearing routes for the administrator (${phoneBearing.size}):\n  ${[...phoneBearing].join('\n  ')}`)
    await check('positive control: the administrator really reads the numbers on the routes that carry them', async (t) => {
      const known = only ? [] : [
        '/api/customers?fields=sales_picker', '/api/customers?fields=picker', '/api/customers?page=1&pageSize=50',
        '/api/suppliers?page=1&pageSize=50', '/api/delivery-contacts?page=1&pageSize=50', '/api/sales?page=1&pageSize=50', '/api/system/audit-logs?limit=200',
      ]
      for (const route of known) t.ok(`${route} carries a fixture number for the administrator`, phoneBearing.has(route), results.admin.find((r) => r.route === route)?.status)
      t.ok(`at least ${only ? 1 : 15} routes carry numbers (the leak surface is wide)`, phoneBearing.size >= (only ? 1 : 15), phoneBearing.size)
    })

    for (const account of world.accounts.denied) {
      await check(`ZERO full numbers for ${account} (no grant) on every route`, async (t) => {
        const leaked = results[account].filter((r) => r.leaks.filter((key) => !(account === 'cashier' && key === 'user')).length)
        t.eq(`${leaked.length} of ${results[account].length} responses leak a number; first ones`, leaked.slice(0, 12).map((r) => `${r.route} -> ${r.leaks.join(',')} :: ${snippetOf(r.text)}`), [])
      })
    }

    // A holder and a non-holder on the SAME role differ in nothing but the grant. Every leaf that holds a fixture number for the
    // holder must hold exactly that number's mask for the other; any other leaf that differs is volatile and ignored.
    const refMask = (digits) => { const keep = Math.max(0, Math.min(3, Math.floor((digits.length - 3) / 2))); return keep ? `${digits.slice(0, keep)} *** ${digits.slice(-keep)}` : '***' }
    const nationalOf = (phone) => phone.replace(/\D/g, '').replace(/^855/, '0')
    // The mask of the number as written, and of its zero-stripped digits (phone_key is that, and it is masked too).
    const masksOfFixture = (phone) => [refMask(nationalOf(phone)), refMask(nationalOf(phone).replace(/^0/, ''))]
    const entries = Object.entries(PHONES).filter(([key]) => key !== 'portal')
    const tokenize = (text, side) => {
      let out = String(text)
      for (const [key, phone] of entries) {
        if (side === 'full') for (const re of variantsOf(phone)) out = out.replace(new RegExp(re.source, 'g'), `#${key}#`)
        else for (const mask of masksOfFixture(phone)) out = out.split(mask).join(`#${key}#`)
      }
      return out
    }
    // search_normalized is the server's internal search helper text: it is masked as running text and nothing displays it.
    const compareLeaves = (a, b, path, bad) => {
      if (path.endsWith('search_normalized')) return
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compareLeaves(a[key], b[key], `${path}.${key}`, bad)
      } else if (a !== b && (String(a).includes('#') || String(b).includes('#'))) bad.push(`${path}: holder=${String(a).slice(0, 90)} | other=${String(b).slice(0, 90)}`)
    }
    if (!only) {
      for (const [holder, other] of [['cashier_granted', 'cashier'], ['person_granted', 'cashier'], ['manager_granted', 'manager'], ['manager_granted', 'person_revoked']]) {
        await check(`${holder} (grant) and ${other} (none) differ ONLY in the numbers: the holder keeps today's output`, async (t) => {
          const bad = []
          let seen = 0
          for (const mine of results[holder]) {
            const theirs = results[other].find((r) => r.route === mine.route)
            if (!theirs || mine.status !== 200 || theirs.status !== 200 || !mine.json) continue
            const a = tokenize(mine.text, 'full'), b = tokenize(theirs.text, 'masked')
            try {
              const before = bad.length
              compareLeaves(JSON.parse(a), JSON.parse(b), mine.route, bad)
              if (a.includes('#') && bad.length === before) seen += 1
            } catch { /* not JSON */ }
          }
          t.eq('leaves where the holder and the other account disagree on a number; first ones', bad.slice(0, 8), [])
          t.ok('the comparison saw at least 10 routes that carry numbers (not a vacuous pass)', seen >= 10, seen)
        })
      }

      await check('masked output keeps the first and last three digits and nothing between', async (t) => {
        const r = await get(`/api/customers?fields=sales_picker&ids=${ids.customer}`, 'cashier')
        t.eq('status', r.status, 200)
        t.ok('shows 087 *** 321', /087 \*\*\* 321/.test(r.text), r.text.slice(0, 300))
        t.ok('the other option shows 098 *** 222', /098 \*\*\* 222/.test(r.text), r.text.slice(0, 600))
        t.ok('the +855 option shows 097 *** 333', /097 \*\*\* 333/.test(r.text), r.text.slice(0, 900))
        t.ok('names, membership and ids are untouched', /Fixture Dara/.test(r.text) && /LC-P28-1/.test(r.text))
      })
    }
  }

  // The cached path. Each shape below is read through the Cache API. Separate entries are proved by changing a name straight in
  // the database (no version bump, so a hit stays stale): the holder keeps reading the OLD name from its own entry while the
  // other account's first read is a miss that builds its own entry from the NEW name, and its second read is a hit.
  if (!only || only === 'cache') {
    const CACHED = [
      ['customers list', '/api/customers?page=1&pageSize=50', 'customers', () => ids.customer, 'Fixture Dara'],
      ['customers picker', '/api/customers?fields=picker', 'customers', () => ids.customer, 'Fixture Dara'],
      ['suppliers list', '/api/suppliers?page=1&pageSize=50', 'suppliers', () => ids.supplier, 'Fixture Supplies'],
      ['delivery contacts list', '/api/delivery-contacts?page=1&pageSize=50', 'delivery_contacts', () => ids.delivery, 'Fixture Courier'],
    ]
    for (const [label, base, table, idOf, name] of CACHED) {
      const rename = (value) => world.run(`UPDATE ${table} SET name = ? WHERE id = ?`, value, idOf())
      await check(`cached path, holder warms first: ${label} is masked for the account without the grant, and the entries are separate`, async (t) => {
        const route = `${base}${base.includes('?') ? '&' : '?'}cb=holderfirst`
        const warm = await get(route, 'manager_granted')
        t.ok('the holder reads a fixture number', leaksIn(warm.text).length > 0, warm.status)
        await rename(`${name} v2`)
        const holderAgain = await get(route, 'manager_granted')
        t.ok('the holder is served its own entry (the old name: a hit)', holderAgain.text.includes(name) && !holderAgain.text.includes(`${name} v2`), holderAgain.text.slice(0, 160))
        const other = await get(route, 'manager')
        t.eq("the other account is not served the holder's body", leaksIn(other.text), [])
        t.ok('the other account built its own entry from the current data (the new name)', other.text.includes(`${name} v2`), other.text.slice(0, 160))
        const otherAgain = await get(route, 'manager')
        t.eq('and its entry is masked on the second read as well', leaksIn(otherAgain.text), [])
        t.ok('a masked mark is present', /\d \*\*\* \d/.test(otherAgain.text), otherAgain.text.slice(0, 160))
        await rename(name)
      })
      await check(`cached path, the other account warms first: ${label} still reads in full for the holder`, async (t) => {
        const route = `${base}${base.includes('?') ? '&' : '?'}cb=otherfirst`
        const first = await get(route, 'manager')
        t.eq('the account without the grant reads no number', leaksIn(first.text), [])
        const holder = await get(route, 'manager_granted')
        t.ok('the holder reads the numbers in full from an entry the other account never wrote into', leaksIn(holder.text).length > 0, holder.text.slice(0, 160))
        const again = await get(route, 'manager')
        t.eq('and the account without the grant still reads none', leaksIn(again.text), [])
      })
    }
    await check('cached path: the Sales list entry is split by the grant as well', async (t) => {
      const route = '/api/sales?page=1&pageSize=50&cb=sales'
      const holder = await get(route, 'manager_granted')
      const other = await get(route, 'manager')
      t.ok('the holder reads sale numbers', leaksIn(holder.text).length > 0, holder.status)
      t.eq('the other account reads none', leaksIn(other.text), [])
    })
  }

  finish(`phone leak crawl${mutantName ? ` [mutant ${mutantName}]` : ''}${egressOff ? ' [egress off]' : ''}${cacheMode ? ' [cache]' : ''}`)
  await world.dispose()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
