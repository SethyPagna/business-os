// P2-9 finding 5: on iOS Safari the address bar and toolbar are inside the
// "100vh" box but outside what is actually visible, so anything sized or capped
// with a raw `vh` renders taller than the viewport -- modal footers, sheet
// bottoms and the app shell itself end up clipped behind Safari's chrome.
//
// `dvh` is the correct unit but is invalid before iOS 15.4 / Chrome 108, where
// an invalid declaration silently drops the whole cap. A single declaration
// cannot carry a fallback, which is why no Tailwind arbitrary value or inline
// style could ever express the fix -- so both halves live in ONE custom
// property, `--app-vh-100`, and every consumer reads it.
//
// This test is the thing that keeps that true: it fails the moment a raw `vh`
// (or a fallback-less `dvh`) height reappears anywhere outside the small,
// explicitly-listed set of places that are allowed to have one.
//
// Run: node tests/pwaViewportUnits.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(?:tsx?|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

function relative(file: string): string {
  return path.relative(path.join(here, '..'), file).replace(/\\/g, '/')
}

// Every file allowed to still name a raw viewport-height unit, each with the
// reason. Anything not on this list must go through the helper.
const ALLOWED: Array<{ prefix: string; why: string }> = [
  // The helper's own definition plus the two inline styles that legitimately
  // keep a literal `100vh` as the var() fallback (an inline style cannot carry
  // a second declaration, and AppContext's splash paints before main.css is
  // guaranteed to have applied).
  { prefix: 'src/styles/main.css', why: 'defines --app-vh-100 itself' },
  { prefix: 'src/AppContext.tsx', why: 'boot splash: var(--app-vh-100, 100vh) fallback' },
  { prefix: 'src/components/shared/NotesWidget.tsx', why: 'inline style: var(--app-vh-100, 100vh) fallback' },
  // Other lanes own these folders in the release candidate.
  { prefix: 'src/components/products/', why: 'P2-4b lane owns components/products' },
  { prefix: 'src/components/shared/kit/', why: 'kit lane owns shared/kit' },
  { prefix: 'src/components/utils-settings/', why: 'P2-8 lane owns utils-settings' },
  // The customer storefront keeps its own design. PublicCatalogPage renders
  // all four of these, so they are storefront surfaces even though the admin
  // Customer Portal editor previews the same components. floatingFilterMenus
  // .test.ts pins the compact filter sheet's own 100dvh, which is the proof
  // that this boundary is real and not a matter of taste.
  { prefix: 'src/components/catalog/PublicCatalogPage.tsx', why: 'storefront keeps its own design' },
  { prefix: 'src/components/catalog/CatalogProductsSection.tsx', why: 'storefront: rendered by PublicCatalogPage' },
  { prefix: 'src/components/catalog/CatalogPreviewSurface.tsx', why: 'storefront: rendered by PublicCatalogPage' },
  { prefix: 'src/components/catalog/ProductDetailFlyout.tsx', why: 'storefront: rendered by PublicCatalogPage' },
  // A generated print document, rendered by the print pipeline into a fresh
  // window -- there is no iOS URL bar in a print box.
  { prefix: 'src/utils/printReceipt.ts', why: 'generated print document, not a viewport' },
]

function allowedReason(file: string): string | null {
  const rel = relative(file)
  for (const entry of ALLOWED) {
    if (rel === entry.prefix || rel.startsWith(entry.prefix)) return entry.why
  }
  return null
}

// A raw vh/dvh/svh/lvh length. `vw` is deliberately NOT matched: horizontal
// viewport units have no equivalent iOS problem.
const RAW_VH = /(?<![\w.-])(?:\d+(?:\.\d+)?)(?:d|s|l)?vh\b/

// Comments are not code. Both main.css and Sidebar.tsx explain IN PROSE why a
// raw vh is wrong and what the old declarations looked like; scanning those
// sentences as if they were declarations would make the rule unwritable.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Only a // that starts a line or follows whitespace/punctuation, so the
    // "https://" in a URL (preceded by a colon) is never taken for a comment.
    .replace(/(^|[\s;,{}()])\/\/[^\n]*/gm, '$1')
}

const files = walk(src)

runTest('every convertible raw-vh height goes through --app-vh-100', () => {
  const offenders: string[] = []
  for (const file of files) {
    if (allowedReason(file)) continue
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/)
    lines.forEach((line, index) => {
      if (!RAW_VH.test(line)) return
      offenders.push(`${relative(file)}:${index + 1}  ${line.trim().slice(0, 120)}`)
    })
  }
  assert.deepEqual(
    offenders, [],
    'these sites still use a raw viewport-height unit; use var(--app-vh-100) (or calc(var(--app-vh-100) * .N)) instead:\n  '
      + offenders.join('\n  '),
  )
})

runTest('main.css defines the helper with a vh fallback and a dvh override', () => {
  const css = fs.readFileSync(path.join(src, 'styles', 'main.css'), 'utf8')
  assert.match(css, /:root\s*\{\s*--app-vh-100:\s*100vh;\s*\}/, 'the helper must fall back to 100vh for engines without dvh')
  assert.match(
    css, /@supports \(height: 100dvh\)\s*\{\s*:root\s*\{\s*--app-vh-100:\s*100dvh;\s*\}\s*\}/,
    'the helper must upgrade to 100dvh under @supports, which is what actually excludes the iOS URL bar',
  )
  assert.match(css, /\.h-screen\s*\{\s*height:\s*var\(--app-vh-100\)/, 'the h-screen utility override must read the helper')
  assert.match(css, /\.min-h-screen\s*\{\s*min-height:\s*var\(--app-vh-100\)/, 'the min-h-screen utility override must read the helper')
  for (const modal of ['90', '92', '80', '85', '88']) {
    assert.ok(
      new RegExp('\\.max-h-modal-' + modal + '\\s*\\{\\s*max-height:\\s*calc\\(var\\(--app-vh-100\\)').test(css),
      'max-h-modal-' + modal + ' must read the helper',
    )
  }
})

runTest('the helper is actually consumed across the app, not just defined', () => {
  const consumers = files.filter((file) => (
    !file.endsWith(path.join('styles', 'main.css'))
    && fs.readFileSync(file, 'utf8').includes('--app-vh-100')
  ))
  assert.ok(
    consumers.length >= 25,
    `expected the helper to be read by the converted surfaces, found only ${consumers.length}`,
  )
})

runTest('Sidebar keeps its documented h-full, with no vh recomputation', () => {
  // The mobile sidebar deliberately sizes from its parent rather than
  // recomputing a viewport height; reintroducing calc(100vh - 3.5rem) there
  // reopens the bug its comment describes.
  const sidebar = stripComments(fs.readFileSync(path.join(src, 'components', 'navigation', 'Sidebar.tsx'), 'utf8'))
  assert.equal(
    /className[^\n]*calc\(100vh/.test(sidebar), false,
    'Sidebar.tsx must not reintroduce a vh recomputation -- see its own h-full comment',
  )
})

if (failed > 0) process.exitCode = 1
else console.log('PASS pwaViewportUnits')
