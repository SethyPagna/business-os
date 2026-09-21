import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = (source: string, scope: Record<string, unknown>, expression: string): any => {
  const js = ts.transpileModule(source.replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), `${js};return ${expression}`)(...Object.values(scope))
}
function functionSource(path: string, name: string): string {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const matches: ts.Node[] = []
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast); assert.equal(matches.length, 1, name)
  return (ts.isVariableDeclaration(matches[0]) ? 'const ' : '') + matches[0].getText(ast)
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
function authority() {
  let actor = 7, revision = 0
  return {
    switchActor: () => { actor++ }, invalidate: () => { revision++ },
    captureActorReadScope: () => ({ actor, revision }),
    assertActorReadScope: (scope: { actor: number; revision: number }, includeInvalidation: boolean) => {
      if (scope.actor !== actor || (includeInvalidation && scope.revision !== revision)) throw new Error('stale actor')
    },
  }
}
for (const kind of ['createProduct', 'updateProduct']) for (const boundary of ['lookup', 'dispatch', 'completion']) {
  const a = authority(), wait = deferred(); let writes = 0
  const method = compile(functionSource('api/productWriteTransport.ts', kind), {
    ...a, getDevicePayload: () => ({}), ensureClientRequestId: (body: unknown) => body, encodeId: String,
    withExpectedUpdatedAt: async (_table: unknown, _id: unknown, body: unknown) => { if (boundary === 'lookup') await wait.promise; return body },
    route: async (_name: unknown, dispatch: () => Promise<unknown>) => { if (boundary === 'dispatch') await wait.promise; return dispatch() },
    apiFetch: async () => { writes++; if (boundary === 'completion') await wait.promise; return { success: true } },
  }, kind)
  if (kind === 'createProduct' && boundary === 'lookup') continue
  const pending = kind === 'createProduct' ? method({ name: 'A' }) : method(1, { name: 'A' })
  await tick(); a.switchActor(); wait.resolve()
  await assert.rejects(pending, /stale actor/)
  assert.equal(writes, boundary === 'completion' ? 1 : 0)
}
for (const kind of ['createProduct', 'updateProduct']) {
  const a = authority(), wait = deferred(); let writes = 0
  const method = compile(functionSource('api/methods.ts', kind), {
    ...a, loadProductWriteTransport: async () => { await wait.promise; return { [kind]: () => { writes++ } } },
  }, kind)
  const pending = method(1, {})
  a.switchActor(); wait.resolve()
  await assert.rejects(pending, /stale actor/); assert.equal(writes, 0)
}
// Actual Products local lazy wrappers must preserve caller permission checks too.
const page = read('components/products/Products.tsx')
const pageAst = ts.createSourceFile('Products.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let object: ts.ObjectLiteralExpression | undefined
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(pageAst) === 'productApi' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) object = node.initializer
  ts.forEachChild(node, find)
}
find(pageAst); assert.ok(object)
for (const kind of ['createProduct', 'updateProduct', 'uploadProductImage']) {
  const prop = object.properties.find(p => p.name?.getText(pageAst) === kind)
  assert.ok(prop && ts.isPropertyAssignment(prop))
  for (const revoke of [false, true]) {
    const a = authority(), wait = deferred(); let writes = 0, allowed = true
    const guard = compile(functionSource('components/products/Products.tsx', 'captureProductWriteGuard'), a, 'captureProductWriteGuard')
    const load = async () => { await wait.promise; return { [kind]: () => { writes++ } } }
    const method = compile(`const method = ${prop.initializer.getText(pageAst)}`, {
      captureProductWriteGuard: guard, loadProductWriteModule: load, loadProductImageUploadModule: load, toProductApiResponse: (v: unknown) => v,
    }, 'method')
    const check = () => { if (!allowed) throw new Error('permission revoked') }
    const pending = kind === 'updateProduct' ? method(1, {}, check) : method({}, check)
    if (revoke) allowed = false; else a.switchActor()
    wait.resolve(); await assert.rejects(pending); assert.equal(writes, 0)
  }
}
for (const phase of ['compression', 'response', 'cache-refresh']) {
  const a = authority(), wait = deferred(); let writes = 0
  const upload = compile(functionSource('api/productImageUploadTransport.ts', 'uploadProductImage'), {
    ...a, assertActorSessionDispatchAllowed: () => {}, requireLiveServerWrite: () => {},
    compressImageFile: async (file: File) => { if (phase !== 'response') await wait.promise; return file },
    getSyncServerUrl: () => 'https://fixture.invalid', normalizeStoredImageResponse: (v: unknown) => v,
    fetch: async () => { writes++; return { ok: true, text: async () => { if (phase === 'response') await wait.promise; return '{"path":"uploads/a.png"}' } } },
  }, 'uploadProductImage')
  const pending = upload({ file: new File(['a'], 'a.png', { type: 'image/png' }) })
  await tick(); if (phase === 'cache-refresh') a.invalidate(); else a.switchActor(); wait.resolve()
  if (phase === 'cache-refresh') { await pending; assert.equal(writes, 1) }
  else { await assert.rejects(pending, /stale actor/); assert.equal(writes, phase === 'response' ? 1 : 0) }
}
console.log('PASS actual product lazy wrappers, revision lookups, dispatch and upload completion preserve original actor/permission; cache invalidation remains allowed')
