// Regression lock for the Part-77 "receipt & three helpers ignore the mm/dd +
// 24h rule" finding. Three duplicated date helpers rendered a bare
// `date.toLocaleString()` -- no locale, no timeZone -- so they printed the
// VIEWER's locale (dd/mm, 12-hour) and the viewer's timezone instead of the
// app-wide en-US mm/dd/yyyy 24-hour Phnom Penh format. Each now routes through
// the canonical fmtTime. This is a source lock: it fails if any of the three
// helpers goes back to a bare toLocaleString() date, or drops the fmtTime wire.
//
// (Number formatting like price.toLocaleString('en-US', { ... }) is fine and
// intentionally untouched -- the check targets the argument-less date call.)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const FILES = [
  'src/components/catalog/CatalogPage.tsx',
  'src/components/catalog/PublicCatalogPage.tsx',
  'src/components/loyalty-points/LoyaltyPointsPage.tsx',
]

for (const file of FILES) {
  await runTest(`${file} formats dates through fmtTime, never a bare toLocaleString()`, () => {
    const src = readFrontend(file)
    // The exact buggy call: a Date formatted with no locale/timezone args.
    assert.doesNotMatch(
      src,
      /\bdate\.toLocaleString\(\s*\)/,
      'a bare date.toLocaleString() reintroduces the viewer-locale (dd/mm, 12h) date bug',
    )
    // The fix must stay wired in.
    assert.match(src, /import \{ fmtTime \} from '\.\.\/\.\.\/utils\/formatters\.ts'/)
    assert.match(src, /:\s*fmtTime\(raw\)/, 'the date helper must delegate to fmtTime')
  })
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll catalog/loyalty date-format locks passed')
