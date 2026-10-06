// DATE-W returns 400 { code: 'invalid_date' } for an unreadable typed date
// (batches, inventory receipts, stock sessions, fees, products, promotions).
// The English sentence the Worker sends must not reach a Khmer screen: the
// transport restates it in the UI language from the pack's `date_entry_invalid`,
// the same sentence the date field itself shows.
//
// The end-to-end half drives the REAL apiFetch against a mocked fetch, once per
// route family, with <html lang> set to km and then en -- so a message that was
// merely the server's English passes neither.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, apiFetch, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { CODED_API_MESSAGE_KEYS, __setCodedApiPackLoaderForTests, codedApiMessageFromPack, hasCodedApiMessage, localizeCodedApiError } from '../src/api/codedApiMessage.ts'

const readPack = (name: string) => JSON.parse(readFileSync(new URL(`../src/lang/${name}.json`, import.meta.url), 'utf8')) as Record<string, string>
const en = readPack('en')
const km = readPack('km')

// Node cannot import a .json module the way Vite does, so the seam serves the real packs from disk.
__setCodedApiPackLoaderForTests(async (language) => (language.startsWith('km') ? km : en))

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function resetApiState(): void {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

const SERVER_SENTENCE = 'received_at is not a valid date (use dd/mm/yyyy)'

function setLanguage(language: string): () => void {
  const g = globalThis as Record<string, unknown>
  const previous = g.document
  g.document = { documentElement: { getAttribute: (name: string) => (name === 'lang' ? language : null) } }
  return () => { g.document = previous }
}

async function refusedWith(method: string, path: string, body: unknown, status: number, payload: Record<string, unknown>): Promise<Error & { code?: string; status?: number }> {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }))) as typeof fetch
  try {
    await apiFetch(method, path, body, 1000)
  } catch (error) {
    return error as Error & { code?: string; status?: number }
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
  throw new Error('apiFetch was expected to reject')
}

await runTest('control: the pack sentence exists in both packs and Khmer is not the English text', () => {
  assert.equal(CODED_API_MESSAGE_KEYS.invalid_date, 'date_entry_invalid')
  assert.ok(en.date_entry_invalid && km.date_entry_invalid)
  assert.notEqual(km.date_entry_invalid, en.date_entry_invalid)
  assert.notEqual(en.date_entry_invalid, SERVER_SENTENCE)
})

await runTest('codedApiMessageFromPack maps only the listed codes', () => {
  assert.equal(codedApiMessageFromPack('invalid_date', km), km.date_entry_invalid)
  assert.equal(codedApiMessageFromPack('invalid_date', en), en.date_entry_invalid)
  assert.equal(codedApiMessageFromPack('write_conflict', km), null, 'another code keeps the server sentence')
  assert.equal(codedApiMessageFromPack('toString', km), null, 'a prototype name is not a code')
  assert.equal(codedApiMessageFromPack(null, km), null)
  assert.equal(codedApiMessageFromPack('invalid_date', {}), null, 'a pack without the key keeps the server sentence')
  assert.equal(hasCodedApiMessage('invalid_date'), true)
  assert.equal(hasCodedApiMessage('constructor'), false)
})

for (const [label, method, path] of [
  ['batch edit', 'PATCH', '/api/batches/7'],
  ['inventory receipt', 'POST', '/api/inventory/adjust'],
  ['stock-in session', 'POST', '/api/products/stock-in-sessions'],
  ['expense', 'POST', '/api/fees'],
  ['product', 'PUT', '/api/products/9'],
  ['promotion', 'POST', '/api/promotions'],
] as const) {
  await runTest(`${label}: 400 invalid_date reads in Khmer on a Khmer screen and in English on an English one`, async () => {
    const payload = { error: SERVER_SENTENCE, code: 'invalid_date' }
    let restore = setLanguage('km')
    try {
      const error = await refusedWith(method, path, { received_at: '31/02/2026' }, 400, payload)
      assert.equal(error.message, km.date_entry_invalid)
      assert.equal(error.code, 'invalid_date', 'the code survives for callers that branch on it')
      assert.equal(error.status, 400)
    } finally { restore() }
    restore = setLanguage('en-US')
    try {
      assert.equal((await refusedWith(method, path, {}, 400, payload)).message, en.date_entry_invalid)
    } finally { restore() }
  })
}

await runTest('a refusal with another code, or none, keeps the server sentence', async () => {
  const restore = setLanguage('km')
  try {
    assert.equal((await refusedWith('PATCH', '/api/batches/7', {}, 400, { error: 'Quantity must be positive', code: 'invalid_quantity' })).message, 'Quantity must be positive')
    assert.equal((await refusedWith('PATCH', '/api/batches/7', {}, 400, { error: 'Bad thing' })).message, 'Bad thing')
  } finally { restore() }
})

await runTest('a pack that cannot be loaded keeps the server sentence and never throws', async () => {
  __setCodedApiPackLoaderForTests(async () => { throw new Error('chunk fetch failed') })
  try {
    const error = await localizeCodedApiError(Object.assign(new Error(SERVER_SENTENCE), { code: 'invalid_date' }))
    assert.equal(error.message, SERVER_SENTENCE)
  } finally {
    __setCodedApiPackLoaderForTests(async (language) => (language.startsWith('km') ? km : en))
  }
})

await runTest('without a document (a worker, a test) the English pack is used', async () => {
  const error = await localizeCodedApiError(Object.assign(new Error(SERVER_SENTENCE), { code: 'invalid_date' }))
  assert.equal(error.message, en.date_entry_invalid)
  const untouched = await localizeCodedApiError(Object.assign(new Error('x'), { code: 'nope' }))
  assert.equal(untouched.message, 'x')
})

await runTest('http.ts routes every non-OK answer through the localizer', () => {
  const source = readFileSync(new URL('../src/api/http.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, /await localizeCodedApiError\(createApiError\(res\.status, parsed, text\)\)/)
})

if (failed > 0) process.exitCode = 1
