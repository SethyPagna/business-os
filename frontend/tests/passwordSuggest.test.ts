import assert from 'node:assert/strict'
import { SUGGEST_ALPHABET, passwordStrength, suggestPassword } from '../src/utils/passwordSuggest.ts'
import { newPasswordProblem } from '../src/utils/passwordRules.ts'

// AUTH-P1: the Suggest button's generator. Four groups of four from an
// alphabet without look-alikes (no l, o, I, O, 0, 1), crypto randomness with
// rejection sampling (no modulo bias), and always a lower, an upper and a
// digit. The strength meter is advice only; it never blocks a save.

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

const DRAWS = 10_000
const draws = Array.from({ length: DRAWS }, () => suggestPassword())
const SHAPE = new RegExp(`^[${SUGGEST_ALPHABET}]{4}(?:-[${SUGGEST_ALPHABET}]{4}){3}$`)

await runTest('the alphabet has 56 characters and none that look alike', () => {
  assert.equal(SUGGEST_ALPHABET.length, 56)
  assert.equal(new Set(SUGGEST_ALPHABET).size, 56)
  for (const lookAlike of 'lIoO01') assert.equal(SUGGEST_ALPHABET.includes(lookAlike), false, lookAlike)
})

await runTest('10,000 draws: 19 ASCII characters, four groups of four, a lower, an upper and a digit each', () => {
  for (const value of draws) {
    assert.equal(value.length, 19)
    assert.match(value, SHAPE)
    assert.match(value, /[a-z]/)
    assert.match(value, /[A-Z]/)
    assert.match(value, /[2-9]/)
    assert.equal(newPasswordProblem(value), null, 'every suggestion passes the new-password rule')
  }
  assert.ok(new Set(draws).size > DRAWS - 2, 'suggestions do not repeat')
})

// Bounds are 5 sigma: with 896 position/character cells a 3-sigma bound would
// fail a correct generator on most runs.
const withinFiveSigma = (count: number, trials: number, p: number) => Math.abs(count - trials * p) < 5 * Math.sqrt(trials * p * (1 - p))

await runTest('every alphabet character appears, letters are equally likely, and no position favours one', () => {
  const positions = Array.from({ length: 16 }, () => new Map<string, number>())
  for (const value of draws) {
    [...value.replaceAll('-', '')].forEach((char, index) => positions[index].set(char, (positions[index].get(char) || 0) + 1))
  }
  const overall = new Map<string, number>()
  for (const counts of positions) for (const [char, n] of counts) overall.set(char, (overall.get(char) || 0) + n)
  assert.equal(overall.size, 56, 'every character is used')
  // Redrawing a suggestion without a digit lifts the digits a little; the 48
  // letters are untouched by that and must be equally likely.
  const letters = [...SUGGEST_ALPHABET].filter((char) => /[a-zA-Z]/.test(char))
  const letterTotal = letters.reduce((sum, char) => sum + (overall.get(char) || 0), 0)
  for (const char of letters) {
    assert.ok(withinFiveSigma(overall.get(char) || 0, letterTotal, 1 / letters.length), `letter ${char}: ${overall.get(char)} of ${letterTotal}`)
  }
  for (const [index, counts] of positions.entries()) {
    for (const char of SUGGEST_ALPHABET) {
      const pooled = (overall.get(char) || 0) / (16 * DRAWS)
      assert.ok(withinFiveSigma(counts.get(char) || 0, DRAWS, pooled), `position ${index} char ${char}: ${counts.get(char)} vs ${(pooled * DRAWS).toFixed(1)}`)
    }
  }
})

await runTest('random bytes at or above 224 are rejected, not folded (no modulo bias)', () => {
  const tape = [255, 224, 250, 0, 24, 48]
  let cursor = 0
  const fakeRandom = (buffer: Uint8Array) => {
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = tape[cursor++ % tape.length]
    return buffer
  }
  const value = suggestPassword(fakeRandom)
  const accepted = [0, 24, 48].map((byte) => SUGGEST_ALPHABET[byte % 56])
  assert.equal(value.slice(0, 3), accepted.join(''), 'bytes 255, 224 and 250 are skipped; 0, 24 and 48 map straight in')
})

await runTest('strength: weak, fair, strong', () => {
  assert.equal(passwordStrength(''), 'weak')
  assert.equal(passwordStrength('abcdef'), 'weak', 'under 10 characters')
  assert.equal(passwordStrength('abcdefghijkl'), 'weak', 'one character class')
  assert.equal(passwordStrength('aaaaaaaaaaaaaaaa'), 'weak', 'one repeated character')
  assert.equal(passwordStrength('abcdefgh12'), 'fair', '10 characters, two classes')
  assert.equal(passwordStrength('Abcdefgh1234xy'), 'strong', '14 characters, three classes')
  assert.equal(passwordStrength('Abcdefgh123'), 'fair', 'three classes but under 14')
  assert.equal(passwordStrength(draws[0]), 'strong', 'a suggestion is strong')
})

await runTest('strength: a password containing the person\'s username, name or phone is weak', () => {
  assert.equal(passwordStrength('Sokha-2026-Strong!', { username: 'sokha' }), 'weak')
  assert.equal(passwordStrength('MyShop#Dara2026xx', { name: 'Dara' }), 'weak')
  assert.equal(passwordStrength('Pw-012345678-Long', { phone: '012 345 678' }), 'weak')
  assert.equal(passwordStrength('Sokha-2026-Strong!', { username: 'dara' }), 'strong', 'control: someone else\'s name does not count')
  assert.equal(passwordStrength('Abcdefgh1234xy', { username: 'ab', phone: '12' }), 'strong', 'very short identities are ignored')
})

if (failed > 0) process.exitCode = 1
