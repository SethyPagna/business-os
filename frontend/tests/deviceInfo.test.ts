import assert from 'node:assert/strict'
import { getClientDeviceInfo, getClientMetaHeaders } from '../src/utils/deviceInfo.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function withNavigator(userAgent: string, fn: TestCallback): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent },
  })
  try {
    fn()
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'navigator', descriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  }
}

runTest('getClientDeviceInfo detects common browser and OS names', () => {
  withNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36', () => {
    const info = getClientDeviceInfo()
    assert.equal(info.deviceName, 'Chrome on Windows')
    assert.match(info.clientTime, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(typeof info.deviceTz === 'string' || info.deviceTz === null, true)
  })
})

runTest('getClientDeviceInfo falls back outside known browsers', () => {
  withNavigator('', () => {
    assert.equal(getClientDeviceInfo().deviceName, 'Browser on Unknown')
  })
})

runTest('getClientMetaHeaders returns stable header names', () => {
  withNavigator('Mozilla/5.0 (Mac OS X) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', () => {
    const headers = getClientMetaHeaders()
    assert.equal(headers['x-device-name'], 'Safari on macOS')
    assert.match(String(headers['x-client-time'] || ''), /^\d{4}-\d{2}-\d{2}T/)
    assert.equal('x-device-tz' in headers, true)
  })
})

// ---- device id stability (fresh module per case: the id lives in module memory) ----
type FakeStorage = { data: Map<string, string>; failSet: boolean; failGet: boolean }

function installStorage(options: Partial<FakeStorage> = {}): FakeStorage {
  const state: FakeStorage = { data: new Map(), failSet: false, failGet: false, ...options }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => { if (state.failGet) throw new Error('blocked'); return state.data.get(key) ?? null },
      setItem: (key: string, value: string) => { if (state.failSet) throw new Error('quota'); state.data.set(key, value) },
    },
  })
  return state
}

function installIndexedDb(records: Map<string, unknown>): void {
  const request = (result: unknown) => {
    const req: Record<string, unknown> = { result }
    queueMicrotask(() => (req.onsuccess as (() => void) | undefined)?.())
    return req
  }
  const db = {
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      const tx: Record<string, unknown> = {}
      tx.objectStore = () => ({
        get: (key: string) => request(records.get(key)),
        put: (value: unknown, key: string) => {
          records.set(key, value)
          queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.())
        },
      })
      return tx
    },
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open: () => request(db) },
  })
}

function uninstallBrowserStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage')
  Reflect.deleteProperty(globalThis, 'indexedDB')
}

let moduleCase = 0
const freshDeviceInfo = () => import(`../src/utils/deviceIdentity.ts?case=${++moduleCase}`) as Promise<typeof import('../src/utils/deviceIdentity.ts')>

async function runAsyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  } finally {
    uninstallBrowserStorage()
  }
}

await runAsyncTest('a storage write that throws still yields one id for the whole page life', async () => {
  installStorage({ failSet: true })
  const { getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  const first = getOrCreatePersistentDeviceId()
  assert.equal(getOrCreatePersistentDeviceId(), first, '/login and /otp/verify carry the same id')
  assert.equal(getOrCreatePersistentDeviceId(), first, 'every later call too')
})

await runAsyncTest('storage that throws on read and on write is still stable', async () => {
  installStorage({ failSet: true, failGet: true })
  const { getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  assert.equal(getOrCreatePersistentDeviceId(), getOrCreatePersistentDeviceId())
})

await runAsyncTest('a stored id is returned unchanged and an invalid stored value is replaced', async () => {
  const state = installStorage()
  state.data.set('businessos_device_id', 'stored-device-0001')
  const { getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  assert.equal(getOrCreatePersistentDeviceId(), 'stored-device-0001')
  state.data.set('businessos_device_id', 'x y')
  const replaced = getOrCreatePersistentDeviceId()
  assert.match(replaced, /^[A-Za-z0-9_-]{8,100}$/)
  assert.equal(state.data.get('businessos_device_id'), replaced)
})

await runAsyncTest('the id the server returns is adopted into memory and storage', async () => {
  const state = installStorage()
  const { adoptDeviceIdFromResponse, getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  const own = getOrCreatePersistentDeviceId()
  adoptDeviceIdFromResponse({ success: true, deviceId: 'server-device-0002' })
  assert.notEqual(own, 'server-device-0002')
  assert.equal(getOrCreatePersistentDeviceId(), 'server-device-0002')
  assert.equal(state.data.get('businessos_device_id'), 'server-device-0002')
  adoptDeviceIdFromResponse({ deviceId: '<script>' })
  adoptDeviceIdFromResponse(null)
  assert.equal(getOrCreatePersistentDeviceId(), 'server-device-0002', 'a malformed or missing id changes nothing')
})

await runAsyncTest('an id kept only in the IndexedDB copy is restored before any request mints a new one', async () => {
  const state = installStorage()
  const records = new Map<string, unknown>([['device_id', 'backup-device-0003']])
  installIndexedDb(records)
  const { deviceIdentityReady, getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  await deviceIdentityReady()
  assert.equal(getOrCreatePersistentDeviceId(), 'backup-device-0003')
  assert.equal(state.data.get('businessos_device_id'), 'backup-device-0003', 'localStorage is refilled from the copy')
})

await runAsyncTest('a new id is copied to IndexedDB and a stored id fills an empty copy', async () => {
  const state = installStorage()
  const records = new Map<string, unknown>()
  installIndexedDb(records)
  const { deviceIdentityReady, getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  const created = getOrCreatePersistentDeviceId()
  await deviceIdentityReady()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(records.get('device_id'), created)
  state.data.set('businessos_device_id', 'stored-device-0004')
  records.clear()
  const second = await freshDeviceInfo()
  await second.deviceIdentityReady()
  assert.equal(records.get('device_id'), 'stored-device-0004')
})

await runAsyncTest('no IndexedDB at all does not break the id', async () => {
  installStorage()
  const { deviceIdentityReady, getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  await deviceIdentityReady()
  assert.equal(getOrCreatePersistentDeviceId(), getOrCreatePersistentDeviceId())
})

await runAsyncTest('an IndexedDB open that never answers does not block sign-in for more than about a second', async () => {
  installStorage()
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open: () => ({}) } })
  const { deviceIdentityReady, getOrCreatePersistentDeviceId } = await freshDeviceInfo()
  const started = Date.now()
  await deviceIdentityReady()
  const waited = Date.now() - started
  assert.ok(waited >= 900 && waited < 3000, `waited ${waited} ms`)
  assert.equal(getOrCreatePersistentDeviceId(), getOrCreatePersistentDeviceId(), 'sign-in carries one id')
})

if (failed > 0) {
  process.exitCode = 1
}
