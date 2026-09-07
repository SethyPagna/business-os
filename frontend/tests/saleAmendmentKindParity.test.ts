// One amendment kind list, three places that have to agree.
//
// WHY THIS FILE EXISTS. `SaleAmendmentRequest.kind` is a closed union that
// spans the wire: the frontend narrows a button to one member, the Worker
// checks the incoming string against its own set, and the ledger's CHECK
// constraint accepts a third list. On Sep 6 2026 commit 4e58891f added
// `delivery_actual_cost_changed` and updated the union in api/salesTransport.ts
// and in SaleDetailModal.tsx -- but not the third hand-copy in Sales.tsx. The
// build went red on the tip with a TS2322 that named neither the feature nor
// the cause, and the fix that a reader reaches for first ("add the member to
// Sales.tsx too") reproduces the fault the next time.
//
// The root cause is not the missing member. It is that a wire type was written
// out by hand three times. Sales.tsx now imports the canonical one, and this
// file makes any surviving or future copy prove it still agrees -- including
// with the Worker, which no TypeScript check can see at all.
//
// This is a SOURCE-TEXT test on purpose. Type-level agreement between a Vite
// bundle and a Worker bundle cannot be checked by a compiler that never loads
// both, and the ledger's accepted kinds are a SQL CHECK constraint. Reading the
// declarations is the only place the three can be compared.
//
// Run: node tests/saleAmendmentKindParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.join(here, '..')
const REPO = path.join(FRONTEND, '..')
const read = (...parts: string[]): string => fs.readFileSync(path.join(...parts), 'utf8')

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- the three declarations -------------------------------------------------

/** Every `kind: 'a' | 'b' | ...` union declared under a SaleAmendmentRequest. */
const declaredKindUnions = (source: string): string[][] => {
  const out: string[][] = []
  const re = /(?:interface|type)\s+SaleAmendmentRequest\b[\s\S]{0,600}?\bkind\s*:\s*([^\n]+)/g
  for (const match of source.matchAll(re)) {
    const members = [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    if (members.length) out.push(members)
  }
  return out
}

/** Files under frontend/src that declare the type at all. */
const frontendSources = (): Array<{ rel: string; text: string }> => {
  const files: Array<{ rel: string; text: string }> = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      if (!/(?:interface|type)\s+SaleAmendmentRequest\b/.test(text)) continue
      files.push({ rel: path.relative(FRONTEND, full).replace(/\\/g, '/'), text })
    }
  }
  walk(path.join(FRONTEND, 'src'))
  return files.sort((a, b) => a.rel.localeCompare(b.rel))
}

const transportText = read(FRONTEND, 'src', 'api', 'salesTransport.ts')
const canonical = declaredKindUnions(transportText)[0]
const workerRoutes = read(REPO, 'cloudflare', 'src', 'routes', 'sales.ts')
const workerLib = read(REPO, 'cloudflare', 'src', 'lib', 'saleAmendments.ts')
const permissionActions = read(FRONTEND, 'src', 'utils', 'permissionActions.ts')

// --- 1. the frontend has ONE canonical wire type ----------------------------

runTest('api/salesTransport.ts declares the canonical request kinds', () => {
  assert.ok(canonical && canonical.length > 0, 'no kind union found in api/salesTransport.ts')
  assert.equal(new Set(canonical).size, canonical.length, 'the canonical union repeats a member')
})

runTest('only the transport declares the full wire envelope', () => {
  // The envelope -- client_request_id + expected_exchange_rate -- is what makes
  // a declaration a copy of the REQUEST rather than a local props payload. Two
  // modules owning that is how a one-line union change broke the build.
  const owners = frontendSources()
    .filter(({ text }) => {
      const block = text.match(/(?:interface|type)\s+SaleAmendmentRequest\b[\s\S]{0,600}?\n\}/)?.[0] ?? ''
      return /client_request_id/.test(block) && /expected_exchange_rate/.test(block)
    })
    .map(({ rel }) => rel)
  assert.deepEqual(owners, ['src/api/salesTransport.ts'],
    'the wire request type belongs to the module that puts it on the wire; import it instead of re-declaring it')
})

runTest('every SaleAmendmentRequest declared in frontend/src agrees on the kinds', () => {
  // Any copy that survives (SaleDetailModal.tsx keeps a props-payload subset)
  // must still list exactly the canonical members. This is the assertion that
  // 431a586a fails: Sales.tsx declared the union without
  // 'delivery_actual_cost_changed'.
  for (const { rel, text } of frontendSources()) {
    for (const union of declaredKindUnions(text)) {
      assert.deepEqual([...union].sort(), [...canonical].sort(),
        `${rel} declares a different kind union from api/salesTransport.ts`)
    }
  }
})

// --- 2. the Worker accepts exactly those kinds ------------------------------

runTest("the Worker's AMENDMENT_REQUEST_KINDS matches the frontend union", () => {
  const set = workerRoutes.match(/const AMENDMENT_REQUEST_KINDS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(set, 'AMENDMENT_REQUEST_KINDS not found in cloudflare/src/routes/sales.ts')
  const kinds = [...set[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(kinds.sort(), [...canonical].sort(),
    'a kind the client can send that the Worker rejects is a 400 nobody tested; a kind the Worker accepts that no client sends is dead surface')
})

runTest('the ledger kinds are the request kinds, minus the one that is two rows', () => {
  // AMENDMENT_KINDS is what the sale_amendments CHECK constraint stores, and it
  // is deliberately NOT the request list: 'line_replaced' is one request that
  // becomes a 'line_removed' + 'line_added' pair sharing a group_id, so
  // 'line_added' exists only in the ledger and 'line_replaced' only on the
  // wire. Stating the relation keeps that difference deliberate -- a kind added
  // to one side alone still fails here.
  const block = workerLib.match(/export const AMENDMENT_KINDS = \[([\s\S]*?)\] as const/)
  assert.ok(block, 'AMENDMENT_KINDS not found in cloudflare/src/lib/saleAmendments.ts')
  const ledger = new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
  const expected = new Set(canonical.filter((k) => k !== 'line_replaced'))
  expected.add('line_added')
  assert.deepEqual([...ledger].sort(), [...expected].sort(),
    "the ledger's kinds must be the request kinds with 'line_replaced' expanded into 'line_added'")
})

runTest('every ledger kind the migration accepts is a kind the Worker knows', () => {
  // The CHECK constraint is the last word: a kind the code emits that the
  // constraint rejects aborts the whole amendment batch at runtime.
  const migrations = path.join(REPO, 'cloudflare', 'migrations')
  const latest = fs.readdirSync(migrations)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => /CHECK \(kind IN \(/.test(fs.readFileSync(path.join(migrations, f), 'utf8')))
    .sort()
    .pop()
  assert.ok(latest, 'no migration defines the sale_amendments kind CHECK')
  const text = fs.readFileSync(path.join(migrations, latest as string), 'utf8')
  const check = text.match(/CHECK \(kind IN \(([\s\S]*?)\)\)/)
  assert.ok(check, `${latest} has no readable kind CHECK`)
  const allowed = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  const block = workerLib.match(/export const AMENDMENT_KINDS = \[([\s\S]*?)\] as const/)
  const ledger = [...(block as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual(allowed.sort(), ledger.sort(),
    `${latest}'s CHECK and AMENDMENT_KINDS must list the same kinds`)
})

// --- 3. one permission gates all of them ------------------------------------

runTest('all amendment kinds go through the single sales:amend grant', () => {
  // There is one gate for the whole family, by design (a shop may let a senior
  // cashier add a forgotten item but not take one back off a paid sale, so
  // `amend` is separate from `add_items` -- but it is not split further). A new
  // kind must therefore not arrive with an endpoint of its own: this asserts
  // the client still routes every amendment through 'sales:amend', and that
  // the action is still declared, still non-reviewable, and still singular.
  assert.match(transportText, /route\(\s*'sales:amend'/,
    "amendSale must declare the 'sales:amend' route key")
  // Exactly one WRITE to /amendments. (The GET on the same path is the history
  // read, deliberately ungated -- anyone who can open the sale may see how it
  // got that way.) A second POST would be a second door past one grant.
  const writes = transportText.match(/apiFetch\('POST', `[^`]*\/amendments`/g) || []
  assert.equal(writes.length, 1,
    'the amendments endpoint is written from exactly one place in the transport')

  const salesBlock = permissionActions.match(/\n  sales: \[([\s\S]*?)\n  \],/)
  assert.ok(salesBlock, 'PERMISSION_ACTIONS.sales not found')
  const amendEntries = [...salesBlock[1].matchAll(/\{ key: 'amend',[^\n]*\}/g)].map((m) => m[0])
  assert.equal(amendEntries.length, 1, "exactly one 'amend' action gates every amendment kind")
  assert.match(amendEntries[0], /review: 'block'/,
    'an amendment moves stock immediately, so it can never be queued for review')
  assert.match(amendEntries[0], /tKey: 'perm_act_sales_amend'/,
    'the amend action must stay translatable through its tKey')
})

if (failed > 0) {
  console.error(`\n${failed} sale-amendment parity check(s) failed`)
  process.exit(1)
}
console.log(`\nAll sale-amendment kind parity checks passed (${canonical.length} request kinds).`)
