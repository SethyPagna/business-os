// P9-12 wave 2 item 2: catalog-bound pickers (supplier/brand/category/unit/
// product-name/barcode) re-fetched their option list over the network every
// time a surface opened. pickerOptionsCache.ts is the one shared in-memory
// cache all of them now route through; SupplierPickerField's loadSupplierNames
// and ProductForm's own supplier field are the two concrete cases this file
// pins (previously TWO independent network fetches for the same list -- one
// per surface -- because ProductForm ran its OWN getSuppliers({fields:'names'})
// call instead of sharing SupplierPickerField's cache).
//
// Discriminating: on the old ProductForm.tsx (a raw
// `(await loadContactsTransportModule()).getSuppliers({ fields: 'names' })`
// call in its own effect, with SupplierPickerField keeping a private
// module-local cache instead of a shared one) the network-call-count
// assertion below would show 2 fetches for two callers sharing the same
// list where the fixed code makes 1.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  cacheClearAll,
  setSyncServerUrl,
  setSyncToken,
} from '../src/api/http.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function read(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
}

function resetApiState() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  cacheClearAll()
  setSyncServerUrl('')
  setSyncToken('')
}

function createReadableStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

function installWindow(): () => void {
  const originalWindow = (globalThis as { window?: unknown }).window
  const listeners = new Map<string, Set<(event: Event) => void>>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: createReadableStorage(),
    sessionStorage: createReadableStorage(),
    setTimeout,
    clearTimeout,
    dispatchEvent: (event: Event & { type: string }) => {
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener)
    },
  }
  return () => { (globalThis as { window?: unknown }).window = originalWindow }
}

function stubFetchCounting(): { calls: number; restore: () => void } {
  const originalFetch = globalThis.fetch
  const counter = { calls: 0 }
  globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
    counter.calls += 1
    return new Response(JSON.stringify([{ id: 1, name: 'Acme Supplies' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { get calls() { return counter.calls }, restore: () => { globalThis.fetch = originalFetch } }
}

await runTest('loadPickerOptions: a second call within the TTL reuses the cached value, no second loader run', async () => {
  const { loadPickerOptions, invalidatePickerOptionsCache } = await import('../src/api/pickerOptionsCache.ts')
  invalidatePickerOptionsCache('test-channel-a')
  let calls = 0
  const loader = async () => { calls += 1; return ['x', 'y'] }
  const first = await loadPickerOptions('test-channel-a', loader)
  const second = await loadPickerOptions('test-channel-a', loader)
  assert.deepEqual(first, ['x', 'y'])
  assert.deepEqual(second, ['x', 'y'])
  assert.equal(calls, 1, 'the loader must run exactly once for two calls inside the TTL window')
})

await runTest('loadPickerOptions: invalidatePickerOptionsCache forces the next call to reload', async () => {
  const { loadPickerOptions, invalidatePickerOptionsCache } = await import('../src/api/pickerOptionsCache.ts')
  invalidatePickerOptionsCache('test-channel-b')
  let calls = 0
  const loader = async () => { calls += 1; return [calls] }
  await loadPickerOptions('test-channel-b', loader)
  invalidatePickerOptionsCache('test-channel-b')
  await loadPickerOptions('test-channel-b', loader)
  assert.equal(calls, 2, 'invalidation must force a fresh loader run')
})

await runTest('loadPickerOptions: two independent channels never share an entry', async () => {
  const { loadPickerOptions, invalidatePickerOptionsCache } = await import('../src/api/pickerOptionsCache.ts')
  invalidatePickerOptionsCache('test-channel-c1')
  invalidatePickerOptionsCache('test-channel-c2')
  const first = await loadPickerOptions('test-channel-c1', async () => ['one'])
  const second = await loadPickerOptions('test-channel-c2', async () => ['two'])
  assert.deepEqual(first, ['one'])
  assert.deepEqual(second, ['two'])
})

// SupplierPickerField.tsx cannot be imported directly under plain Node (no
// JSX/tsx loader here -- every other picker test in this suite asserts its
// source instead, see supplierPicker.test.ts). This exercises the SAME
// contactsTransport.getSuppliers({fields:'names'}) read wrapped in
// loadPickerOptions('suppliers', ...) the way loadSupplierNames does, over a
// real fetch stub, proving the shared channel actually collapses concurrent
// callers to one network request end-to-end (not just for a synthetic
// in-memory loader as in the tests above).
await runTest('pickerOptionsCache("suppliers", contactsTransport.getSuppliers): two concurrent callers produce exactly one network read', async () => {
  resetApiState()
  const restoreWindow = installWindow()
  setSyncServerUrl('https://sync.example.test')
  const { loadPickerOptions, invalidatePickerOptionsCache } = await import('../src/api/pickerOptionsCache.ts')
  const { getSuppliers } = await import('../src/api/contactsTransport.ts')
  invalidatePickerOptionsCache('suppliers')
  const fetchStub = stubFetchCounting()
  const load = () => loadPickerOptions('suppliers', async () => {
    const data = await getSuppliers({ fields: 'names' })
    return Array.isArray(data) ? data : []
  })
  try {
    // Simulates ProductForm and a stock modal both opening close together
    // and both asking for the same supplier-names list.
    const [a, b] = await Promise.all([load(), load()])
    assert.deepEqual(a, [{ id: 1, name: 'Acme Supplies' }])
    assert.deepEqual(b, [{ id: 1, name: 'Acme Supplies' }])
    assert.equal(fetchStub.calls, 1, 'two callers sharing the "suppliers" channel must produce exactly one underlying network read')
    // A third, later call still reuses the cache instead of firing again.
    await load()
    assert.equal(fetchStub.calls, 1, 'a later call inside the TTL must not refetch')
  } finally {
    fetchStub.restore()
    restoreWindow()
    resetApiState()
  }
})

await runTest("ProductForm.tsx: the supplier-list effect calls the shared loadSupplierNames(), not its own getSuppliers({fields:'names'}) fetch", () => {
  const productForm = read('components/products/forms/ProductForm.tsx')
  assert.match(
    productForm,
    /await loadSupplierPickerModule\(\)\)\.loadSupplierNames\(\)/,
    'the effect must call the shared cached loader',
  )
  const codeOnly = productForm.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(
    codeOnly,
    /getSuppliers\(\{\s*fields:\s*['"]names['"]\s*\}\)/,
    "ProductForm must not run its own independent suppliers?fields=names fetch anymore",
  )
})

await runTest('SupplierPickerField.tsx: no leftover module-local cache duplicate of pickerOptionsCache', () => {
  const picker = read('components/shared/SupplierPickerField.tsx')
  assert.doesNotMatch(picker, /let supplierNamesCache/, 'the ad hoc module cache must be gone, replaced by the shared module')
  assert.match(picker, /from '\.\.\/\.\.\/api\/pickerOptionsCache\.ts'/, 'the picker must import the shared cache module')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All pickerOptionsCache tests passed')
}
