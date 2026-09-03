// P2-9 finding 2 (user decision 8): iOS Safari auto-zooms the whole page when a
// focused form control's COMPUTED font-size is below 16px, and only a user
// gesture undoes that zoom. Below 768px every admin control must therefore land
// at 16px or more; from 768px up decision 8 keeps them at 13px.
//
// This pins the two things a browser probe cannot: that the floor rule exists at
// all, and that its selector is specific enough to beat the `!important` size
// utilities in the same stylesheet. Specificity is arithmetic, so it is computed
// here rather than eyeballed.
//
// Run: node tests/pwaInputZoom.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
// Comments are stripped first: main.css documents its own rules heavily, and a
// prose mention of a selector must never be parsed as one.
const mainCss = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokensCss = fs.readFileSync(path.join(root, 'src', 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

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

type Specificity = [number, number, number]

/** (id, class/attribute/pseudo-class, element) -- the CSS cascade's triple. */
function specificity(selector: string): Specificity {
  const base = selector.replace(/::[a-z-]+/g, ' ')
  const ids = (base.match(/#[\w-]+/g) || []).length
  // :not() contributes its ARGUMENT's specificity and none of its own, so
  // scanning the whole string for classes/attributes (which reaches inside the
  // parentheses) while skipping the :not token itself is exactly the rule.
  const classes = (base.match(/\.(?:\\.|[\w-])+/g) || []).length
    + (base.match(/\[[^\]]*\]/g) || []).length
    + (base.match(/:(?!not\b)[a-z-]+(?:\([^)]*\))?/g) || []).length
  const bare = base
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/:[a-z-]+(?:\([^)]*\))?/g, ' ')
    .replace(/\.(?:\\.|[\w-])+/g, ' ')
    .replace(/#[\w-]+/g, ' ')
  const elements = (bare.match(/\b[a-z][\w-]*\b/g) || []).length
  return [ids, classes, elements]
}

function compare(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

// Locate the floor by its declaration, then read back out to its selector list
// and its enclosing at-rule -- so the test follows the stylesheet rather than
// restating it.
const declarationAt = mainCss.indexOf('font-size: max(16px')
assert.notEqual(declarationAt, -1, 'main.css must declare a font-size: max(16px, ...) floor for form controls')
const openBrace = mainCss.lastIndexOf('{', declarationAt)
const selectorStart = Math.max(mainCss.lastIndexOf('}', openBrace), mainCss.lastIndexOf('{', openBrace - 1)) + 1
const floorSelectorText = mainCss.slice(selectorStart, openBrace)
const floorBody = mainCss.slice(openBrace + 1, mainCss.indexOf('}', declarationAt))
const atRuleAt = mainCss.lastIndexOf('@media', selectorStart)
const floorAtRule = mainCss.slice(atRuleAt, mainCss.indexOf('{', atRuleAt)).trim()
const floorSelectors = floorSelectorText.split(',').map((s) => s.trim()).filter(Boolean)

runTest('the floor is mobile-only and at least 16px', () => {
  assert.match(
    floorAtRule, /@media\s*\(max-width:\s*767px\)/,
    'the floor must be inside @media (max-width: 767px) -- decision 8 keeps 13px on desktop, and desktop browsers never zoom on focus',
  )
  assert.match(floorBody, /font-size:\s*max\(16px/, 'the floor must be at least 16px')
  assert.match(floorBody, /!important/, 'the floor must be !important or the size utilities (which are) win')
  for (const tag of ['input', 'select', 'textarea']) {
    assert.ok(new RegExp('\\b' + tag + '\\b').test(floorSelectorText), 'the floor must cover <' + tag + '>')
  }
})

runTest('the floor is scoped to the admin shell, never the storefront', () => {
  // index.html classifies /catalog as an admin route even on the public host
  // (it mirrors isPublicCatalogPath), so the pre-paint attribute alone is not
  // enough -- CatalogPage's runtime data-public-portal marker is the other
  // half. Both are required: the storefront keeps its own design.
  assert.ok(
    floorSelectorText.includes('[data-business-os-initial-route="public"]'),
    'the floor must exclude the pre-paint public route',
  )
  assert.ok(
    floorSelectorText.includes('[data-public-portal="true"]'),
    'the floor must also exclude the runtime storefront marker',
  )
})

runTest('checkbox and radio are excluded from the floor', () => {
  assert.ok(floorSelectorText.includes(':not([type="checkbox"])'), 'checkboxes render no text and size their box from font-size')
  assert.ok(floorSelectorText.includes(':not([type="radio"])'), 'radios render no text and size their box from font-size')
})

runTest('no !important size utility can beat the floor', () => {
  const weakest = floorSelectors.map(specificity).reduce((low, next) => (compare(next, low) < 0 ? next : low))

  // Every other !important font-size rule in the same stylesheet is a
  // competitor. At EQUAL specificity source order would decide, which is too
  // fragile to rely on, so the floor must be strictly higher than all of them.
  const competitors: Array<{ selector: string; spec: Specificity }> = []
  for (const match of mainCss.matchAll(/([^{}]+)\{([^{}]*font-size:[^{}]*!important[^{}]*)\}/g)) {
    if (/max\(16px/.test(match[2])) continue
    for (const selector of match[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (selector.startsWith('@') || selector.includes('{')) continue
      competitors.push({ selector, spec: specificity(selector) })
    }
  }
  assert.ok(competitors.length > 5, 'expected to find the !important size utilities this floor has to outrank, found ' + competitors.length)

  const winners = competitors.filter((c) => compare(c.spec, weakest) >= 0)
  assert.deepEqual(
    winners.map((c) => c.selector + ' ' + JSON.stringify(c.spec)), [],
    'these !important font-size rules are at least as specific as the weakest floor selector ' + JSON.stringify(weakest) + ' and would steal the 16px floor back',
  )
})

runTest('--ui-input-size still supplies 16px below 768px and 13px above', () => {
  // The floor is belt-and-braces over this token, not a second source of
  // truth; if the token stops agreeing, the two disagree about desktop.
  assert.match(tokensCss, /--ui-input-size:\s*16px/, 'tokens.css must define --ui-input-size: 16px for the mobile range')
  assert.ok(
    /@media[^{]*min-width:\s*768px[^{]*\{[\s\S]{0,600}?--ui-input-size:\s*13px/.test(tokensCss),
    'tokens.css must drop --ui-input-size to 13px from 768px up (decision 8 keeps desktop at 13px)',
  )
})

runTest('the floor carries no :not(.text-*) carve-outs', () => {
  // Naming a class that main.css also defines as a top-level rule makes
  // Tailwind clone this whole rule for every @apply of that class, re-emitted
  // with the class swapped -- a duplicate that no longer excludes it, which
  // defeats the carve-out while doubling the CSS. Verified in dist/.
  assert.equal(
    /:not\(\.text-/.test(floorSelectorText), false,
    'a :not(.text-*) exclusion here is silently defeated by Tailwind @apply selector cloning -- keep the floor flat',
  )
})

if (failed > 0) process.exitCode = 1
else console.log('PASS pwaInputZoom')
