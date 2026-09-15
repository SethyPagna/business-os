import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// P4-4b item 5: uploadGalleryImages (Products.tsx) used to upload gallery
// images one at a time -- a `for...of` loop that `await`ed each upload
// before starting the next -- so a full gallery paid for N sequential
// round trips even though every upload is independent of every other. It
// now runs up to GALLERY_UPLOAD_CONCURRENCY (3) uploads at once through a
// small worker pool, while still writing each result into its ORIGINAL
// index so the final gallery order matches the order the images were
// picked in, not completion order.
//
// No DOM renderer is available in this harness (see
// tests/returnMoneyV1Flow.test.ts's own note), so this extracts the real
// `uploadGalleryImages` function body via TypeScript's AST, transpiles it,
// and executes it with injected mock bindings -- exercising the actual
// async control flow instead of a reimplementation/source-regex claim.

function callback(file: string, name: string, bindings: Record<string, unknown>): (...args: any[]) => Promise<unknown> {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer!.getText(ast)
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.ok(expression, name)
  const js = ts.transpileModule(`const handler = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return new Function(...Object.keys(bindings), js + ';return handler')(...Object.values(bindings))
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Minimal stand-in for the real helper -- the real one just clamps/dedupes,
// which is irrelevant to the concurrency behaviour under test.
function normalizeProductGallery(value: unknown): string[] {
  return Array.isArray(value) ? value as string[] : []
}

function setup() {
  const started: number[] = []
  const uploads = [deferred<{ path: string }>(), deferred<{ path: string }>(), deferred<{ path: string }>()]
  const runProductWriteMutation = (loader: () => Promise<unknown>) => loader()
  const productApi = {
    uploadProductImage: ({ filePath }: { filePath: string }) => {
      const index = Number(filePath.replace('data:image/png;base64,', ''))
      started.push(index)
      return uploads[index].promise
    },
  }
  const bindings = { normalizeProductGallery, runProductWriteMutation, productApi, PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS: 5000, GALLERY_UPLOAD_CONCURRENCY: 3 }
  return { started, uploads, bindings, run: () => callback('../src/components/products/Products.tsx', 'uploadGalleryImages', bindings) }
}

{
  // All three uploads must be IN FLIGHT together (bounded concurrency), not
  // one-at-a-time -- the pre-fix `for...of` loop would only have started
  // upload 1 after upload 0's promise resolved.
  const h = setup()
  const gallery = ['data:image/png;base64,0', 'data:image/png;base64,1', 'data:image/png;base64,2']
  const pending = h.run()(undefined, gallery)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(h.started.slice().sort(), [0, 1, 2], 'all three uploads start without waiting for an earlier one to finish')

  // Resolve out of completion order (2 finishes first) -- final array must
  // still come back in ORIGINAL gallery order, not completion order.
  h.uploads[2].resolve({ path: 'uploaded-2' })
  h.uploads[0].resolve({ path: 'uploaded-0' })
  h.uploads[1].resolve({ path: 'uploaded-1' })
  const result = await pending
  assert.deepEqual(result, ['uploaded-0', 'uploaded-1', 'uploaded-2'], 'gallery order survives out-of-order completion')
}
{
  // A failed upload still fails the whole call (matches the pre-fix
  // behaviour of the sequential loop, which also threw on the first
  // failure and never returned a partial gallery).
  const h = setup()
  const gallery = ['data:image/png;base64,0', 'data:image/png;base64,1', 'data:image/png;base64,2']
  const pending = h.run()(undefined, gallery)
  await new Promise(resolve => setTimeout(resolve, 0))
  h.uploads[1].resolve({ path: '' }) // no path => "Image upload failed"
  h.uploads[0].resolve({ path: 'uploaded-0' })
  h.uploads[2].resolve({ path: 'uploaded-2' })
  await assert.rejects(pending, /Image upload failed/)
}
{
  // Non-data-url entries (already-uploaded paths kept from a prior save)
  // pass through untouched and don't consume an upload slot.
  const h = setup()
  const gallery = ['already/uploaded/path.jpg', 'data:image/png;base64,0']
  const pending = h.run()(undefined, gallery)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(h.started, [0], 'only the data-url entry triggers an upload')
  h.uploads[0].resolve({ path: 'uploaded-0' })
  const result = await pending
  assert.deepEqual(result, ['already/uploaded/path.jpg', 'uploaded-0'])
}

console.log('PASS gallery uploads run with bounded concurrency, preserve original order, and still fail the whole call on any upload error')
