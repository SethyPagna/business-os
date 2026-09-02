// Product bootstrap performance/scoping contract.
//
// POS renders its first product window and branch selector from /bootstrap,
// then fetches faceted filter metadata after the route becomes interactive.
// `metadata=0` must therefore skip loadProductFilters server-side; otherwise
// the bootstrap runs six GROUP BY facet queries plus a promotion-rule query
// whose result POS immediately requests again from /filters.
//
// Run (from cloudflare/): node scripts/test-product-bootstrap-performance-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const routeSource = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
const posSource = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8')

function lift(signature, name) {
  const start = routeSource.indexOf(signature)
  assert.ok(start >= 0, `${name} not found in routes/products.ts`)
  let depth = 0
  let cursor = routeSource.indexOf('{', start)
  const open = cursor
  for (; cursor < routeSource.length; cursor += 1) {
    if (routeSource[cursor] === '{') depth += 1
    else if (routeSource[cursor] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return routeSource.slice(start, cursor + 1)
    .slice(0, open - start) + routeSource.slice(open, cursor + 1)
}

const helperSource = lift(
  'export function shouldLoadProductBootstrapMetadata',
  'shouldLoadProductBootstrapMetadata',
)
  .replace('export ', '')
  .replace(/: unknown/g, '')
  .replace(/: boolean/g, '')
const { shouldLoadProductBootstrapMetadata } = new Function(
  `${helperSource}\nreturn { shouldLoadProductBootstrapMetadata }`,
)()

assert.equal(shouldLoadProductBootstrapMetadata('0'), false, 'metadata=0 must disable bootstrap facets')
assert.equal(shouldLoadProductBootstrapMetadata(0), false, 'numeric zero must disable bootstrap facets')
assert.equal(shouldLoadProductBootstrapMetadata(undefined), true, 'legacy callers keep metadata by default')
assert.equal(shouldLoadProductBootstrapMetadata('1'), true, 'metadata=1 keeps facets enabled')

const bootstrapStart = routeSource.indexOf("app.get('/bootstrap'")
const bootstrapEnd = routeSource.indexOf("app.get('/filters'", bootstrapStart)
assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'bootstrap route block must be present')
const bootstrapSource = routeSource.slice(bootstrapStart, bootstrapEnd)

assert.match(
  bootstrapSource,
  /includeFilterMetadata \? loadProductFilters\(c\.env, query\) : Promise\.resolve\(null\)/,
  'the expensive filter query fan-out must be gated inside the bootstrap Promise.all',
)
assert.doesNotMatch(
  bootstrapSource,
  /\n\s*loadProductFilters\(c\.env, query\),/,
  'bootstrap must not retain an unconditional filter metadata read',
)
assert.match(
  bootstrapSource,
  /SELECT id, name, is_default, is_active FROM branches WHERE is_active = 1/,
  'bootstrap branch metadata must stay limited to the four fields POS consumes',
)
assert.doesNotMatch(bootstrapSource, /SELECT \* FROM branches/, 'bootstrap must not ship unused branch profile fields')

assert.match(posSource, /metadata: '0'/, 'POS must explicitly request the fast bootstrap path')
assert.match(
  posSource,
  /loadPosProductFilters\(scopedQuery\)/,
  'POS must retain the delayed, structurally scoped filter metadata request',
)

console.log('PASS product bootstrap skips seven redundant metadata statements and narrows branch payload')
