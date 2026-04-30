import assert from 'node:assert/strict'
import { getPreferredScannerMode } from '../src/components/products/scanbotScanner.mjs'

const originalWindow = globalThis.window
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value,
  })
}

async function run() {
  globalThis.window = {}

  setNavigator({})
  {
    const result = await getPreferredScannerMode()
    assert.equal(result.mode, 'fallback')
    assert.equal(result.reason, 'unsupported')
  }

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
      delete globalThis.navigator
    }
    globalThis.window = originalWindow
    console.log('scanbotScanner tests passed')
  })
  .catch((error) => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
    } else {
      delete globalThis.navigator
    }
    globalThis.window = originalWindow
    console.error(error)
    process.exit(1)
  })
