import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 8.1 (Part 413): "click an image to open details -- what is using it,
// edit, and rewire." Source pins across the four layers so no half can
// silently drop out: the backend endpoints, the transport, the FilesPage
// details modal, and the permission/guard rules the locked notes require.

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const routeSource = readFileSync(new URL('../../cloudflare/src/routes/files.ts', import.meta.url), 'utf8')
const transportSource = readFileSync(new URL('../src/api/fileTransport.ts', import.meta.url), 'utf8')
const pageSource = readFileSync(new URL('../src/components/files/FilesPage.tsx', import.meta.url), 'utf8')

runTest('8.1: the usage drill-in names every reference kind and stays read-open', () => {
  assert.match(routeSource, /app\.get\('\/:id\/usage'/)
  // named rows for each reference kind the counts already summarize
  assert.match(routeSource, /SELECT id, name, barcode FROM products WHERE image_path = @path/)
  assert.match(routeSource, /FROM product_images pi LEFT JOIN products p ON p\.id = pi\.product_id/)
  assert.match(routeSource, /SELECT id, name, username FROM users WHERE avatar_path = @path/)
  // settings keys are reported (and later skipped by rewire), never guessed
  assert.match(routeSource, /settings: settingKeys/)
})

runTest('8.1: rewire is full-access, image-to-image, duplicate-safe, and skips settings', () => {
  assert.match(routeSource, /app\.post\('\/:id\/rewire'/)
  assert.match(routeSource, /Rewiring file references requires Full Access to Library\./)
  assert.match(routeSource, /can only be rewired to another IMAGE/)
  // a product already holding the target image must not gain a duplicate row
  assert.match(routeSource, /DELETE FROM product_images WHERE image_path = @from AND product_id IN \(\s*SELECT product_id FROM product_images WHERE image_path = @to\)/)
  // covers, gallery and avatars repoint; settings deliberately do not
  assert.match(routeSource, /UPDATE products SET image_path = @to/)
  assert.match(routeSource, /UPDATE product_images SET image_path = @to/)
  assert.match(routeSource, /UPDATE users SET avatar_path = @to/)
  assert.match(routeSource, /settingsSkipped/)
  // stock caches see the change
  assert.match(routeSource, /bumpVersion\(c\.env, 'products'\)/)
})

runTest('8.1: the transport surfaces both endpoints without an offline mirage', () => {
  assert.match(transportSource, /export async function getFileUsage/)
  assert.match(transportSource, /File usage is unavailable/)
  assert.match(transportSource, /export function rewireFileAsset/)
  assert.match(transportSource, /to_file_id: Number\(toFileId\)/)
})

runTest('8.1: the details modal shows named usage and gates rewire on Full Access', () => {
  // the click-through modal fetches usage on open and renders each kind
  assert.match(pageSource, /filesApi\.getFileUsage\(asset\.id\)/)
  assert.match(pageSource, /Product cover \(/)
  assert.match(pageSource, /Product gallery \(/)
  assert.match(pageSource, /User avatar \(/)
  assert.match(pageSource, /rewire skips these/)
  // rewire only for managers, only for images, never against itself
  assert.match(pageSource, /canManage && asset\.media_type === 'image'/)
  assert.match(pageSource, /String\(row\.id\) === String\(asset\.id\)\) return false/)
  // the page passes the real gate + refresh through
  assert.match(pageSource, /canManage=\{canManageLibrary\}/)
  assert.match(pageSource, /onRewired=\{\(\) => \{ void loadFiles\(\) \}\}/)
})

if (failed > 0) {
  process.exitCode = 1
}
