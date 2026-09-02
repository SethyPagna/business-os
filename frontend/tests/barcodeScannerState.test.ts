import assert from 'node:assert/strict'
import fs from 'node:fs'
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
  cameraPermissionReady: 'Permission saved',
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

  const granted = deriveScannerPresentation({ status: 'manual', permissionState: 'granted', labels, promptDismissedMessage: 'Dismissed' })
  assert.equal(granted.emptyStateMessage, 'Permission saved')
  assert.equal(granted.requestCameraLabel, 'Start camera')
})

await runTest('scanner starts only from an explicit button and always releases the camera', () => {
  const source = fs.readFileSync(new URL('../src/components/products/scanning/BarcodeScannerModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /const video = await waitForVideoElement\(startToken\)/, 'camera startup must wait for React to commit the video element')
  assert.match(source, /decodeFromConstraints\([\s\S]*?video,[\s\S]*?\(result\)/, 'the iOS compatibility decoder must receive the mounted video element')
  const prepareBlock = source.slice(source.indexOf('const prepareScanner'), source.indexOf('const closeScanner'))
  const visibilityBlock = source.slice(source.indexOf('// iOS can keep a PWA page mounted'), source.indexOf('void watchCameraPermission'))
  const permissionBlock = source.slice(source.indexOf('void watchCameraPermission'), source.indexOf('if (!open) return null'))
  assert.doesNotMatch(prepareBlock, /startCamera\(/, 'saved permission must not auto-start a MediaStream when the modal prepares')
  assert.doesNotMatch(visibilityBlock, /startCamera\(/, 'foregrounding an installed PWA must not auto-restart the camera')
  assert.doesNotMatch(permissionBlock, /startCamera\(/, 'permission changes must not auto-start the camera')
  assert.match(source, /onClick=\{\(\) => startCamera\(\{ preserveManualValue: true \}\)\}/, 'the visible camera action remains the sole start trigger')
  assert.match(source, /const closeScanner[\s\S]*?cleanup\(\)[\s\S]*?onClose\(\)/, 'closing the scanner must stop tracks before dismissing the modal')
  assert.match(source, /cleanup\(\)[\s\S]*?setPermissionState\(documentBlocked/, 'failed starts must stop partially-open camera tracks')
})

await runTest('branch transfer exposes the shared icon scanner in single and multi-product searches', () => {
  const source = fs.readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
  const mainCss = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  assert.match(source, /import ScanSearchButton from ['"]\.\.\/shared\/ScanSearchButton\.tsx['"]/)
  const scannerUses = source.match(/<ScanSearchButton onDetected=\{setSearch\} t=\{t\} \/>/g) || []
  assert.equal(scannerUses.length, 2, 'single and multi transfer searches must both keep scanner access')
  assert.match(source, /items-end justify-center[^\"]*sm:items-center/, 'small screens should use a bottom sheet while larger screens center the dialog')
  assert.match(source, /modal-viewport-safe/, 'transfer dialog should use the shared safe-area viewport layer')
  assert.match(mainCss, /\.modal-viewport-safe[\s\S]*safe-area-inset-bottom/, 'the shared transfer layer should stay above the mobile safe area')
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
