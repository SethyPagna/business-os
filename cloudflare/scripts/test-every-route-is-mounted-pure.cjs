// Every file under src/routes must be reachable from index.ts.
//
// Why this exists: routes/customTables.ts sat in the tree for months as a
// fully-written Hono router -- dynamic DDL, a load-bearing SQL identifier
// sanitiser, audit calls -- that index.ts never imported and never mounted.
// It compiled, it typechecked, it shipped inside every Worker bundle, and no
// gate anywhere noticed there was no way to reach it. `git grep -n
// customTables -- cloudflare/src` returned only its own header comment.
//
// An unmounted route is worse than merely dead: it reads as a live, reviewed
// surface. Anyone auditing "which endpoints accept attacker-controlled SQL
// identifiers" finds it and reasons about a route that does not exist, and
// anyone maintaining it maintains nothing. So the invariant is mechanical:
// a router file exists <=> index.ts imports it.
//
// Run: node scripts/test-every-route-is-mounted-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const indexSource = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8')

// Both import shapes index.ts uses: a default router import
//   import salesRoute from './routes/sales'
// and a named factory/helper import
//   import { createSyncRoute } from './routes/sync'
//   import { reapStalledImportJobs } from './routes/importJobs'
function importedRouteModules(source) {
  const found = new Set()
  const pattern = /^import\s+(?:[^'"]*?)\s*from\s+'\.\/routes\/([A-Za-z0-9_-]+)'/gm
  let match
  while ((match = pattern.exec(source)) !== null) found.add(match[1])
  return found
}

const imported = importedRouteModules(indexSource)

// --- positive control ------------------------------------------------------
// A sweep that answers the same way for every input is indistinguishable from
// a broken instrument. Prove the extractor and the comparison both discriminate
// before trusting the real answer: a router that IS imported must be found, and
// a name that is not imported must be reported missing.
assert.ok(imported.has('sales'), 'positive control: routes/sales is imported by index.ts and the extractor must see it')
assert.ok(imported.has('sync'), 'positive control: the named-import shape (createSyncRoute) must be recognised too')
assert.ok(!imported.has('thisRouterDoesNotExist'), 'positive control: an unimported name must NOT be reported as imported')
const controlSource = `${indexSource}\nimport ghostRoute from './routes/ghostRouter'\n`
assert.ok(
  importedRouteModules(controlSource).has('ghostRouter'),
  'positive control: the extractor must pick up a newly added route import',
)

// --- the real sweep --------------------------------------------------------
const routesDir = path.join(root, 'src', 'routes')
const routeFiles = fs.readdirSync(routesDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.replace(/\.ts$/, ''))
  .sort()

assert.ok(routeFiles.length > 20, `sanity: src/routes should hold the Worker's routers, found ${routeFiles.length}`)

const unmounted = routeFiles.filter((name) => !imported.has(name))
assert.deepStrictEqual(
  unmounted,
  [],
  'these src/routes files are never imported by index.ts, so nothing can reach them '
    + `-- delete them or mount them:\n  ${unmounted.join('\n  ')}`,
)

// The reverse direction: index.ts must not import a router file that is gone.
const missingFiles = [...imported].filter((name) => !routeFiles.includes(name))
assert.deepStrictEqual(missingFiles, [], 'index.ts imports route modules that no longer exist')

console.log(`PASS all ${routeFiles.length} src/routes modules are imported by index.ts`)

// The retired custom-tables router specifically: it is the reason this file
// exists, and re-adding it (rather than mounting it) must stay red.
assert.ok(
  !fs.existsSync(path.join(routesDir, 'customTables.ts')),
  'the unreachable custom-tables router must stay deleted, not restored unmounted',
)
console.log('PASS the unreachable custom-tables router is gone')

// What is NOT retired: the custom_tables D1 table still exists in production,
// so factory reset must still drop the dynamically-created tables it lists.
// Deleting the route must not have taken that cleanup path with it.
const coreDataInvariants = fs.readFileSync(path.join(root, 'src', 'lib', 'coreDataInvariants.ts'), 'utf8')
assert.match(
  coreDataInvariants,
  /export async function dropAllCustomTables\(/,
  'factory reset still has to drop the custom tables production already created',
)
assert.match(coreDataInvariants, /SELECT name FROM custom_tables/, 'dropAllCustomTables still reads the metadata table')
const system = fs.readFileSync(path.join(root, 'src', 'routes', 'system.ts'), 'utf8')
assert.match(system, /await dropAllCustomTables\(c\.env\)/, 'the factory-reset route still calls it')
console.log('PASS factory-reset cleanup for existing custom tables is untouched')

console.log('\nevery-route-is-mounted tests passed')
