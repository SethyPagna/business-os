// D1 port of backend/src/postgresDatabase.ts's ensureDefaultSeedData /
// ensurePrimaryAdminRoleAndUser. The Node backend runs this on every boot;
// the Worker doesn't have a boot hook, so ensureCoreDataInvariantsOnce()
// below is called from global middleware (see index.ts) to approximate
// "on every boot" as "once per isolate, before its first request". This
// also runs explicitly (via ensureCoreDataInvariants(), not the memoized
// wrapper) right after factory-reset wipes users/roles/organizations down
// to nothing -- without that, factory-reset would lock the operator out
// with no local recovery path (see the previous comment this file replaces
// in routes/system.ts). A genuinely fresh deploy (migrations applied, never
// factory-reset) used to have zero branches/roles/admin until someone
// manually hit factory-reset once; the middleware closes that gap.
//
// Same defaults as the backend (org name "Business OS" / slug "business-os",
// admin username "admin", DEFAULT_ROLE_PERMISSIONS from
// backend/src/permissions.ts) so a factory-reset instance behaves the same
// way an equivalent Docker/Postgres instance would after first boot.

import { getDb } from './db'
import { buildInClause } from './sqlBinding'
import type { Env } from '../index'
import bcrypt from 'bcryptjs'

// Default posture (progress.md "Permissions -- default posture"): every
// page's default permission tier is None unless the role is Admin. Manager
// and Employee used to seed with several sections pre-granted (pos,
// products, inventory, sales, contacts, customer_portal, audit_log for
// Manager; pos, products, contacts for Employee) -- that meant a brand-new
// Manager/Employee role on a freshly-seeded instance already had write
// access to real business data before an admin had reviewed or granted
// anything. Both now seed to `{}` (nothing granted), matching what
// PermissionEditor.tsx's own "new role" form already defaults to
// (Users.tsx line ~270, `permissions: {}`) -- so a freshly-created role
// behaves the same everywhere it can be created, whether that's the
// first-boot seed or the "Add role" button. Admin is unchanged (`{all:
// true}`), the sole exception the spec calls out.
//
// This only affects instances seeded from empty -- the loop below only
// force-rewrites the *admin* role's permissions back to this default on
// every ensure call; Manager/Employee are only inserted once (if the code
// doesn't already exist) and are otherwise left alone as editable by the
// org, so an existing installation's already-customized Manager/Employee
// roles are not silently reset by this change.
const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  admin: { all: true },
  manager: {},
  employee: {},
}

export type CoreDataInvariants = {
  organizationId: number
  organizationGroupId: number | null
  branchId: number | null
  adminRoleId: number | null
  adminUserId: number | null
  adminUserCreated: boolean
  adminPassword: string | null
}

// Read-only pre-check for ensureCoreDataInvariants(). Every request on a
// fresh Worker isolate runs ensureCoreDataInvariants() once (see
// ensureCoreDataInvariantsOnce() below) -- and until this fast path
// existed, that meant every cold isolate unconditionally ran a handful of
// UPDATE/INSERT statements (organizations, organization_groups, the admin
// role, and a full products-table backfill scan) even when nothing needed
// to change. On a real page load the admin app fires ~10 concurrent
// requests, which Cloudflare frequently spreads across *different*
// isolates -- so those isolates would all try to write to the same D1
// database at the same moment. D1 (SQLite under the hood) serializes
// writes; that burst of simultaneous writers is exactly the shape of
// error that produces "database is locked"/busy failures, which is why
// every endpoint behind this middleware (i.e. every route in the app) was
// observed 500ing together in bursts, then succeeding on a lone refresh
// once the contention had cleared. This function turns the overwhelmingly
// common case ("already set up, nothing to do") into a handful of plain
// SELECTs -- which D1 handles fine under concurrency -- instead of a batch
// of writes. Returns null if anything is missing/out of date, so the
// caller falls through to the original (write-capable) path below.
async function tryFastPath(
  db: ReturnType<typeof getDb>,
  orgName: string,
  orgSlug: string,
  publicId: string,
): Promise<CoreDataInvariants | null> {
  const org = await db.prepare(`
    SELECT id FROM organizations
    WHERE (public_id = @publicId OR slug = @slug)
      AND name = @name AND is_active = 1 AND setup_enabled = 0
    ORDER BY CASE WHEN public_id = @publicId THEN 0 ELSE 1 END, id ASC LIMIT 1
  `).get<{ id: number }>({ publicId, slug: orgSlug, name: orgName })
  if (!org?.id) return null

  const group = await db.prepare(`
    SELECT id FROM organization_groups
    WHERE organization_id = @orgId AND slug = 'main' AND is_default = 1 AND is_active = 1
    LIMIT 1
  `).get<{ id: number }>({ orgId: org.id })
  if (!group?.id) return null

  const branch = await db.prepare(`
    SELECT id FROM branches WHERE is_active = 1 AND is_default = 1 ORDER BY id ASC LIMIT 1
  `).get<{ id: number }>()
  if (!branch?.id) return null

  const adminRole = await db.prepare(`
    SELECT id, permissions FROM roles WHERE code = 'admin' AND name = 'Admin' AND is_system = 1 LIMIT 1
  `).get<{ id: number; permissions: string }>()
  if (!adminRole?.id || adminRole.permissions !== JSON.stringify(DEFAULT_ROLE_PERMISSIONS.admin)) return null

  const managerRole = await db.prepare(`SELECT id FROM roles WHERE code = 'manager' LIMIT 1`).get<{ id: number }>()
  if (!managerRole?.id) return null

  const employeeRole = await db.prepare(`SELECT id FROM roles WHERE code = 'employee' LIMIT 1`).get<{ id: number }>()
  if (!employeeRole?.id) return null

  const admin = await db.prepare(`
    SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1
  `).get<{ id: number }>()
  if (!admin?.id) return null

  // Same NOT IN check the write path uses below, just without the INSERT --
  // an EXISTS short-circuits on the first missing row instead of scanning
  // the whole table, so this stays cheap even as the catalog grows.
  const missingBranchStock = await db.prepare(`
    SELECT EXISTS(
      SELECT 1 FROM products p
      WHERE p.is_active = 1 AND p.id NOT IN (SELECT product_id FROM branch_stock)
    ) AS missing
  `).get<{ missing: number }>()
  if (Number(missingBranchStock?.missing || 0)) return null

  return {
    organizationId: org.id,
    organizationGroupId: group.id,
    branchId: branch.id,
    adminRoleId: adminRole.id,
    adminUserId: admin.id,
    adminUserCreated: false,
    adminPassword: null,
  }
}

export async function ensureCoreDataInvariants(env: Env): Promise<CoreDataInvariants> {
  const db = getDb(env)

  // The organization's identity is CONFIGURED, not hardcoded.
  //
  // This used to force `name = 'Business OS'` on every run, including an
  // explicit UPDATE over any existing row. That made the name unfixable:
  // renaming the organization in the database worked until the next request
  // ran these invariants, which silently renamed it straight back. It is the
  // direct cause of the reported "the lock organization is LeangCosmetics
  // not Business OS" surviving a rename, and of that class of fix appearing
  // to "break again and again" -- the fix was being reverted by code, not by
  // anyone touching it.
  //
  // Defaults preserve the old values exactly, so a deployment that sets
  // nothing behaves as before.
  const orgName = String(env.BUSINESS_OS_ORGANIZATION_NAME || '').trim() || 'Business OS'
  const orgSlug = String(env.BUSINESS_OS_ORGANIZATION_SLUG || '').trim().toLowerCase() || 'business-os'
  const publicId = `org_${orgSlug.replace(/-/g, '_')}`

  // Identities this deployment's row may STILL carry from before a rename.
  // Every rename in this app's history appends here: matching a previous
  // identity is what lets a newly configured slug adopt and rename the
  // EXISTING row in place -- without it, the new slug matches nothing and
  // this function inserts a SECOND, empty organization beside the real one
  // (and the login pin starts falling back to first-by-id). 'business-os'
  // is the identity the code originally shipped with; 'leangcosmetics' is
  // the identity in production before the Aug 2026 rename to LeangBeauty.
  const PREVIOUS_IDENTITIES = [
    { slug: 'leangcosmetics', publicId: 'org_leangcosmetics' },
    { slug: 'business-os', publicId: 'org_business_os' },
  ]

  const fastPathResult = await tryFastPath(db, orgName, orgSlug, publicId)
  if (fastPathResult) return fastPathResult

  // Prefer the configured identity; fall back to previous identities (most
  // recent first) so an existing organization is adopted and renamed in
  // place rather than duplicated. IN-lists go through lib/sqlBinding's
  // buildInClause like everywhere else — the list is tiny, but hand-built
  // placeholder lists are exactly what test-d1-bound-params-repro forbids.
  const previousIds = buildInClause('previousId', PREVIOUS_IDENTITIES.map(({ publicId: pid }) => pid))
  const previousSlugs = buildInClause('previousSlug', PREVIOUS_IDENTITIES.map(({ slug }) => slug))
  const existingOrg = await db.prepare(`
    SELECT id FROM organizations
    WHERE public_id = @publicId OR slug = @slug
       OR public_id IN (${previousIds.sql}) OR slug IN (${previousSlugs.sql})
    ORDER BY CASE WHEN public_id = @publicId THEN 0 WHEN slug = @slug THEN 1 ELSE 2 END, id ASC
    LIMIT 1
  `).get<{ id: number }>({ publicId, slug: orgSlug, ...previousIds.params, ...previousSlugs.params })

  let organizationId: number
  if (existingOrg?.id) {
    // slug/public_id move with the name. Without that, an adopted legacy row
    // would be renamed but keep slug 'business-os', so
    // BUSINESS_OS_ORGANIZATION_SLUG would still match nothing and
    // routes/organizations.ts's pin would go on falling back to first-by-id.
    await db.prepare(`
      UPDATE organizations
      SET name = @name, slug = @slug, public_id = @publicId, is_active = 1, setup_enabled = 0
      WHERE id = @id
    `).run({ name: orgName, slug: orgSlug, publicId, id: existingOrg.id })
    organizationId = existingOrg.id
  } else {
    const inserted = await db.prepare(`
      INSERT INTO organizations (name, slug, public_id, is_active, setup_enabled)
      VALUES (@name, @slug, @publicId, 1, 0)
    `).run({ name: orgName, slug: orgSlug, publicId })
    organizationId = inserted.lastInsertRowid
  }

  const existingGroup = await db.prepare(`
    SELECT id FROM organization_groups WHERE organization_id = @orgId AND slug = 'main' LIMIT 1
  `).get<{ id: number }>({ orgId: organizationId })
  let organizationGroupId: number | null = existingGroup?.id ?? null
  if (existingGroup?.id) {
    await db.prepare(`UPDATE organization_groups SET is_default = 1, is_active = 1 WHERE id = @id`)
      .run({ id: existingGroup.id })
  } else {
    const insertedGroup = await db.prepare(`
      INSERT INTO organization_groups (organization_id, name, slug, is_default, is_active)
      VALUES (@orgId, 'Main', 'main', 1, 1)
    `).run({ orgId: organizationId })
    organizationGroupId = insertedGroup.lastInsertRowid
  }

  const branchState = await db.prepare(`
    SELECT
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN is_active = 1 AND is_default = 1 THEN 1 ELSE 0 END) AS default_count
    FROM branches
  `).get<{ active_count: number | null; default_count: number | null }>()

  let branchId: number | null = null
  if (!Number(branchState?.active_count || 0)) {
    const insertedBranch = await db.prepare(`
      INSERT INTO branches (name, notes, is_default, is_active, updated_at)
      VALUES ('Main Store', 'Default branch created during factory reset.', 1, 1, CURRENT_TIMESTAMP)
    `).run()
    branchId = insertedBranch.lastInsertRowid
  } else if (!Number(branchState?.default_count || 0)) {
    const firstActive = await db.prepare(`SELECT id FROM branches WHERE is_active = 1 ORDER BY id ASC LIMIT 1`).get<{ id: number }>()
    if (firstActive?.id) {
      await db.prepare(`UPDATE branches SET is_default = 0`).run()
      await db.prepare(`UPDATE branches SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: firstActive.id })
      branchId = firstActive.id
    }
  }

  const roleDefs: Array<[string, string, number, Record<string, boolean>]> = [
    ['Admin', 'admin', 1, DEFAULT_ROLE_PERMISSIONS.admin],
    ['Manager', 'manager', 0, DEFAULT_ROLE_PERMISSIONS.manager],
    ['Employee', 'employee', 0, DEFAULT_ROLE_PERMISSIONS.employee],
  ]
  for (const [name, code, isSystem, permissions] of roleDefs) {
    const existingRole = await db.prepare(`SELECT id FROM roles WHERE code = @code LIMIT 1`).get<{ id: number }>({ code })
    if (existingRole?.id) {
      // Only the admin role's permissions are forced back to the default on
      // every ensure call (matches the backend) -- manager/employee are
      // editable by the org and shouldn't get silently overwritten.
      if (code === 'admin') {
        await db.prepare(`
          UPDATE roles SET name = @name, is_system = @isSystem, permissions = @permissions, updated_at = CURRENT_TIMESTAMP WHERE id = @id
        `).run({ name, isSystem, permissions: JSON.stringify(permissions), id: existingRole.id })
      } else {
        await db.prepare(`UPDATE roles SET name = @name, is_system = @isSystem, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
          .run({ name, isSystem, id: existingRole.id })
      }
    } else {
      await db.prepare(`
        INSERT INTO roles (name, code, is_system, permissions, updated_at)
        VALUES (@name, @code, @isSystem, @permissions, CURRENT_TIMESTAMP)
      `).run({ name, code, isSystem, permissions: JSON.stringify(permissions) })
    }
  }

  const adminRole = await db.prepare(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`).get<{ id: number }>()
  const existingAdmin = await db.prepare(`
    SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1
  `).get<{ id: number }>()

  let adminUserId: number | null = existingAdmin?.id ?? null
  let adminUserCreated = false
  let adminPassword: string | null = null
  if (!existingAdmin?.id) {
    adminPassword = (env as unknown as { BUSINESS_OS_ADMIN_PASSWORD?: string }).BUSINESS_OS_ADMIN_PASSWORD || 'Admin123456!'
    const passwordHash = bcrypt.hashSync(adminPassword, 10)
    const inserted = await db.prepare(`
      INSERT INTO users (
        username, name, password, role_id, permissions, is_active,
        organization_id, organization_group_id, created_at, updated_at
      ) VALUES ('admin', 'Admin', @password, @roleId, '{}', 1, @orgId, @groupId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run({ password: passwordHash, roleId: adminRole?.id ?? null, orgId: organizationId, groupId: organizationGroupId })
    adminUserId = inserted.lastInsertRowid
    adminUserCreated = true
  }

  // Backfill: any product that has never received a branch_stock row (created
  // before a default branch existed, or via a code path that skipped branch
  // assignment) is invisible to branch-filtered POS/Inventory views even
  // though the product itself is active. Assign it to the org's default
  // branch using whatever stock_quantity it already carries. Cheap and
  // idempotent -- once a product has a branch_stock row it's excluded from
  // the NOT IN subquery on every future call, so this is a no-op after the
  // first successful run for a given product.
  const activeDefaultBranch = await db.prepare(`
    SELECT id FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1
  `).get<{ id: number }>()
  if (activeDefaultBranch?.id) {
    await db.prepare(`
      INSERT INTO branch_stock (product_id, branch_id, quantity)
      SELECT p.id, @branchId, COALESCE(p.stock_quantity, 0)
      FROM products p
      WHERE p.is_active = 1
        AND p.id NOT IN (SELECT product_id FROM branch_stock)
    `).run({ branchId: activeDefaultBranch.id })
  }

  return {
    organizationId,
    organizationGroupId,
    branchId,
    adminRoleId: adminRole?.id ?? null,
    adminUserId,
    adminUserCreated,
    adminPassword,
  }
}

// Workers have no boot hook, so "run once on startup" becomes "run once per
// isolate, before the first request it handles". Memoized per-isolate --
// ensureCoreDataInvariants() is cheap and fully idempotent (every step is a
// SELECT-then-conditional-write) so a cold start elsewhere re-running it is
// harmless, but this keeps the common case (isolate already warm) down to
// zero extra DB round-trips per request.
let coreInvariantsPromise: Promise<CoreDataInvariants> | null = null

export function ensureCoreDataInvariantsOnce(env: Env): Promise<CoreDataInvariants> {
  if (!coreInvariantsPromise) {
    coreInvariantsPromise = ensureCoreDataInvariants(env).catch((error) => {
      // Don't let a transient failure "poison" the isolate forever -- allow
      // the next request to retry instead of every subsequent request
      // silently skipping the ensure step because of one bad attempt.
      coreInvariantsPromise = null
      throw error
    })
  }
  return coreInvariantsPromise
}

// Every table with real rows in migrations/0001_init.sql + 0002_promotions.sql,
// deleted child-tables-first (defensive ordering -- this D1 schema has no
// REFERENCES/foreign_keys pragma, so nothing here actually enforces FK
// order, but keeping it FK-shaped costs nothing and matches the intent of
// backend/src/routes/system/index.ts's factory-reset deletion order).
//
// Unlike reset-data (which explicitly keeps branches/categories/units/
// settings/users/roles), a *factory* reset wipes those too -- users, roles,
// branches, organization_groups, and organizations are included here and
// deliberately deleted before ensureCoreDataInvariants() runs. An earlier
// version of this list excluded them on the theory that
// ensureCoreDataInvariants() would "update in place" -- that's wrong: it
// matches an existing org by the *default* slug/public_id
// ('business-os'/'org_business_os'), so a real store's differently-named
// organization (and its branches/roles/users) would simply survive
// alongside a second, newly-inserted default org instead of being replaced
// by it. Confirmed with an in-memory D1-equivalent test seeded with a
// non-default org/branch/admin before wiping these tables too.
export const FACTORY_RESET_TABLES = [
  'return_item_batch_allocations',
  'sale_item_batch_allocations',
  'return_items',
  'returns',
  'sale_items',
  'sales',
  'rfid_session_items',
  'rfid_events',
  'rfid_scan_sessions',
  'rfid_tags',
  'inventory_movements',
  'stock_row_moves',
  'stock_transfers',
  'branch_batch_stock',
  'branch_stock',
  'product_batches',
  'product_images',
  'products',
  'categories',
  'units',
  'suppliers',
  'customers',
  'delivery_contacts',
  'customer_share_submissions',
  'custom_fields',
  'import_job_errors',
  'import_job_batches',
  'import_job_rows',
  'import_job_files',
  'import_jobs',
  'file_assets',
  'ai_response_logs',
  'ai_provider_configs',
  'google_drive_sync_entries',
  'promotions',
  'verification_codes',
  'user_sessions',
  'action_history',
  'audit_logs',
  'settings',
  // Reseeded fresh by ensureCoreDataInvariants() immediately after this
  // batch runs -- listed last, children-of-org-first.
  'users',
  'roles',
  'branches',
  'organization_groups',
  'organizations',
]

// Tables cleared by reset-data's mode='products' (routes/system.ts) --
// deletes products plus the live inventory state that only has meaning
// attached to a product row (branch/batch stock, product images, RFID tag
// bindings). Deliberately much narrower than FACTORY_RESET_TABLES or
// reset-data's mode='all': every one of sales/returns/inventory-movement/
// stock-transfer/allocation/customer/supplier/contact/settings/user/branch
// tables is left untouched, because all of the transactional ones already
// store their own product_name/price/lot_code snapshot at write time (see
// migrations/0001_init.sql's sale_items/return_items/inventory_movements/
// stock_transfers/stock_row_moves/*_batch_allocations column lists) -- a
// dangling product_id/batch_id afterward doesn't break their display, it's
// just an id nothing points at anymore.
//
// rfid_events/rfid_session_items are the one deliberate exception left off
// this list despite also referencing product_id: unlike the tables above,
// neither stores its own product_name snapshot, so whether a dangling
// product_id there renders fine or shows a blank/lost reference in the
// RFID admin screen hasn't been checked -- flagged, not resolved, in
// routes/system.ts's mode='products' comment.
//
// Order matters here more than in FACTORY_RESET_TABLES: product_images/
// rfid_tags/branch_batch_stock/product_batches/branch_stock all have to be
// collected (image paths) or cleared before 'products' itself, since this
// D1 schema has no FK/cascade to do it automatically.
export const PRODUCTS_RESET_TABLES = [
  'product_images',
  'rfid_tags',
  'branch_batch_stock',
  'product_batches',
  'branch_stock',
  'products',
]

// custom_tables rows describe dynamically-created tables that a "custom tables"
// feature used to create via `CREATE TABLE "ct_<name>" (...)` DDL per row. That
// feature's route/UI was removed (it was fully built but never wired into any
// navigation, so no user could ever reach it -- see AUDIT-PROGRESS.md). This
// helper is kept as a defensive factory-reset safety net: wiping the
// custom_tables metadata row without dropping its backing table would leave
// orphaned tables sitting in D1 forever, invisible to the app, so this still
// runs during factory-reset in case any such table was created back when the
// feature existed.
export async function dropAllCustomTables(env: Env): Promise<string[]> {
  const db = getDb(env)
  const rows = await db.prepare(`SELECT name FROM custom_tables`).all<{ name: string }>()
  const dropped: string[] = []
  for (const row of rows) {
    const safeName = String(row.name || '').replace(/"/g, '""')
    if (!safeName) continue
    await db.prepare(`DROP TABLE IF EXISTS "${safeName}"`).run()
    dropped.push(row.name)
  }
  await db.prepare(`DELETE FROM custom_tables`).run()
  return dropped
}
