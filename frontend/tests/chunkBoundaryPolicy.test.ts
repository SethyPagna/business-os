import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import config from '../vite.config.ts'
import { neutralPrimitiveChunk } from '../build/chunkBoundaries.ts'

const frontend = fileURLToPath(new URL('..', import.meta.url))
const output = config.build?.rollupOptions?.output
assert.ok(output && !Array.isArray(output))
assert.equal(typeof output.manualChunks, 'function')
const chunkFor = output.manualChunks as (id: string) => string | undefined

// Exercise the real config's rule ordering, including Windows ids, rather than
// accepting a correct helper that a later directory rule silently overrides.
const boundaries: Array<[string, string]> = [
  ['utils/workDrafts.ts', 'work-drafts'],
  ['utils/dirtyWork.ts', 'work-drafts'],
  ['components/shared/hubNavigation.ts', 'hub-navigation'],
  ['utils/publicAssetUrls.ts', 'api-http-core'],
  ['components/catalog/catalogPagination.tsx', 'catalog-public-utils'],
  ['components/catalog/PortalFilterCombobox.tsx', 'catalog-public-controls'],
  ['components/catalog/PortalPromoStrip.tsx', 'catalog-public-controls'],
  ['components/catalog/portalContrast.ts', 'catalog-public-utils'],
  ['components/catalog/portalAccount.ts', 'catalog-account-core'],
  ['components/catalog/portalBucket.ts', 'catalog-account-core'],
  ['components/catalog/legal/LegalPages.tsx', 'catalog-legal'],
  ['components/shared/modalCloseContext.ts', 'shared-modal'],
  ['components/shared/UnsavedChangesPrompt.tsx', 'shared-modal'],
  ['components/shared/InfoHint.tsx', 'shared-ui'],
  ['components/shared/TruncatedText.tsx', 'shared-ui'],
  ['components/shared/AlphaIndexRail.tsx', 'shared-ui'],
  ['utils/alphaRail.ts', 'shared-ui'],
  ['components/catalog/logoImageStyle.ts', 'catalog-public-utils'],
  ['components/catalog/legal/PortalEmbedConsent.tsx', 'catalog-legal'],
]
for (const [relative, expected] of boundaries) {
  const id = path.join(frontend, 'src', relative)
  assert.equal(fs.existsSync(id), true, `policy target exists: ${relative}`)
  assert.equal(chunkFor(id), expected, relative)
  assert.equal(chunkFor(id.replace(/\//g, '\\')), expected, `Windows: ${relative}`)
}
for (const icon of ['loader-2', 'arrow-left', 'shield-check', 'download', 'copy', 'minus', 'grip-vertical', 'heart', 'user']) {
  assert.equal(chunkFor(`/fixture/node_modules/lucide-react/dist/esm/icons/${icon}.js`), 'shared-ui', icon)
}
assert.equal(neutralPrimitiveChunk('/fixture/src/components/catalog/CatalogPage.tsx'), undefined)
assert.equal(neutralPrimitiveChunk('/fixture/node_modules/example/src/utils/workDrafts.ts'), undefined)
assert.equal(chunkFor('/fixture/src/components/catalog/CatalogProductsSection.tsx'), 'catalog-products')
assert.equal(chunkFor('/fixture/src/components/auth/Login.tsx'), 'auth-login')
assert.equal(chunkFor('/fixture/src/utils/lazyImport.ts'), 'lazy-import-utils')
assert.equal(chunkFor('\0vite/preload-helper.js'), 'app-routing')
assert.equal(chunkFor('/fixture/node_modules/@fontsource/noto-sans-khmer/400.css'), undefined)
assert.equal(chunkFor('/fixture/node_modules/qrcode/lib/browser.js'), 'vendor')

function staticImports(file: string): string[] {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return ast.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return []
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return []
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.isTypeOnly) return []
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.every(element => element.isTypeOnly)) return []
    }
    return [statement.moduleSpecifier.text]
  })
}

// Follow actual source imports: changing the provider facade import back in
// either modal must fail even if the neutral chunk naming still looks right.
function sourceClosure(relative: string): Set<string> {
  const seen = new Set<string>()
  function visit(file: string) {
    if (seen.has(file)) return
    seen.add(file)
    if (file.endsWith('.json')) return
    for (const specifier of staticImports(file).filter(value => value.startsWith('.'))) {
      const base = path.resolve(path.dirname(file), specifier)
      const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      assert.ok(target, `unresolved static source import: ${file} -> ${specifier}`)
      visit(target)
    }
  }
  visit(path.join(frontend, 'src', relative))
  return seen
}
for (const relative of [
  'utils/workDrafts.ts', 'utils/dirtyWork.ts', 'utils/lazyImport.ts',
  'components/shared/Modal.tsx', 'components/shared/UnsavedChangesPrompt.tsx',
  'components/shared/AlphaIndexRail.tsx', 'utils/alphaRail.ts',
  'components/catalog/logoImageStyle.ts', 'components/catalog/legal/PortalEmbedConsent.tsx',
]) {
  const closure = sourceClosure(relative)
  assert.equal(closure.has(path.join(frontend, 'src/AppContext.tsx')), false, `${relative} must not import admin startup`)
  assert.equal([...closure].some(file => /(?:PublicCatalogPage|CatalogPage|BackgroundImportTracker)\.tsx$/.test(file)), false)
}
console.log('PASS neutral chunk policy, real config ordering, and source dependency boundaries')

// Run explicitly after a build; ordinary unit runs must not silently inspect
// an old dist directory. Dynamic imports remain excluded from this static graph.
if (process.argv.includes('--bundle')) {
  const assets = path.join(frontend, 'dist/assets')
  const files = fs.readdirSync(assets).filter(file => file.endsWith('.js'))
  const graph = new Map(files.map(file => [file, staticImports(path.join(assets, file))
    .map(specifier => path.posix.basename(specifier)).filter(target => files.includes(target))]))
  const complete = new Set<string>()
  const active = new Set<string>()
  function visit(file: string, chain: string[] = []) {
    assert.equal(active.has(file), false, `static chunk cycle: ${[...chain, file].join(' -> ')}`)
    if (complete.has(file)) return
    active.add(file)
    for (const dependency of graph.get(file) || []) visit(dependency, [...chain, file])
    active.delete(file); complete.add(file)
  }
  files.forEach(file => visit(file))
  function closureOf(entries: string[]): Set<string> {
    const closure = new Set<string>()
    const collect = (file: string): void => {
      assert.ok(graph.has(file), `missing emitted chunk: ${file}`)
      if (closure.has(file)) return
      closure.add(file)
      graph.get(file)?.forEach(collect)
    }
    entries.forEach(collect)
    return closure
  }
  for (const [entryName, forbidden] of [
    ['index', ['vendor', 'app-auth', 'auth-login', 'catalog']],
    ['auth-login', ['catalog', 'catalog-public', 'background-import-tracker']],
    ['catalog-public', ['app-auth', 'auth-login', 'catalog', 'background-import-tracker']],
    ['catalog-products', ['app-auth', 'catalog', 'file-api', 'import-jobs-api']],
    ['catalog-secondary-tabs', ['app-auth', 'catalog', 'file-api', 'import-jobs-api']],
  ] as const) {
    const match = (name: string) => new RegExp(`^${name}-[\\w-]{8}\\.js$`)
    const entry = files.find(file => match(entryName).test(file))
    assert.ok(entry, `missing exact ${entryName} chunk`)
    const closure = closureOf([entry])
    for (const name of forbidden) assert.equal([...closure].some(file => match(name).test(file)), false, `${entryName} statically pulls ${name}`)
    const bytes = [...closure].reduce((sum, file) => sum + fs.statSync(path.join(assets, file)).size, 0)
    assert.ok(bytes < 1_854_755, `${entryName} must improve the measured baseline closure: ${bytes}`)
    console.log(`PASS emitted ${entryName} closure: ${closure.size} chunks, ${bytes} bytes`)
  }
  const html = fs.readFileSync(path.join(frontend, 'dist/index.html'), 'utf8')
  const preloadJson = html.match(/var preloads = (\{[^\n]+\});/)
  assert.ok(preloadJson, 'built HTML must contain the actual route preload lists')
  const preloads = JSON.parse(preloadJson[1]) as { public: string[] }
  assert.ok(preloads.public.length > 0)
  const publicPreloadClosure = closureOf(preloads.public.map(file => path.posix.basename(file)))
  for (const name of ['app-auth', 'auth-login', 'catalog', 'file-api', 'import-jobs-api']) {
    assert.equal([...publicPreloadClosure].some(file => new RegExp(`^${name}-[\\w-]{8}\\.js$`).test(file)), false, `public preload graph pulls ${name}`)
  }
  console.log(`PASS actual public preload closure: ${publicPreloadClosure.size} chunks, no admin/file/import code`)
  const css = fs.readdirSync(assets).filter(file => file.endsWith('.css'))
    .map(file => fs.readFileSync(path.join(assets, file), 'utf8')).join('\n')
  const khmerFaces = (css.match(/@font-face\s*\{[^}]*\}/g) || [])
    .filter(face => /font-family:[^;}]*Noto Sans Khmer/.test(face))
  for (const weight of [400, 500, 600]) {
    assert.ok(khmerFaces.some(face => new RegExp(`font-weight:\\s*${weight}(?:;|})`).test(face)), `Khmer font weight ${weight} must remain emitted`)
  }
  for (const face of khmerFaces) {
    for (const match of face.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      assert.equal(fs.existsSync(path.join(frontend, 'dist', match[1].replace(/^\//, ''))), true, `missing font asset: ${match[1]}`)
    }
  }
  console.log(`PASS emitted static chunk graph: ${files.length} chunks, zero cycles`)
}
