// The organization's name/slug must be CONFIGURED, and must stay configured.
//
// Reported: "the lock organization is LeangCosmetics not Business OS" -- and,
// more importantly, "why whenever you fix it gets broken again and again".
//
// Those were the same bug. lib/coreDataInvariants.ts hardcoded
//
//   const orgName = 'Business OS'
//   ...
//   UPDATE organizations SET name = @name ... WHERE id = @id
//
// and ensureCoreDataInvariants runs on request. Renaming the organization in
// the database worked, and then the very next request renamed it straight
// back. No one was undoing the fix; the code was.
//
// The two properties that keep it fixed:
//   1. the configured identity wins and is written through
//   2. an EXISTING row carrying the old identity is adopted and renamed in
//      place -- never left behind while a second organization is inserted
//      beside it, which would put a real choice on the login screen of a
//      deployment that is supposed to be pinned to one
//
// Run: node scripts/test-org-identity-pure.cjs

const assert = require('assert')
const Database = require('better-sqlite3')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

const LEGACY_SLUG = 'business-os'
const LEGACY_PUBLIC_ID = 'org_business_os'

// Mirrors ensureCoreDataInvariants' organization half.
function resolveIdentity(env) {
  const orgName = String(env.BUSINESS_OS_ORGANIZATION_NAME || '').trim() || 'Business OS'
  const orgSlug = String(env.BUSINESS_OS_ORGANIZATION_SLUG || '').trim().toLowerCase() || 'business-os'
  const publicId = `org_${orgSlug.replace(/-/g, '_')}`
  return { orgName, orgSlug, publicId }
}

function ensureOrganization(db, env) {
  const { orgName, orgSlug, publicId } = resolveIdentity(env)
  const existing = db.prepare(`
    SELECT id FROM organizations
    WHERE public_id = :publicId OR slug = :slug
       OR public_id = :legacyPublicId OR slug = :legacySlug
    ORDER BY CASE WHEN public_id = :publicId THEN 0 WHEN slug = :slug THEN 1 ELSE 2 END, id ASC
    LIMIT 1
  `).get({ publicId, slug: orgSlug, legacyPublicId: LEGACY_PUBLIC_ID, legacySlug: LEGACY_SLUG })

  if (existing) {
    db.prepare(`
      UPDATE organizations
      SET name = :name, slug = :slug, public_id = :publicId, is_active = 1, setup_enabled = 0
      WHERE id = :id
    `).run({ name: orgName, slug: orgSlug, publicId, id: existing.id })
    return existing.id
  }
  const info = db.prepare(
    'INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled) VALUES (?, ?, ?, 1, 0)',
  ).run(orgName, orgSlug, publicId)
  return info.lastInsertRowid
}

function freshDb(rows = []) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE organizations (
    id INTEGER PRIMARY KEY, name TEXT, slug TEXT, public_id TEXT,
    is_active INTEGER DEFAULT 1, setup_enabled INTEGER DEFAULT 0
  )`)
  const ins = db.prepare('INSERT INTO organizations (id, name, slug, public_id) VALUES (@id, @name, @slug, @public_id)')
  for (const r of rows) ins.run(r)
  return db
}

const LEGACY_ROW = { id: 1, name: 'Business OS', slug: 'business-os', public_id: 'org_business_os' }
const CONFIGURED = {
  BUSINESS_OS_ORGANIZATION_NAME: 'LeangCosmetics',
  BUSINESS_OS_ORGANIZATION_SLUG: 'leangcosmetics',
}

// --- the reported bug --------------------------------------------------

check('an existing "Business OS" row is RENAMED in place, not duplicated', () => {
  const db = freshDb([LEGACY_ROW])
  ensureOrganization(db, CONFIGURED)
  const all = db.prepare('SELECT id, name, slug, public_id FROM organizations').all()
  assert.strictEqual(all.length, 1, 'must not insert a second organization beside the old one')
  assert.deepStrictEqual(all[0], {
    id: 1, name: 'LeangCosmetics', slug: 'leangcosmetics', public_id: 'org_leangcosmetics',
  })
  db.close()
})

check('the rename STICKS across repeated runs -- the actual regression', () => {
  // This is the whole point. The old code re-applied 'Business OS' on every
  // invocation, so the name reverted on the next request after any fix.
  const db = freshDb([LEGACY_ROW])
  for (let i = 0; i < 5; i += 1) ensureOrganization(db, CONFIGURED)
  const row = db.prepare('SELECT name, slug FROM organizations WHERE id = 1').get()
  assert.strictEqual(row.name, 'LeangCosmetics', 'the name must not revert on a later run')
  assert.strictEqual(row.slug, 'leangcosmetics')
  db.close()
})

check('slug and public_id move with the name, so the login pin can match', () => {
  // Renaming only the NAME would leave slug 'business-os', so
  // BUSINESS_OS_ORGANIZATION_SLUG would still match nothing and
  // routes/organizations.ts's pin would go on falling back to first-by-id.
  const db = freshDb([LEGACY_ROW])
  ensureOrganization(db, CONFIGURED)
  const row = db.prepare('SELECT slug, public_id FROM organizations WHERE id = 1').get()
  assert.strictEqual(row.slug, CONFIGURED.BUSINESS_OS_ORGANIZATION_SLUG)
  assert.strictEqual(row.public_id, 'org_leangcosmetics')
  db.close()
})

// --- defaults and edge cases ------------------------------------------

check('an unconfigured deployment keeps the historical identity exactly', () => {
  const db = freshDb([])
  ensureOrganization(db, {})
  const row = db.prepare('SELECT name, slug, public_id FROM organizations').get()
  assert.deepStrictEqual(row, { name: 'Business OS', slug: 'business-os', public_id: 'org_business_os' })
  db.close()
})

check('a fresh database seeds the CONFIGURED identity, not the default', () => {
  const db = freshDb([])
  ensureOrganization(db, CONFIGURED)
  const row = db.prepare('SELECT name, slug, public_id FROM organizations').get()
  assert.deepStrictEqual(row, { name: 'LeangCosmetics', slug: 'leangcosmetics', public_id: 'org_leangcosmetics' })
  db.close()
})

check('re-running against an ALREADY-configured row is a no-op', () => {
  const db = freshDb([{ id: 1, name: 'LeangCosmetics', slug: 'leangcosmetics', public_id: 'org_leangcosmetics' }])
  ensureOrganization(db, CONFIGURED)
  const all = db.prepare('SELECT id, name, slug FROM organizations').all()
  assert.strictEqual(all.length, 1)
  assert.strictEqual(all[0].name, 'LeangCosmetics')
  db.close()
})

check('the configured row is preferred when both it and a legacy row exist', () => {
  const db = freshDb([
    LEGACY_ROW,
    { id: 2, name: 'LeangCosmetics', slug: 'leangcosmetics', public_id: 'org_leangcosmetics' },
  ])
  const id = ensureOrganization(db, CONFIGURED)
  assert.strictEqual(Number(id), 2, 'must adopt the configured row, not the lower-id legacy one')
  db.close()
})

check('slug is lower-cased and trimmed, and public_id is derived from it', () => {
  const db = freshDb([])
  ensureOrganization(db, { BUSINESS_OS_ORGANIZATION_SLUG: '  Leang-Cosmetics  ', BUSINESS_OS_ORGANIZATION_NAME: ' Leang ' })
  const row = db.prepare('SELECT name, slug, public_id FROM organizations').get()
  assert.strictEqual(row.slug, 'leang-cosmetics')
  assert.strictEqual(row.public_id, 'org_leang_cosmetics', 'hyphens become underscores in public_id')
  assert.strictEqual(row.name, 'Leang', 'name is trimmed')
  db.close()
})

check('a blank config value falls back rather than writing an empty name', () => {
  const db = freshDb([])
  ensureOrganization(db, { BUSINESS_OS_ORGANIZATION_NAME: '   ', BUSINESS_OS_ORGANIZATION_SLUG: '' })
  const row = db.prepare('SELECT name, slug FROM organizations').get()
  assert.strictEqual(row.name, 'Business OS')
  assert.strictEqual(row.slug, 'business-os')
  db.close()
})

// --- source guard ------------------------------------------------------

const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'coreDataInvariants.ts'), 'utf8')

check('coreDataInvariants no longer hardcodes the organization name', () => {
  assert.doesNotMatch(
    src,
    /const orgName = 'Business OS'/,
    "the name must come from env, or renaming the organization silently reverts again",
  )
  assert.match(src, /env\.BUSINESS_OS_ORGANIZATION_NAME/)
  assert.match(src, /env\.BUSINESS_OS_ORGANIZATION_SLUG/)
})

console.log(`\n${passed} organization-identity checks passed`)
