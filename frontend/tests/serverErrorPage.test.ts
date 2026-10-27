// Lane 6.0.1002 (perf-transport): a failure answered by something in front of the app (an HTML 503 or 1102 page, a 413,
// a 429) reaches the operator as one short translated sentence that fits the status, never as markup. Runs the real
// api/http.ts error path against a stubbed fetch, and the Khmer restatement from the real module and pack.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  apiFetch,
  cacheClearAll,
  FOREIGN_BODY_ERRORS,
  SERVER_ERROR_PAGE_MESSAGE,
  setSyncServerUrl,
} from '../src/api/http.ts'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EN = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
const KM = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

async function failWith(status: number, body: string, contentType = 'text/html'): Promise<any> {
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll()
  setSyncServerUrl('https://sync.example.test')
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(body, { status, headers: { 'Content-Type': contentType } })) as typeof fetch
  try {
    return await apiFetch('GET', '/api/sales', undefined, 2000).then(() => assert.fail('expected a failure'), (error) => error)
  } finally { globalThis.fetch = original; setSyncServerUrl('') }
}

const HTML_503 = '<!DOCTYPE html><html><head><title>Error 1102</title></head><body><h1>Worker exceeded resource limits</h1><p>Ray ID: 8f2</p></body></html>'

await runTest('an HTML 503 page becomes the short sentence, flagged transient, with its status', async () => {
  const error = await failWith(503, HTML_503)
  assert.equal(error.message, SERVER_ERROR_PAGE_MESSAGE)
  assert.doesNotMatch(error.message, /[<>]|Ray ID|1102/)
  assert.equal(error.status, 503)
  assert.equal(error.code, 'server_error_page')
  assert.equal(error.transientGateway, true)
})

await runTest('a plain-text gateway body and an HTML 500 are replaced too', async () => {
  for (const [status, body, type] of [[502, 'Bad Gateway', 'text/plain'], [500, '<html>Internal</html>', 'text/html'], [504, 'timeout', 'text/plain']] as const) {
    const error = await failWith(status, body, type)
    assert.equal(error.message, SERVER_ERROR_PAGE_MESSAGE, String(status))
    assert.equal(error.code, 'server_error_page')
  }
})

await runTest('the sentence depends on the status: only a 5xx says the server is unavailable', async () => {
  const cases: Array<[number, string, string, string]> = [
    [413, '<html>413 Request Entity Too Large</html>', 'text/html', FOREIGN_BODY_ERRORS.tooLarge.message],
    [429, 'error code: 1015', 'text/plain', FOREIGN_BODY_ERRORS.rateLimited.message],
    [404, '<html>404 Not Found</html>', 'text/html', FOREIGN_BODY_ERRORS.notFound.message],
    [400, '<html>Bad Request</html>', 'text/html', FOREIGN_BODY_ERRORS.failed.message],
  ]
  for (const [status, body, type, expected] of cases) {
    const error = await failWith(status, body, type)
    assert.equal(error.message, expected, String(status))
    assert.notEqual(error.message, SERVER_ERROR_PAGE_MESSAGE, `${status} must not claim the server is unavailable`)
    assert.doesNotMatch(error.message, /[<>]/)
    assert.equal(error.status, status)
  }
  assert.match(FOREIGN_BODY_ERRORS.rateLimited.message, /wait/i)
})

await runTest('own JSON refusals of the app keep their message and code', async () => {
  const error = await failWith(409, JSON.stringify({ error: 'Insufficient stock', code: 'stock_conflict' }), 'application/json')
  assert.equal(error.message, 'Insufficient stock')
  assert.equal(error.code, 'stock_conflict')
  const bare = await failWith(500, '', 'text/plain')
  assert.equal(bare.message, 'HTTP 500', 'an empty body has no markup to hide')
})

await runTest('each English sentence is its pack key word for word, and each Khmer one is short Khmer', () => {
  for (const { key, message } of Object.values(FOREIGN_BODY_ERRORS)) {
    assert.equal(EN[key], message, key)
    assert.ok(KM[key] && KM[key] !== EN[key], key)
    assert.doesNotMatch(KM[key], /[A-Za-z]/, `no English placeholder in km.json: ${key}`)
    assert.ok(KM[key].length <= EN[key].length + 10, `Khmer short: ${key}`)
  }
})

await runTest('a Khmer screen gets the Khmer sentence for each kind', async () => {
  Object.assign(globalThis, { document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? 'km' : null) } } })
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'branchRefusalLanguage.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    if (request.endsWith('/lang/km.json')) return KM
    throw new Error(`unexpected import ${request}`)
  })
  const restate = mod.exports.restateForeignBodyError as (error: Error & { messageKey?: string }) => Promise<Error>
  for (const { key, message } of Object.values(FOREIGN_BODY_ERRORS)) {
    assert.equal((await restate(Object.assign(new Error(message), { messageKey: key }))).message, KM[key], key)
  }
  const other = Object.assign(new Error('Insufficient stock'), { code: 'stock_conflict' })
  assert.equal((await restate(other)).message, 'Insufficient stock', 'an error without a messageKey is left alone')
  delete (globalThis as { document?: unknown }).document
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('serverErrorPage: all passed')
