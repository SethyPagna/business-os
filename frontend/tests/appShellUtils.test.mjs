import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPublicCatalogPath, updateMountedPages } from '../src/app/appShellUtils.mjs'

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('isPublicCatalogPath matches only public SPA-style paths', () => {
  assert.equal(isPublicCatalogPath('/catalog'), true)
  assert.equal(isPublicCatalogPath('/products/new'), true)
  assert.equal(isPublicCatalogPath('/'), false)
  assert.equal(isPublicCatalogPath('/health'), false)
  assert.equal(isPublicCatalogPath('/api/products'), false)
  assert.equal(isPublicCatalogPath('/uploads/image.jpg'), false)
  assert.equal(isPublicCatalogPath('/assets/app.js'), false)
})

runTest('updateMountedPages keeps order and max size while de-duplicating', () => {
  const first = updateMountedPages(['dashboard', 'sales'], 'products', 3)
  assert.deepEqual(first, ['dashboard', 'sales', 'products'])

  const withExisting = updateMountedPages(first, 'sales', 3)
  assert.deepEqual(withExisting, ['dashboard', 'products', 'sales'])

  const overflow = updateMountedPages(withExisting, 'users', 3)
  assert.deepEqual(overflow, ['products', 'sales', 'users'])
})

runTest('app shell does not render floating page info help', () => {
  const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /PageHelpButton/)
})

runTest('Khmer buttons use a stronger but not extra-bold weight', () => {
  const source = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
  assert.match(source, /body\.lang-km:not\(\[data-public-portal='true'\]\) button/)
  assert.match(source, /font-weight:\s*600 !important/)
})

if (failed > 0) {
  process.exitCode = 1
}
