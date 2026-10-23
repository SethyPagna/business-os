// The small pure parts of the camera sheet: which camera this device remembers, which one a
// switch moves to, which reset steps a blocked camera is shown, and what the panel presents.
//
// Run: node tests/scannerCameraChoice.test.ts
import assert from 'node:assert/strict'
import {
  clearCameraChoice,
  listCameras,
  nextCameraId,
  readCameraChoice,
  saveCameraChoice,
  withRememberedCamera,
} from '../src/components/products/scanning/cameraChoice.ts'
import { cameraResetPlatform, deriveScannerPresentation } from '../src/components/products/scanning/barcodeScannerState.ts'

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

const globals = globalThis as unknown as Record<string, unknown>
function withGlobals<T>(values: Record<string, unknown>, run: () => T): T {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globals, key)]))
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globals, key, { configurable: true, writable: true, value })
  const restore = () => {
    for (const [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globals, key, descriptor)
      else delete globals[key]
    }
  }
  try {
    const result = run()
    if (result instanceof Promise) return result.finally(restore) as T
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}
const storageWindow = (storage: unknown) => ({ localStorage: storage })

const BACK_CAMERA = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, frameRate: { ideal: 30 } }, audio: false }

await runTest('the remembered camera is read back, and asked for as a preference instead of "the back camera"', () => {
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  withGlobals({ window: storageWindow(storage) }, () => {
    assert.equal(readCameraChoice(), null, 'nothing remembered yet')
    assert.equal(withRememberedCamera(BACK_CAMERA), BACK_CAMERA, 'so the constraints are used as they are')
    saveCameraChoice('cam-b')
    assert.equal(readCameraChoice(), 'cam-b')
    assert.deepEqual(withRememberedCamera(BACK_CAMERA), {
      audio: false,
      video: { deviceId: { ideal: 'cam-b' }, width: { ideal: 1920 }, frameRate: { ideal: 30 } },
    }, 'the camera replaces facingMode, as an ideal (an unplugged camera falls back instead of failing), and the rest is kept')
    assert.deepEqual(Object.keys(BACK_CAMERA.video), ['facingMode', 'width', 'frameRate'], 'the shared constraints object is not changed')
  })
})

await runTest('a remembered camera that can no longer be opened is forgotten, and a storage that refuses is not an error', () => {
  const data = new Map<string, string>([['business-os-scanner-camera-v1', 'cam-unplugged']])
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  withGlobals({ window: storageWindow(storage) }, () => {
    assert.equal(readCameraChoice(), 'cam-unplugged')
    clearCameraChoice()
    assert.equal(readCameraChoice(), null, 'the next scan asks for the default camera in one request')
  })
  withGlobals({ window: storageWindow({ removeItem: () => { throw new Error('storage blocked') } }) }, () => {
    assert.doesNotThrow(() => clearCameraChoice())
  })
  withGlobals({ window: {} }, () => {
    assert.doesNotThrow(() => clearCameraChoice(), 'no storage at all')
  })
})

await runTest('storage that is missing, blocked or full never throws and means the default camera', () => {
  withGlobals({ window: {} }, () => {
    assert.equal(readCameraChoice(), null, 'no localStorage at all')
    assert.doesNotThrow(() => saveCameraChoice('cam-b'))
    assert.equal(withRememberedCamera(BACK_CAMERA), BACK_CAMERA)
  })
  withGlobals({ window: storageWindow({ getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') } }) }, () => {
    assert.equal(readCameraChoice(), null)
    assert.doesNotThrow(() => saveCameraChoice('cam-b'))
  })
  withGlobals({ window: storageWindow({ getItem: () => '', setItem: () => {} }) }, () => {
    assert.equal(readCameraChoice(), null, 'an empty value is no choice')
  })
  assert.deepEqual(withRememberedCamera({ audio: false, video: true }), { audio: false, video: true }, 'constraints with no video detail are left alone')
})

await runTest('a switch moves to the next camera in the list, wraps round, and starts from the first when the current one is unknown', () => {
  assert.equal(nextCameraId(['a', 'b', 'c'], 'a'), 'b')
  assert.equal(nextCameraId(['a', 'b', 'c'], 'c'), 'a', 'wraps')
  assert.equal(nextCameraId(['a', 'b'], 'b'), 'a')
  assert.equal(nextCameraId(['a', 'b'], 'gone'), 'a', 'the current camera is no longer listed')
  assert.equal(nextCameraId(['a', 'b'], undefined), 'a', 'no track to ask')
  assert.equal(nextCameraId([], 'a'), null, 'nothing to switch to')
})

await runTest('only video inputs count as cameras, and a browser that cannot list them reports none', async () => {
  const devices = [{ kind: 'videoinput', deviceId: 'a' }, { kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'b' }, { kind: 'audiooutput', deviceId: 'out' }]
  const ids = await withGlobals({ navigator: { mediaDevices: { enumerateDevices: async () => devices } } }, async () => (await listCameras()).map((device) => device.deviceId))
  assert.deepEqual(ids, ['a', 'b'])
  assert.deepEqual(await withGlobals({ navigator: { mediaDevices: {} } }, () => listCameras()), [], 'no enumerateDevices')
  assert.deepEqual(await withGlobals({ navigator: { mediaDevices: { enumerateDevices: async () => { throw new Error('denied') } } } }, () => listCameras()), [], 'enumerateDevices rejects')
})

await runTest('the reset steps shown follow the device: Settings on iPhone and iPad (also iPadOS posing as a Mac), the lock icon on Android and desktop', () => {
  assert.equal(cameraResetPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'), 'ios')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15'), 'ios')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5), 'ios', 'iPadOS 13+ reports a Mac with a touch screen')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0), 'desktop', 'a real Mac has no touch points')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'), 'desktop', 'and no argument means none')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 5), 'android')
  assert.equal(cameraResetPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0'), 'desktop')
  assert.equal(cameraResetPlatform(''), 'desktop')
})

await runTest('only a true block is the "blocked" kind (the one red): a saved denial or a view that forbids the camera, nothing else', () => {
  const kind = (status: string, permissionState: string, error = '') => deriveScannerPresentation({ status, permissionState, labels: { error }, promptDismissedMessage: '' }).stateKind
  assert.equal(kind('blocked', 'denied'), 'blocked')
  assert.equal(kind('manual', 'denied'), 'blocked')
  assert.equal(kind('blocked', 'blocked'), 'blocked', 'the view forbids the camera')
  assert.equal(kind('manual', 'unsupported'), 'manual', 'no camera: neutral')
  assert.equal(kind('dismissed', 'prompt'), 'dismissed', 'a dismissed prompt: neutral')
  assert.equal(kind('manual', 'granted', 'Another app is using the camera.'), 'manual', 'a failed start: neutral')
  assert.equal(kind('manual', 'prompt'), 'manual', 'a paused camera: neutral')
  assert.equal(kind('starting', 'prompt'), 'starting', 'a slow start: neutral')
  assert.equal(kind('scanning', 'granted'), 'scanning')
})

if (failed > 0) process.exitCode = 1
