// The last-administrator refusal is told in the operator's language
// (FX-sec2, refuter R-sec F3, 27 Sep 2026).
//
// The Worker refuses any user or role write that would leave no active
// administrator with 409 `code: 'last_admin_required'`
// (cloudflare/src/lib/adminControlGuard.ts). The Users page is the only
// screen that writes a user's role, status or permissions or a role's
// permissions; every path there -- save user, save role, and the Undo/Redo
// of either edit -- maps the code through
// components/users/lastAdminErrors.ts to a pack key present in both
// languages instead of showing the server's English sentence.
//
// Run: node tests/lastAdminRequiredMessage.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const runTest = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const KEY = 'last_admin_required'

type Mod = typeof import('../src/components/users/lastAdminErrors.ts')
let mod: Mod | null = null
try {
  mod = await import('../src/components/users/lastAdminErrors.ts')
} catch (error) {
  console.error('lastAdminErrors.ts could not be loaded:', (error as Error).message)
}
const need = (): Mod => { assert.ok(mod, 'components/users/lastAdminErrors.ts exists'); return mod! }

// The app's tr: the pack value when present, else the call's fallback.
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback

// What http.ts createApiError throws for the Worker's 409 body.
function apiError409(): Error & { status: number; code: string } {
  const error = new Error('This change would leave no active administrator. Give another active user the admin role first. No changes were saved.') as Error & { status: number; code: string }
  error.status = 409
  error.code = 'last_admin_required'
  return error
}

await runTest('the 409 thrown by apiFetch becomes the pack message, in English and in Khmer', () => {
  const { lastAdminRequiredMessage } = need()
  assert.equal(lastAdminRequiredMessage(apiError409(), trFrom(en)), en[KEY])
  assert.equal(lastAdminRequiredMessage(apiError409(), trFrom(km)), km[KEY])
  assert.equal(lastAdminRequiredMessage({ success: false, code: KEY, error: 'x' }, trFrom(km)), km[KEY], 'a { success: false } result maps too')
})

await runTest('control: any other failure is left to the caller (write conflict, reserved name, no permission)', () => {
  const { lastAdminRequiredMessage } = need()
  const conflict = Object.assign(new Error('This item changed on another device.'), { status: 409, code: 'write_conflict' })
  assert.equal(lastAdminRequiredMessage(conflict, trFrom(en)), null)
  assert.equal(lastAdminRequiredMessage({ success: false, code: 'username_reserved', error: 'x' }, trFrom(en)), null)
  assert.equal(lastAdminRequiredMessage(Object.assign(new Error('No permission'), { status: 403 }), trFrom(en)), null)
  assert.equal(lastAdminRequiredMessage(null, trFrom(en)), null)
  assert.equal(lastAdminRequiredMessage('last_admin_required', trFrom(en)), null)
})

await runTest('Undo/Redo rethrow the refusal with the translated sentence and leave every other error untouched', () => {
  const { lastAdminRequiredError } = need()
  const translated = lastAdminRequiredError(apiError409(), trFrom(km)) as Error & { code?: string }
  assert.ok(translated instanceof Error)
  assert.equal(translated.message, km[KEY], 'utils/actionHistory.ts shows this message')
  assert.equal(translated.code, KEY)
  const conflict = Object.assign(new Error('This item changed on another device.'), { status: 409, code: 'write_conflict' })
  assert.equal(lastAdminRequiredError(conflict, trFrom(km)), conflict, 'the same object, so conflict handling still sees it')
})

await runTest('the key is in both packs, the Khmer is Khmer, and the code is the one the Worker sends', () => {
  assert.equal(typeof en[KEY], 'string')
  assert.equal(typeof km[KEY], 'string')
  assert.match(km[KEY], /[ក-៿]/)
  assert.notEqual(km[KEY], en[KEY])
  const guard = read('../../cloudflare/src/lib/adminControlGuard.ts')
  const workerCode = (/LAST_ADMIN_REQUIRED_CODE = '([a-z_]+)'/.exec(guard) || [])[1]
  assert.equal(workerCode, KEY, 'the Worker code is readable and matches the pack key')
  assert.equal(need().LAST_ADMIN_REQUIRED_CODE, workerCode)
})

const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

await runTest('every Users page path that writes a user or a role maps the code', () => {
  const users = code(read('../src/components/users/Users.tsx'))
  const surfaces = {
    user: between(users, 'const commitSaveUser = async', 'const buildUserReviewItems = '),
    role: between(users, 'const handleSaveRole = async', 'const handleDeleteRole = '),
  }
  const paths: Array<[keyof typeof surfaces, string, string]> = [
    ['user', 'save: a { success: false } result', "notify(newPasswordRefusalMessage(result, tr) || lastAdminRequiredMessage(result, tr) || result.error || 'Failed to save user', 'error')"],
    ['user', 'save: a thrown ApiError', "notify(newPasswordRefusalMessage(error, tr) || lastAdminRequiredMessage(error, tr) || getErrorMessage(error, 'Failed to save user'), 'error')"],
    ['user', 'Undo of the edit', "throw new Error(lastAdminRequiredMessage(undoResult, tr) || undoResult.error || 'Failed to restore user')"],
    ['user', 'Redo of the edit', "throw new Error(lastAdminRequiredMessage(redoResult, tr) || redoResult.error || 'Failed to reapply user changes')"],
    ['role', 'save: a { success: false } result', "notify(lastAdminRequiredMessage(result, tr) || result.error || 'Failed to save role', 'error')"],
    ['role', 'save: a thrown ApiError', "notify(lastAdminRequiredMessage(error, tr) || getErrorMessage(error, 'Failed to save role'), 'error')"],
    ['role', 'Undo of the edit', "throw new Error(lastAdminRequiredMessage(undoResult, tr) || undoResult.error || 'Failed to restore role')"],
    ['role', 'Redo of the edit', "throw new Error(lastAdminRequiredMessage(redoResult, tr) || redoResult.error || 'Failed to reapply role changes')"],
  ]
  for (const [surface, name, expression] of paths) {
    assert.ok(surfaces[surface].includes(expression), `${surface} ${name}: ${expression}`)
  }
  // A refused Undo/Redo arrives as a thrown ApiError (apiFetch throws on 409),
  // so each edit's Undo and Redo request maps that path too.
  const thrown = /\.(updateUser|updateRole)\([^\n]*'(Undo|Redo) (user|role) update'\)\n\s*\.catch\(\(error: unknown\) => \{ throw lastAdminRequiredError\(error, tr\) \}\)/g
  const mapped = [...users.matchAll(thrown)].map((m) => `${m[2]} ${m[3]}`).sort()
  assert.deepEqual(mapped, ['Redo role', 'Redo user', 'Undo role', 'Undo user'])
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
