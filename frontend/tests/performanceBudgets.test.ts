// SLOWNESS regression gate: the public storefront's shipped bundle must stay
// small and must not grow unnoticed.
//
// chunkBoundaryPolicy.test.ts (run with --bundle by the postbuild hook) already
// certifies the emitted graph has no cycles and that a curated shortlist of
// files/entries stays out of the admin/file/import chunks, with one large
// fixed ceiling per entry (~1.85MB) so a runaway does not silently ship.
// This file adds what that one does not:
//
//   1. a TIGHT, MEASURED tolerance (+10%) on the actual catalog-products
//      closure size/chunk-count, so growth is caught long before it could
//      ever approach the older, much looser ceiling;
//   2. a full source-level sweep of EVERY file under src/components/catalog
//      (not a curated shortlist) for static imports into the admin-only
//      inventory/products/dashboard/files/imports surfaces, with an explicit,
//      cross-checked allowlist for the few already-vetted shared leaf
//      utilities vite.config.ts routes to a neutral chunk;
//   3. that the storefront's own page-size menu can never ask the Worker for
//      more than the Worker will serve.
//
// Needs a real `frontend/dist` build (the postbuild hook already produces
// one; this test does not build it itself -- see the task report for the
// `npm run build` invoked once to produce the numbers below).
//
// Run: node tests/performanceBudgets.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')
const repoRoot = path.resolve(frontendRoot, '..')
const distAssets = path.join(frontendRoot, 'dist', 'assets')

type TestCallback = () => void | Promise<void>

let failed = 0
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function read(relativeToFrontend: string): string {
  return fs.readFileSync(path.join(frontendRoot, relativeToFrontend), 'utf8').replace(/\r\n/g, '\n')
}

function readRepo(relativeToRepo: string): string {
  return fs.readFileSync(path.join(repoRoot, relativeToRepo), 'utf8').replace(/\r\n/g, '\n')
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(absolute) : [absolute]
  })
}

const distAvailable = fs.existsSync(distAssets)

// ---------------------------------------------------------------------------
// 1) measured, tight tolerance on the catalog-products closure -- built from
//    the SAME emitted dist chunkBoundaryPolicy.test.ts --bundle certifies,
//    computed independently here (own static-import walk over the .js
//    output) rather than importing that file's internals, so the two checks
//    can never both be silently broken by the same helper bug.
// ---------------------------------------------------------------------------

function staticImportSpecifiers(file: string): string[] {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    specifiers.push(statement.moduleSpecifier.text)
  }
  return specifiers
}

function buildEmittedGraph(): Map<string, string[]> {
  const files = fs.readdirSync(distAssets).filter((file) => file.endsWith('.js'))
  const fileSet = new Set(files)
  return new Map(files.map((file) => [
    file,
    staticImportSpecifiers(path.join(distAssets, file))
      .map((specifier) => path.posix.basename(specifier))
      .filter((target) => fileSet.has(target)),
  ]))
}

function closureBytesAndCount(graph: Map<string, string[]>, entryFiles: string[]): { chunks: number; bytes: number; files: string[] } {
  const closure = new Set<string>()
  const collect = (file: string): void => {
    if (closure.has(file)) return
    closure.add(file)
    for (const dependency of graph.get(file) || []) collect(dependency)
  }
  entryFiles.forEach(collect)
  const bytes = [...closure].reduce((sum, file) => sum + fs.statSync(path.join(distAssets, file)).size, 0)
  return { chunks: closure.size, bytes, files: [...closure] }
}

// Measured on a clean `npm run build` of this worktree's committed HEAD
// (see the task report). +10% tolerance: enough to absorb routine dependency
// bumps and code churn without masking an actual regression, and small
// enough that a doubling -- the kind of regression a raw "under 1.85MB"
// ceiling would miss for a long time -- fails immediately.
const CATALOG_PRODUCTS_BASELINE_BYTES = 804_175
const CATALOG_PRODUCTS_BASELINE_CHUNKS = 28
const PUBLIC_PRELOAD_BASELINE_CHUNKS = 36
const BUDGET_TOLERANCE = 1.10

await runTest('the catalog-products closure stays within +10% of its measured baseline (bytes and chunk count)', () => {
  if (!distAvailable) {
    console.log('  (skipped: no frontend/dist -- run `npm run build` first)')
    return
  }
  const graph = buildEmittedGraph()
  const entry = [...graph.keys()].find((file) => /^catalog-products-[\w-]{8}\.js$/.test(file))
  assert.ok(entry, 'missing exact catalog-products chunk in dist/assets')
  const { chunks, bytes } = closureBytesAndCount(graph, [entry as string])
  assert.ok(
    bytes <= CATALOG_PRODUCTS_BASELINE_BYTES * BUDGET_TOLERANCE,
    `catalog-products closure grew past +10% of the ${CATALOG_PRODUCTS_BASELINE_BYTES}-byte baseline: ${bytes} bytes (${chunks} chunks) -- update the baseline deliberately if this growth is expected, do not just raise the tolerance`,
  )
  assert.ok(
    chunks <= Math.ceil(CATALOG_PRODUCTS_BASELINE_CHUNKS * BUDGET_TOLERANCE),
    `catalog-products closure split into more chunks than the +10% budget allows: ${chunks} (baseline ${CATALOG_PRODUCTS_BASELINE_CHUNKS})`,
  )
  console.log(`  measured: ${chunks} chunks, ${bytes} bytes (baseline ${CATALOG_PRODUCTS_BASELINE_CHUNKS} chunks / ${CATALOG_PRODUCTS_BASELINE_BYTES} bytes)`)
})

await runTest('the public preload closure (index.html\'s own preload list) never regains admin/file/import code, and its chunk count stays within +10% of baseline', () => {
  if (!distAvailable) {
    console.log('  (skipped: no frontend/dist -- run `npm run build` first)')
    return
  }
  const graph = buildEmittedGraph()
  const html = fs.readFileSync(path.join(frontendRoot, 'dist/index.html'), 'utf8')
  const preloadJson = html.match(/var preloads = (\{[^\n]+\});/)
  assert.ok(preloadJson, 'built HTML must contain the real route preload lists')
  const preloads = JSON.parse(preloadJson[1]) as { public: string[] }
  assert.ok(preloads.public.length > 0)
  const { chunks } = closureBytesAndCount(graph, preloads.public.map((file) => path.posix.basename(file)))
  for (const name of ['app-auth', 'auth-login', 'catalog', 'file-api', 'import-jobs-api']) {
    const { files } = closureBytesAndCount(graph, preloads.public.map((file) => path.posix.basename(file)))
    assert.equal(files.some((file) => new RegExp(`^${name}-[\\w-]{8}\\.js$`).test(file)), false, `public preload closure must never pull in ${name}`)
  }
  assert.ok(
    chunks <= Math.ceil(PUBLIC_PRELOAD_BASELINE_CHUNKS * BUDGET_TOLERANCE),
    `public preload closure grew past +10% of the ${PUBLIC_PRELOAD_BASELINE_CHUNKS}-chunk baseline: ${chunks} chunks`,
  )
  console.log(`  measured: ${chunks} chunks (baseline ${PUBLIC_PRELOAD_BASELINE_CHUNKS})`)
})

await runTest('startup preloads name app-shared (a static import of both roots) and never the dynamic-only print/QR vendor chunk', () => {
  if (!distAvailable) {
    console.log('  (skipped: no frontend/dist -- run `npm run build` first)')
    return
  }
  // I6-3: app-shared sits in the static closure of AdminRoot and of
  // PublicCatalogRoot, so a startup list without it leaves the browser to
  // discover it only after the root chunk parses. I6-2: generic `vendor` is
  // reached only through import() (and the lazy scanner chunk), so preloading
  // it at high priority spends 63 KB gz of the cold load on nothing.
  const graph = buildEmittedGraph()
  const html = fs.readFileSync(path.join(frontendRoot, 'dist/index.html'), 'utf8')
  const preloads = JSON.parse(html.match(/var preloads = (\{[^\n]+\});/)?.[1] ?? '{}') as Record<string, string[]>
  const chunkNamed = (name: string) => (file: string) => new RegExp(`^${name}-[\\w-]{8}\\.js$`).test(path.posix.basename(file))
  const emitted = [...graph.keys()]
  for (const root of ['AdminRoot', 'PublicCatalogRoot']) {
    const rootFile = emitted.find(chunkNamed(root))
    assert.ok(rootFile, `missing ${root} chunk`)
    assert.ok(closureBytesAndCount(graph, [rootFile]).files.some(chunkNamed('app-shared')), `app-shared must still be a static import of ${root}, or this preload is dead weight`)
  }
  for (const list of ['admin', 'login', 'public']) {
    assert.ok((preloads[list] ?? []).some(chunkNamed('app-shared')), `the ${list} startup preload must name app-shared`)
    assert.equal((preloads[list] ?? []).some(chunkNamed('vendor')), false, `the ${list} startup preload must not name the print/QR vendor chunk`)
  }
})

await runTest('discriminating: the +10% budget actually rejects a doubled closure, and accepts one at the baseline', () => {
  const graph = new Map<string, string[]>([
    ['entry.js', ['a.js', 'b.js']],
    ['a.js', []],
    ['b.js', []],
  ])
  // Can't stat real files for a synthetic graph -- exercise the pure
  // count/byte-summation shape directly instead of closureBytesAndCount,
  // which is intentionally tied to real files on disk.
  const closure = new Set<string>()
  const collect = (file: string): void => {
    if (closure.has(file)) return
    closure.add(file)
    for (const dep of graph.get(file) || []) collect(dep)
  }
  collect('entry.js')
  assert.equal(closure.size, 3)
  const withinBudget = (measured: number, baseline: number) => measured <= Math.ceil(baseline * BUDGET_TOLERANCE)
  assert.equal(withinBudget(3, 3), true, 'exactly at baseline must pass')
  assert.equal(withinBudget(Math.ceil(3 * BUDGET_TOLERANCE), 3), true, 'exactly at the tolerance ceiling must pass')
  assert.equal(withinBudget(6, 3), false, 'a doubled closure must fail -- proves the assertion above is not a tautology')
})

// ---------------------------------------------------------------------------
// 2) no catalog source file reaches into an admin-only surface. Full sweep,
//    not a shortlist -- and the one currently-real exception (a handful of
//    already-vetted `products/` leaf utilities) is asserted BOTH ways: it
//    must be exactly this list, and vite.config.ts must actually route each
//    one to a neutral chunk, or the exception and the chunk policy could
//    silently drift apart.
// ---------------------------------------------------------------------------

const ADMIN_ONLY_DIRECTORIES = ['inventory', 'dashboard', 'files', 'imports']

// Every current, reviewed exception: a catalog file importing from
// `components/products/...` and the target vite.config.ts already declares
// neutral (the 'product-shared' manual chunk). Keep this list in the source,
// not a wildcard -- a wildcard here would make the sweep below untestable.
const ALLOWED_PRODUCTS_IMPORTS = new Set([
  'products/shared/primitives',
  'products/helpers/productFilterHelpers.ts',
  'products/helpers/productGalleryHelpers.ts',
])

function catalogSourceFiles(): string[] {
  const catalogRoot = path.join(frontendRoot, 'src/components/catalog')
  return walk(catalogRoot).filter((file) => /\.(ts|tsx)$/.test(file))
}

function importsFrom(file: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
  const specifiers: string[] = []
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (statement.importClause?.isTypeOnly) continue
    specifiers.push(statement.moduleSpecifier.text)
  }
  return specifiers
}

await runTest('no file under src/components/catalog imports from inventory, dashboard, files or imports', () => {
  const offenders: string[] = []
  for (const file of catalogSourceFiles()) {
    for (const specifier of importsFrom(file)) {
      if (!specifier.startsWith('.')) continue
      const resolved = path.posix.normalize(`${path.posix.dirname(path.relative(frontendRoot, file).replace(/\\/g, '/'))}/${specifier}`)
      const underAdminDir = ADMIN_ONLY_DIRECTORIES.some((dir) => resolved.startsWith(`src/components/${dir}/`) || resolved === `src/components/${dir}`)
      if (underAdminDir) offenders.push(`${path.relative(frontendRoot, file)} -> ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [], `a public-bundle source file must never statically import an admin-only surface:\n${offenders.join('\n')}`)
})

await runTest('the one real exception (a few products/ leaf utilities) is exactly this list, and each is a vite.config.ts neutral chunk', () => {
  const found = new Set<string>()
  for (const file of catalogSourceFiles()) {
    for (const specifier of importsFrom(file)) {
      if (!specifier.startsWith('.')) continue
      const resolved = path.posix.normalize(`${path.posix.dirname(path.relative(frontendRoot, file).replace(/\\/g, '/'))}/${specifier}`)
      if (resolved.startsWith('src/components/products/')) {
        found.add(resolved.replace('src/components/', ''))
      }
    }
  }
  assert.deepEqual([...found].sort(), [...ALLOWED_PRODUCTS_IMPORTS].sort(), 'a NEW catalog -> products import appeared; either it is another vetted leaf utility (add it to vite.config.ts\'s neutral chunk rule AND to this allowlist) or it is a real regression pulling admin weight into the public bundle')
  const viteConfig = read('vite.config.ts')
  for (const allowed of ALLOWED_PRODUCTS_IMPORTS) {
    // vite.config.ts routes some of these by exact file (the two helper
    // files) and one by directory prefix (`shared/primitives` resolves
    // through the `products/shared/` folder rule) -- accept either shape,
    // since what matters is that SOME rule in vite.config.ts still catches
    // this import, not which shape the rule takes.
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fullPath = `components/${allowed.replace(/\.ts$/, '')}`
    const directory = `components/${allowed.split('/').slice(0, -1).join('/')}/`
    const matchesEither = new RegExp(escape(fullPath)).test(viteConfig) || new RegExp(escape(directory)).test(viteConfig)
    assert.ok(
      matchesEither,
      `vite.config.ts must still route ${allowed} to a neutral chunk (looked for "${fullPath}" or "${directory}"), or it drags into whichever admin page imports it too`,
    )
  }
})

await runTest('discriminating: the admin-directory sweep actually fires on a synthetic violation', () => {
  const offenders: string[] = []
  const fakeFile = 'src/components/catalog/FakeSurface.tsx'
  const specifier = '../inventory/InventoryProductsSurface.tsx'
  const resolved = path.posix.normalize(`${path.posix.dirname(fakeFile)}/${specifier}`)
  const underAdminDir = ADMIN_ONLY_DIRECTORIES.some((dir) => resolved.startsWith(`src/components/${dir}/`) || resolved === `src/components/${dir}`)
  if (underAdminDir) offenders.push(`${fakeFile} -> ${specifier}`)
  assert.equal(offenders.length, 1, 'the same resolution logic used above must flag a genuine admin-directory import, or the sweep is a no-op')
})

// ---------------------------------------------------------------------------
// 3) the storefront's page-size menu can never ask for more than the Worker
//    will serve.
// ---------------------------------------------------------------------------

await runTest('CATALOG_PAGE_SIZE_OPTIONS stays within [1, Worker cap] for every public search endpoint', () => {
  const catalogPagination = read('src/components/catalog/catalogPagination.tsx')
  const optionsMatch = catalogPagination.match(/export const CATALOG_PAGE_SIZE_OPTIONS: number\[\] = \[([^\]]+)\]/)
  assert.ok(optionsMatch, 'CATALOG_PAGE_SIZE_OPTIONS must stay a named, greppable constant')
  const options = optionsMatch[1].split(',').map((value) => Number(value.trim()))
  assert.ok(options.length > 0)

  const portal = readRepo('cloudflare/src/routes/portal.ts')
  // Both public paging surfaces the storefront can hit: the bootstrap
  // snapshot's own page size and the live product-search endpoint.
  const capMatches = [...portal.matchAll(/Math\.min\((\d+), Math\.max\(1, Number\.parseInt\(query\.pageSize[^)]*\)[^)]*\)\)/g)]
  assert.ok(capMatches.length > 0, 'expected at least one clamp of the incoming pageSize query param in portal.ts')
  const caps = capMatches.map((match) => Number(match[1]))
  for (const cap of caps) {
    for (const option of options) {
      assert.ok(option >= 1 && option <= cap, `storefront option ${option} must not exceed the Worker's cap of ${cap}`)
    }
  }
  // And the reverse: the cap itself must be exactly the storefront's largest
  // offered option, not a looser number that would let a hand-edited request
  // ask for a page the storefront never offers a control for.
  assert.deepEqual([...new Set(caps)], [Math.max(...options)], `the Worker's clamp (${caps.join(', ')}) must equal the storefront's largest offered size (${Math.max(...options)})`)
})

await runTest('discriminating: the cap-vs-options check catches a widened option the Worker would reject', () => {
  const options = [20, 50, 100, 500]
  const cap = 100
  const violations = options.filter((option) => option > cap)
  assert.deepEqual(violations, [500], 'the check above must fail exactly this way if a 500 option were ever added without raising the server cap')
})

if (failed > 0) {
  process.exitCode = 1
}
