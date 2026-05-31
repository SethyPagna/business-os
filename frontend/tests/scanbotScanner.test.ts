import assert from 'node:assert/strict'
import { getPreferredScannerMode } from '../src/components/products/scanning/scanbotScanner.ts'
import { readCameraPermissionState, watchCameraPermission } from '../src/components/products/scanning/cameraPermission.ts'

const originalWindow = globalThis.window
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = globalThis.document

type TestNavigator = {
  mediaDevices?: { getUserMedia: () => Promise<unknown> }
  permissions?: { query: () => Promise<{ state: string; addEventListener?: (type: 'change', listener: () => void) => void; removeEventListener?: (type: 'change', listener: () => void) => void }> }
}
type TestDocument = {
  permissionsPolicy?: { allowsFeature: (feature: string) => boolean }
}

const testGlobals = globalThis as unknown as { window: Window; document: Document }

function setNavigator(value: TestNavigator) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value,
  })
}

async function run() {
  testGlobals.window = {} as Window
  testGlobals.document = {} as Document

  setNavigator({})
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'fallback')
    assert.equal(result.reason, 'unsupported')
  }

  testGlobals.document = {
    permissionsPolicy: {
      allowsFeature(feature: string) {
        return feature !== 'camera'
      },
    },
  } as unknown as Document
  setNavigator({
    mediaDevices: { getUserMedia: async () => ({}) },
    permissions: {
      query: async () => ({ state: 'granted' }),
    },
  })
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'fallback')
    assert.equal(result.reason, 'document-policy')
    assert.equal(result.permissionState, 'blocked')
  }

  testGlobals.document = {} as Document

  setNavigator({
    mediaDevices: { getUserMedia: async () => ({}) },
    permissions: {
      query: async () => ({ state: 'denied' }),
    },
  })
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'scanbot')
    assert.equal(result.reason, 'retry-after-denied')
    assert.equal(result.permissionState, 'denied')
  }

  setNavigator({
    mediaDevices: { getUserMedia: async () => ({}) },
    permissions: {
      query: async () => ({ state: 'prompt' }),
    },
  })
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'scanbot')
    assert.equal(result.reason, 'permission-prompt')
    assert.equal(result.permissionState, 'prompt')
  }

  setNavigator({
    mediaDevices: { getUserMedia: async () => ({}) },
    permissions: {
      query: async () => ({ state: 'granted' }),
    },
  })
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'scanbot')
    assert.equal(result.reason, 'granted')
    assert.equal(result.permissionState, 'granted')
  }

  setNavigator({
    permissions: {
      query: async () => ({ state: 'weird-browser-state' }),
    },
  })
  assert.equal(await readCameraPermissionState(), 'unknown')

  const listenerRef: { current: (() => void) | null } = { current: null }
  let removed = false
  const changes: string[] = []
  const permissionStatus = {
    state: 'prompt',
    addEventListener(_type: 'change', nextListener: () => void) {
      listenerRef.current = nextListener
    },
    removeEventListener(_type: 'change', nextListener: () => void) {
      removed = listenerRef.current === nextListener
    },
  }
  setNavigator({
    permissions: {
      query: async () => permissionStatus,
    },
  })
  const dispose = await watchCameraPermission((state) => changes.push(state))
  assert.deepEqual(changes, ['prompt'])
  permissionStatus.state = 'granted'
  if (!listenerRef.current) throw new Error('permission watcher did not register a change listener')
  listenerRef.current()
  assert.deepEqual(changes, ['prompt', 'granted'])
  dispose()
  assert.equal(removed, true)
}

run()
  .then(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
    testGlobals.document = originalDocument
    testGlobals.window = originalWindow
    console.log('scanbotScanner tests passed')
  })
  .catch((error) => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
    testGlobals.document = originalDocument
    testGlobals.window = originalWindow
    console.error(error)
    process.exit(1)
  })
