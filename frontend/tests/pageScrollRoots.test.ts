// Every admin page mounts inside PageSlot, which is a bounded
// `overflow:hidden; flex:1; flex-direction:column; min-height:0` box. That box
// deliberately does NOT scroll -- the page inside it must own the scroll. So a
// page's root has to resolve to a `.page-scroll` container (flex-1, min-h-0,
// overflow-y-auto), or, for the hub pages, be a height-filling flex column that
// lets the hosted sub-page's own `.page-scroll` fill and scroll.
//
// This was reported for real: PromotionsPage shipped with a plain
// `<div className="p-4 space-y-4 max-w-5xl mx-auto">` root, so everything below
// the fold sat inside PageSlot's clipped box and could not be reached. This test
// reads the live PAGE_IMPORTERS registry in App.tsx and checks every page id, so
// a new page (or a hub that loses its fill wrapper) fails here instead of
// stranding content in the app.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

// The hub pages host sub-pages that carry their own `.page-scroll`; the hub
// itself must be the height-filling flex column that lets that fill work.
const HUB_PAGE_IDS = new Set(['sales', 'branches', 'settings'])
const HUB_FILL_WRAPPER = /flex min-h-0 flex-1 flex-col/

// Parse `PAGE_IMPORTERS = { id: asPageModule(() => import('<path>')), ... }`.
function parsePageImporters(source: string): Array<{ id: string; importPath: string }> {
  const block = source.slice(source.indexOf('const PAGE_IMPORTERS'))
  const entries: Array<{ id: string; importPath: string }> = []
  const re = /(\w+):\s*asPageModule\(\(\)\s*=>\s*import\('([^']+)'\)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(block)) !== null) {
    entries.push({ id: match[1], importPath: match[2] })
    // The map is followed by other code; stop once we leave the object.
    if (block.slice(match.index).indexOf('}') < block.slice(match.index).indexOf(':')) break
  }
  return entries
}

function resolvePageFile(importPath: string): string {
  const base = fileURLToPath(new URL(`../src/${importPath.replace(/^\.\//, '')}`, import.meta.url))
  const candidates = /\.[tj]sx?$/.test(base) ? [base] : [`${base}.tsx`, `${base}.ts`]
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8')
    } catch {
      /* try next */
    }
  }
  throw new Error(`could not read page file for import '${importPath}'`)
}

const importers = parsePageImporters(appSource)

runTest('the page registry was parsed', () => {
  // Guard the parser itself: if App.tsx's shape changes and we silently read
  // zero pages, every other check would vacuously pass.
  assert.ok(importers.length >= 12, `expected the full page registry, parsed ${importers.length}`)
  assert.ok(importers.some((entry) => entry.id === 'promotions'), 'promotions must be in the registry')
})

for (const { id, importPath } of importers) {
  runTest(`page '${id}' provides a scroll container`, () => {
    const source = resolvePageFile(importPath)
    if (HUB_PAGE_IDS.has(id)) {
      assert.match(
        source,
        HUB_FILL_WRAPPER,
        `hub page '${id}' must be a height-filling flex column so its hosted sub-page's page-scroll can fill`,
      )
    } else {
      assert.ok(
        source.includes('page-scroll'),
        `page '${id}' must own a .page-scroll root, or its content gets clipped inside PageSlot`,
      )
    }
  })
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll page-scroll-root checks passed')
