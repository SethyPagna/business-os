// P2-1 design kit: shape checks for components/shared/kit/*. Like
// kitTokens.test.ts, these are source-text assertions (no DOM/CSS engine
// in this test runner) -- they pin export surface and a few structural
// guarantees the brief calls out by name (ControlRow never flex-wraps;
// Fold portals and traps focus).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

function readKitFile(name: string): string {
  return readFileSync(new URL(`../src/components/shared/kit/${name}`, import.meta.url), 'utf8')
}

const indexSrc = readKitFile('index.ts')

const REQUIRED_EXPORTS = [
  'Button', 'IconButton', 'Chip', 'SectionHeader', 'ControlRow', 'OverflowMenu',
  'StatStrip', 'Fold', 'EmptyState', 'Skeleton', 'DenseTable', 'DenseTableExpandCell',
  'TileGrid', 'HubTile', 'zLayers', 'zLayerVar',
]

runTest('kit/index.ts exports every primitive named in the P2-1 brief plus TileGrid/HubTile (decision 19)', () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.match(indexSrc, new RegExp(`\\bas ${name}\\b|\\b${name}\\b,`), `index.ts does not export ${name}`)
  }
})

const REQUIRED_FILES = [
  'Button.tsx', 'IconButton.tsx', 'Chip.tsx', 'SectionHeader.tsx', 'ControlRow.tsx',
  'OverflowMenu.tsx', 'StatStrip.tsx', 'Fold.tsx', 'EmptyState.tsx', 'Skeleton.tsx',
  'DenseTable.tsx', 'TileGrid.tsx', 'HubTile.tsx', 'zLayers.ts',
]

runTest('every primitive file referenced by index.ts exists on disk and has a default export', () => {
  for (const file of REQUIRED_FILES) {
    const src = readKitFile(file)
    if (file === 'zLayers.ts') {
      assert.match(src, /export const zLayers/)
      continue
    }
    // Either a direct `export default function Name` (most primitives) or
    // a `forwardRef`-wrapped component assigned to a const and re-exported
    // as `export default Name` (Button/IconButton, which need a ref).
    assert.match(src, /export default function \w+|export default \w+\s*$/m, `${file} missing a default export`)
  }
})

runTest('ControlRow never uses flex-wrap for its tier layout (the primitive this component replaces)', () => {
  const src = readKitFile('ControlRow.tsx')
  // Scoped to an actual same-line quoted className string, not the
  // explanatory comment's backtick-quoted prose ("hand-rolling its own
  // `flex flex-wrap` toolbar") describing what ControlRow replaces --
  // the character class excludes newlines so the match can't span across
  // an unrelated quote earlier/later in the file (source-shape tests bit
  // by this exact class of bug before: kitTokens.test.ts's prior fixes).
  assert.doesNotMatch(src, /['"][^'"\n]*flex-wrap[^'"\n]*['"]/)
})

runTest('ControlRow measures its own width via ResizeObserver (a container query, not only a window breakpoint)', () => {
  const src = readKitFile('ControlRow.tsx')
  assert.match(src, /new ResizeObserver/)
})

runTest('ControlRow implements all three width tiers from the brief (>=1024 / 768-1023 / <768)', () => {
  const src = readKitFile('ControlRow.tsx')
  assert.match(src, /TIER_WIDE\s*=\s*1024/)
  assert.match(src, /TIER_MEDIUM\s*=\s*768/)
})

runTest('Fold portals to document.body', () => {
  const src = readKitFile('Fold.tsx')
  assert.match(src, /createPortal/)
  assert.match(src, /document\.body/)
})

runTest('Fold traps Tab focus and returns focus to the previously-focused element on close', () => {
  const src = readKitFile('Fold.tsx')
  assert.match(src, /event\.key\s*!==\s*'Tab'|key === 'Tab'/)
  assert.match(src, /previouslyFocusedRef/)
  assert.match(src, /\.focus\(\)/)
})

runTest('Fold closes on Escape and is history-stack aware (back button closes it)', () => {
  const src = readKitFile('Fold.tsx')
  assert.match(src, /Escape/)
  assert.match(src, /popstate/)
  assert.match(src, /pushState/)
})

runTest('Fold never dims/pushes page content the way Modal does (no full-page inset-0 backdrop on the desktop floating-panel branch)', () => {
  const src = readKitFile('Fold.tsx')
  // The mobile bottom-sheet branch is allowed a scrim (`fixed inset-0`);
  // the desktop floating-panel branch must not carry one.
  const desktopBranch = src.slice(src.indexOf('isMobile ? (\n    <div className="fixed inset-0'))
  const afterMobileBranch = desktopBranch.slice(desktopBranch.indexOf(') : ('))
  assert.doesNotMatch(afterMobileBranch.slice(0, 400), /fixed inset-0/)
})

runTest('DenseTable wraps its table in its own overflow-x:auto scroller (never the page)', () => {
  const src = readKitFile('DenseTable.tsx')
  assert.match(src, /overflow-x-auto/)
})

runTest('DenseTable sticky thead uses --z-sticky, scoped to its own scroller', () => {
  const src = readKitFile('DenseTable.tsx')
  assert.match(src, /z-\[var\(--z-sticky\)\]/)
})

runTest('Skeleton respects prefers-reduced-motion', () => {
  const src = readKitFile('Skeleton.tsx')
  assert.match(src, /motion-reduce:animate-none/)
})

runTest('TileGrid renders HubTile items and forwards each item\'s own permission-hidden flag (decision 19: hidden, never disabled)', () => {
  const src = readKitFile('TileGrid.tsx')
  assert.match(src, /HubTile/)
  assert.match(src, /hidden=\{item\.hidden\}/)
})

runTest('HubTile uses the native hidden attribute for a permission gate, not a disabled/greyed style', () => {
  const src = readKitFile('HubTile.tsx')
  assert.match(src, /hidden=\{hidden\}/)
  assert.doesNotMatch(src, /disabled=\{hidden\}/)
})

runTest('HubTile is sized as the ~110px tap tile the design spec calls for, with a 40px icon and a top-right badge', () => {
  const src = readKitFile('HubTile.tsx')
  assert.match(src, /min-h-\[110px\]/)
  assert.match(src, /h-10 w-10/)
  assert.match(src, /absolute right-2 top-2/)
})

if (failed > 0) {
  process.exitCode = 1
}
