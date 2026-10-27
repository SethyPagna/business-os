// Lane 6.0.1002 (perf-transport): a failure answered by something in front of the app (an HTML 503 or 1102 page)
// reaches the operator as one short translated sentence, never as markup. Runs the real api/http.ts error path
// against a stubbed fetch, and the Khmer restatement from the real module and pack.
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

await runTest('a plain-text gateway body and an HTML 500 or 429 are replaced too', async () => {
  for (const [status, body, type] of [[502, 'Bad Gateway', 'text/plain'], [500, '<html>Internal</html>', 'text/html'], [429, 'error code: 1015', 'text/plain']] as const) {
    const error = await failWith(status, body, type)
    assert.equal(error.message, SERVER_ERROR_PAGE_MESSAGE, String(status))
    assert.equal(error.code, 'server_error_page')
  }
})

await runTest('the app\'s own JSON refusals keep their message and code', async () => {
  const error = await failWith(409, JSON.stringify({ error: 'Insufficient stock', code: 'stock_conflict' }), 'application/json')
  assert.equal(error.message, 'Insufficient stock')
  assert.equal(error.code, 'stock_conflict')
  const bare = await failWith(500, '', 'text/plain')
  assert.equal(bare.message, 'HTTP 500', 'an empty body has no markup to hide')
})

await runTest('the English constant is the pack key word for word, and Khmer is a short Khmer sentence', () => {
  assert.equal(EN.server_error_page, SERVER_ERROR_PAGE_MESSAGE)
  assert.ok(KM.server_error_page && KM.server_error_page !== EN.server_error_page)
  assert.doesNotMatch(KM.server_error_page, /[A-Za-z]/, 'no English placeholder in km.json')
  assert.ok(KM.server_error_page.length <= EN.server_error_page.length + 10, 'Khmer short')
})

await runTest('a Khmer screen gets the Khmer sentence; an English screen keeps English', async () => {
  let uiLanguage = 'km'
  Object.assign(globalThis, { document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } } })
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'branchRefusalLanguage.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    if (request.endsWith('/lang/km.json')) return KM
    throw new Error(`unexpected import ${request}`)
  })
  const restate = mod.exports.restateServerErrorPage as (error: Error & { code?: string }) => Promise<Error>
  const page = Object.assign(new Error(SERVER_ERROR_PAGE_MESSAGE), { code: 'server_error_page' })
  assert.equal((await restate(page)).message, KM.server_error_page)
  const other = Object.assign(new Error('Insufficient stock'), { code: 'stock_conflict' })
  assert.equal((await restate(other)).message, 'Insufficient stock')
  uiLanguage = 'en'
  const english = Object.assign(new Error(SERVER_ERROR_PAGE_MESSAGE), { code: 'server_error_page' })
  assert.equal((await restate(english)).message, SERVER_ERROR_PAGE_MESSAGE)
  delete (globalThis as { document?: unknown }).document
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('serverErrorPage: all passed')
