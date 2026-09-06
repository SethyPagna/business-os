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
