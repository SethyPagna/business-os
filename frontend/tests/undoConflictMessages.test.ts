// FX-undo2 item 1 (R-undo C5/C12): an undo or redo the Worker refused to
// protect newer data reaches the operator in their own language.
//
// The Worker answers such a refusal with HTTP 409 and a stable machine code
// (cloudflare/src/lib/undoAppliers.ts UNDO_RECORD_CHANGED_CODE /
// UNDO_NO_DEFAULT_BRANCH_CODE, returned by routes/actionHistory.ts). The
// action-history transport restates it from the language pack the UI shows,
// the same way fileTransport.ts restates an avatar type refusal, so every
// caller keeps showing error.message as is (utils/actionHistory.ts runEntry
// and runServerEntry notify it). Before this, the English server sentence
// reached a Khmer screen, and there was no code to restate it from.
//
// The transport runs for real (esbuild -> CommonJS) with only its network
// helpers stubbed; the codes are read from the Worker source, so renaming one
// on either side fails here.
//
// Run: node tests/undoConflictMessages.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER = path.resolve(here, '..', '..', 'cloudflare')

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')

// The Worker's codes, read from its source rather than restated here.
const workerSource = fs.readFileSync(path.join(WORKER, 'src', 'lib', 'undoAppliers.ts'), 'utf8')
function workerCode(name: string): string {
  const match = workerSource.match(new RegExp(`export const ${name} = '([a-z_]+)'`))
  assert.ok(match, `cloudflare/src/lib/undoAppliers.ts no longer exports ${name}`)
  return match[1]
}

const KEYS = {
  recordChanged: { undo: 'undo_refused_record_changed', redo: 'redo_refused_record_changed' },
  noDefaultBranch: { undo: 'undo_refused_no_default_branch', redo: 'redo_refused_no_default_branch' },
} as const

// --- the browser and network the transport expects --------------------------

let uiLanguage = 'en'
Object.assign(globalThis, {
  document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } },
})

type Refusal = { status: number; error: string; code?: string }
let nextRefusal: Refusal | null = null
let requests: Array<{ method: string; url: string }> = []

const STUBS: Record<string, unknown> = {
  '/lang/en.json': EN,
  '/lang/km.json': KM,
  '/http.ts': {
    // routes/http.ts's createApiError: message = body.error, status, code.
    apiFetch: async (method: string, url: string) => {
      requests.push({ method, url })
      if (!nextRefusal) return { success: true, applied: true }
      throw Object.assign(new Error(nextRefusal.error), { status: nextRefusal.status, code: nextRefusal.code ?? null, conflict: false })
    },
    route: async (_channel: string, serverFn: () => Promise<unknown>) => serverFn(),
  },
  '/query.ts': { buildQueryString: () => '', appendQuery: (value: string) => value },
  '/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
}

function loadTransport(): Record<string, any> {
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'actionHistoryTransport.ts'), 'utf8')
  // dynamic-import off: the packs' import() becomes require(), served below.
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    const stub = Object.entries(STUBS).find(([suffix]) => request.endsWith(suffix))
    if (!stub) throw new Error(`actionHistoryTransport.ts imports ${request}, which this harness does not provide`)
    return stub[1]
  })
  return mod.exports
}

const transport = loadTransport()

async function rejection(promise: Promise<unknown>): Promise<Error & { status?: unknown; code?: unknown }> {
  try {
    const value = await promise
    throw new assert.AssertionError({ message: `expected a refusal, got ${JSON.stringify(value)}` })
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error
    return error as Error & { status?: unknown; code?: unknown }
  }
}

const failures: string[] = []
async function runCase(name: string, body: () => Promise<void> | void): Promise<void> {
  uiLanguage = 'en'
  nextRefusal = null
  requests = []
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const RECORD_CHANGED_ENGLISH = 'This branch was edited after this change (manager), so it can no longer be undone without overwriting that edit. Nothing was changed.'

await runCase('both packs carry the refusal in each direction; the Khmer is Khmer and says the newer data was kept', () => {
  for (const pair of Object.values(KEYS)) {
    for (const key of Object.values(pair)) {
      assert.equal(typeof EN[key], 'string', `en.json has no ${key}`)
      assert.equal(typeof KM[key], 'string', `km.json has no ${key}`)
      assert.match(String(KM[key]), /[ក-៿]/, `km ${key} is not Khmer`)
      assert.notEqual(KM[key], EN[key], `km ${key} is the English`)
    }
  }
  for (const direction of ['undo', 'redo'] as const) {
    const english = String(EN[KEYS.recordChanged[direction]])
    assert.match(english, /changed this record after this action/, `en ${direction}: says someone changed the record after the action`)
    assert.match(english, new RegExp(direction === 'undo' ? '\\bUndo\\b' : '\\bRedo\\b'), `en ${direction}: names what was refused`)
    assert.match(english, /newer data/, `en ${direction}: says why (to protect the newer data)`)
    const khmer = String(KM[KEYS.recordChanged[direction]])
    assert.ok(khmer.includes(direction === 'undo' ? 'ត្រឡប់វិញ' : 'ធ្វើឡើងវិញ'), `km ${direction}: uses the pack's own word for ${direction} (${KM[direction]})`)
    assert.ok(khmer.includes('ទិន្នន័យថ្មី'), `km ${direction}: mentions the newer data`)
    assert.ok(String(KM[KEYS.noDefaultBranch[direction]]).includes(String(KM.default_branch_option)), `km ${direction}: no-default refusal uses the pack's "default branch"`)
  }
})

await runCase('the transport maps exactly the codes the Worker sends', () => {
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'api', 'actionHistoryTransport.ts'), 'utf8')
  for (const [constant, pair] of [['UNDO_RECORD_CHANGED_CODE', KEYS.recordChanged], ['UNDO_NO_DEFAULT_BRANCH_CODE', KEYS.noDefaultBranch]] as const) {
    const code = workerCode(constant)
    assert.match(source, new RegExp(`\\b${code}: \\{ undo: '${pair.undo}', redo: '${pair.redo}' \\}`), `${code} -> ${pair.undo} / ${pair.redo}`)
  }
})

for (const language of ['en', 'km'] as const) {
  const pack = language === 'km' ? KM : EN
  for (const direction of ['undo', 'redo'] as const) {
    await runCase(`${language}: ${direction === 'undo' ? 'an' : 'a'} ${direction} refused because the record changed shows the ${language} pack's message, keeping status and code`, async () => {
      uiLanguage = language
      const code = workerCode('UNDO_RECORD_CHANGED_CODE')
      nextRefusal = { status: 409, error: RECORD_CHANGED_ENGLISH, code }
      const call = direction === 'undo' ? transport.undoActionHistory(17) : transport.redoActionHistory(17)
      const error = await rejection(call)
      assert.equal(error.message, pack[KEYS.recordChanged[direction]])
      assert.equal(error.status, 409, 'the HTTP status travels with the error')
      assert.equal(error.code, code, 'the machine code travels with the error')
      assert.deepEqual(requests, [{ method: 'POST', url: `/api/action-history/17/${direction}` }])
    })
    await runCase(`${language}: ${direction === 'undo' ? 'an' : 'a'} ${direction} that would leave no default branch shows its own ${language} message`, async () => {
      uiLanguage = language
      nextRefusal = { status: 409, error: `This change cannot be ${direction}ne: it would leave no default branch. Nothing was changed.`, code: workerCode('UNDO_NO_DEFAULT_BRANCH_CODE') }
      const error = await rejection(direction === 'undo' ? transport.undoActionHistory(3) : transport.redoActionHistory(3))
      assert.equal(error.message, pack[KEYS.noDefaultBranch[direction]])
    })
  }
}

await runCase('a refusal without a refusal code, or with another code, keeps the server message untouched', async () => {
  for (const refusal of [
    { status: 409, error: 'Action is not undoable right now' },
    { status: 409, error: 'This item changed on another device.', code: 'write_conflict' },
    { status: 500, error: 'The branch this action changed no longer exists, so it cannot be reversed.' },
  ]) {
    uiLanguage = 'km'
    nextRefusal = refusal
    const error = await rejection(transport.undoActionHistory(9))
    assert.equal(error.message, refusal.error)
    assert.equal(error.status, refusal.status)
  }
})

await runCase('an applied replay still resolves with the Worker response', async () => {
  uiLanguage = 'km'
  assert.deepEqual(await transport.undoActionHistory(5), { success: true, applied: true })
  assert.deepEqual(await transport.redoActionHistory(5), { success: true, applied: true })
})

await runCase('the history hook shows the transport error message as is, for both the live and the server-row path', () => {
  const hook = fs.readFileSync(path.join(FRONTEND, 'src', 'utils', 'actionHistory.ts'), 'utf8')
  assert.match(hook, /function getErrorMessage\(error: unknown, fallback: string\): string \{\s*return error instanceof Error \? error\.message : String\(error \|\| fallback\)/)
  assert.equal(hook.match(/notify\?\.\(getErrorMessage\(error, `Unable to \$\{direction\} that action right now\.`\), 'error'\)/g)?.length, 2,
    'runEntry and runServerEntry both notify the transport error message')
})

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll undo refusal message checks passed.')
