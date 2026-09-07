// Retirement lock for features that were unreachable on BOTH sides.
//
// Dead code that still compiles is not neutral here: it reads as a live,
// reviewed surface. The custom-tables cluster is the worked example -- a
// 749-line CRUD component, a 93-line transport and a Worker router with
// dynamic CREATE TABLE DDL, none of it reachable, all of it shipped. The
// component had zero importers, no App route, no Sidebar entry and no
// permission key; the Worker half is pinned by
// cloudflare/scripts/test-every-route-is-mounted-pure.cjs.
//
// Each section below fails on the pre-deletion tree, so this file is a
// discriminating gate and not a restatement of the current source.
//
// Run: node tests/deadFeatureRetirement.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, '..', 'src')

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(abs, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(abs)
  }
  return out
}

const sourceFiles = collectSourceFiles(srcDir)
const sources = new Map(sourceFiles.map((abs) => [abs, fs.readFileSync(abs, 'utf8')]))

function filesMatching(pattern: RegExp): string[] {
  return [...sources.entries()]
    .filter(([, text]) => pattern.test(text))
    .map(([abs]) => path.relative(srcDir, abs).replace(/\\/g, '/'))
    .sort()
}

// --- positive control ------------------------------------------------------
// A scanner that answers "nothing found" for every pattern is indistinguishable
// from a scanner that is broken. Prove it discriminates on a module that IS
// live before trusting its all-clear on the retired ones.
assert.ok(sourceFiles.length > 200, `expected the frontend source tree, found ${sourceFiles.length} files`)
assert.notDeepEqual(
  filesMatching(/feesTransport\.ts/),
  [],
  'positive control: the live fees transport must still be found by this scanner',
)

// --- 1. the custom-tables cluster is gone from the frontend ----------------

assert.ok(
  !fs.existsSync(path.join(srcDir, 'components', 'custom-tables')),
  'src/components/custom-tables must stay deleted -- it had zero importers, no route, no Sidebar entry and no permission key',
)
assert.ok(
  !fs.existsSync(path.join(srcDir, 'api', 'customTablesTransport.ts')),
  'src/api/customTablesTransport.ts must stay deleted -- its only importer was the unreachable component',
)

assert.deepEqual(
  filesMatching(/customTablesTransport|CustomTables|\/api\/custom-tables|customTables:/),
  [],
  'no source file may reference the retired custom-tables cluster',
)
console.log('PASS the custom-tables cluster is gone from the frontend')

// --- 2. inventoryExport exports exactly what a caller can reach ------------
//
// Part 562 removed the Inventory products slice and its export menu, which
// removed every caller of the summary/stats/package exports -- but the exports
// stayed, and exportInventoryPackage was kept nominally alive by a regex
// assertion in performanceLoadingUx.test.ts, i.e. by a test rather than a user.
// The rule is the general one: an exported function with no caller is deleted,
// and the check is mechanical rather than a name list, so a new orphan is
// caught too.

const inventoryExportPath = path.join(srcDir, 'components', 'inventory', 'inventoryExport.ts')
const inventoryExportSource = fs.readFileSync(inventoryExportPath, 'utf8')

const exportedNames = [...inventoryExportSource.matchAll(/^export\s+(?:async\s+)?(?:function|const|type)\s+([A-Za-z0-9_]+)/gm)]
  .map((match) => match[1])
  .sort()

// positive control: the extractor must actually see the one live export
assert.ok(exportedNames.includes('collectInventoryMovementRows'), 'positive control: the live movements row builder must be extracted')

const importersOfInventoryExport = [...sources.entries()]
  .filter(([abs, text]) => abs !== inventoryExportPath && /inventoryExport\.ts/.test(text))
  .map(([, text]) => text)
  .join('\n')

const unusedExports = exportedNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(importersOfInventoryExport))
assert.deepEqual(
  unusedExports,
  [],
  'inventoryExport.ts exports these with no caller anywhere in src -- delete them rather than shipping an assembly no UI can request:\n  '
    + unusedExports.join('\n  '),
)
console.log(`PASS all ${exportedNames.length} inventoryExport export(s) have a caller`)

// --- 3. the retired strings are gone from BOTH packs ----------------------
//
// A dead key is not merely clutter. stock_desc_low was the worst of them:
// "Shows Low Stock when stock <= 10" states a threshold as fact, while the
// real threshold is owner-configurable per shop and per product
// (utils/lowStockSettings.ts). Had anything rendered it, it would have
// contradicted the list beneath it for every shop that changed the number.
// Its two siblings, stock_desc_in and stock_desc_out, hardcode the same 10.
//
// The other three lost their feature: all_custom_tables and add_table belonged
// to the deleted custom-tables component, and perm_section_users labelled a
// permission section removed when the `users` grant was found to be backend-dead
// (progress.md: the section is admin-only by design, and the label was left
// behind rather than churn the peer-managed packs).
//
// langKeyIntegrity.test.ts is the other half of this: it fails on an OVER-delete
// (a key the source still asks for), so the two together bound the change from
// both sides.

const en = JSON.parse(fs.readFileSync(path.join(srcDir, 'lang', 'en.json'), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(path.join(srcDir, 'lang', 'km.json'), 'utf8')) as Record<string, string>

// positive control: a key that IS live must be present in both packs, so an
// "absent from both packs" pass cannot come from a mis-read file.
assert.ok(en.stock_filter_low_stock && km.stock_filter_low_stock, 'positive control: the live Low Stock filter label must exist in both packs')

const retiredKeys = [
  'add_table',
  'all_custom_tables',
  'perm_section_users',
  'stock_desc_in',
  'stock_desc_low',
  'stock_desc_out',
]

const stillInEn = retiredKeys.filter((key) => key in en)
const stillInKm = retiredKeys.filter((key) => key in km)
assert.deepEqual(stillInEn, [], `these retired keys are still in en.json: ${stillInEn.join(', ')}`)
assert.deepEqual(stillInKm, [], `these retired keys are still in km.json: ${stillInKm.join(', ')}`)

// No stock_desc_* may come back at all: the family exists only to restate a
// threshold the owner controls, so the right place for that sentence is an
// InfoHint that reads the configured number, never a fixed string.
assert.deepEqual(
  Object.keys(en).filter((key) => key.startsWith('stock_desc_')),
  [],
  'a stock_desc_* string hardcodes a threshold the owner configures in lowStockSettings',
)

// And the source must genuinely still resolve the threshold at runtime -- the
// reason those strings were wrong in the first place.
const lowStockSettings = fs.readFileSync(path.join(srcDir, 'utils', 'lowStockSettings.ts'), 'utf8')
assert.match(lowStockSettings, /export function effectiveLowStockThreshold\(/, 'the low-stock threshold is still resolved per shop and per product')
assert.match(lowStockSettings, /if \(config\.mode === 'global'\) return global/, 'a per-product override still beats the global number')

console.log(`PASS all ${retiredKeys.length} retired keys are gone from both packs`)

console.log('\ndeadFeatureRetirement tests passed')
