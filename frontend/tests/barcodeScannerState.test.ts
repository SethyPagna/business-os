// Scanner contract: ONE TAP opens the camera.
//
// Owner rule, 2026-09-14: "for camera I have to click allow and open button
// after clicking the scanner button. instead of clicking button = opening the
// scanner directly."
//
// Why the old two-step flow existed (Part 605, Sep 7 2026, session log): the
// owner had asked that scanning "ask for permission only when needed ... and
// not keep re-prompting", and the wave found that the browser/OS owns the
// "Always allow" choice -- the app cannot grant it. The lane's answer was to
// make every getUserMedia call come from a visible Start/Request camera
// button, so no prompt could ever appear from a mount, a foreground event or a
// re-render. That protected against re-prompting, but it charged every scan a
// second tap even when permission was already granted.
//
// One tap is safe now because the protections moved rather than disappeared:
// the modal is mounted only by a deliberate tap on a scanner button (that tap
// IS the gesture), `open` is the only effect input so a re-render cannot
// restart a stream, a saved denial still short-circuits before getUserMedia,
// and foregrounding a backgrounded PWA still parks on the button.
//
// The render test at the bottom is the discriminating one: on the pre-change
// source it fails with 0 getUserMedia calls, because the open effect only ran
// prepareScanner.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { deriveScannerPresentation } from '../src/components/products/scanning/barcodeScannerState.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const labels = {
  scanReady: 'Scan ready',
  requestingCamera: 'Requesting camera',
  scanUnsupported: 'Unsupported',
  cameraPermissionNeeded: 'Need camera',
  cameraPaused: 'Camera paused',
  cameraPermissionBlocked: 'Blocked',
  requestCameraAccess: 'Request access',
  startCamera: 'Start camera',
  tryCameraAgain: 'Try again',
  error: '',
}

await runTest('deriveScannerPresentation distinguishes scanning and blocked states', () => {
  const scanning = deriveScannerPresentation({ status: 'scanning', permissionState: 'granted', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(scanning.stateKind, 'scanning')
  assert.equal(scanning.showCameraAction, false)
  assert.equal(scanning.statusMessage, 'Scan ready')

  const blocked = deriveScannerPresentation({ status: 'blocked', permissionState: 'denied', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(blocked.stateKind, 'blocked')
  assert.equal(blocked.showCameraAction, true)
  assert.equal(blocked.requestCameraLabel, 'Try again')
  assert.equal(blocked.emptyStateMessage, 'Blocked')
})

await runTest('deriveScannerPresentation hides retry when the document itself blocks camera access', () => {
  const blockedByDocument = deriveScannerPresentation({ status: 'blocked', permissionState: 'blocked', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(blockedByDocument.stateKind, 'blocked')
  assert.equal(blockedByDocument.showCameraAction, false)
  assert.equal(blockedByDocument.emptyStateMessage, 'Blocked')
})

await runTest('deriveScannerPresentation keeps dismissed prompts distinct from hard-denied permissions', () => {
  const dismissed = deriveScannerPresentation({ status: 'dismissed', permissionState: 'prompt', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(dismissed.stateKind, 'dismissed')
  assert.equal(dismissed.emptyStateMessage, 'Dismissed')
  assert.equal(dismissed.requestCameraLabel, 'Try again')

  const manual = deriveScannerPresentation({ status: 'manual', permissionState: 'unknown', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(manual.stateKind, 'manual')
  assert.equal(manual.emptyStateMessage, 'Need camera')

  // Granted + not scanning is now only reachable AFTER a stream was released
  // (backgrounded page, photo picker), never on open -- so the copy describes
  // a paused camera instead of telling the user to start one.
  const granted = deriveScannerPresentation({ status: 'manual', permissionState: 'granted', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(granted.emptyStateMessage, 'Camera paused')
  assert.equal(granted.requestCameraLabel, 'Start camera')
})

await runTest('opening the scanner starts the camera itself, and the button survives only for the states that cannot', () => {
  const source = fs.readFileSync(new URL('../src/components/products/scanning/BarcodeScannerModal.tsx', import.meta.url), 'utf8')
  const modalSource = fs.readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
  const searchButtonSource = fs.readFileSync(new URL('../src/components/shared/ScanSearchButton.tsx', import.meta.url), 'utf8')
  assert.match(source, /const video = await waitForVideoElement\(startToken\)/, 'camera startup must wait for React to commit the video element')
  assert.match(source, /decodeFromConstraints\([\s\S]*?video,[\s\S]*?\(result\)/, 'the iOS compatibility decoder must receive the mounted video element')

  const openEffect = source.slice(source.indexOf('const startCameraRef'), source.indexOf('// iOS can keep a PWA page mounted'))
  const prepareBlock = source.slice(source.indexOf('const prepareScanner'), source.indexOf('const closeScanner'))
  const visibilityBlock = source.slice(source.indexOf('// iOS can keep a PWA page mounted'), source.indexOf('void watchCameraPermission'))
  const permissionBlock = source.slice(source.indexOf('void watchCameraPermission'), source.indexOf('if (!open) return null'))

  // 1. one tap: the open effect is the start trigger
  assert.match(openEffect, /if \(!open\) return undefined[\s\S]*?void startCameraRef\.current\(\)/, 'opening the scanner must start the camera without a second tap')
  assert.match(openEffect, /\}, \[cleanup, open\]\)/, '`open` must be the only input that can start a camera -- a re-render must never restart one')
  assert.match(source, /useState<ScannerStatus>\(open \? 'starting' : 'idle'\)/, 'the first paint must be the camera shell, not a frame of the old request-access empty state')

  // 2. the paths that are NOT a user gesture still refuse to start a stream
  assert.doesNotMatch(prepareBlock, /startCamera\(/, 'the resume path must re-read permission and park on the button, not call getUserMedia')
  assert.doesNotMatch(visibilityBlock, /startCamera\(/, 'foregrounding an installed PWA must not auto-restart the camera')
  assert.doesNotMatch(permissionBlock, /startCamera\(/, 'permission changes must not auto-start the camera')

  // 3. the explicit button remains for retry/blocked/denied/failed only
  assert.match(source, /\{showCameraAction \? \([\s\S]*?onClick=\{\(\) => startCamera\(\{ preserveManualValue: true \}\)\}/, 'the retry button stays for the states a mount cannot resolve')
  assert.doesNotMatch(source, /camera_permission_ready/, 'the two-step "start the camera when you are ready" copy is retired')

  assert.match(source, /const closeScanner[\s\S]*?cleanup\(\)[\s\S]*?onClose\(\)/, 'closing the scanner must stop tracks before dismissing the modal')
  assert.match(source, /const completeDetection = useCallback\([\s\S]*?detectionHandledRef\.current[\s\S]*?onDetected\(nextValue\)[\s\S]*?finally[\s\S]*?onClose\(\)/, 'every successful detection must publish once and close the scanner')
  assert.match(source, /expectedStartToken\?\: number[\s\S]*?startTokenRef\.current !== expectedStartToken/, 'a stale decoder result must not publish after a new camera start or close')
  assert.match(source, /const scanToken = startTokenRef\.current[\s\S]*?detector\.detect\(video\)[\s\S]*?startTokenRef\.current !== scanToken/, 'native detection must reject a result from an obsolete camera session')
  assert.match(source, /handlePhotoSelection[\s\S]*?completeDetection\(nextValue\)/, 'photo barcode results must use the same terminal completion path')
  assert.match(source, /nextPermissionState === 'denied'[\s\S]*?setStatus\('blocked'\)[\s\S]*?return/, 'a saved browser denial must not trigger another getUserMedia request loop')
  assert.match(source, /detectionHandledRef\.current = false/, 'a newly opened scanner must be able to complete one fresh result')
  assert.match(source, /cleanup\(\)[\s\S]*?setPermissionState\(documentBlocked/, 'failed starts must stop partially-open camera tracks')
  assert.match(source, /<Modal[^>]*layer="nested"/, 'the camera dialog must sit above the workflow modal that opened it')
  assert.match(modalSource, /layer === 'nested' \? 'z-\[1070\]' : 'z-\[1050\]'/, 'nested tools must use a higher dialog layer')
  const searchHandler = searchButtonSource.slice(searchButtonSource.indexOf('const handleDetected'), searchButtonSource.indexOf('}, [onDetected])'))
  assert.doesNotMatch(searchHandler, /setOpen\(false\)/, 'the search wrapper must not issue a second close after the modal owns completion')
  // A scan still only FILLS the query -- it never adds or picks anything.
  assert.match(searchHandler, /const trimmed = String\(value \|\| ''\)\.trim\(\)\s*\n\s*if \(trimmed\) onDetected\(trimmed\)/, 'a scan hands the value to the caller\'s search setter and nothing else')
})

await runTest('both scanner entry points warm the modal chunk before the click that needs it', () => {
  const lazyImportSource = fs.readFileSync(new URL('../src/utils/lazyImport.ts', import.meta.url), 'utf8')
  assert.match(lazyImportSource, /export function preloadLazy<T>\(importer: LazyImporter<T>\): \(\) => void/, 'the shared preload helper lives beside lazyRetry')
  assert.match(lazyImportSource, /let started: Promise<unknown> \| null = null[\s\S]*?if \(started\) return/, 'preloading must be idempotent -- four handlers fire per press')

  // The modal calls getUserMedia on mount, so a chunk still downloading after
  // the click spends the gesture's transient-activation window on the network.
  const entryPoints = [
    { name: 'ScanSearchButton', path: '../src/components/shared/ScanSearchButton.tsx' },
    { name: 'ProductForm barcode field', path: '../src/components/products/forms/ProductForm.tsx' },
  ]
  for (const entry of entryPoints) {
    const source = fs.readFileSync(new URL(entry.path, import.meta.url), 'utf8')
    assert.match(source, /import \{ lazyRetry, preloadLazy \}/, `${entry.name} must import the preload helper`)
    assert.match(source, /const importBarcodeScannerModal = \(\) => import\('[^']*scanning\/BarcodeScannerModal'\)/, `${entry.name} must share one importer between lazyRetry and the preload`)
    assert.match(source, /const preloadBarcodeScannerModal = preloadLazy\(importBarcodeScannerModal\)/, `${entry.name} must build its preload from that importer`)
    for (const handler of ['onPointerDown', 'onTouchStart', 'onMouseEnter', 'onFocus']) {
      assert.ok(
        source.includes(`${handler}={preloadBarcodeScannerModal}`),
        `${entry.name}'s scanner trigger must warm the chunk on ${handler}, which fires before click`,
      )
    }
  }
})

// --- the discriminating one: mount it and watch getUserMedia ---------------

class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style: Record<string, string> = {}
  namespaceURI: string
  nodeValue = ''
  // <video> surface the modal touches: it plays the stream and polls readiness.
  readyState = 0
  srcObject: unknown = null
  muted = false
  private ownText = ''
  private attributes = new Map<string, string>()

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
  }

  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode {
    child.parentNode = this; this.ownText = ''
    const index = this.childNodes.indexOf(before)
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child)
    return child
  }
  removeChild(child: MemoryNode): MemoryNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  focus(): void { this.ownerDocument.activeElement = this }
  click(): void {}
  play(): Promise<void> { return Promise.resolve() }
  pause(): void {}
  contains(target: MemoryNode | null): boolean { return target === this || this.childNodes.some((child) => child.contains(target)) }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling(): MemoryNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }
  set textContent(value: string) { this.ownText = String(value); this.childNodes = [] }
  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue
    return this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText
  }
}

type MemoryDocument = {
  nodeType: number
  nodeName: string
  documentElement: MemoryNode
  body: MemoryNode
  activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null
  visibilityState: string
  createElement: (name: string) => MemoryNode
  createElementNS: (namespaceURI: string, name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode
  addEventListener: () => void
  removeEventListener: () => void
}

const memoryDocument = {} as MemoryDocument
memoryDocument.nodeType = 9
memoryDocument.nodeName = '#document'
memoryDocument.defaultView = null
memoryDocument.visibilityState = 'visible'
memoryDocument.createElement = (name) => new MemoryNode(1, name.toUpperCase(), memoryDocument)
memoryDocument.createElementNS = (namespaceURI, name) => new MemoryNode(1, name, memoryDocument, namespaceURI)
memoryDocument.createTextNode = (text) => {
  const node = new MemoryNode(3, '#text', memoryDocument)
  node.nodeValue = String(text)
  return node
}
memoryDocument.addEventListener = () => {}
memoryDocument.removeEventListener = () => {}
memoryDocument.documentElement = memoryDocument.createElement('html')
memoryDocument.body = memoryDocument.createElement('body')
memoryDocument.documentElement.appendChild(memoryDocument.body)
memoryDocument.activeElement = memoryDocument.documentElement

// A fake native BarcodeDetector keeps the run on the native path, so the
// assertion is about getUserMedia and not about loading ZXing.
class FakeBarcodeDetector {
  static async getSupportedFormats(): Promise<string[]> { return ['ean_13'] }
  async detect(): Promise<Array<{ rawValue?: unknown }>> { return [] }
}

const memoryWindow = {
  document: memoryDocument,
  HTMLElement: MemoryNode,
  HTMLIFrameElement: class {},
  BarcodeDetector: FakeBarcodeDetector,
  addEventListener() {},
  removeEventListener() {},
  getSelection() { return null },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}
memoryDocument.defaultView = memoryWindow

// The scan loop reschedules itself forever; give it a budget so an assertion
// failure cannot turn into a hung test file.
let framesLeft = 120
const frameTimers = new Map<number, ReturnType<typeof setTimeout>>()
let nextFrameId = 1

Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: () => void): number => {
    const id = nextFrameId++
    if (framesLeft-- <= 0) return id
    frameTimers.set(id, setTimeout(callback, 0))
    return id
  },
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: (id: number): void => {
    const timer = frameTimers.get(id)
    if (timer) clearTimeout(timer)
    frameTimers.delete(id)
  },
})

interface CameraProbe {
  getUserMediaCalls: number
}

function installCamera(permissionState: 'granted' | 'prompt' | 'denied'): CameraProbe {
  const probe: CameraProbe = { getUserMediaCalls: 0 }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      permissions: {
        query: async () => ({ state: permissionState, addEventListener() {}, removeEventListener() {} }),
      },
      mediaDevices: {
        getUserMedia: async () => {
          probe.getUserMediaCalls += 1
          return { getTracks: () => [{ stop() {} }] }
        },
      },
    },
  })
  return probe
}

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
// Overridable so the same assertions can be run against a copy of the
// pre-change component when proving this test discriminates.
const modulePath = process.env.SCANNER_MODULE_PATH || '/src/components/products/scanning/BarcodeScannerModal.tsx'

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  plugins: [
    {
      name: 'barcode-scanner-mocks',
      enforce: 'pre',
      resolveId(id) {
        if (id.includes('lucide-react')) return '\0scanner-icon'
        if (/shared\/Modal$/.test(id)) return '\0scanner-modal'
        return null
      },
      load(id) {
        if (id === '\0scanner-icon') return 'export default function Icon() { return null }'
        if (id === '\0scanner-modal') {
          return `import React from 'react'
            export default function Modal({ children }) { return React.createElement('div', { role: 'dialog' }, children) }`
        }
        return null
      },
    },
    react(),
  ],
})

async function mountScanner(probePermission: 'granted' | 'prompt' | 'denied'): Promise<{ probe: CameraProbe; text: string; unmount: () => Promise<void> }> {
  const probe = installCamera(probePermission)
  const module = await vite.ssrLoadModule(modulePath) as { default: React.ComponentType<Record<string, unknown>> }
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(React.createElement(module.default, {
      open: true,
      title: 'Scan barcode',
      onClose() {},
      onDetected() {},
      t: (key: string) => key,
    }))
    await Promise.resolve()
  })
  // Let the permission read, the video commit and the start resolve. No click
  // happens anywhere in here -- that is the whole point of the test.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  const text = container.textContent
  return {
    probe,
    text,
    unmount: async () => {
      await act(async () => root.unmount())
      memoryDocument.body.removeChild(container)
    },
  }
}

try {
  await runTest('opening the modal with camera permission available reaches getUserMedia with no second click', async () => {
    const mounted = await mountScanner('granted')
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 1, 'mounting the scanner must request the camera exactly once, with no Start/Request tap')
      assert.match(mounted.text, /Center the barcode inside the frame/, 'a granted camera must land on the live scanning view')
      assert.doesNotMatch(mounted.text, /Request camera access|Start camera/, 'a working camera must never be shown a start button first')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('opening the modal at a prompt permission still reaches getUserMedia once', async () => {
    const mounted = await mountScanner('prompt')
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 1, 'an unanswered permission must be asked from the tap that opened the scanner')
    } finally {
      await mounted.unmount()
    }
  })

  await runTest('opening the modal with a saved denial shows the retry state and never calls getUserMedia', async () => {
    const mounted = await mountScanner('denied')
    try {
      assert.equal(mounted.probe.getUserMediaCalls, 0, 'a saved browser denial must short-circuit before any getUserMedia retry loop')
      assert.match(mounted.text, /Camera access is blocked/, 'a blocked camera must explain itself instead of showing a blank video')
      assert.match(mounted.text, /Try camera again/, 'the explicit retry button survives exactly for this state')
    } finally {
      await mounted.unmount()
    }
  })
} finally {
  await vite.close()
  for (const timer of frameTimers.values()) clearTimeout(timer)
  frameTimers.clear()
}

await runTest('branch transfer exposes the shared icon scanner in single and multi-product searches', () => {
  const source = fs.readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
  const mainCss = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  assert.match(source, /import ScanSearchButton from ['"]\.\.\/shared\/ScanSearchButton\.tsx['"]/)
  assert.match(
    source,
    /const handleTransferProductScan = useCallback\([\s\S]*?setShowSelectedOnly\(false\)[\s\S]*?setShowAllProducts\(false\)[\s\S]*?setSearch\(barcode\)/,
    'a scan must become the transfer picker query and reset filters that could hide it',
  )
  const scannerUses = source.match(/<ScanSearchButton\b[\s\S]*?onDetected=\{handleTransferProductScan\}[\s\S]*?\/>/g) || []
  assert.equal(scannerUses.length, 2, 'single and multi transfer searches must both keep scanner access')
  const focusedProductSearches = source.match(/placeholder=\{t\('search_products_placeholder'\)[\s\S]*?autoFocus[\s\S]*?autoComplete="off"/g) || []
  assert.equal(focusedProductSearches.length, 2, 'both transfer product searches must take scanner-keyboard focus')
  assert.doesNotMatch(source, /<ScanSearchButton\s+onDetected=\{setSearch\}/, 'transfer scans must not use an unscoped generic search setter')
  assert.match(source, /items-end justify-center[^\"]*sm:items-center/, 'small screens should use a bottom sheet while larger screens center the dialog')
  assert.match(source, /modal-viewport-safe/, 'transfer dialog should use the shared safe-area viewport layer')
  assert.match(mainCss, /\.modal-viewport-safe[\s\S]*safe-area-inset-bottom/, 'the shared transfer layer should stay above the mobile safe area')
})

await runTest('stock workflow scanners stay inside their active product picker', () => {
  const adjustmentSource = fs.readFileSync(new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url), 'utf8')
  const stockInSource = fs.readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
  const ledgerSource = fs.readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')

  assert.match(
    adjustmentSource,
    /const handleProductScan = useCallback\([\s\S]*?setResults\(\[\]\)[\s\S]*?setSearch\(barcode\)/,
    'Add, Remove, and Set Quantity must route scans to their modal query',
  )
  assert.match(adjustmentSource, /<ScanSearchButton\b[\s\S]*?onDetected=\{handleProductScan\}/)
  assert.match(
    stockInSource,
    /<ScanSearchButton onDetected=\{\(value\) => \{[\s\S]*?setQuery\(barcode\)[\s\S]*?setScannedBarcode\(barcode\)/,
    'Add Stock must keep barcode lookup in its own query and exact-scan state',
  )

  assert.match(ledgerSource, /const stockWorkflowOpen = adjustType !== null \|\| fastStockInOpen/)
  assert.match(ledgerSource, /const blurLedgerSearch = useCallback\([\s\S]*?activeElement\.blur\(\)/)
  assert.match(ledgerSource, /const openFastStockIn = useCallback\(\(nextMode: StockMode = 'add'\) => \{\s*blurLedgerSearch\(\)/)
  assert.match(ledgerSource, /<SearchInput id="stock-ledger-search"[^>]*disabled=\{stockWorkflowOpen\}/)
  assert.match(
    ledgerSource,
    /\{!stockWorkflowOpen \? <ScanSearchButton onDetected=\{setSearch\}/,
    'Stock Change History scanner must be unavailable while a stock workflow owns scanning',
  )
})

await runTest('remaining product search surfaces expose controlled icon-only scanners', () => {
  const surfaces = [
    {
      name: 'branch stock',
      path: '../src/components/branches/Branches.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{\(value\) => handleBranchStockSearchChange\(branch\.id, value\)\}/,
    },
    {
      name: 'supplier return product picker',
      path: '../src/components/returns/NewSupplierReturnModal.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setSearch\}/,
    },
    {
      name: 'product duplicates filter',
      path: '../src/components/products/ProductDuplicatesTab.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setSearch\}/,
    },
    {
      name: 'promotion per-product picker',
      path: '../src/components/promotions/PromotionsPage.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setProductQuery\}/,
    },
    {
      name: 'promotion rule product picker',
      path: '../src/components/promotions/PromotionsPage.tsx',
      importPath: '../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{setPickerQuery\}/,
    },
    {
      name: 'product import conflict search',
      path: '../src/components/products/import/ProductImportConflictsModal.tsx',
      importPath: '../../shared/ScanSearchButton.tsx',
      wiring: /onDetected=\{\(value\) => \{ setQuery\(value\); setPage\(1\) \}\}/,
    },
  ]

  const sourceByPath = new Map<string, string>()
  for (const surface of surfaces) {
    const source = sourceByPath.get(surface.path)
      || fs.readFileSync(new URL(surface.path, import.meta.url), 'utf8')
    sourceByPath.set(surface.path, source)
    assert.ok(
      source.includes(`import ScanSearchButton from '${surface.importPath}'`),
      `${surface.name} must import the shared scanner button`,
    )
    assert.match(source, surface.wiring, `${surface.name} must write the scan into its controlled query`)
  }

  for (const [path, source] of sourceByPath) {
    const scannerUses = source.match(/<ScanSearchButton\b[\s\S]*?\/>/g) || []
    assert.ok(scannerUses.length > 0, `${path} must render at least one scanner button`)
    for (const use of scannerUses) {
      assert.doesNotMatch(use, /\bshowLabel\b/, `${path} product search scanners must remain icon-only`)
    }
  }
})

if (failed > 0) {
  process.exitCode = 1
}
