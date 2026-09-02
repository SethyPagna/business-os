// P2-1 design kit: tokens.css + fonts.css shape checks. These are
// source-text assertions (no CSS engine in this test runner) -- they pin
// the token names, the light/dark palette split, and that the app never
// falls back to auto-honouring OS dark mode (decision 5: manual `.dark`
// toggle only, never `prefers-color-scheme`).
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    // Sep 3 2026: RenameCascadeModal portals to document.body from inside a level-3
// Modal; a literal z-[60] put it UNDER --z-modal (1050) and rename hung forever.
const renameCascade = readFileSync(new URL('../src/components/shared/RenameCascadeModal.tsx', import.meta.url), 'utf8')
assert.match(renameCascade, /z-\[var\(--z-modal-2\)\]/, 'RenameCascadeModal must stack on the modal-over-modal layer')
assert.doesNotMatch(renameCascade, /z-\[60\]/, 'RenameCascadeModal must not use a literal z-index below the modal layer')

console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const tokensPath = new URL('../src/styles/tokens.css', import.meta.url)
const fontsPath = new URL('../src/styles/fonts.css', import.meta.url)
const mainPath = new URL('../src/styles/main.css', import.meta.url)
const tokens = readFileSync(tokensPath, 'utf8')
const fonts = readFileSync(fontsPath, 'utf8')
const main = readFileSync(mainPath, 'utf8')

const REQUIRED_TOKENS = [
  '--ui-ground', '--ui-surface', '--ui-surface-2',
  '--ui-ink', '--ui-ink-2', '--ui-ink-3',
  '--ui-line', '--ui-line-2',
  '--ui-accent-ink', '--ui-accent-soft',
  '--ui-danger', '--ui-success', '--ui-warn', '--ui-info', '--ui-focus', '--ui-backdrop',
  '--ui-shadow-1', '--ui-shadow-2', '--ui-shadow-3',
  '--ui-radius-sm', '--ui-radius-lg',
  '--ui-space-1', '--ui-space-2', '--ui-space-3', '--ui-space-4', '--ui-space-5', '--ui-space-6',
  '--ui-font-body', '--ui-font-display', '--ui-font-khmer-body', '--ui-font-khmer-display',
  '--ui-size-meta', '--ui-size-body', '--ui-size-h3', '--ui-size-h2', '--ui-size-h1',
  '--ui-row-h', '--ui-control-h', '--ui-icon-lg', '--ui-icon-sm', '--ui-input-size',
  '--z-sticky', '--z-dropdown', '--z-fold', '--z-modal', '--z-modal-2', '--z-toast',
]

runTest('tokens.css declares every design-kit token', () => {
  for (const token of REQUIRED_TOKENS) {
    assert.match(tokens, new RegExp(`${token}\\s*:`), `missing token ${token}`)
  }
})

runTest('tokens.css defines a light default and a manual .dark override only', () => {
  assert.match(tokens, /:root\s*\{/)
  assert.match(tokens, /:root\.dark,\s*\n?\s*\.dark\s*\{/)
  assert.doesNotMatch(tokens, /@media\s*\(\s*prefers-color-scheme/)
})

runTest('main.css never auto-honours OS dark mode via prefers-color-scheme colour rules', () => {
  // Matches only an actual @media(prefers-color-scheme) at-rule, not the
  // phrase appearing in an explanatory code comment.
  assert.doesNotMatch(main, /@media\s*\(\s*prefers-color-scheme/)
})

runTest('main.css imports tokens.css before fonts.css, both before @tailwind base', () => {
  const tokensIdx = main.indexOf("@import './tokens.css'")
  const fontsIdx = main.indexOf("@import './fonts.css'")
  const tailwindIdx = main.indexOf('@tailwind base')
  assert.ok(tokensIdx >= 0, 'tokens.css not imported')
  assert.ok(fontsIdx >= 0, 'fonts.css not imported')
  assert.ok(tokensIdx < fontsIdx, 'tokens.css must be imported before fonts.css')
  assert.ok(fontsIdx < tailwindIdx, 'both imports must precede @tailwind base')
})

runTest('main.css no longer declares the dead --ui-page-bg / --ui-sidebar-bg vars', () => {
  assert.doesNotMatch(main, /--ui-page-bg\s*:\s*;/)
  assert.doesNotMatch(main, /--ui-sidebar-bg\s*:\s*;/)
  // The dead `body:has([data-page-bg])` rule is gone; a comment explaining
  // the removal (which mentions the attribute name in prose) may remain.
  assert.doesNotMatch(main, /\[data-page-bg\]/)
})

runTest('main.css .input reads --ui-input-size (mobile-zoom-safe token, not a fixed px)', () => {
  assert.match(main, /\.input\s*\{[\s\S]*?font-size:\s*var\(--ui-input-size/)
})

runTest('main.css deterministically resolves the .input vs .text-xs/.text-sm font-size fight', () => {
  assert.match(main, /input\.input\.text-xs,\s*textarea\.input\.text-xs,\s*select\.input\.text-xs/)
})

const FONT_FAMILIES: Array<{ family: string; dir: string; weights: number[] }> = [
  { family: 'Inter', dir: 'inter', weights: [400, 500, 600] },
  { family: 'Source Serif 4', dir: 'source-serif-4', weights: [500, 600] },
  { family: 'Noto Sans Khmer', dir: 'noto-sans-khmer', weights: [400, 500, 600] },
  { family: 'Noto Serif Khmer', dir: 'noto-serif-khmer', weights: [500, 600] },
]

runTest('fonts.css declares an @font-face for every required family/weight, self-hosted under /fonts', () => {
  for (const { family, dir, weights } of FONT_FAMILIES) {
    for (const weight of weights) {
      const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const block = new RegExp(
        `font-family:\\s*'${escapedFamily}';[\\s\\S]{0,200}?font-weight:\\s*${weight};[\\s\\S]{0,200}?src:\\s*url\\('/fonts/${dir}/`
      )
      assert.match(fonts, block, `missing @font-face for ${family} ${weight}`)
    }
  }
})

runTest('fonts.css gives the Khmer faces a unicode-range so Latin pages never fetch them', () => {
  const khmerBlocks = fonts.split("font-family: 'Noto Sans Khmer'").slice(1)
    .concat(fonts.split("font-family: 'Noto Serif Khmer'").slice(1))
  assert.ok(khmerBlocks.length >= 5, 'expected at least 5 Khmer @font-face blocks (3 sans + 2 serif)')
  for (const block of khmerBlocks) {
    assert.match(block.slice(0, 300), /unicode-range:\s*U\+1780-17FF/)
  }
})

runTest('every referenced woff2 file actually exists under public/fonts', () => {
  const urlRe = /url\('(\/fonts\/[^']+\.woff2)'\)/g
  let match: RegExpExecArray | null
  let count = 0
  while ((match = urlRe.exec(fonts)) !== null) {
    count += 1
    const diskPath = new URL(`../public${match[1]}`, import.meta.url)
    assert.ok(existsSync(diskPath), `font file missing on disk: public${match[1]}`)
  }
  assert.ok(count >= 10, `expected at least 10 font-face src urls, found ${count}`)
})

runTest('zLayers.ts mirrors tokens.css --z-* values exactly (no drift between the two sources)', () => {
  const zLayersSrc = readFileSync(new URL('../src/components/shared/kit/zLayers.ts', import.meta.url), 'utf8')
  const cssZ: Record<string, number> = {}
  for (const match of tokens.matchAll(/--z-([a-z0-9-]+):\s*(\d+);/g)) {
    cssZ[match[1]] = Number(match[2])
  }
  const nameMap: Record<string, string> = {
    sticky: 'sticky', dropdown: 'dropdown', fold: 'fold',
    modal: 'modal', modal2: 'modal-2', toast: 'toast',
  }
  for (const [jsName, cssName] of Object.entries(nameMap)) {
    const jsMatch = zLayersSrc.match(new RegExp(`${jsName}:\\s*(\\d+),`))
    assert.ok(jsMatch, `zLayers.ts missing ${jsName}`)
    assert.ok(cssName in cssZ, `tokens.css missing --z-${cssName}`)
    assert.equal(Number(jsMatch![1]), cssZ[cssName], `zLayers.${jsName} (${jsMatch![1]}) must equal tokens.css --z-${cssName} (${cssZ[cssName]})`)
  }
})

runTest('Modal.tsx reads --z-modal and --ui-backdrop instead of a literal z-index/black overlay', () => {
  const modal = readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
  assert.match(modal, /className="[^"]*z-\[var\(--z-modal\)\][^"]*"/)
  assert.match(modal, /var\(--ui-backdrop\)/)
  assert.doesNotMatch(modal, /className="[^"]*bg-black\/50[^"]*"/)
})

runTest('tailwind.config.ts exposes the ui-* tokens as theme extensions', () => {
  const tw = readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8')
  assert.match(tw, /'ui-ground':\s*'var\(--ui-ground\)'/)
  assert.match(tw, /'ui-body':\s*'var\(--ui-font-body\)'/)
})

if (failed > 0) {
  process.exitCode = 1
}
