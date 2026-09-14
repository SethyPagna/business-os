#!/usr/bin/env node
/**
 * Seed a LOCAL miniflare D1 for the Playwright Tier "system" suite.
 *
 * LOCAL ONLY, structurally: this script opens one sqlite file under
 * --persist-to with better-sqlite3. There is no network code in it, no
 * wrangler invocation, no --remote path, and no credential is read. It cannot
 * reach production D1 even by accident.
 *
 * Prerequisite:
 *   node scripts/apply-local-migrations.cjs --persist-to <dir>
 *
 * Usage:
 *   node scripts/seed-e2e-local.cjs --persist-to <dir>
 *
 * What it creates, and why exactly this much:
 *
 *   roles         one row, code 'admin'. src/lib/deviceTrust.ts:31
 *                 requiresDeviceApproval() gates EVERY non-administrator
 *                 account behind a per-device approval, so a cashier-role
 *                 seed would answer a correct password with
 *                 `deviceApprovalRequired` and the suite could never sign in.
 *                 Seeding an administrator is the smallest thing that makes
 *                 the real login route usable; the device gate itself is a
 *                 separate claim that belongs in its own spec.
 *   users         'e2e_admin' -- bcryptjs hash, produced here, because
 *                 routes/auth.ts:223 verifies with bcrypt.compareSync and the
 *                 whole point of this tier is that the real check runs.
 *   branches      the two canonical branches: 'shop' (default, sells) and
 *                 'warehouse' (stock only).
 *   categories    one, so the till's category rail is not empty.
 *   products      three, priced, with branch_stock at the shop.
 *   settings      exchange_rate, which the till reads to show riel.
 *
 * The organization row is NOT created here: migration 0001 already inserts
 * exactly one, and routes/organizations.ts getDefaultOrganization() resolves
 * it. Adding a second would make the login screen offer a choice that this
 * deployment shape never has.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

const E2E_USERNAME = 'e2e_admin'
const E2E_PASSWORD = 'e2e-password'

const PRODUCTS = [
  { name: 'E2E Product 001 Aurelia', barcode: '8850001000017', price: 12.5, qty: 40 },
  { name: 'E2E Product 002 Belle Roux', barcode: '8850001000024', price: 7.25, qty: 25 },
  { name: 'E2E Product 003 Cendre', barcode: '8850001000031', price: 3.0, qty: 60 },
]

function parseArgs(argv) {
  const out = { persistTo: path.join(__dirname, '..', '.wrangler', 'state') }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--persist-to') { out.persistTo = argv[i + 1]; i += 1 }
  }
  return out
}

function resolveDatabaseFile(persistTo) {
  const dir = path.join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  if (!fs.existsSync(dir)) throw new Error(`No local D1 state at ${dir}`)
  const candidates = fs.readdirSync(dir).filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (candidates.length !== 1) throw new Error(`Expected exactly one D1 file in ${dir}, found ${candidates.length}`)
  return path.join(dir, candidates[0])
}

function main() {
  const { persistTo } = parseArgs(process.argv.slice(2))
  const db = new Database(resolveDatabaseFile(persistTo))
  const migrations = db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n
  if (migrations < 150) {
    throw new Error(`Only ${migrations} migrations applied. Run scripts/apply-local-migrations.cjs first.`)
  }

  db.exec('BEGIN')
  try {
    db.prepare("INSERT OR IGNORE INTO roles (id, name, code, permissions, is_system) VALUES (1, 'Administrator', 'admin', '{\"all\":true}', 1)").run()

    // Resolve the organization the SAME way the Worker will
    // (routes/organizations.ts getDefaultOrganization): the slug pinned in
    // wrangler.toml [vars] BUSINESS_OS_ORGANIZATION_SLUG first, then
    // first-by-id. This is not pedantry -- on its first boot the Worker
    // PROVISIONS that pinned organization, so a database that has been served
    // once holds two rows (migration 0001's 'leang-cosmetics' at id 1 and the
    // pinned 'leangbeauty' at id 2). Seeding the user onto id 1 produces an
    // account whose organization is not the one the login screen resolves.
    // Start the Worker once before seeding; the check below makes the failure
    // explicit rather than mysterious.
    const pinned = String(process.env.BUSINESS_OS_ORGANIZATION_SLUG || 'leangbeauty').trim().toLowerCase()
    const org = db.prepare('SELECT id, name, slug FROM organizations WHERE lower(trim(slug)) = @pinned OR lower(trim(public_id)) = @pinned LIMIT 1').get({ pinned })
      || db.prepare('SELECT id, name, slug FROM organizations ORDER BY id ASC LIMIT 1').get()
    if (!org) throw new Error('No organization row -- migration 0001 should have created one')
    if (org.slug !== pinned) {
      console.warn(`[seed-e2e] WARNING: pinned organization '${pinned}' does not exist yet; seeding onto '${org.slug}'.`)
      console.warn('[seed-e2e] Start the Worker once (it provisions the pinned organization), then re-run this seed.')
    }

    db.prepare('DELETE FROM users WHERE username = ?').run(E2E_USERNAME)
    db.prepare(`
      INSERT INTO users (username, name, password, role_id, permissions, is_active, organization_id)
      VALUES (@username, @name, @password, 1, '{}', 1, @organization_id)
    `).run({
      username: E2E_USERNAME,
      name: 'E2E Administrator',
      // 10 rounds: the same cost the app uses, so the login route's
      // compareSync is doing the real work and the test measures the real
      // thing. Generated at seed time -- no hash is committed.
      password: bcrypt.hashSync(E2E_PASSWORD, 10),
      organization_id: org.id,
    })

    for (const [name, isDefault] of [['shop', 1], ['warehouse', 0]]) {
      db.prepare('INSERT INTO branches (name, is_default, is_active) SELECT @name, @isDefault, 1 WHERE NOT EXISTS (SELECT 1 FROM branches WHERE name = @name)')
        .run({ name, isDefault })
    }
    const shop = db.prepare("SELECT id FROM branches WHERE name = 'shop'").get()

    db.prepare("INSERT INTO categories (name) SELECT 'E2E' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'E2E')").run()

    for (const product of PRODUCTS) {
      db.prepare('DELETE FROM products WHERE name = ?').run(product.name)
      const info = db.prepare(`
        INSERT INTO products (name, barcode, category, unit, selling_price_usd, cost_price_usd, stock_quantity, is_active)
        VALUES (@name, @barcode, 'E2E', 'pcs', @price, @cost, @qty, 1)
      `).run({ name: product.name, barcode: product.barcode, price: product.price, cost: product.price / 2, qty: product.qty })
      db.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, ?)')
        .run(info.lastInsertRowid, shop.id, product.qty)
    }

    // Clear the REAL limiter's recorded attempts, without touching the limit
    // itself. routes/auth.ts:56 allows 8 logins per account per 15 minutes and
    // :54 allows 20 per IP; a suite that signs in repeatedly from one loopback
    // address reaches both, and the honest fix is to reset the COUNTER between
    // runs rather than raise the limit in the build under test. (Measured: a
    // three-project run answered "Too many login attempts for this account.")
    for (const table of ['rate_limit_events', 'login_lockouts']) {
      try { db.prepare(`DELETE FROM ${table}`).run() } catch { /* table may predate this schema */ }
    }

    for (const [key, value] of [['exchange_rate', '4100'], ['currency', 'USD']]) {
      db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value').run({ key, value })
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  console.log(`[seed-e2e] user ${E2E_USERNAME} / ${E2E_PASSWORD} (administrator role -- no device approval)`)
  console.log(`[seed-e2e] products ${db.prepare('SELECT COUNT(*) AS n FROM products').get().n}, branches ${db.prepare('SELECT COUNT(*) AS n FROM branches').get().n}`)
}

main()
