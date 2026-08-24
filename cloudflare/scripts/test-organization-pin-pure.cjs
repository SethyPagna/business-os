// Locks in the single-organization pin (routes/organizations.ts's
// getDefaultOrganization).
//
// This deployment serves exactly one business, Leang Cosmetics. Before the
// pin, /bootstrap resolved "first organization by id" -- correct only by
// accident of there being one row. If a second row ever appeared (a bad
// import, a backup restored from another business, a manual insert), the
// login screen could silently auto-select the wrong one.
//
// The pin is deliberately a PREFERENCE with a fallback, not a hard
// requirement: a stale or wrong BUSINESS_OS_ORGANIZATION_SLUG must never be
// able to lock everyone out of the app. Both halves of that contract are
// asserted below, because only testing the happy path would leave the
// dangerous case (config matches nothing -> null -> no login) unguarded.
//
// Run: node scripts/test-organization-pin-pure.cjs

const assert = require('assert')
const Database = require('better-sqlite3')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const ORG_COLUMNS = 'id, name, slug, public_id, is_active, setup_enabled, created_at'

// Mirrors getDefaultOrganization's real SQL and branching exactly.
function getDefaultOrganization(db, pinnedSlugRaw) {
  const pinnedSlug = String(pinnedSlugRaw || '').trim().toLowerCase()
  if (pinnedSlug) {
    const pinned = db
      .prepare(`SELECT ${ORG_COLUMNS} FROM organizations WHERE lower(trim(slug)) = @slug OR lower(trim(public_id)) = @slug LIMIT 1`)
      .get({ slug: pinnedSlug })
    if (pinned) return pinned
  }
  return db.prepare(`SELECT ${ORG_COLUMNS} FROM organizations ORDER BY id ASC LIMIT 1`).get() || null
}

function freshDb(rows) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE organizations (
    id INTEGER PRIMARY KEY, name TEXT, slug TEXT, public_id TEXT,
    is_active INTEGER DEFAULT 1, setup_enabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`)
  const ins = db.prepare('INSERT INTO organizations (id, name, slug, public_id) VALUES (@id, @name, @slug, @public_id)')
  for (const r of rows) ins.run(r)
  return db
}

const OTHER = { id: 1, name: 'Business OS', slug: 'business-os', public_id: 'org_business_os' }
const LEANG = { id: 2, name: 'LeangCosmetics', slug: 'leangcosmetics', public_id: 'org_leangcosmetics' }

check('pins to the configured org even when another row sorts first by id', () => {
  const db = freshDb([OTHER, LEANG])
  assert.equal(getDefaultOrganization(db, 'leangcosmetics').id, 2, 'must pin to the configured slug, not the lowest id')
  db.close()
})

check('matches on public_id as well as slug', () => {
  const db = freshDb([OTHER, LEANG])
  assert.equal(getDefaultOrganization(db, 'org_leangcosmetics').id, 2)
  db.close()
})

check('match is case- and whitespace-insensitive', () => {
  const db = freshDb([OTHER, LEANG])
  assert.equal(getDefaultOrganization(db, '  LeangCosmetics  ').id, 2)
  db.close()
})

// The safety half. A wrong value here must degrade to the previous
// behaviour, never to "no organization" -- which the login screen would
// render as a permanently unsatisfiable "choose your organization first".
check('falls back to first-by-id when the configured slug matches nothing', () => {
  const db = freshDb([OTHER, LEANG])
  const org = getDefaultOrganization(db, 'does-not-exist')
  assert.ok(org, 'a stale config value must never produce a null organization')
  assert.equal(org.id, 1, 'unmatched pin falls back to the old first-by-id behaviour')
  db.close()
})

check('falls back to first-by-id when no slug is configured at all', () => {
  const db = freshDb([OTHER, LEANG])
  assert.equal(getDefaultOrganization(db, '').id, 1)
  assert.equal(getDefaultOrganization(db, undefined).id, 1)
  db.close()
})

check('single-organization deployments are unaffected either way', () => {
  const db = freshDb([LEANG])
  assert.equal(getDefaultOrganization(db, 'leangcosmetics').id, 2)
  assert.equal(getDefaultOrganization(db, 'anything-else').id, 2)
  assert.equal(getDefaultOrganization(db, '').id, 2)
  db.close()
})

check('an empty organizations table returns null rather than throwing', () => {
  const db = freshDb([])
  assert.equal(getDefaultOrganization(db, 'leangcosmetics'), null)
  db.close()
})

// Organization creation must stay impossible. Guarded against the real
// route source so adding a write endpoint fails this test rather than
// quietly enabling multi-tenant signup.
const fs = require('fs')
const path = require('path')
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'organizations.ts'), 'utf8')

check('routes/organizations.ts exposes no write endpoints', () => {
  assert.doesNotMatch(routeSrc, /^app\.(post|put|patch|delete)\(/m, 'organizations must remain read-only -- no creating or editing organizations')
})

check('/bootstrap still reports organizationCreationEnabled: false', () => {
  assert.match(routeSrc, /organizationCreationEnabled:\s*false/, 'the login screen keys its locked state off this flag')
})

console.log(`\n${passed} organization-pin checks passed`)
