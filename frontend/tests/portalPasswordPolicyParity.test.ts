// Parity guard for the storefront password rule (N45).
//
// Three places state the same number and none of them can see the others:
//   1. cloudflare/src/lib/passwordPolicy.ts  -- PORTAL_MIN_PASSWORD_LENGTH,
//      the only one that actually refuses anything;
//   2. CatalogAccountSection.tsx -- the form's own minLength, which is what a
//      customer experiences and which used to say 6 while the Worker said 6
//      too, so nobody noticed the pair existed;
//   3. the privacy policy, which now promises a minimum out loud in both
//      languages -- a promise that is false the moment either of the others
//      moves.
//
// A frontend-only rule is not a rule (a direct POST skips it) and a
// backend-only rule is a bad form (the browser lets you type it, then the
// server rejects it), so this pins them together rather than picking one.
//
// Run: node tests/portalPasswordPolicyParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', '..', ...parts), 'utf8')

const worker = read('cloudflare', 'src', 'lib', 'passwordPolicy.ts')
const workerMin = worker.match(/export const PORTAL_MIN_PASSWORD_LENGTH = (\d+)/)
assert.ok(workerMin, 'passwordPolicy.ts must export PORTAL_MIN_PASSWORD_LENGTH')
const min = Number(workerMin[1])
assert.ok(min >= 8, `the portal minimum must not fall below 8, found ${min}`)

// The staff minimum is a separate, deliberately unchanged number. If someone
// "simplifies" the portal rule back onto it, this catches the regression.
const staffMin = worker.match(/export const MIN_PASSWORD_LENGTH = (\d+)/)
assert.ok(staffMin, 'passwordPolicy.ts must still export the staff MIN_PASSWORD_LENGTH')
assert.ok(Number(staffMin[1]) <= min, 'the portal rule must be at least as strict as the staff rule')

const form = read('frontend', 'src', 'components', 'catalog', 'CatalogAccountSection.tsx')
const formMin = form.match(/const PORTAL_MIN_PASSWORD_LENGTH = (\d+)/)
assert.ok(formMin, 'CatalogAccountSection.tsx must declare the mirrored minimum')
assert.equal(Number(formMin[1]), min, 'the signup form and the Worker disagree about the password minimum')
assert.match(form, /minLength=\{PORTAL_MIN_PASSWORD_LENGTH\}/, 'the password input must use the mirrored constant, not a literal')
assert.doesNotMatch(form, /minLength=\{\d+\}/, 'a hardcoded minLength cannot be kept in parity')

// The enforcement the hint promises has to exist on the server side.
assert.match(form, /PASSWORD_HINT_EN/, 'the signup form must show what the rule is before the submit fails')
for (const rule of [/password_is_phone/, /password_is_name/, /password_common/]) {
  assert.match(worker, rule, `the Worker must enforce ${rule} for portal accounts`)
}

// And the policy text must say the same number in words, in both packs.
const WORDS: Record<number, { en: RegExp; km: RegExp }> = {
  8: { en: /at least eight characters/i, km: /យ៉ាងតិច៨តួអក្សរ/ },
}
const words = WORDS[min]
assert.ok(words, `no policy wording is pinned for a minimum of ${min}; add it before changing the number`)
assert.match(PORTAL_LEGAL_EN.portal_legal_privacy_security_b, words.en, 'the English privacy policy no longer states the real minimum')
assert.match(PORTAL_LEGAL_KM.portal_legal_privacy_security_b, words.km, 'the Khmer privacy policy no longer states the real minimum')

console.log(`PASS portal password minimum ${min} agrees across the Worker, the signup form and both policy packs`)
