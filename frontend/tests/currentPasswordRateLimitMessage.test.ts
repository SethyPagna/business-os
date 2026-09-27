// A current password that hit its limit is told in the operator's language
// (U-profile3, refuter X5, 27 Sep 2026).
//
// The Worker answers 429 `code: 'current_password_rate_limited'`
// (cloudflare/src/lib/currentPasswordGuard.ts). Every screen that re-enters
// the current password showed the server's English sentence instead: My
// Profile's profile save, password change and Google disconnect, and the
// Users page password change. They now map the code through
// components/users/currentPasswordErrors.ts to a pack key present in both
// languages. Also pins the remove-photo dialog text, which promised that the
// photo is "deleted from storage" -- the X1 fix made that untrue.
//
// Run: node tests/currentPasswordRateLimitMessage.test.ts
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
const KEY = 'current_password_rate_limited'

type Mod = typeof import('../src/components/users/currentPasswordErrors.ts')
let mod: Mod | null = null
try {
  mod = await import('../src/components/users/currentPasswordErrors.ts')
} catch (error) {
  console.error('currentPasswordErrors.ts could not be loaded:', (error as Error).message)
}
const need = (): Mod => { assert.ok(mod, 'components/users/currentPasswordErrors.ts exists'); return mod! }

// The app's tr: the pack value when present, else the call's fallback.
const trFrom = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback

// What http.ts createApiError throws for the Worker's 429 body.
function apiError429(): Error & { status: number; code: string } {
  const error = new Error('Too many wrong current-password attempts. Please try again later.') as Error & { status: number; code: string }
  error.status = 429
  error.code = 'current_password_rate_limited'
  return error
}

await runTest('the 429 thrown by apiFetch becomes the pack message, in English and in Khmer', () => {
  const { currentPasswordRateLimitMessage } = need()
  assert.equal(currentPasswordRateLimitMessage(apiError429(), trFrom(en)), en[KEY])
  assert.equal(currentPasswordRateLimitMessage(apiError429(), trFrom(km)), km[KEY])
  assert.equal(currentPasswordRateLimitMessage({ success: false, code: KEY, error: 'x' }, trFrom(km)), km[KEY], 'a { success: false } result maps too')
})

await runTest('control: any other failure is left to the caller (wrong password, conflict, network)', () => {
  const { currentPasswordRateLimitMessage } = need()
  const wrong = Object.assign(new Error('Current password is incorrect'), { status: 400, code: 'incorrect_password' })
  assert.equal(currentPasswordRateLimitMessage(wrong, trFrom(en)), null)
  assert.equal(currentPasswordRateLimitMessage(Object.assign(new Error('Too Many Requests'), { status: 429, code: null }), trFrom(en)), null)
  assert.equal(currentPasswordRateLimitMessage(null, trFrom(en)), null)
  assert.equal(currentPasswordRateLimitMessage('current_password_rate_limited', trFrom(en)), null)
})

await runTest('the key is in both packs, the Khmer is Khmer, and the wait matches the Worker window', () => {
  assert.equal(typeof en[KEY], 'string')
  assert.equal(typeof km[KEY], 'string')
  assert.match(km[KEY], /[ក-៿]/)
  assert.notEqual(km[KEY], en[KEY])
  const guard = read('../../cloudflare/src/lib/currentPasswordGuard.ts')
  const minutes = Number((/CURRENT_PASSWORD_LIMIT_WINDOW_MS = (\d+) \* 60 \* 1000/.exec(guard) || [])[1])
  assert.ok(minutes > 0, 'the Worker window is readable')
  assert.ok(en[KEY].includes(`${minutes} minutes`), `en says ${minutes} minutes`)
  assert.ok(km[KEY].includes(String(minutes).replace(/\d/g, (d) => '០១២៣៤៥៦៧៨៩'[Number(d)])), `km says ${minutes} minutes in Khmer digits`)
})

const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  assert.ok(from > -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.ok(to > from, `missing ${end} after ${start}`)
  return source.slice(from, to)
}

await runTest('every screen that re-enters the current password maps the code, on both failure paths', () => {
  const profile = code(read('../src/components/users/UserProfileModal.tsx'))
  const users = code(read('../src/components/users/Users.tsx'))
  const surfaces = [
    ['My Profile save', between(profile, 'const commitProfileSave = async', 'const handlePasswordSave = async')],
    ['My Profile password change', between(profile, 'const handlePasswordSave = async', 'const handleSessionSave = ')],
    ['My Profile Google disconnect', between(profile, 'const handleDisconnectOauthProvider = async', 'const handleAvatarSelected = async')],
    ['Users page password change', between(users, 'const handleResetPassword = async', 'const handleSaveRole = async')],
  ] as const
  for (const [name, body] of surfaces) {
    assert.ok(body.includes('currentPasswordRateLimitMessage(result, tr) ||'), `${name}: a { success: false } result`)
    assert.ok(body.includes('currentPasswordRateLimitMessage(error, tr) ||'), `${name}: a thrown ApiError`)
  }
})

await runTest('the remove-photo dialog no longer promises the photo is deleted from storage', () => {
  assert.doesNotMatch(en.remove_avatar_message, /delet/i)
  assert.match(en.remove_avatar_message, /stays in the file library/)
  assert.doesNotMatch(km.remove_avatar_message, /លុប/)
  assert.match(km.remove_avatar_message, /[ក-៿]/)
})

if (failed) {
  console.error(`${failed} failed`)
  process.exitCode = 1
}
