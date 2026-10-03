import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('../src/api/branchTransport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const httpSource = readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8')
const httpTree = ts.createSourceFile('http.ts', httpSource, ts.ScriptTarget.Latest, true)
const predicate = httpTree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'isWriteConflictError')
assert(predicate, 'The actual shared conflict predicate must exist')
const predicateModule = { exports: {} as any }
new Function('exports', ts.transpileModule(predicate.getText(httpTree), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(predicateModule.exports)
const body = { name: 'Immutable name', is_active: 0, location: 'Phnom Penh', phone: '', manager: 'Manager', notes: 'My unsaved description', is_default: false, expectedEditEtag: 'private-version-token', unexpected: 'never shown' }
let response: any
let observed: any
let sent: any
let requests = 0
const dependencies: Record<string, any> = {
  './http.ts': {
    apiFetch: async (method: string, url: string, payload: any) => { requests++; sent = { method, url, payload }; if (response instanceof Error) throw response; return response },
    isWriteConflictError: predicateModule.exports.isWriteConflictError,
    route: async (_channel: string, send: () => Promise<unknown>) => { try { return await send() } catch (error) { observed = error; throw error } },
  },
  './query.ts': {},
  '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({ device_id: 'private-device' }) },
  './requestIds.ts': {},
  '../utils/syncProblemLifecycle.ts': {},
}
const mod = { exports: {} as any }
new Function('require', 'module', 'exports', compiled)((id: string) => {
  assert(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`)
  return dependencies[id]
}, mod, mod.exports)
for (const code of ['branch_edit_conflict', 'write_conflict']) {
  response = Object.assign(new Error('Changed'), { code, conflict: code === 'branch_edit_conflict', current: { notes: 'Current saved description' }, expectedEditEtag: 'original', actualEditEtag: 'latest' })
  observed = null
  await assert.rejects(mod.exports.updateBranch(27, body), error => error === response)
  assert.equal(observed, response)
  assert.deepEqual(observed.attempted, { location: 'Phnom Penh', phone: '', manager: 'Manager', notes: 'My unsaved description', is_default: false })
  assert.equal(observed.current.notes, 'Current saved description')
  assert.equal(sent.method, 'PUT'); assert.equal(sent.url, '/api/branches/27')
  assert.equal(sent.payload.expectedEditEtag, 'private-version-token')
  assert.equal(sent.payload.device_id, 'private-device')
  assert.equal(body.expectedEditEtag, 'private-version-token')
}
console.log('PASS branch conflict route receives exact allowlisted attempted metadata before dispatch')
response = Object.assign(new Error('Unavailable'), { code: 'branch_edit_outcome_unknown' })
await assert.rejects(mod.exports.updateBranch(27, body), error => error === response)
assert.equal(observed.attempted, undefined)
response = { success: true }
assert.equal(await mod.exports.updateBranch(27, body), response)
assert.equal(requests, 4)
console.log('PASS unrelated errors and successful response remain exact with no retry')
response = Object.assign(new Error('Changed'), { code: 'branch_edit_conflict', conflict: true })
await assert.rejects(mod.exports.updateBranch('a/b', { notes: 'Only description' }))
assert.deepEqual(observed.attempted, { notes: 'Only description' })
assert.equal(sent.url, '/api/branches/a%2Fb')
assert.equal(observed.entity, 'branch', 'Branch ETag conflicts omit server entity; the known transport must identify the branch')
assert.equal(observed.current, undefined, 'No saved record may be fabricated when the server omitted it')
assert.equal(requests, 5)
console.log('PASS absent editable fields stay absent and branch identity remains encoded')
