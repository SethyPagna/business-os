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
