// BLANK PAGE and RUNTIME ERROR regression gate for the app's startup path.
//
// Everything here pins a way the shell has actually gone blank or thrown
// during boot, on either the admin app or the public storefront:
//
//   a) a throwing localStorage/sessionStorage (Safari private mode, "block
//      all cookies") must never escape a startup read/write and blank the
//      shell -- checked by REAL execution against an actually-throwing
//      Storage, not just a grep for `try`.
//   b) the public storefront's embedded/cached bootstrap payload can be
//      missing, malformed JSON, oversized, or cut at a page size the viewer
//      didn't choose -- the shopper must still end up with a real product
//      search, never an empty grid parked under a pager that disagrees
//      with it.
//   c) a failed lazy chunk import (the shape a stale deploy produces) must
//      end at an actionable "Reload page" control, never an unhandled
//      rejection with nothing on screen.
//   d) the top-level per-page error boundary must always paint visible,
//      non-empty text plus a working retry/reload action -- proven for the
//      admin page slot and separately for the public catalog route.
//   e) the inline theme bootstrap must default to light, never touch
//      matchMedia, and never throw even when every storage read fails.
//   f) the built-startup postbuild verifier must still run the real chunk
//      graph checks it claims to run.
//
// Run: node tests/startupResilience.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '..')
const repoRoot = path.resolve(frontendRoot, '..')

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

// ---------------------------------------------------------------------------
// Small in-memory sandbox to run a slice of real TS/TSX source (not a
// reimplementation of it) against a controlled `window`/`document`. Bundling
// through esbuild -- the same tool this repo's own lazyPortalMenuFirstClick
// harness uses to run real TSX in a browser -- lets a plain-Node test call
// exported functions from a file the type-stripping loader alone cannot run
// (catalogPagination.tsx and PublicCatalogPage.tsx carry JSX in the same
// module as the plain functions under test here).
// ---------------------------------------------------------------------------
async function runSource<T = Record<string, unknown>>(source: string, loader: 'ts' | 'tsx' = 'ts'): Promise<T> {
  const built = await build({
    stdin: { contents: source, loader, resolveDir: frontendRoot, sourcefile: 'startup-resilience-fixture.tsx' },
    bundle: false,
    format: 'esm',
    platform: 'neutral',
    write: false,
  })
  const code = built.outputFiles[0].text
  const file = path.join(os.tmpdir(), `bos-startup-resilience-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  fs.writeFileSync(file, code)
  try {
    return await import(`${'file://'}${file.replace(/\\/g, '/')}`) as T
  } finally {
    fs.unlinkSync(file)
  }
}

/** A Storage whose every method throws -- Safari private mode / blocked site data. */
function throwingStorage(): Storage {
  const boom = () => { throw new DOMException('The operation is not supported', 'SecurityError') }
  return { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 } as unknown as Storage
}

function withWindow<T>(win: Record<string, unknown>, fn: () => T): T {
  const previous = (globalThis as Record<string, unknown>).window
  ;(globalThis as Record<string, unknown>).window = win
  try {
    return fn()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
    else (globalThis as Record<string, unknown>).window = previous
  }
}

// ---------------------------------------------------------------------------
// a) every startup-path storage access is guarded (AST-based: no regex can
//    tell "wrapped" from "the try is somewhere else in the file").
// ---------------------------------------------------------------------------

function findUnguardedStorageAccess(filePath: string, scriptKind: ts.ScriptKind): string[] {
  const text = fs.readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind)
  const offenders: string[] = []

  function isStorageTarget(expr: ts.Expression): boolean {
    // localStorage / sessionStorage / indexedDB, bare or window-qualified.
    if (ts.isIdentifier(expr)) return ['localStorage', 'sessionStorage', 'indexedDB'].includes(expr.text)
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'window') {
      return ['localStorage', 'sessionStorage', 'indexedDB'].includes(expr.name.text)
    }
    return false
  }

  function insideTryBlock(node: ts.Node): boolean {
    let current: ts.Node | undefined = node
    while (current) {
      // Named `parentNode`, not `parent` -- lib.dom.d.ts declares an ambient
      // global `parent: Window` whose type is self-referential, and shadowing
      // it with a same-named local here defeats TS's inference (TS7022).
      const parentNode: ts.Node | undefined = current.parent
      if (parentNode && ts.isTryStatement(parentNode) && parentNode.tryBlock === current) return true
      // A catch/finally block reading storage is not "guarded" against ITS
      // OWN throw -- only code inside the try block is.
      current = parentNode
    }
    return false
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression
      const method = node.expression.name.text
      if (isStorageTarget(target) && ['getItem', 'setItem', 'removeItem', 'clear', 'key', 'open'].includes(method)) {
        if (!insideTryBlock(node)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          offenders.push(`${path.relative(frontendRoot, filePath)}:${line + 1} ${text.slice(node.getStart(source), node.getEnd())}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return offenders
}

await runTest('AppContext.tsx never reads or writes storage outside a try block', () => {
  const offenders = findUnguardedStorageAccess(path.join(frontendRoot, 'src/AppContext.tsx'), ts.ScriptKind.TSX)
  assert.deepEqual(offenders, [], `unguarded storage access would blank the admin shell on a throwing Storage:\n${offenders.join('\n')}`)
})

await runTest('the theme-bootstrap source never reads storage outside a try block', () => {
  const offenders = findUnguardedStorageAccess(path.join(frontendRoot, 'src/public-runtime/theme-bootstrap.ts'), ts.ScriptKind.TS)
  assert.deepEqual(offenders, [])
})

await runTest('the AST guard is discriminating: a bare call at module scope is caught', () => {
  const file = path.join(os.tmpdir(), `bos-unguarded-fixture-${Date.now()}.ts`)
  fs.writeFileSync(file, "const v = localStorage.getItem('x')\n")
  try {
    const offenders = findUnguardedStorageAccess(file, ts.ScriptKind.TS)
    assert.equal(offenders.length, 1, 'a genuinely unguarded call must be reported, or this lock is a no-op')
  } finally {
    fs.unlinkSync(file)
  }
})

// ---------------------------------------------------------------------------
// a) catalogPagination.tsx's own storage helpers, executed for real against
//    a Storage that actually throws (not merely read as source text -- every
//    existing storefrontPager* test only greps this file, because it also
//    carries JSX in the same module).
// ---------------------------------------------------------------------------

function extractCatalogPaginationHelpers(): string {
  const source = read('src/components/catalog/catalogPagination.tsx')
  const start = source.indexOf('export const CATALOG_DEFAULT_PAGE_SIZE')
  const end = source.indexOf('function clampCatalogPage')
  assert.ok(start > 0 && end > start, 'catalogPagination.tsx must keep these exports in the expected shape for the sandbox to extract them')
  return source.slice(start, end)
}

await runTest('readStoredCatalogPageSize survives a Storage that throws on every call', async () => {
  const mod = await runSource<{ readStoredCatalogPageSize: () => number | null }>(extractCatalogPaginationHelpers())
  const result = withWindow({ localStorage: throwingStorage() }, () => mod.readStoredCatalogPageSize())
  assert.equal(result, null, 'a throwing localStorage must degrade to "no stored choice", not throw through the storefront render')
})

await runTest('writeStoredCatalogPageSize survives a Storage that throws on every call', async () => {
  const mod = await runSource<{ writeStoredCatalogPageSize: (value: number) => void }>(extractCatalogPaginationHelpers())
  assert.doesNotThrow(() => withWindow({ localStorage: throwingStorage() }, () => mod.writeStoredCatalogPageSize(20)))
})

await runTest('readStoredCatalogPageSize with no window/localStorage at all returns null, not a crash', async () => {
  const mod = await runSource<{ readStoredCatalogPageSize: () => number | null }>(extractCatalogPaginationHelpers())
  const result = withWindow({}, () => mod.readStoredCatalogPageSize())
  assert.equal(result, null)
})

await runTest('readStoredCatalogPageSize ignores a healthy Storage holding an off-menu value', async () => {
  const mod = await runSource<{ readStoredCatalogPageSize: () => number | null }>(extractCatalogPaginationHelpers())
  const data = new Map([['business-os-portal-page-size-v1', '5000']])
  const storage = { getItem: (key: string) => data.get(key) ?? null } as unknown as Storage
  assert.equal(withWindow({ localStorage: storage }, () => mod.readStoredCatalogPageSize()), null, 'an out-of-range persisted value must not resurrect as a page size')
})

// ---------------------------------------------------------------------------
// b) the public bootstrap payload path tolerates missing/malformed/oversized
//    input and a viewer page-size mismatch, and still ends up searching.
// ---------------------------------------------------------------------------

function extractPublicBootstrapHelpers(): string {
  const source = read('src/components/catalog/PublicCatalogPage.tsx')
  const start = source.indexOf('const PUBLIC_PORTAL_CACHE_KEY')
  const end = source.indexOf('function normalizeBootstrapPayload')
  assert.ok(start > 0 && end > start, 'PublicCatalogPage.tsx must keep readEmbeddedPortalBootstrap/normalizeBootstrapPayload in the expected shape for the sandbox to extract them')
  const endOfNormalize = source.indexOf('\n}\n', end) + 3
  // Both functions are private to the real module (no top-level app state to
  // leak); this sandboxed copy exports them purely so the test can call them.
  return `${source.slice(start, endOfNormalize)}\nexport { readEmbeddedPortalBootstrap, normalizeBootstrapPayload }\n`
}

type BootstrapModule = {
  readEmbeddedPortalBootstrap: () => Record<string, unknown> | null
  normalizeBootstrapPayload: (payload: unknown) => { config: Record<string, unknown>; products: unknown[]; catalog: Record<string, unknown> }
}

function domWithBootstrapNode(textContent: string | null): Record<string, unknown> {
  const node = textContent === null ? null : { textContent }
  return {
    getElementById: (id: string) => (id === 'business-os-portal-bootstrap' ? node : null),
  }
}

await runTest('a missing embedded bootstrap node returns null, not a throw', async () => {
  const mod = await runSource<BootstrapModule>(extractPublicBootstrapHelpers(), 'tsx')
  const previousDocument = (globalThis as Record<string, unknown>).document
  ;(globalThis as Record<string, unknown>).document = domWithBootstrapNode(null)
  ;(globalThis as Record<string, unknown>).window = {}
  try {
    assert.equal(mod.readEmbeddedPortalBootstrap(), null)
  } finally {
    if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document')
    else (globalThis as Record<string, unknown>).document = previousDocument
    Reflect.deleteProperty(globalThis, 'window')
  }
})

await runTest('malformed JSON in the embedded bootstrap node returns null, not a throw', async () => {
  const mod = await runSource<BootstrapModule>(extractPublicBootstrapHelpers(), 'tsx')
  ;(globalThis as Record<string, unknown>).document = domWithBootstrapNode('{not json')
  ;(globalThis as Record<string, unknown>).window = {}
  try {
    assert.equal(mod.readEmbeddedPortalBootstrap(), null)
  } finally {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'window')
  }
})

await runTest('an oversized embedded bootstrap node is rejected before JSON.parse ever runs', async () => {
  const mod = await runSource<BootstrapModule>(extractPublicBootstrapHelpers(), 'tsx')
  const huge = `{"products":[${'1,'.repeat(1_000_001)}]}`
  assert.ok(huge.length > 2_000_000, 'fixture must actually exceed the size ceiling under test')
  ;(globalThis as Record<string, unknown>).document = domWithBootstrapNode(huge)
  ;(globalThis as Record<string, unknown>).window = {}
  try {
    assert.equal(mod.readEmbeddedPortalBootstrap(), null)
  } finally {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'window')
  }
})

await runTest('normalizeBootstrapPayload defaults every field for missing/malformed input, never throws', async () => {
  const mod = await runSource<BootstrapModule>(extractPublicBootstrapHelpers(), 'tsx')
  for (const malformed of [undefined, null, 'a string', 42, { products: 'not-an-array', catalog: null, meta: 3 }]) {
    const next = mod.normalizeBootstrapPayload(malformed)
    assert.deepEqual(next.products, [], `products must default to [] for ${JSON.stringify(malformed)}`)
    assert.deepEqual(next.catalog, {}, `catalog must default to {} for ${JSON.stringify(malformed)}`)
    assert.equal(typeof next.config, 'object')
  }
})

// Counts how many times `refName.current` is set from the result of
// `bootstrapPageSizeMatchesViewer(...)`, accepting two equally valid shapes:
// a direct inline assignment, or the indirect shape where the decision is
// first bound to a named local (e.g. so it can also gate a second setter)
// and that local is assigned into the ref afterwards. Counting only the
// inline shape would go stale the moment either bootstrap branch is
// refactored to share its decision with another setter, even though the
// actual wiring (the ref still gets recomputed) is unchanged.
function countBootstrapSkipDecisions(source: string, refName: string): number {
  // Walk every assignment to `refName.current`, not every DECLARATION of a
  // `bootstrapPageSizeMatchesViewer(...)` result -- two branches can (and,
  // in CatalogPage.tsx, do) both bind a same-named local without both of
  // them feeding this particular ref, so counting declarations over-counts.
  const assignments = [...source.matchAll(new RegExp(`${refName}\\.current = (\\w+)(\\()?`, 'g'))]
  let count = 0
  for (const [, rhsName, hasParen] of assignments) {
    if (hasParen) {
      if (rhsName === 'bootstrapPageSizeMatchesViewer') count += 1
    } else if (new RegExp(`const ${rhsName} = bootstrapPageSizeMatchesViewer\\(`).test(source)) {
      count += 1
    }
  }
  return count
}

await runTest('the wiring: both bootstrap moments recompute skipNextProductSearchRef from bootstrapPageSizeMatchesViewer', () => {
  const source = read('src/components/catalog/PublicCatalogPage.tsx')
  assert.equal(countBootstrapSkipDecisions(source, 'skipNextProductSearchRef'), 2, 'the embedded-bootstrap shortcut AND the fetched-bootstrap branch must each re-decide whether to skip the follow-up search (directly or via a named decision variable)')
  // CatalogPage.tsx's publicView preview mount of the same public path must
  // carry the identical wiring, or the two public entry points would
  // diverge. (CatalogPage.tsx also calls bootstrapPageSizeMatchesViewer a
  // second time in its admin/editor-load branch, which is deliberately NOT
  // gated by this ref -- that branch only runs when publicView is false, and
  // the ref is only ever read `if (publicView && ...)` -- so exactly one
  // assignment, not two, is the correct count here.)
  const catalogPage = read('src/components/catalog/CatalogPage.tsx')
  assert.equal(countBootstrapSkipDecisions(catalogPage, 'skipNextBootstrappedProductSearchRef'), 1, 'CatalogPage.tsx publicView preview must use the same decision exactly once')
})

await runTest('bootstrapPageSizeMatchesViewer: a size-mismatched or malformed catalog payload never blocks the follow-up search forever', async () => {
  const mod = await runSource<{ bootstrapPageSizeMatchesViewer: (b: unknown, v: number | null) => boolean }>(extractCatalogPaginationHelpers())
  // Matrix: bootstrap pageSize (missing/malformed/matching/mismatched) x viewer choice (none/stored).
  const cases: Array<[unknown, number | null, boolean]> = [
    [undefined, null, true],       // no viewer preference at all -> any bootstrap is fine
    [undefined, 20, false],        // missing catalog.pageSize normalizes to 50 (default) != viewer's 20
    ['not-a-number', 20, false],   // malformed pageSize -> Number(NaN) || default(50) != 20
    [50, null, true],
    [50, 50, true],
    [50, 20, false],               // the exact regression: bootstrap always cut at 50, viewer picked 20
    [20, 20, true],
    [100, 20, false],
  ]
  for (const [bootstrapSize, viewerSize, expected] of cases) {
    assert.equal(
      mod.bootstrapPageSizeMatchesViewer(bootstrapSize, viewerSize),
      expected,
      `bootstrap=${JSON.stringify(bootstrapSize)} viewer=${JSON.stringify(viewerSize)}`,
    )
  }
})

// ---------------------------------------------------------------------------
// c) a failed lazy chunk import ends at an actionable control, never a
//    silent unhandled rejection.
// ---------------------------------------------------------------------------

function extractChunkClassifiers(): string {
  const source = read('src/App.tsx')
  const start = source.indexOf('function getErrorMessage(error: unknown): string {')
  // PAGE_IMPORTERS sits between the two halves of this run and calls
  // asPageModule(...) at module scope for real lazy imports -- excluded here
  // (not needed by the classifiers, and it would try to resolve ~15 real
  // page bundles as a side effect of importing this sandboxed slice).
  const pageImportersStart = source.indexOf('const PAGE_IMPORTERS')
  const afterPageImporters = source.indexOf('function getChunkErrorMessage', pageImportersStart)
  const end = source.indexOf('async function importWithTimeout')
  assert.ok(start > 0 && pageImportersStart > start && afterPageImporters > pageImportersStart && end > afterPageImporters, 'App.tsx must keep the chunk-error classifiers in the expected shape')
  const body = source.slice(start, pageImportersStart) + source.slice(afterPageImporters, end)
  return `${body}\nexport { isChunkLoadError, isRetryableImportError, getChunkErrorMessage, createChunkTimeoutError }\n`
}

await runTest('isChunkLoadError recognizes every stale-deploy error shape the browser actually throws', async () => {
  const mod = await runSource<{ isChunkLoadError: (message: string) => boolean; isRetryableImportError: (error: unknown) => boolean }>(extractChunkClassifiers())
  const chunkErrors = [
    'Loading chunk 12 failed.',
    'ChunkLoadError: Loading chunk vendor failed',
    'Failed to fetch dynamically imported module: https://x/y.js',
    'Importing a module script failed',
    'The server responded with a non-JavaScript MIME type of "text/html"',
  ]
  for (const message of chunkErrors) assert.equal(mod.isChunkLoadError(message), true, message)
  assert.equal(mod.isChunkLoadError('TypeError: cannot read properties of undefined'), false, 'a real bug must not be swallowed as a stale-chunk retry')
  for (const message of chunkErrors) assert.equal(mod.isRetryableImportError(new Error(message)), true, message)
  assert.equal(mod.isRetryableImportError(new Error('permission denied')), false)
  assert.equal(mod.isRetryableImportError('a bare string, not an Error'), false)
})

await runTest('every page slot wraps its lazy component in PageErrorBoundary + Suspense, so a final failed import cannot reject unhandled', () => {
  const app = read('src/App.tsx')
  assert.match(
    app,
    /<PageErrorBoundary key=\{`\$\{pageId\}-boundary`\} pageId=\{pageId\}>\s*\n\s*<Suspense fallback=\{<PageLoader \/>\}>/,
    'the admin PageSlot must boundary every lazy page',
  )
  assert.match(
    app,
    /<PageErrorBoundary pageId="catalog-public">\s*\n\s*<Suspense fallback=\{<PublicCatalogFallback \/>\}>/,
    'the public catalog route (CatalogPage publicView) must carry the same boundary',
  )
  // The final attempt either navigates away (chunk recovery) or re-throws --
  // there is no third branch that just drops the error.
  assert.match(app, /if \(await triggerChunkRecoveryReload\(marker\)\) \{\s*\n\s*return await new Promise\(\(\) => \{\}\)/, 'a successful recovery reload must suspend rather than resolve into a half-loaded page')
  assert.match(app, /\n\s*throw error\s*\n\s*\}\s*\n\s*\}\s*\n\s*\n\s*throw createChunkTimeoutError/, 'every other path out of the retry loop must throw, so the boundary above always gets a chance to render')
})

// ---------------------------------------------------------------------------
// d) the top-level error boundary always shows visible, non-empty text.
// ---------------------------------------------------------------------------

await runTest('PageErrorBoundary renders non-empty text and a working action for ANY caught error, including one with no message', () => {
  const app = read('src/App.tsx')
  const renderStart = app.indexOf('class PageErrorBoundary')
  const renderEnd = app.indexOf('\nfunction Notification(')
  assert.ok(renderStart > 0 && renderEnd > renderStart)
  const boundary = app.slice(renderStart, renderEnd)
  assert.match(boundary, /if \(!this\.state\.error\) \{\s*\n\s*return this\.props\.children/, 'children render normally until something is actually caught')
  // message falls back to String(error) -- Error#toString() is never empty
  // ("Error" at minimum) -- so the panel can never print a blank body.
  assert.match(boundary, /const message = this\.state\.error\?\.message \|\| String\(this\.state\.error\)/)
  assert.match(boundary, /Page failed to load/, 'a fixed, non-empty heading regardless of what the app was doing when it crashed')
  assert.match(boundary, /onClick=\{\(\) => \{/)
  assert.match(boundary, /this\.setState\(\{ error: null \}\)/, 'the non-reload branch must still be able to leave the crashed state')
  // Discovered gap (reported, not fixed here -- out of this lane's file
  // ownership): the panel's copy is a fixed English literal, not looked up
  // through t()/portalLanguagePacks, so it does not actually vary with the
  // Khmer pack. The lock above only pins "never blank"; it does not claim
  // bilingual coverage that the source does not have.
  assert.doesNotMatch(boundary, /\bt\(['"]/, 'documents the current state: no i18n lookup exists here yet')
})

await runTest('componentDidCatch reports the crash but a reporting failure can never become a second crash', () => {
  const app = read('src/App.tsx')
  // One reporter for both boundaries: the per-page one here and the root one in shared/RootErrorBoundary.tsx.
  assert.match(app, /import \{ reportClientCrash \} from '\.\/utils\/clientCrashReport\.ts'/, 'App.tsx must import the shared crash reporter, not carry a private twin')
  assert.doesNotMatch(app, /function reportClientCrash\(/, 'no private copy of the reporter may drift from the util')
  const reporter = read('src/utils/clientCrashReport.ts')
  assert.match(reporter, /export async function reportClientCrash[\s\S]*?catch \{\s*\n\s*\/\/ Intentionally silent/, 'crash reporting must swallow its own network failure')
  assert.match(app, /componentDidCatch\(error: Error, info: ErrorInfo\): void \{[\s\S]*?void reportClientCrash\(error, this\.props\.pageId\)/, 'reporting must be fire-and-forget, never awaited into the render path')
})

// ---------------------------------------------------------------------------
// e) theme bootstrap: light default, no matchMedia, never throws.
// ---------------------------------------------------------------------------

await runTest('theme-bootstrap.ts defaults to light and never reads prefers-color-scheme', () => {
  const source = read('src/public-runtime/theme-bootstrap.ts')
  assert.match(source, /let theme: AppTheme = 'light'/, 'light is the only default -- 2026-09-14 storefront/admin decision')
  assert.doesNotMatch(source, /matchMedia/, 'must never auto-honor the OS/browser color scheme')
})

await runTest('the generated public/theme-bootstrap.js in the working tree matches the source it claims to be built from', () => {
  const generated = read('public/theme-bootstrap.js')
  assert.match(generated, /Generated from frontend\/src\/public-runtime\/\*\.ts/)
  assert.match(generated, /let theme = 'light'/)
  assert.doesNotMatch(generated, /matchMedia/)
  // The whole read-theme block is one try, so a throwing localStorage still
  // leaves `theme` at its 'light' default instead of throwing before the
  // stylesheet class is ever applied.
  const tryAt = generated.indexOf('try {')
  const catchAt = generated.indexOf('catch (_) { }', tryAt)
  assert.ok(tryAt > 0 && catchAt > tryAt)
  const guarded = generated.slice(tryAt, catchAt)
  assert.match(guarded, /localStorage\.getItem\('businessos_device_settings'\)/)
  assert.match(guarded, /localStorage\.getItem\('businessos_theme'\)/)
  assert.match(guarded, /localStorage\.getItem\('businessos_settings'\)/)
})

// ---------------------------------------------------------------------------
// f) the built-startup postbuild verifier still runs the real chunk graph
//    checks it claims to run (builtStartupGate.test.ts already exercises the
//    script end-to-end; this is a smaller, source-level cross-check that its
//    own docstring stays true).
// ---------------------------------------------------------------------------

await runTest('verify-built-startup.mjs actually delegates to the chunk-boundary validator with --bundle', () => {
  const script = readRepo('ops/scripts/frontend/verify-built-startup.mjs')
  assert.match(script, /tests\/chunkBoundaryPolicy\.test\.ts/, 'the postbuild script must run the real validator, not a stub')
  assert.match(script, /'--bundle'/, 'without --bundle the validator only checks source-level policy, never the emitted dist it postbuild is meant to certify')
  assert.match(script, /process\.exitCode = result\.status \?\? 1/, 'a validator that could not even run must fail the build, not silently pass')
})

if (failed > 0) {
  process.exitCode = 1
}
