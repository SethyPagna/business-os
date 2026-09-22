// Every guarded write sends the version its SCREEN holds, never a local mirror.
//
// Owner report, 22 Sep 2026: product edits, image saves, deletes and other
// changes were refused as "changed on another device" with an "expected"
// version days old, and a refused save gave no way forward but a full reload.
//
// What was wrong, as a class. The token a guarded write sent was whatever
// `updated_at` rode along in the form payload -- the record the screen loaded
// with (a list on a phone kept open for days, or a restored autosaved draft) --
// and nothing ever refreshed it. Where the payload had no `updated_at`,
// `frontend/src/api/expectedUpdatedAt.ts` filled one from a Dexie mirror row
// the live app stopped rewriting on 12 Sep 2026 (`localMirrors.ts`
// `shouldPersistLocalMirror` is false on any http(s) origin): stale where a
// row existed, absent otherwise. The settings variant read a device-local
// `settings_meta` row with a wrong-scope global version.
//
// The fix: that helper is deleted and transports send the payload they are
// given (no mirror read on the request path); each caller passes the
// `updated_at` of the record its form or row shows, explicitly; a refused
// product save re-reads the row into the open form AND the list; a refused
// contact save reloads the list; a write with no version is checked by nothing
// server-side (`assertUpdatedAtMatch` no-ops on an empty token) rather than
// refused on a stale one.
//
// Pinned here, each with a negative control where a wrong shape is cheap to
// build:
//   1. the helper module and the settings meta store are gone, and no
//      transport reads a mirror for a version;
//   2. contactWriteTransport and userAdminTransport, EXECUTED with a fake
//      apiFetch, send exactly what the caller passed;
//   3. the callers that had no version now pass the screen's: branch save,
//      promotion discount save, role delete, contact deletes (single + bulk),
//      product undo/redo restore and delete-redo;
//   4. a refused product save re-reads the row into `selected` and the list;
//      a refused contact save reloads its list, and the open contact form's
//      version follows the list (so the next press carries the version that won).
//
// Run: node tests/writeVersionFromScreen.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (p: string) => fs.readFileSync(path.join(here, '..', p), 'utf8')
let checks = 0
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1 }
const eq = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); checks += 1 }

// ── 1. the mirror-backed version seam is gone ───────────────────────────────
ok(!fs.existsSync(path.join(here, '..', 'src/api/expectedUpdatedAt.ts')), 'the mirror-backed version helper no longer exists')
const transports = fs.readdirSync(path.join(here, '..', 'src/api')).filter((f) => f.endsWith('Transport.ts'))
ok(transports.length > 20, 'transport modules discovered')
for (const file of transports) {
  const source = read(`src/api/${file}`)
  ok(!/expectedUpdatedAt\.ts|withExpectedUpdatedAt|withSettingsExpectedUpdatedAt/.test(source), `${file} does not fill a version from a local mirror`)
}
const localDb = read('src/api/localDb.ts')
ok(!/localGetSettingsMeta|localSaveSettingsMeta/.test(localDb), 'the device-local settings_meta reader/writer pair is gone')
ok(!/SettingsMeta/.test(read('src/api/settingsTransport.ts')) && !/SettingsMeta/.test(read('src/api/offlineSnapshotTransport.ts')),
  'no writer feeds settings_meta any more')
ok(!/withExpectedUpdatedAt|await import\('\.\/expectedUpdatedAt\.ts'\)/.test(read('src/api/contactWriteTransport.ts')), 'contact writes no longer lazy-load the helper')

// ── 2. transports send exactly what the caller passed ───────────────────────
type Call = { method: string; url: string; body: unknown }
function loadTransport(file: string, calls: Call[]): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const compiled = ts.transpileModule(read(`src/api/${file}`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name.endsWith('/http.ts')) {
      return {
        apiFetch: async (method: string, url: string, body?: unknown) => { calls.push({ method, url, body }); return { success: true } },
        route: (_key: string, fn: () => Promise<unknown>) => fn(),
      }
    }
    if (name.endsWith('/deviceInfo.ts')) return { getClientDeviceInfo: () => ({}) }
    if (name.endsWith('/actorQuery.ts')) return { appendActorQuery: (url: string) => url }
    if (name.endsWith('/userReadTransport.ts')) return { getUsers: async () => [] }
    return {}
  }, module, module.exports)
  return module.exports
}
const VERSION = '2026-09-22T06:33:25.086Z'
{
  const calls: Call[] = []
  const contacts = loadTransport('contactWriteTransport.ts', calls)
  await contacts.deleteCustomer(41, VERSION)
  await contacts.deleteSupplier(42)
  await contacts.updateDeliveryContact(43, { name: 'Driver', updated_at: VERSION })
  eq(calls.map((c) => [c.method, c.url, c.body]), [
    ['DELETE', '/api/customers/41', { expectedUpdatedAt: VERSION }],
    ['DELETE', '/api/suppliers/42', {}],
    ['PUT', '/api/delivery-contacts/43', { name: 'Driver', updated_at: VERSION }],
  ], 'contact deletes send the row version they were given (and nothing when none), updates pass the form through untouched')
}
{
  const calls: Call[] = []
  const users = loadTransport('userAdminTransport.ts', calls)
  await users.deleteRole(7, { expectedUpdatedAt: VERSION, userId: 1 })
  await users.updateRole(7, { name: 'Cashier', expectedUpdatedAt: VERSION })
  eq(calls.map((c) => [c.method, c.body]), [
    ['DELETE', { expectedUpdatedAt: VERSION, userId: 1 }],
    ['PUT', { name: 'Cashier', expectedUpdatedAt: VERSION }],
  ], 'role delete and update send the version in the JSON body, as the Worker now reads it')
}

// ── 3. callers pass the version their screen holds ──────────────────────────
function pin(file: string, pattern: RegExp, message: string, control?: (s: string) => string) {
  const source = read(file)
  ok(pattern.test(source), message)
  if (control) {
    const mutated = control(source)
    assert.notEqual(mutated, source, `control for ${message} changes the source`)
    ok(!pattern.test(mutated), `negative control: ${message}`)
  }
}
pin('src/components/branches/Branches.tsx',
  /is_active: form\.is_active \? 1 : 0,[\s\S]{0,260}expectedUpdatedAt: selected\.updated_at \|\| undefined,[\s\S]{0,120}branchApi\.updateBranch\(selected\.id, payload\)/,
  "branch save carries the selected branch's version", (s) => s.replace('expectedUpdatedAt: selected.updated_at || undefined,', ''))
pin('src/components/promotions/PromotionsPage.tsx',
  /updateProduct\(discountDraft\.product\.id, \{[\s\S]{0,260}expectedUpdatedAt: typeof discountDraft\.product\.updated_at === 'string' \? discountDraft\.product\.updated_at : undefined,/,
  "the discount save carries the product version the editor opened with", (s) => s.replace(/expectedUpdatedAt: typeof discountDraft\.product\.updated_at[^\n]*\n/, ''))
pin('src/components/users/Users.tsx',
  /deleteRole\(role\.id, \{\s*expectedUpdatedAt: role\.updated_at \|\| undefined,/,
  "role delete carries the listed role's version", (s) => s.replace(/expectedUpdatedAt: role\.updated_at \|\| undefined,\r?\n\s*/, ''))
for (const [file, single, bulk] of [
  ['src/components/contacts/CustomersTab.tsx', /deleteCustomer\(customer\.id, customer\.updated_at\)/, /deleteCustomer\(id, snapshotById\.get\(Number\(id\)\)\?\.updated_at/],
  ['src/components/contacts/SuppliersTab.tsx', /deleteSupplier\(supplier\.id, supplier\.updated_at\)/, /deleteSupplier\(id, snapshotById\.get\(Number\(id\)\)\?\.updated_at/],
  ['src/components/contacts/DeliveryTab.tsx', /deleteDeliveryContact\(c\.id, c\.updated_at\)/, /deleteDeliveryContact\(id, snapshotById\.get\(Number\(id\)\)\?\.updated_at/],
] as const) {
  pin(file, single, `${path.basename(file)}: the single delete passes the row's version`)
  pin(file, bulk, `${path.basename(file)}: the bulk delete passes each selected row's version`)
  ok(/const snapshotById = new Map\(snapshots\.map\(\(row\) => \[Number\(row\.id\), row\]\)\)/.test(read(file)), `${path.basename(file)}: bulk versions come from the pre-delete snapshots`)
}
const products = read('src/components/products/Products.tsx')
ok(/payload\.expectedUpdatedAt = currentProduct\.updated_at \|\| undefined\s*\n\s*await runProductWriteMutation\(\(\) => productApi\.updateProduct\(productId, payload\), 'Restore product'\)/.test(products),
  'undo/redo restore writes over the version it just re-read')
ok(/const latestById = buildProductIdMap\(await fetchProductsByIds\(idsToDelete\)\)[\s\S]{0,200}productApi\.deleteProduct\(id, reason, latestById\.get\(Number\(id\)\)\?\.updated_at\)/.test(products),
  'bulk delete redo re-reads the rows and passes their versions')
ok(/const \[latest\] = await fetchProductsByIds\(\[targetId\]\)\s*\n\s*const result = await runProductDeleteMutation\(\(\) => productApi\.deleteProduct\(targetId, reason, latest\?\.updated_at\)/.test(products),
  'single delete redo re-reads the row and passes its version')
// ── 4. a refused write refreshes what the screen holds ──────────────────────
pin('src/components/products/Products.tsx',
  /isWriteConflictError\(e\)\) \{\s*\n\s*const conflictedId = selected\.id\s*\n\s*void fetchProductsByIds\(\[conflictedId\]\)\s*\n\s*\.then\(\(\[latest\]\) => \{\s*\n\s*if \(!latest\) return\s*\n\s*patchProductRow\(latest\)\s*\n\s*if \(productSaveFormRef\.current\.revision === formRevision\) setSelected\(latest\)/,
  'a refused product save re-reads the row into the list AND the open form', (s) => s.replace(/\r?\n\s*patchProductRow\(latest\)/, ''))
for (const [file, label] of [
  ['src/components/contacts/CustomersTab.tsx', 'Customers'],
  ['src/components/contacts/SuppliersTab.tsx', 'Suppliers'],
  ['src/components/contacts/DeliveryTab.tsx', 'Delivery contacts'],
] as const) {
  pin(file, new RegExp(`if \\(isWriteConflictError\\(error\\)\\) void load\\(\\{ silent: true, label: '${label} conflict reload' \\}\\)`),
    `${path.basename(file)}: a refused save reloads the list`,
    (s) => s.replace(/\r?\n\s*if \(isWriteConflictError\(error\)\) void load\([^\n]*/, ''))
  pin(file, /useEffect\(\(\) => \{\s*\n\s*if \(!selected\) return\s*\n\s*const fresh = \w+\.find\(\(row\) => Number\(row\.id\) === Number\(selected\.id\)\)\s*\n\s*if \(fresh && fresh\.updated_at !== selected\.updated_at\) setSelected\(fresh\)/,
    `${path.basename(file)}: the open form's version follows the reloaded list`,
    (s) => s.replace(/\r?\n\s*if \(fresh && fresh\.updated_at !== selected\.updated_at\) setSelected\(fresh\)/, ''))
  pin(file, /const payload[^\n]*= \{ \.\.\.form, \.\.\.\(selected \? \{ updated_at: selected\.updated_at \} : \{\}\), userId: user\?\.id, userName: user\?\.name \}/,
    `${path.basename(file)}: the edit payload carries the listed row's version, not the one the form opened with`,
    (s) => s.replace('...(selected ? { updated_at: selected.updated_at } : {}), ', ''))
}
// Contact edit forms initialise from the row, so their PUT body carries the
// row's `updated_at` and the Worker reads that as the token.
ok(/const initial = customer\b/.test(read('src/components/contacts/CustomerFormModal.tsx')), 'the customer form opens from the listed row (its updated_at rides in the payload)')

console.log(`writeVersionFromScreen: ${checks} checks passed`)
