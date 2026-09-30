import assert from 'node:assert/strict'
import { isCameraBlockedByDocumentPolicy } from '../src/components/products/scanning/cameraPolicy.ts'
import { readCameraPermissionState, watchCameraPermission } from '../src/components/products/scanning/cameraPermission.ts'

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = globalThis.document

type TestNavigator = {
  permissions?: { query: () => Promise<{ state: string; addEventListener?: (type: 'change', listener: () => void) => void; removeEventListener?: (type: 'change', listener: () => void) => void }> }
}
const testGlobals = globalThis as unknown as { document: Document }

function setNavigator(value: TestNavigator) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value,
  })
}

function restore() {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'navigator')
  }
  testGlobals.document = originalDocument
}

async function run() {
  testGlobals.document = {} as Document
  assert.equal(isCameraBlockedByDocumentPolicy(), false, 'no policy object means not blocked')

  testGlobals.document = {
    permissionsPolicy: { allowsFeature: (feature: string) => feature !== 'camera' },
  } as unknown as Document
  assert.equal(isCameraBlockedByDocumentPolicy(), true, 'a policy that denies camera blocks it')

  testGlobals.document = {
    featurePolicy: { allowsFeature: () => true },
  } as unknown as Document
  assert.equal(isCameraBlockedByDocumentPolicy(), false, 'a policy that allows camera does not block it')

  testGlobals.document = {} as Document

  for (const state of ['granted', 'denied', 'prompt'] as const) {
    setNavigator({ permissions: { query: async () => ({ state }) } })
    assert.equal(await readCameraPermissionState(), state)
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
    restore()
    console.log('cameraPolicy tests passed')
  })
  .catch((error) => {
    restore()
    console.error(error)
    process.exit(1)
  })
