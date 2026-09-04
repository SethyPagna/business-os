// Guard: almost nothing may call the CUSTOMERS LIST transport.
//
// GET /api/customers with no narrowing query returns every column of every
// customer row plus a per-row loyalty aggregation (cloudflare/src/routes/
// contacts.ts's withPoints) -- measured at ~2.4 MB / ~4 s against a
// 5,000-row table, the slowest request in the system, and effectively
// uncacheable during business hours because that list's cache version
// includes the `sales` namespace, so every till transaction turns it over.
// Production logs (2026-09-03) showed several of them in flight around a
// 70-second stall.
//
// The rule this file enforces: only the Contacts page (which IS the paged
// customers list) and the POS customer picker (a debounced, page-capped
// typeahead plus a bounded `ids=` read) may touch that transport at all,
// and neither may ask for the list unfiltered. Any other component that
// needs a customer either has its id already (use `ids=`) or wants a
// search (use the picker's pattern) -- a whole-table download is never the
// answer, and this test fails the moment one reappears.
//
// The app-level offline mirror in src/api/offlineSnapshotTransport.ts is
// the one remaining unfiltered reader (the offline copy has to come from
// somewhere); it is checked here too, so its long-interval guard cannot be
// quietly dropped back onto the five-minute maintenance loop.
//
// Run: node tests/customerListTransportCallers.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(here, '..', 'src')

// path (posix, relative to src/) -> why it is allowed
const ALLOWED = new Map<string, string>([
  [
    'components/contacts/CustomersTab.tsx',
    'the Contacts page: it IS the customers list, and reads it one page at a time',
  ],
  [
    'components/pos/POS.tsx',
    'the shared customer picker/typeahead: debounced server search, capped page size, ids= by id',
  ],
])

// The transport layer itself defines and mirrors the call; it is reviewed
// by the dedicated assertions at the bottom rather than by the sweep.
const TRANSPORT_DIR = 'api/'

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// Removes comment text while leaving string and template literals intact,
// so a prose mention of getCustomers or /api/customers never counts as a
// call site and a real call is never lost with the comment around it.
function stripComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      out += ' '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < n) {
        if (source[i] === '\\') { out += source.slice(i, i + 2); i += 2; continue }
        out += source[i]
        if (source[i] === quote) { i += 1; break }
        i += 1
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

const sources = new Map<string, string>()
for (const file of walk(srcRoot)) {
  const rel = path.relative(srcRoot, file).split(path.sep).join('/')
  sources.set(rel, stripComments(fs.readFileSync(file, 'utf8')))
}
assert.ok(sources.size > 100, `expected to scan the app source, found ${sources.size} files`)

// A file "reads the customers list" when it names the transport function or
// requests the list endpoint itself. Sub-paths (/api/customers/123,
// /api/customers/duplicates, ...) are bounded reads and are not the concern.
const LIST_ENDPOINT_FETCH = /(?:apiFetch|fetch)\(\s*(?:['"]GET['"]\s*,\s*)?[`'"]\/api\/customers(?:[`'"?])/
function readsCustomerList(source: string): boolean {
  return /\bgetCustomers\b/.test(source) || LIST_ENDPOINT_FETCH.test(source)
}

// --- who may call it ----------------------------------------------------

check('every allow-listed caller still exists and still uses the transport', () => {
  for (const [rel, why] of ALLOWED) {
    const source = sources.get(rel)
    assert.ok(source, `allow-listed file is gone -- drop it from ALLOWED: ${rel}`)
    assert.ok(
      readsCustomerList(source),
      `${rel} no longer reads the customers list (${why}) -- remove it from ALLOWED so the allow-list stays honest`,
    )
  }
})

check('no other component reads the customers list', () => {
  const offenders: string[] = []
  for (const [rel, source] of sources) {
    if (ALLOWED.has(rel)) continue
    if (rel.startsWith(TRANSPORT_DIR)) continue
    if (readsCustomerList(source)) offenders.push(rel)
  }
  assert.deepEqual(
    offenders, [],
    'these files call the customers list transport but are not allowed to. Use a narrowed read instead'
    + ' -- ids= for contacts already known by id (cloudflare/src/lib/contactIds.ts), or the POS picker\'s'
    + ` debounced page-capped search for a lookup:\n  ${offenders.join('\n  ')}`,
  )
})

// --- how the allowed callers call it ------------------------------------

// Returns the source text of each argument list for `name(...)`.
function callArguments(source: string, name: string): string[] {
  const calls: string[] = []
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g')
  let match: RegExpExecArray | null = pattern.exec(source)
  while (match) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      i += 1
    }
    calls.push(source.slice(start, i - 1))
    match = pattern.exec(source)
  }
  return calls
}

check('no allow-listed caller asks for the list unfiltered', () => {
  for (const rel of ALLOWED.keys()) {
    const source = sources.get(rel) as string
    const calls = callArguments(source, 'getCustomers')
    assert.ok(calls.length > 0, `${rel}: expected at least one getCustomers call site`)
    for (const args of calls) {
      const trimmed = args.trim()
      assert.ok(
        trimmed && !/^\{\s*\}$/.test(trimmed),
        `${rel}: getCustomers(${trimmed}) requests the whole customer table -- pass ids, search or page/pageSize`,
      )
    }
  }
})

const pos = sources.get('components/pos/POS.tsx') as string

check('the POS picker searches server-side, debounced, at a short page size', () => {
  const pageSize = /POS_CUSTOMER_PAGE_SIZE\s*=\s*(\d+)/.exec(pos)
  assert.ok(pageSize, 'POS.tsx should define POS_CUSTOMER_PAGE_SIZE')
  assert.ok(
    Number(pageSize[1]) > 0 && Number(pageSize[1]) <= 50,
    `POS customer page size must stay <= 50, found ${pageSize[1]}`,
  )
  const debounce = /POS_CUSTOMER_SEARCH_DEBOUNCE_MS\s*=\s*(\d+)/.exec(pos)
  assert.ok(debounce, 'POS.tsx should debounce the customer search')
  assert.ok(
    Number(debounce[1]) >= 100 && Number(debounce[1]) <= 1000,
    `POS customer search debounce must stay between 100ms and 1000ms, found ${debounce[1]}`,
  )
  assert.ok(
    /getCustomers\(\{[\s\S]*?pageSize:\s*POS_CUSTOMER_PAGE_SIZE/.test(pos),
    'the POS search read must send the capped pageSize',
  )
  assert.ok(
    /getCustomers\(\{\s*ids:/.test(pos),
    'the POS by-id read must use the ids= filter, not a list scan',
  )
})

check('the POS by-id read keeps only the ids it asked for', () => {
  // Both by-id call sites destructure `[0]` off this helper, so a
  // non-narrow answer does not merely waste bytes -- it puts the WRONG
  // customer on the sale. Two real ways the answer comes back wide:
  // contactReadTransport.ts's failure path falls back to the whole local
  // mirror, and a Worker that predates the `ids=` filter ignores the param
  // and returns the whole table. The client must re-check.
  const body = /async function loadPosCustomersByIds\(([\s\S]*?)\n}/.exec(pos)
  assert.ok(body, 'POS.tsx should define loadPosCustomersByIds')
  assert.match(
    body[1],
    /\.filter\(\([^)]*\) =>[\s\S]*?\bwantedSet\.has\(/,
    'loadPosCustomersByIds must filter the rows it got back down to the requested ids'
    + ' -- a fallback answer (offline mirror, or a Worker without ids=) is the whole table,'
    + ' and taking [0] of that selects a stranger',
  )
  assert.match(
    body[1],
    /new Set\(wanted\)/,
    'the id re-check must be built from the same normalized ids that were requested',
  )
})

check('the Contacts page reads one page at a time', () => {
  const contacts = sources.get('components/contacts/CustomersTab.tsx') as string
  const query = /const customerQuery = useMemo\(\(\) => \(\{([\s\S]*?)\}\)/.exec(contacts)
  assert.ok(query, 'CustomersTab.tsx should build its list query in one place')
  assert.match(query[1], /\bpage:/, 'the Contacts list query must stay paginated')
  assert.match(query[1], /\bpageSize:/, 'the Contacts list query must stay paginated')
})

// --- the offline mirror -------------------------------------------------

const snapshot = sources.get('api/offlineSnapshotTransport.ts') as string

check('the offline mirror keeps its own long refresh interval', () => {
  const interval = /OFFLINE_CUSTOMER_MIRROR_MIN_INTERVAL_MS\s*=\s*([^\n]+)/.exec(snapshot)
  assert.ok(interval, 'offlineSnapshotTransport.ts should define OFFLINE_CUSTOMER_MIRROR_MIN_INTERVAL_MS')
  const ms = Number(new Function(`return (${interval[1].replace(/_/g, '')})`)())
  assert.ok(
    Number.isFinite(ms) && ms >= 60 * 60_000,
    `the customers mirror must not ride a short loop -- expected >= 1h, found ${interval[1]}`,
  )
  assert.ok(
    /runOfflineSnapshotStep\(\s*'customers'[\s\S]*?skipWhen:\s*customerMirrorSkipReason/.test(snapshot),
    'the customers snapshot step must stay guarded by customerMirrorSkipReason',
  )
  const skipReason = /async function customerMirrorSkipReason\(([\s\S]*?)\n}/.exec(snapshot)
  assert.ok(skipReason, 'offlineSnapshotTransport.ts should define customerMirrorSkipReason')
  assert.match(
    skipReason[1],
    /shouldPersistLocalMirror\('customers'/,
    'the guard must not download a copy this device is going to throw away'
    + ' (customers is a live-server sensitive mirror -- see platform/storage/storagePolicy.ts)',
  )
  assert.match(
    skipReason[1],
    /isCustomerMirrorFresh\(\)/,
    'the guard must still keep a recent copy instead of re-downloading it',
  )
  assert.ok(
    /await db\.table\('customers'\)\.count\(\)/.test(snapshot),
    'a missing or empty mirror must still refresh immediately, whatever the timestamp says',
  )
})

check('the offline mirror asks for the bounded picker shape', () => {
  // The mirror is the one reader left that fetches more than a handful of
  // customers. It must stay on `fields=picker` (picker columns, no loyalty
  // aggregation) with an explicit row cap -- dropping either turns the
  // five-minutely snapshot back into the whole-table download this lane
  // removed.
  assert.match(
    snapshot,
    /[`'"]\/api\/customers\?fields=picker&limit=\$\{OFFLINE_CUSTOMER_MIRROR_LIMIT\}/,
    'the customers mirror read must stay the bounded fields=picker shape with an explicit limit',
  )
  const limit = /OFFLINE_CUSTOMER_MIRROR_LIMIT\s*=\s*(\d+)/.exec(snapshot)
  assert.ok(limit, 'offlineSnapshotTransport.ts should define OFFLINE_CUSTOMER_MIRROR_LIMIT')
  assert.ok(
    Number(limit[1]) > 0 && Number(limit[1]) <= 5000,
    `the offline customers copy must stay bounded by the server ceiling (CONTACT_PICKER_MAX_LIMIT = 5000), found ${limit[1]}`,
  )
})

check('nothing in the transport layer reads the list unfiltered', () => {
  // The mirror was the last no-argument caller in here; it now goes
  // straight to the bounded fields=picker endpoint (checked above), so
  // this sweep has no exemptions left and must not grow one.
  const offenders: string[] = []
  for (const [rel, source] of sources) {
    if (!rel.startsWith(TRANSPORT_DIR)) continue
    // The transport modules that DEFINE getCustomers pass their own params
    // through; only a call with no argument at all downloads the table.
    for (const args of callArguments(source, 'getCustomers')) {
      if (args.trim()) continue
      offenders.push(rel)
    }
  }
  assert.deepEqual(
    offenders, [],
    `these transport modules download the whole customers table:\n  ${offenders.join('\n  ')}`,
  )
})

console.log(`\n${passed} checks passed`)
