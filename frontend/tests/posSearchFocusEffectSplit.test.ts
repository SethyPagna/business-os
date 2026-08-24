import assert from 'node:assert/strict'
import fs from 'node:fs'

// Regression test for the "POS Groups filter -- not showing, slow, just
// refreshing" bug (see progress.md). Root cause: `searchRef.current?.focus()`
// lived inside the same effect that re-runs on every `loadCatalogData`
// identity change (i.e. every filter/search/page change), not just on the
// POS tab's initial activation. That yanked focus back to the search box on
// every filter click, disrupting the still-open filter popover.
//
// The fix split that one `useEffect` into two:
//   1. The data-reload effect, keyed on `[isActive, loadCatalogData]`, with
//      no focus call in its body.
//   2. A separate effect keyed only on `[isActive]` that does the one-time
//      `searchRef.current?.focus()`.
//
// This test reads the actual POS.tsx source and asserts that shape holds,
// so a future edit can't silently merge the focus call back into the
// filter-driven reload effect.
//
// The one-time focus effect was later extended (separate fix, for the
// "mobile keyboard pops up on every product tap" report) to also gate on
// `isDesktopViewport` -- popping the on-screen keyboard the instant the POS
// tab activates, before anyone has tapped the search box themselves, is
// unwanted on mobile. The assertion below matches that current two-condition/
// two-dependency shape rather than the original single-condition one.

const posSource = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('data-reload effect (keyed on loadCatalogData) does not call searchRef.focus()', () => {
  // Anchor on the unique closing line of this specific effect, then look
  // backward a bounded window rather than matching from any/every earlier
  // "useEffect(() => {" in the file (there are many, and a greedy/lazy
  // regex spanning the whole file would false-pass or false-fail).
  const closer = "}, [isActive, loadCatalogData])"
  const closerIndex = posSource.indexOf(closer)
  assert.ok(closerIndex !== -1, 'expected to find the catalog-reload effect closing on [isActive, loadCatalogData]')
  const windowStart = Math.max(0, closerIndex - 1200)
  const reloadEffectBody = posSource.slice(windowStart, closerIndex + closer.length)
  assert.match(reloadEffectBody, /void loadCatalogData\('POS catalog'\)/, 'sanity check: window should contain the reload call')
  assert.doesNotMatch(
    reloadEffectBody,
    /searchRef\.current\?.focus\(\)/,
    'searchRef focus() must not live inside the effect that re-fires on every filter change -- this is the exact regression that caused the Groups-filter popover disruption bug',
  )
})

await runTest('a separate effect keyed on [isActive, isDesktopViewport] performs the one-time, desktop-only search focus', () => {
  const focusEffectMatch = posSource.match(
    /useEffect\(\(\) => \{\s*\n\s*if \(!isActive \|\| !isDesktopViewport\) return\s*\n\s*searchRef\.current\?.focus\(\)[\s\S]*?\}, \[isActive, isDesktopViewport\]\)/,
  )
  assert.ok(
    focusEffectMatch,
    'expected a standalone useEffect keyed on [isActive, isDesktopViewport] that calls searchRef.current?.focus() once on tab activation, desktop only',
  )
})

if (failed > 0) {
  process.exitCode = 1
}
