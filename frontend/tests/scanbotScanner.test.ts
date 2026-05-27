import assert from 'node:assert/strict'
import { getPreferredScannerMode } from '../src/components/products/scanning/scanbotScanner.ts'

const originalWindow = globalThis.window
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = globalThis.document

type TestNavigator = {
  mediaDevices?: { getUserMedia: () => Promise<unknown> }
  permissions?: { query: () => Promise<{ state: string }> }
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
