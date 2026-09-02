// barcodeScanSelectConfirm.test.ts -- P2-2 (search + barcode scan core).
//
// 1. The keyboard-wedge burst detector in src/hooks/useBarcodeScan.ts
//    (wedge.onKeyDown), exercised directly against its exported logic by
//    driving a fake key-event sequence through it -- since the hook itself
//    is a React hook (needs a component to mount), the wedge detector's
//    actual *timing/branching* logic is what's under test here, invoked the
//    same way a real keydown handler would be: one event object per key.
//
// 2. Decision 9 (binding, see the P2-2 brief / docs/history/session-log.md):
//    "a barcode scan must never auto-add/auto-pick/auto-open anything -- the
//    camera auto-closes, the value fills search, the list narrows, and the
//    user chooses." Source-level assertions confirm useBarcodeScan.ts never
//    calls anything that looks like a select/add/confirm/navigate action
//    itself. Adopting-surface-specific assertions (e.g. PromotionsPage.tsx's
//    two scan-fed pickers still requiring an explicit click to confirm) are
//    added to this same file as each surface adopts the hook -- see the
//    note further down and this file's later commits.
//
// Run: node tests/barcodeScanSelectConfirm.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- keyboard-wedge burst detector -----------------------------------------
//
// useBarcodeScan.ts is not self-contained (it imports React), so it can't be
// loaded through the ts.transpileModule + `new Function` pattern the pure
// searchMatch/productLookup tests use. Instead this re-implements the exact
// same WEDGE_MAX_GAP_MS/WEDGE_MIN_CHARS logic in a standalone function here
// and cross-checks it against the real source text below (so a change to
// either the constants or the branching in useBarcodeScan.ts without a
// matching update here fails loudly) -- the same "behavior, not just source
// text" spirit as searchMatchParity.test.ts, scaled down to one file instead
// of two independent copies.

const WEDGE_MAX_GAP_MS = 35
const WEDGE_MIN_CHARS = 4
const IGNORED_STANDALONE_KEYS = new Set(['Shift', 'CapsLock'])

interface FakeKeyEvent {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  prevented?: boolean
}

function makeWedgeHandler(onValue: (value: string) => void) {
  let buffer = ''
  let lastCharTime = 0
  return (event: FakeKeyEvent, now: number) => {
    const key = event.key
    if (IGNORED_STANDALONE_KEYS.has(key)) return
    if (event.ctrlKey || event.altKey || event.metaKey) { buffer = ''; return }
    if (key === 'Enter') {
      const candidate = buffer
      buffer = ''
      if (candidate.length >= WEDGE_MIN_CHARS) {
        event.prevented = true
        onValue(candidate)
      }
      return
    }
    if (key.length !== 1) { buffer = ''; return }
    const gap = now - lastCharTime
    buffer = buffer.length > 0 && gap < WEDGE_MAX_GAP_MS ? buffer + key : key
    lastCharTime = now
  }
}

check('a fast burst (<35ms/char) of >=4 chars ending in Enter fires onValue and prevents default', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  const chars = ['6', '9', '2', '3', '6', '4', '4']
  for (const ch of chars) { handle({ key: ch }, t); t += 10 } // 10ms apart -- well under 35ms
  const enterEvent: FakeKeyEvent = { key: 'Enter' }
  handle(enterEvent, t)
  assert.deepEqual(values, ['6923644'])
  assert.equal(enterEvent.prevented, true, 'Enter must be prevented so it does not submit a surrounding form')
})

check('a slow burst (>=35ms gap between chars) does not fire onValue -- reads as human typing', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  const chars = ['1', '2', '3', '4', '5']
  for (const ch of chars) { handle({ key: ch }, t); t += 200 } // 200ms apart -- human typing speed
  const enterEvent: FakeKeyEvent = { key: 'Enter' }
  handle(enterEvent, t)
  assert.deepEqual(values, [], 'a 200ms/char sequence must never be treated as a wedge scan')
  assert.notEqual(enterEvent.prevented, true, 'a normal Enter must be left alone (allowed to submit) when no burst qualifies')
})

check('a fast burst shorter than WEDGE_MIN_CHARS does not fire onValue', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  for (const ch of ['1', '2']) { handle({ key: ch }, t); t += 10 }
  handle({ key: 'Enter' }, t)
  assert.deepEqual(values, [])
})

check('a slow gap in the middle of an otherwise-fast sequence resets the buffer to just the fast tail', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  handle({ key: '1' }, t); t += 10
  handle({ key: '2' }, t); t += 10
  // a 500ms human pause here...
  t += 500
  handle({ key: '3' }, t); t += 10
  handle({ key: '4' }, t); t += 10
  handle({ key: '5' }, t); t += 10
  handle({ key: 'Enter' }, t)
  // only "345" survives the reset, one char short of WEDGE_MIN_CHARS -- no fire.
  assert.deepEqual(values, [])
})

check('a lone Shift keydown does not reset an in-progress burst (many wedge scanners emit it for uppercase/punctuation)', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  handle({ key: '6' }, t); t += 5
  handle({ key: 'Shift' }, t); t += 5 // does not consume a "slot" or reset
  handle({ key: '9' }, t); t += 5
  handle({ key: '2' }, t); t += 5
  handle({ key: '3' }, t); t += 5
  handle({ key: 'Enter' }, t)
  assert.deepEqual(values, ['6923'])
})

check('a real modifier chord (Ctrl/Alt/Meta held) resets the buffer -- a human shortcut, not a scanner', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  handle({ key: '6' }, t); t += 5
  handle({ key: '9' }, t); t += 5
  handle({ key: 'v', ctrlKey: true }, t); t += 5 // Ctrl+V paste mid-sequence
  handle({ key: '2' }, t); t += 5
  handle({ key: '3' }, t); t += 5
  handle({ key: 'Enter' }, t)
  // only "23" survives -- too short, no fire.
  assert.deepEqual(values, [])
})

check('a non-character key (Backspace) mid-sequence resets the buffer', () => {
  const values: string[] = []
  const handle = makeWedgeHandler((v) => values.push(v))
  let t = 0
  handle({ key: '6' }, t); t += 5
  handle({ key: '9' }, t); t += 5
  handle({ key: 'Backspace' }, t); t += 5
  handle({ key: '2' }, t); t += 5
  handle({ key: '3' }, t); t += 5
  handle({ key: '4' }, t); t += 5
  handle({ key: '5' }, t); t += 5
  handle({ key: 'Enter' }, t)
  assert.deepEqual(values, ['2345'])
})

// --- cross-check against the real source -----------------------------------

const hookSource = fs.readFileSync(fileURLToPath(new URL('../src/hooks/useBarcodeScan.ts', import.meta.url)), 'utf8')

check('useBarcodeScan.ts still defines WEDGE_MAX_GAP_MS/WEDGE_MIN_CHARS matching this test\'s standalone reimplementation', () => {
  assert.match(hookSource, /const WEDGE_MAX_GAP_MS = 35/, 'WEDGE_MAX_GAP_MS changed in the source without this test being updated')
  assert.match(hookSource, /const WEDGE_MIN_CHARS = 4/, 'WEDGE_MIN_CHARS changed in the source without this test being updated')
})

check('useBarcodeScan.ts calls preventDefault only on a qualifying Enter, never unconditionally', () => {
  const enterBlock = hookSource.slice(hookSource.indexOf("if (key === 'Enter')"), hookSource.indexOf("if (key.length !== 1)"))
  assert.match(enterBlock, /if \(candidate\.length >= WEDGE_MIN_CHARS\)/)
  assert.match(enterBlock, /event\.preventDefault\(\)/)
})

check('useBarcodeScan.ts\'s handleDetected closes the scanner (setOpen(false)) before forwarding the value -- matches ScanSearchButton.tsx\'s own pattern', () => {
  const detectedBlock = hookSource.slice(hookSource.indexOf('const handleDetected'), hookSource.indexOf('const onKeyDown'))
  assert.match(detectedBlock, /setOpen\(false\)/)
  const closeIdx = detectedBlock.indexOf('setOpen(false)')
  const onValueIdx = detectedBlock.indexOf('onValue(trimmed)')
  assert.ok(closeIdx >= 0 && onValueIdx > closeIdx, 'close must happen before (or in the same tick ahead of) forwarding the value')
})

check('useBarcodeScan.ts never calls a select/add/confirm/navigate-shaped function itself -- decision 9: it only ever calls the caller-supplied onValue', () => {
  // Scan the whole file for suspicious call shapes that would indicate the
  // hook is doing more than "fill the search box" on its own.
  assert.doesNotMatch(hookSource, /\b(selectProduct|addProduct|confirmProduct|pickProduct|navigate\()/i)
})

// --- PromotionsPage.tsx: scan value fills search, list narrows, user confirms via click ---
// (P2-2 step 9 -- added once PromotionsPage.tsx actually adopted the hooks above.)

const promotionsSource = fs.readFileSync(fileURLToPath(new URL('../src/components/promotions/PromotionsPage.tsx', import.meta.url)), 'utf8')

check('PromotionsPage.tsx wires useProductLookup for the debounced search (P2-2 step 9 adoption)', () => {
  assert.match(promotionsSource, /import \{ useProductLookup \} from '\.\.\/\.\.\/hooks\/useProductLookup\.ts'/)
  assert.match(promotionsSource, /useProductLookup<ProductLite>\(\{/)
})

check('PromotionsPage.tsx still requires an explicit click on the per-product-discount result before opening the editor -- scan/type never auto-opens it', () => {
  const block = promotionsSource.slice(promotionsSource.indexOf('{productResults.map'), promotionsSource.indexOf('{productResults.map') + 1200)
  assert.match(block, /onClick=\{\(\) => \{ openDiscountEditor\(product\); setProductResults\(\[\]\) \}\}/)
})

check('PromotionsPage.tsx still requires an explicit click on the rule-picker result before adding it to the draft -- scan/type never auto-adds it', () => {
  const block = promotionsSource.slice(promotionsSource.indexOf('{pickerResults.map'), promotionsSource.indexOf('{pickerResults.map') + 1200)
  assert.match(block, /onClick=\{\(\) => \{/)
  assert.match(block, /setDraft\(\{ \.\.\.draft, products: \[\.\.\.draft\.products, product\] \}\)/)
})

check('PromotionsPage.tsx marks the exact-barcode-hit row with data-exact-hit, never a selected/active class alone', () => {
  const matches = promotionsSource.match(/data-exact-hit=\{isExactHit \? 'true' : undefined\}/g) || []
  assert.equal(matches.length, 2, 'both the per-product picker and the rule picker must mark their exact-hit row')
})

check('PromotionsPage.tsx keeps ScanSearchButton wired to fill the search box only (setProductQuery/setPickerQuery), not to select/add anything', () => {
  assert.match(promotionsSource, /<ScanSearchButton onDetected=\{setProductQuery\} t=\{t\} \/>/)
  assert.match(promotionsSource, /<ScanSearchButton onDetected=\{setPickerQuery\} t=\{t\} \/>/)
})

// --- Products.tsx: scan/wedge value fills search, list narrows, exact hit
// highlighted + scrolled into view, user still clicks Confirm (or the row
// itself) to open the fold -- P2-4 step 3 adoption. ---

const productsSource = fs.readFileSync(fileURLToPath(new URL('../src/components/products/Products.tsx', import.meta.url)), 'utf8')

check('Products.tsx wires useBarcodeScan for the keyboard-wedge path, camera path stays on ScanSearchButton (P2-4 step 3 adoption)', () => {
  assert.match(productsSource, /import \{ useBarcodeScan \} from '\.\.\/\.\.\/hooks\/useBarcodeScan\.ts'/)
  assert.match(productsSource, /const productSearchBarcodeScan = useBarcodeScan\(\{ onValue: handleScanDetected \}\)/)
  assert.match(productsSource, /onKeyDown=\{productSearchBarcodeScan\.wedge\.onKeyDown\}/)
})

check('Products.tsx routes both the camera scan and the wedge scan through the same handleScanDetected -- neither selects/opens/adds a product itself', () => {
  assert.match(productsSource, /<ScanSearchButton onDetected=\{handleScanDetected\} t=\{t\} \/>/)
  const block = productsSource.slice(productsSource.indexOf('const handleScanDetected'), productsSource.indexOf('const handleScanDetected') + 500)
  assert.match(block, /setSearch\(value\)/)
  assert.doesNotMatch(block, /\b(selectProduct|addProduct|confirmProduct|pickProduct|setDetailProduct|navigate\()/i)
})

check('Products.tsx resolves exact_barcode_hit_id via the shared resolveExactBarcodeHit helper, never re-implementing the match logic inline', () => {
  assert.match(productsSource, /import \{ resolveExactBarcodeHit \} from '\.\.\/\.\.\/utils\/productLookup\.ts'/)
  assert.match(productsSource, /resolveExactBarcodeHit\(\s*serverExactHitRaw,/)
})

check('Products.tsx marks the exact-hit row with data-exact-hit on both the desktop table row and the mobile card', () => {
  const matches = productsSource.match(/data-exact-hit=\{isExactHit \? 'true' : undefined\}/g) || []
  assert.equal(matches.length, 2, 'both renderDesktopProductRow and renderMobileProductCard must mark their exact-hit row')
})

check('Products.tsx never auto-opens the exact-hit row -- the Confirm affordance and the row itself both require an explicit onClick calling setDetailProduct', () => {
  const matches = productsSource.match(/onClick=\{\(event\) => \{ event\.stopPropagation\(\); setDetailProduct\(p\) \}\}/g) || []
  assert.equal(matches.length, 2, 'the desktop Confirm button and the mobile Confirm button must both require an explicit click')
})

console.log(`\nAll ${passed} barcodeScanSelectConfirm tests passed`)
