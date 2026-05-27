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

if (failed > 0) {
  process.exitCode = 1
}
