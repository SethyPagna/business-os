// G38 Phase 1 acceptance: website Member IDs (lib/memberCode.ts, design §4.2).
//
//   "10,000 minted codes: all match ^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$,
//    check digit valid, no duplicates, none equals a value derived from the row
//    id (mutant: sequential mint must fail the test)."
//
// The same property check runs against the real minter and against two
// plausible wrong ones -- a sequential minter and a minter that hashes the
// row id -- and must reject both mutants, so a green result here means the
// check can see the difference (memory: discriminating tests).
//
// Run (from cloudflare/): node scripts/test-portal-member-code-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(rel) {
  const file = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, require, mod)
  return mod.exports
}

const code = loadTs('lib/memberCode.ts')
const PATTERN = /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const N = 10_000

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// Encodes a row id the way a lazy implementation would: base32 of the id,
// zero-padded to seven characters, plus the real check character.
function encodeId(id) {
  let data = ''
  let n = id
  for (let i = 0; i < 7; i += 1) { data = ALPHABET[n % 32] + data; n = Math.floor(n / 32) }
  const full = data + code.memberCodeCheckChar(data)
  return `W-${full.slice(0, 4)}-${full.slice(4)}`
}
function hashOfId(id) {
  const digest = require('node:crypto').createHash('sha256').update(`member:${id}`).digest()
  let data = ''
  for (let i = 0; i < 7; i += 1) data += ALPHABET[digest[i] % 32]
  const full = data + code.memberCodeCheckChar(data)
  return `W-${full.slice(0, 4)}-${full.slice(4)}`
}

// The acceptance property, as a function of a minter `mint(rowId)`.
// Returns the list of violated properties (empty = acceptable).
function violations(mint) {
  const problems = []
  const first = []
  for (let id = 1; id <= N; id += 1) first.push(mint(id))
  if (!first.every((c) => PATTERN.test(c))) problems.push('pattern')
  if (!first.every((c) => code.normalizeMemberCode(c) === c)) problems.push('check character')
  if (new Set(first).size !== first.length) problems.push('duplicates')
  // Not derived from the row id: not its plain encoding ...
  if (first.some((c, i) => c === encodeId(i + 1))) problems.push('equals encoded row id')
  // ... and not ANY fixed function of it: minting the same ids again must not
  // reproduce the same codes (a hash of the id would).
  const again = []
  for (let id = 1; id <= N; id += 1) again.push(mint(id))
  const repeats = again.filter((c, i) => c === first[i]).length
  if (repeats > 2) problems.push(`reproducible from the row id (${repeats} repeats)`)
  // Not in order: a sequence sorts the same as it was issued.
  const sorted = [...first].sort()
  if (first.every((c, i) => c === sorted[i])) problems.push('sequential')
  // Every position uses the alphabet roughly evenly (catches a stuck or
  // narrowed random source): each of 32 symbols appears at each data position.
  for (let pos = 0; pos < 7; pos += 1) {
    const chars = new Set(first.map((c) => c.replace(/-/g, '').slice(1)[pos]))
    if (chars.size < 32) { problems.push(`position ${pos} uses only ${chars.size} symbols`); break }
  }
  return problems
}

check('10,000 real codes: pattern, check character, unique, random, not from the row id', () => {
  assert.deepEqual(violations(() => code.mintMemberCode()), [])
})

check('mutant: a SEQUENTIAL minter fails the same property check', () => {
  const problems = violations((id) => encodeId(id))
  assert.ok(problems.includes('equals encoded row id'), problems.join(', '))
  assert.ok(problems.includes('sequential'), problems.join(', '))
})

check('mutant: a minter that HASHES the row id fails the same property check', () => {
  const problems = violations((id) => hashOfId(id))
  assert.ok(problems.some((p) => p.startsWith('reproducible from the row id')), problems.join(', '))
})

check('mutant: a random minter WITHOUT a valid check character fails', () => {
  const problems = violations(() => {
    const valid = code.mintMemberCode()
    const last = valid.slice(-1)
    return valid.slice(0, -1) + ALPHABET[(ALPHABET.indexOf(last) + 1) % 32]
  })
  assert.ok(problems.includes('check character'), problems.join(', '))
})

check('the check character catches every single wrong character', () => {
  for (let trial = 0; trial < 300; trial += 1) {
    const valid = code.mintMemberCode()
    const chars = valid.replace(/^W-/, '').replace('-', '').split('')
    for (let pos = 0; pos < 8; pos += 1) {
      for (const replacement of ALPHABET) {
        if (replacement === chars[pos]) continue
        const wrong = [...chars]
        wrong[pos] = replacement
        assert.equal(code.normalizeMemberCode(wrong.join('')), null, `${valid}: ${wrong.join('')} passed`)
      }
    }
  }
})

check('the check character catches nearly every swap of two neighbours', () => {
  let swaps = 0
  let caught = 0
  for (let trial = 0; trial < 2000; trial += 1) {
    const chars = code.mintMemberCode().replace(/^W-/, '').replace('-', '').split('')
    for (let pos = 0; pos < 7; pos += 1) {
      if (chars[pos] === chars[pos + 1]) continue
      const swapped = [...chars]
      ;[swapped[pos], swapped[pos + 1]] = [swapped[pos + 1], swapped[pos]]
      swaps += 1
      if (code.normalizeMemberCode(swapped.join('')) === null) caught += 1
    }
  }
  // Luhn mod 32 misses only the pair whose values differ by 31 (0 <-> Z).
  assert.ok(caught / swaps > 0.99, `${caught}/${swaps}`)
})

check('typing is forgiven: case, spaces, dashes, missing W, and O/I/L look-alikes', () => {
  const valid = code.mintMemberCode()
  const bare = valid.replace(/^W-/, '').replace('-', '')
  assert.equal(code.normalizeMemberCode(valid.toLowerCase()), valid)
  assert.equal(code.normalizeMemberCode(bare), valid)
  assert.equal(code.normalizeMemberCode(` w ${bare.slice(0, 4)} ${bare.slice(4)} `), valid)
  const withZero = code.mintMemberCode((bytes) => bytes.fill(0))
  assert.equal(withZero, `W-0000-000${code.memberCodeCheckChar('0000000')}`)
  assert.equal(code.normalizeMemberCode(withZero.replace(/0/g, 'O')), withZero, 'O reads as 0')
  assert.equal(code.normalizeMemberCode('LC-00001'), null, 'a store number is never a member code')
  assert.equal(code.normalizeMemberCode(''), null)
  assert.equal(code.isValidMemberCode(valid), true)
  assert.equal(code.isValidMemberCode(valid.toLowerCase()), false, 'stored codes are canonical upper case')
})

check('the minter uses crypto.getRandomValues only (no Math.random, no row id input)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'memberCode.ts'), 'utf8')
  assert.doesNotMatch(source, /Math\.random/)
  assert.match(source, /crypto\.getRandomValues/)
  assert.match(source, /export function mintMemberCode\(random: \(bytes: Uint8Array\) => Uint8Array/, 'the only input is a random source')
})

check('the 0230 schema CHECK accepts real codes and refuses other shapes', () => {
  const { openDb } = require('./harness/d1compat.cjs')
  const { loadAll } = require('./harness/load_migrations.cjs')
  const db = openDb(loadAll())
  const insert = (value) => db.prepare("INSERT INTO portal_accounts (name, member_code) VALUES ('x', @c)").run({ c: value })
  insert(code.mintMemberCode())
  for (const bad of ['W-0000-000I', 'W-ABCD-EFG', 'LC-00001', 'w-0000-0000', 'W-0000-0000-']) {
    assert.throws(() => insert(bad), /CHECK constraint failed/, bad)
  }
  const dupe = code.mintMemberCode()
  insert(dupe)
  assert.throws(() => insert(dupe), (error) => code.isMemberCodeCollision(error))
})

console.log(`\n${passed} checks passed`)
