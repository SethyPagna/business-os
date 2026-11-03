// CACHE-LIFECYCLE T-CL3 client part (lane 6.0.1048, R8 / G10). What this device keeps for the person at the till is versioned: a POS cart
// and a form draft carry the schema of the build that wrote them. A build reads the schemas it knows; a record from a NEWER build (a
// rollback; a second tab still on the new build) is not read under this build's older rules, is neither overwritten nor deleted by it,
// stays byte for byte, and the person is told once. A record with no schema (written before this slice) reads exactly as before. The
// product search index is a cache, not work: an unknown format or core there is discarded and downloaded again, never merged.
// Each MUTANT (a reader that treats an unknown version as the old one) must fail the same assertions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'
import {
  NEWER_RECORD_EVENT,
  WORK_DRAFT_SCHEMA,
  __resetNewerRecordNoticesForTests,
  inspectWorkDraftRecord,
  takeNewerRecordNotices,
} from '../src/utils/persistedRecordSchema.ts'
import {
  KNOWN_MONEY_PRECISION,
  POS_ORDERS_SCHEMA,
  inspectPosOrdersRecord,
  pickReadablePosOrders,
  posOrdersWriteTargets,
} from '../src/utils/posOrdersSchema.ts'
import { __productSearchIndexTest, ensureProductSearchIndex, searchProductIndex } from '../src/api/productSearchIndex.ts'
import { SEARCH_CORE_VERSION } from '../src/utils/searchCore.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(FRONTEND, relative), 'utf8').split('\r\n').join('\n')

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

const order = (extra: Record<string, unknown> = {}) => ({ id: 'o1', label: 'Order 1', cart: [{ id: 5, qty: 2 }], checkoutRequestId: '', ...extra })
const CURRENT = JSON.stringify([order({ schema: 1, money_precision_version: 1 })])
const LEGACY = JSON.stringify([order({ money_precision_version: 0 }), order({ id: 'o2' })])
const NEWER_SCHEMA = JSON.stringify([order({ schema: 2, money_precision_version: 1, fromTheFuture: { rule: 'v2' } })])
const NEWER_MONEY = JSON.stringify([order({ schema: 1, money_precision_version: 2 })])

await runTest('the cart record: none, unreadable, readable (no schema, schema 1) and newer (schema 2, a money rule this build cannot price)', () => {
  assert.equal(POS_ORDERS_SCHEMA, 1)
  assert.equal(KNOWN_MONEY_PRECISION, 1)
  assert.equal(inspectPosOrdersRecord(null), 'none')
  assert.equal(inspectPosOrdersRecord(''), 'none')
  for (const bad of ['{not json', '{}', '"x"', '42', 'null']) assert.equal(inspectPosOrdersRecord(bad), 'unreadable', bad)
  assert.equal(inspectPosOrdersRecord(LEGACY), 'readable', 'written before this slice: read as it always was')
  assert.equal(inspectPosOrdersRecord(CURRENT), 'readable')
  assert.equal(inspectPosOrdersRecord(NEWER_SCHEMA), 'newer')
  assert.equal(inspectPosOrdersRecord(NEWER_MONEY), 'newer', 'money_precision_version 2 would be priced under the legacy rule by this build')
  assert.equal(inspectPosOrdersRecord(JSON.stringify([order({ schema: 1 }), order({ schema: 3 })])), 'newer', 'one newer order makes the whole record newer')
  assert.equal(inspectPosOrdersRecord(JSON.stringify([order({ schema: '2' })])), 'readable', 'only numbers are versions')
  assert.equal(inspectPosOrdersRecord(JSON.stringify([null, 3, 'x', order()])), 'readable')
})

await runTest('a screen loads the first store that is not newer, says so once, and starts empty when only newer ones exist', () => {
  assert.deepEqual(pickReadablePosOrders([CURRENT, null, null]), { raw: CURRENT, sawNewer: false })
  assert.deepEqual(pickReadablePosOrders([NEWER_SCHEMA, CURRENT, LEGACY]), { raw: CURRENT, sawNewer: true }, "the newer localStorage record is skipped; this tab's own sessionStorage still carries its work")
  assert.deepEqual(pickReadablePosOrders([NEWER_SCHEMA, null, LEGACY]), { raw: LEGACY, sawNewer: true })
  assert.deepEqual(pickReadablePosOrders([NEWER_SCHEMA, NEWER_MONEY, null]), { raw: null, sawNewer: true })
  assert.deepEqual(pickReadablePosOrders([null, undefined, null]), { raw: null, sawNewer: false })
  assert.deepEqual(pickReadablePosOrders(['{not json', CURRENT]), { raw: '{not json', sawNewer: false }, 'an unreadable record behaves as before (the caller falls back to a fresh order)')
})

await runTest('a cart write reaches only the stores that do not hold a newer record', () => {
  assert.deepEqual(posOrdersWriteTargets(CURRENT, CURRENT), { local: true, session: true })
  assert.deepEqual(posOrdersWriteTargets(null, null), { local: true, session: true })
  assert.deepEqual(posOrdersWriteTargets(LEGACY, '{not json'), { local: true, session: true })
  assert.deepEqual(posOrdersWriteTargets(NEWER_SCHEMA, CURRENT), { local: false, session: true })
  assert.deepEqual(posOrdersWriteTargets(CURRENT, NEWER_MONEY), { local: true, session: false })
  assert.deepEqual(posOrdersWriteTargets(NEWER_SCHEMA, NEWER_MONEY), { local: false, session: false })
})

await runTest('POS.tsx stamps every order, reads and writes only through those helpers, and the unresolved-checkout merge leaves a newer cart alone', () => {
  const pos = read('src/components/pos/POS.tsx')
  assert.match(pos, /schema: POS_ORDERS_SCHEMA,\n    cart: Array\.isArray\(order\.cart\)/, 'normalizeOrder stamps the schema after the spread, so a stored value cannot override it')
  assert.match(pos, /pickReadablePosOrders\(\[readPosStorage\('local', posOrdersStorageKey\), readPosStorage\('session', posOrdersStorageKey\), readPosStorage\('session', 'bos_pos_orders'\)\]\)/)
  assert.match(pos, /posOrdersWriteTargets\(readPosStorage\('local', key\), readPosStorage\('session', key\)\)/)
  assert.equal((pos.match(/readPosOrders\(\)/g) || []).length, 2, 'both hydrations (first render and a till scope change) use the guarded reader')
  assert.doesNotMatch(pos, /readPosDraft\(posOrdersStorageKey/, 'no unguarded read of the orders key is left')
  const unresolved = read('src/utils/posUnresolvedCheckout.ts')
  assert.match(unresolved, /inspectPosOrdersRecord\(local\.getItem\(ordersKey\)\) === 'newer' \|\| inspectPosOrdersRecord\(session\?\.getItem\(ordersKey\)\) === 'newer'\) return/)
})

// ---- drafts, run against the real module and against mutants ---------------------------------------------------------------------

type DraftModules = { drafts: typeof import('../src/utils/workDrafts.ts'); schema: typeof import('../src/utils/persistedRecordSchema.ts') }

async function loadDraftModules(mutate?: (schemaSource: string) => string): Promise<DraftModules> {
  if (!mutate) {
    return { drafts: await import('../src/utils/workDrafts.ts'), schema: await import('../src/utils/persistedRecordSchema.ts') }
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-persisted-schema-'))
  const compile = (source: string) => transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  const schemaSource = read('src/utils/persistedRecordSchema.ts')
  const mutated = mutate(schemaSource)
  assert.notEqual(mutated, schemaSource, 'mutation anchor missing')
  fs.writeFileSync(path.join(directory, 'persistedRecordSchema.mjs'), compile(mutated))
  const draftsSource = read('src/utils/workDrafts.ts')
    .replace("from '../constants.ts'", `from '${pathToFileURL(path.join(FRONTEND, 'src', 'constants.ts')).href}'`)
    .replace("from './persistedRecordSchema.ts'", "from './persistedRecordSchema.mjs'")
  fs.writeFileSync(path.join(directory, 'workDrafts.mjs'), compile(draftsSource))
  const stamp = Math.random()
  return {
    drafts: await import(`${pathToFileURL(path.join(directory, 'workDrafts.mjs')).href}?m=${stamp}`),
    schema: await import(`${pathToFileURL(path.join(directory, 'persistedRecordSchema.mjs')).href}?m=${stamp}`),
  }
}

async function draftScenario(modules: DraftModules): Promise<void> {
  const { drafts, schema } = modules
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalLocal = (globalThis as { localStorage?: unknown }).localStorage
  const events: string[] = []
  const target = new EventTarget()
  target.addEventListener(NEWER_RECORD_EVENT, (event) => events.push((event as CustomEvent).detail.kind))
  const local = memoryStorage()
  ;(globalThis as { window?: unknown }).window = Object.assign(target, { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) })
  ;(globalThis as { localStorage?: unknown }).localStorage = local
  schema.__resetNewerRecordNoticesForTests()
  try {
    const key = 'businessos_draft_v2_x_product'
    // a draft written before this slice, and one this build wrote
    local.setItem(key, JSON.stringify({ at: 7, data: { name: 'legacy' } }))
    assert.deepEqual(drafts.readWorkDraft(key), { at: 7, data: { name: 'legacy' } })
    drafts.writeWorkDraft(key, { name: 'current' })
    const stamped = JSON.parse(local.getItem(key) as string)
    assert.equal(stamped.schema, WORK_DRAFT_SCHEMA, 'a write stamps the schema')
    assert.deepEqual(stamped.data, { name: 'current' })
    assert.deepEqual(drafts.readWorkDraft(key)?.data, { name: 'current' })
    assert.equal(events.length, 0, 'no notice for records this build can read')

    // a draft from a newer build
    const newer = JSON.stringify({ schema: 2, at: 99, data: { name: 'from the future' }, kept: [1, 2, 3] })
    local.setItem(key, newer)
    assert.equal(drafts.readWorkDraft(key), null, 'not read under this build\'s rules')
    assert.equal(local.getItem(key), newer, 'reading changed nothing')
    drafts.writeWorkDraft(key, { name: 'typing in the old build' })
    assert.equal(local.getItem(key), newer, 'a write does not overwrite it')
    drafts.scheduleWorkDraftWrite(key, { name: 'debounced' }, 0)
    drafts.flushPendingWorkDrafts()
    assert.equal(local.getItem(key), newer, 'neither does the debounced autosave')
    drafts.clearWorkDraft(key)
    assert.equal(local.getItem(key), newer, 'clearing a form does not delete it')
    drafts.clearUnchangedWorkDraft(key, null)
    assert.equal(local.getItem(key), newer, 'neither does the clear-if-unchanged')
    assert.equal(drafts.readWorkDraft(key, { notOlderThanMs: 1000 }), null)
    assert.equal(local.getItem(key), newer, 'nor does a stale-draft check')
    assert.deepEqual(schema.takeNewerRecordNotices(), ['draft'], 'the person is told, once')
    assert.deepEqual(schema.takeNewerRecordNotices(), [])
    assert.deepEqual(events, ['draft'])
    // the old schema comes back: the record is readable again (a roll-forward needs nothing)
    local.setItem(key, JSON.stringify({ schema: 1, at: 100, data: { name: 'back to current' } }))
    assert.deepEqual(drafts.readWorkDraft(key)?.data, { name: 'back to current' })
  } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    ;(globalThis as { localStorage?: unknown }).localStorage = originalLocal
  }
}

await runTest('drafts: a newer draft is not read, overwritten, auto-saved over or deleted, and the person is told once; legacy and current drafts read and write as before', async () => {
  await draftScenario(await loadDraftModules())
  assert.equal(inspectWorkDraftRecord(JSON.stringify({ at: 1, data: 1 })), 'readable')
  assert.equal(inspectWorkDraftRecord(JSON.stringify({ schema: 1, at: 1, data: 1 })), 'readable')
  assert.equal(inspectWorkDraftRecord(JSON.stringify({ schema: 2, at: 1, data: 1 })), 'newer')
  assert.equal(inspectWorkDraftRecord('[]'), 'unreadable')
  assert.equal(inspectWorkDraftRecord(''), 'none')
})

await runTest('MUTANT: a reader that treats an unknown draft version as the old one is caught by the same scenario', async () => {
  const mutant = await loadDraftModules((source) => source.replace(
    "export const isNewerSchema = (value: unknown, known: number): boolean => typeof value === 'number' && Number.isFinite(value) && value > known",
    'export const isNewerSchema = (_value: unknown, _known: number): boolean => false',
  ))
  await assert.rejects(() => draftScenario(mutant), /not read under this build/, 'the scenario must fail on a reader that reads every version as the old one')
})

await runTest('MUTANT: a draft writer that does not look at what it is overwriting is caught by the same scenario', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-persisted-schema-'))
  const compile = (source: string) => transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code
  fs.writeFileSync(path.join(directory, 'persistedRecordSchema.mjs'), compile(read('src/utils/persistedRecordSchema.ts')))
  const source = read('src/utils/workDrafts.ts')
  const anchor = 'if (storedDraftIsNewer(key)) return\n    localStorage.setItem(key, JSON.stringify({ schema: WORK_DRAFT_SCHEMA'
  assert.ok(source.includes(anchor), 'mutation anchor missing')
  fs.writeFileSync(path.join(directory, 'workDrafts.mjs'), compile(source.replace(anchor, 'localStorage.setItem(key, JSON.stringify({ schema: WORK_DRAFT_SCHEMA')
    .replace("from '../constants.ts'", `from '${pathToFileURL(path.join(FRONTEND, 'src', 'constants.ts')).href}'`)
    .replace("from './persistedRecordSchema.ts'", "from './persistedRecordSchema.mjs'")))
  const stamp = Math.random()
  const mutant = {
    drafts: await import(`${pathToFileURL(path.join(directory, 'workDrafts.mjs')).href}?m=${stamp}`),
    schema: await import(`${pathToFileURL(path.join(directory, 'persistedRecordSchema.mjs')).href}?m=${stamp}`),
  } as DraftModules
  await assert.rejects(() => draftScenario(mutant), /a write does not overwrite it/)
})

// ---- the search index: a cache, so unknown versions are discarded and rebuilt, never merged ----------------------------------------

await runTest('the search index: a stored index with an unknown format or core is discarded and rebuilt from the server, never merged; a matching one is used (control)', async () => {
  const { transport, state } = __productSearchIndexTest
  const originals = { ...transport }
  const row = (id: number, name: string): [number, string, string, string, string, string] => [id, name, '', '', '', '']
  const served = { format: 1, page: 0, buckets: [0], pageIds: 2000, hash: 'fresh-hash', rows: [row(1, 'Fresh Lipstick')] }
  let written: unknown = null
  const run = async (storedValue: unknown) => {
    __productSearchIndexTest.reset()
    state.resets = 0
    written = null
    transport.readStored = async () => storedValue
    transport.writeStored = async (value) => { written = JSON.parse(JSON.stringify(value)) }
    transport.fetchPage = async (_page, have) => (have === 'stale-hash' ? { ...served, hash: 'stale-hash', unchanged: true, rows: undefined } : served) as never
    await ensureProductSearchIndex(true)
    return { stale: searchProductIndex('Stale')?.total ?? 0, fresh: searchProductIndex('Fresh')?.total ?? 0 }
  }
  try {
    const stalePage = { page: 0, hash: 'stale-hash', rows: [row(999, 'Stale Format Row')] }
    assert.deepEqual(await run({ format: 1, core: SEARCH_CORE_VERSION, pages: [stalePage] }), { stale: 1, fresh: 0 }, 'control: a stored index of this format and core is used (the server said unchanged)')
    assert.deepEqual(await run({ format: 2, core: SEARCH_CORE_VERSION, pages: [stalePage] }), { stale: 0, fresh: 1 }, 'format 2 is discarded and rebuilt')
    assert.deepEqual(await run({ format: 1, core: SEARCH_CORE_VERSION + 1, pages: [stalePage] }), { stale: 0, fresh: 1 }, 'a newer core is discarded and rebuilt')
    assert.deepEqual(await run({ format: 'x', core: null, pages: 'nope' }), { stale: 0, fresh: 1 }, 'garbage is discarded')
    assert.deepEqual((written as { format: number; core: number } | null) && { format: (written as any).format, core: (written as any).core }, { format: 1, core: SEARCH_CORE_VERSION }, 'and what is stored again is this build\'s own record')
  } finally {
    Object.assign(transport, originals)
    __productSearchIndexTest.reset()
  }
})

await runTest('the notices are one per kind, wait for the shell, and the shell shows them in both languages', () => {
  __resetNewerRecordNoticesForTests()
  assert.deepEqual(takeNewerRecordNotices(), [])
  const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
  for (const key of ['newer_cart_record_notice', 'newer_draft_record_notice']) {
    assert.ok(en[key] && km[key], `${key} must exist in both packs`)
    assert.doesNotMatch(km[key], /[A-Za-z]{3,}/, `${key}: Khmer without English`)
  }
  const app = read('src/App.tsx')
  assert.match(app, /takeNewerRecordNotices\(\)/)
  assert.match(app, /kind === 'cart' \? t\('newer_cart_record_notice'\) : t\('newer_draft_record_notice'\)/)
})

if (failed) { console.error(`${failed} persistedRecordSchema test(s) failed`); process.exit(1) }
console.log('persistedRecordSchema tests passed')
