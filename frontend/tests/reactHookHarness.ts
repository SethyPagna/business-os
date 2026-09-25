// Minimal react-dom harness for rendering hook-only components in Node.
//
// Not a test file (no `.test.ts` suffix, so tests/runTestChain.ts does not
// execute it). It is shared by the sync tests, which have to observe real
// commits and effect order: a regex over the source cannot tell whether a
// page effect sees every channel of a coalesced window, or whether a stale
// event re-fires when a handler's identity changes.
//
// It stubs exactly what react-dom touches when the rendered components
// return null: window.event (update priority), the container's listener
// registration, and the active-element lookup around each commit. Components
// that render real DOM need a fuller stub (see barcodeScannerState.test.ts).
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

const noop = () => {}

export function installMinimalDom(): void {
  const doc = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null, body: null }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { event: undefined, addEventListener: noop, removeEventListener: noop, HTMLIFrameElement: class {}, document: doc },
  })
}

export type TestRoot = {
  render: (element: ReactElement) => Promise<void>
  unmount: () => Promise<void>
}

export function createTestRoot(): TestRoot {
  const doc = (globalThis as { document?: unknown }).document
  if (!doc) throw new Error('call installMinimalDom() before createTestRoot()')
  const container = {
    nodeType: 1,
    tagName: 'DIV',
    nodeName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    addEventListener: noop,
    removeEventListener: noop,
    textContent: '',
  }
  const root = createRoot(container as unknown as Element)
  return {
    render: async (element) => { await act(async () => { root.render(element) }) },
    unmount: async () => { await act(async () => { root.unmount() }) },
  }
}
