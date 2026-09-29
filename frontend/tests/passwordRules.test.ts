import assert from 'node:assert/strict'
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  isNewPasswordProblem,
  newPasswordProblem,
  newPasswordRefusalMessage,
  passwordProblemMessage,
} from '../src/utils/passwordRules.ts'

// AUTH-P1: the app refuses exactly what the Worker refuses for a NEW password
// (cloudflare/src/lib/passwordPolicy.ts newPasswordProblem, enforced in
// routes/users.ts and routes/auth.ts). A client rule stricter than the server
// blocks people for nothing; a looser one lets a save through that the server
// then refuses. Parity is checked by running BOTH implementations on the same
// inputs, not by comparing source text.

type TestCallback = () => void | Promise<void>
let failed = 0
async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const server = await import(new URL('../../cloudflare/src/lib/passwordPolicy.ts', import.meta.url).href) as {
  MIN_PASSWORD_LENGTH: number
  MAX_PASSWORD_BYTES: number
  newPasswordProblem: (value: unknown) => string | null
}

const KHMER_KA = 'ក'
const FIXTURES: string[] = [
  '', 'a', 'abcde', 'abcdef', 'abc def', ' abcdef', 'abcdef ', '\tabcdef', 'abcdef\n', ' abcdef', '      ',
  'a'.repeat(72), 'a'.repeat(73), KHMER_KA.repeat(2), KHMER_KA.repeat(24), KHMER_KA.repeat(25),
  '\u{1F511}'.repeat(18), '\u{1F511}'.repeat(19), 'abcd-EFGH-2345-jkmn',
]
const tr = (_key: string, fallback: string) => fallback

await runTest('the app and the Worker give the same answer for every fixture', () => {
  assert.equal(MIN_PASSWORD_LENGTH, server.MIN_PASSWORD_LENGTH)
  assert.equal(MAX_PASSWORD_BYTES, server.MAX_PASSWORD_BYTES)
  for (const value of FIXTURES) {
    assert.equal(newPasswordProblem(value), server.newPasswordProblem(value), JSON.stringify(value))
  }
})

await runTest('the minimum stays 6 until the owner rules (Q4): 5 refused, 6 accepted', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 6)
  assert.equal(newPasswordProblem('abcde'), 'password_too_short')
  assert.equal(newPasswordProblem('abcdef'), null)
})

await runTest('edge whitespace is refused, never trimmed; inner spaces are fine', () => {
  assert.equal(newPasswordProblem(' abcdef'), 'password_edge_whitespace')
  assert.equal(newPasswordProblem('abcdef '), 'password_edge_whitespace')
  assert.equal(newPasswordProblem('abc def'), null)
})

await runTest('the 72 limit is UTF-8 bytes: 24 Khmer letters pass, 25 do not', () => {
  assert.equal(newPasswordProblem(KHMER_KA.repeat(24)), null)
  assert.equal(newPasswordProblem(KHMER_KA.repeat(25)), 'password_too_long')
})

await runTest('each problem has a message that names the number it enforces', () => {
  assert.match(passwordProblemMessage('password_too_short', tr), /6/)
  assert.match(passwordProblemMessage('password_too_long', tr), /72/)
  assert.ok(passwordProblemMessage('password_edge_whitespace', tr).length > 10)
  const khmer = (key: string, fallback: string) => (key === 'password_too_short' ? 'យ៉ាងតិច {min} តួ' : fallback)
  assert.equal(passwordProblemMessage('password_too_short', khmer), 'យ៉ាងតិច 6 តួ', 'the translated text gets the number too')
})

await runTest('a server refusal code is recognised so the screen can say it in the operator\'s language', () => {
  for (const code of ['password_too_short', 'password_edge_whitespace', 'password_too_long']) assert.equal(isNewPasswordProblem(code), true)
  for (const code of ['incorrect_password', 'password_known_leaked', '', 'password']) assert.equal(isNewPasswordProblem(code), false)
})

await runTest('every refusal of a new password reads the same on every screen, from an answer or a thrown error', () => {
  const tr = (key: string, fallback: string) => `${key}: ${fallback}`
  assert.equal(newPasswordRefusalMessage({ success: false, code: 'password_too_long' }, tr), passwordProblemMessage('password_too_long', tr))
  assert.equal(newPasswordRefusalMessage(Object.assign(new Error('English'), { code: 'password_edge_whitespace' }), tr), passwordProblemMessage('password_edge_whitespace', tr))
  assert.match(newPasswordRefusalMessage({ code: 'password_known_leaked' }, tr) || '', /^password_known_leaked: /)
  for (const other of [{ code: 'incorrect_password' }, { code: 'current_password_rate_limited' }, { error: 'x' }, null, undefined, 'password_too_short']) {
    assert.equal(newPasswordRefusalMessage(other, tr), null, `not a new-password refusal: ${JSON.stringify(other)}`)
  }
})

if (failed > 0) process.exitCode = 1
