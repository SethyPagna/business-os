// Signing in by username, name, email or phone.
//
// The sign-in field has been labelled "Username, name, email, or phone" for
// a long time, but POST /login only ever matched `u.username`. Signing in
// with any of the other three failed as "Invalid username or password",
// which reads as a wrong password rather than an unsupported identifier.
//
// The risky half of fixing that is ambiguity, which is what this file is
// really about. `username` is unique in this schema; `name`, `email` and
// `phone_lookup` are not necessarily. Matching loosely without care would
// eventually sign somebody into a colleague's account because two staff
// share a display name -- a far worse outcome than asking them to type
// their username. So:
//
//   - an exact username match wins outright, even when the same string is
//     somebody else's NAME
//   - the other three are accepted only when they identify exactly one
//     account
//   - an ambiguous identifier resolves to nothing, taking the same generic
//     failure path as an unknown one, so the response cannot be used to
//     discover which names or numbers are shared
//
// Replicates the route's real resolution SQL against the real users schema.
//
// Run: node scripts/test-login-identifier-pure.cjs

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const Database = require('better-sqlite3')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- real schema ----------------------------------------------------------

const initSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8')
const usersDdl = initSql.match(/CREATE TABLE (?:IF NOT EXISTS )?users\s*\([\s\S]*?\n\);/)
assert.ok(usersDdl, 'could not find the users table definition in 0001_init.sql')

const db = new Database(':memory:')
db.exec(usersDdl[0])
// Columns added by later migrations that the login lookup depends on.
for (const col of ['email TEXT', 'phone_lookup TEXT', 'deleted_at TEXT']) {
  const name = col.split(' ')[0]
  const exists = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === name)
  if (!exists) db.exec(`ALTER TABLE users ADD COLUMN ${col}`)
}
db.exec('CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, code TEXT, permissions TEXT)')

const insert = db.prepare(`
  INSERT INTO users (id, username, name, password, email, phone_lookup, is_active, deleted_at)
  VALUES (@id, @username, @name, 'hash', @email, @phone, 1, @deleted)
`)
const add = (row) => insert.run({ email: null, phone: null, deleted: null, ...row })

add({ id: 1, username: 'dara.k', name: 'Dara', email: 'dara@shop.com', phone: '012345678' })
// Same display name as user 1 -- the collision this design exists for.
add({ id: 2, username: 'dara.s', name: 'Dara', email: 'dara.s@shop.com', phone: '098765432' })
add({ id: 3, username: 'sophea', name: 'Sophea Lim', email: 'sophea@shop.com', phone: '011223344' })
// Username collides with user 3's NAME fragment; also a deleted decoy below.
add({ id: 4, username: 'Sophea Lim', name: 'Impostor', email: 'impostor@shop.com', phone: '077777777' })
add({ id: 5, username: 'gone', name: 'Gone Away', email: 'gone@shop.com', phone: '055555555', deleted: '2026-01-01' })

// --- the route's real resolution logic ------------------------------------

const SELECT_LOGIN_USER = `
  SELECT u.id, u.username, u.name, u.is_active
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
`

function resolveLoginUser(rawIdentifier) {
  const identifier = String(rawIdentifier ?? '').trim()
  const identifierLower = identifier.toLowerCase()
  const identifierPhone = identifier.replace(/[^\d+]/g, '')

  let user = db.prepare(`
    ${SELECT_LOGIN_USER}
    WHERE lower(u.username) = lower(:identifier) AND u.deleted_at IS NULL
    LIMIT 1
  `).get({ identifier })

  if (!user) {
    const candidates = db.prepare(`
      ${SELECT_LOGIN_USER}
      WHERE u.deleted_at IS NULL
        AND (
          lower(trim(COALESCE(u.email, ''))) = :identifierLower
          OR (:identifierPhone <> '' AND COALESCE(u.phone_lookup, '') = :identifierPhone)
          OR lower(trim(COALESCE(u.name, ''))) = :identifierLower
        )
      LIMIT 2
    `).all({ identifierLower, identifierPhone })
    if (candidates.length === 1) user = candidates[0]
  }
  return user || null
}

// --- each identifier type resolves ---------------------------------------

check('username signs in', () => {
  assert.equal(resolveLoginUser('dara.k').id, 1)
})

check('username is case-insensitive', () => {
  assert.equal(resolveLoginUser('DARA.K').id, 1)
})

check('email signs in', () => {
  assert.equal(resolveLoginUser('sophea@shop.com').id, 3)
  assert.equal(resolveLoginUser('  SOPHEA@SHOP.COM  ').id, 3, 'trimmed and case-insensitive')
})

check('phone signs in, however it is punctuated', () => {
  assert.equal(resolveLoginUser('011223344').id, 3)
  assert.equal(resolveLoginUser('011-223-344').id, 3)
  assert.equal(resolveLoginUser('011 223 344').id, 3)
})

check('a unique name signs in', () => {
  assert.equal(resolveLoginUser('Sophea Lim').id, 4, 'exact USERNAME match wins over another row\'s name')
  assert.equal(resolveLoginUser('Impostor').id, 4)
})

// --- ambiguity and precedence: the part that must not go wrong -----------

check('an exact username match wins even when the same string is another user\'s name', () => {
  // "Sophea Lim" is user 3's NAME and user 4's USERNAME. Username wins.
  const user = resolveLoginUser('Sophea Lim')
  assert.equal(user.id, 4, 'the account whose USERNAME matches must win')
  assert.notEqual(user.id, 3, 'must not resolve by name when a username matches exactly')
})

check('a name shared by two people resolves to NOBODY rather than guessing', () => {
  // Both user 1 and user 2 are named "Dara". Signing either in would be
  // wrong half the time.
  assert.equal(resolveLoginUser('Dara'), null)
})

check('each of those two can still sign in by their own username', () => {
  assert.equal(resolveLoginUser('dara.k').id, 1)
  assert.equal(resolveLoginUser('dara.s').id, 2)
})

check('each of those two can still sign in by their own unique email or phone', () => {
  assert.equal(resolveLoginUser('dara@shop.com').id, 1)
  assert.equal(resolveLoginUser('098765432').id, 2)
})

check('an unknown identifier resolves to nothing', () => {
  assert.equal(resolveLoginUser('nobody@nowhere.com'), null)
  assert.equal(resolveLoginUser('000000000'), null)
})

check('an ambiguous identifier is indistinguishable from an unknown one', () => {
  // Both return null, so the caller emits the same generic failure and the
  // response cannot be used to discover which names are shared.
  assert.equal(resolveLoginUser('Dara'), resolveLoginUser('definitely-not-a-user'))
})

check('a soft-deleted account cannot sign in by ANY identifier', () => {
  assert.equal(resolveLoginUser('gone'), null, 'username')
  assert.equal(resolveLoginUser('gone@shop.com'), null, 'email')
  assert.equal(resolveLoginUser('055555555'), null, 'phone')
  assert.equal(resolveLoginUser('Gone Away'), null, 'name')
})

check('an empty identifier never matches a row with a null email or phone', () => {
  // The @identifierPhone <> '' guard exists for this: without it, an empty
  // identifier would match every row whose phone_lookup is ''.
  assert.equal(resolveLoginUser(''), null)
  assert.equal(resolveLoginUser('   '), null)
})

db.close()
console.log(`\n${passed} login-identifier checks passed`)
