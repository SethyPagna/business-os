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
import { productHasStockSql } from './productStockGuard'
import { assertCustomTableName } from './customTableName'
import { buildInClause } from './sqlBinding'
import type { Env } from '../index'
import { hashPassword } from './passwordHash'

// Default posture (progress.md "Permissions -- default posture"): every
// page's default permission tier is None unless the role is Admin. Manager
// and Employee used to seed with several sections pre-granted (pos,
// products, inventory, sales, contacts, customer_portal, audit_log for
// Manager; pos, products, contacts for Employee) -- that meant a brand-new
// Manager/Employee role on a freshly-seeded instance already had write
// access to real business data before an admin had reviewed or granted
// anything. Manager still seeds to `{}` (nothing granted), matching what
// PermissionEditor.tsx's own "new role" form defaults to. Employee receives
// only the explicitly approved front-line POS/Sales defaults below;
// unrelated page grants remain absent. Admin is unchanged (`{all: true}`).
//
// This only affects instances seeded from empty -- the loop below only
// force-rewrites the *admin* role's permissions back to this default on
// every ensure call; Manager/Employee are only inserted once (if the code
// doesn't already exist) and are otherwise left alone as editable by the
// org, so an existing installation's already-customized Manager/Employee
// roles are not silently reset by this change.
type DefaultRolePermissionValue = boolean | 'review' | 'view'
const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, DefaultRolePermissionValue>> = {
  admin: { all: true },
  manager: {},
  employee: {
    pos: true,
    // Receipt/print settings (page menu + avatar dropdown, Sep 16 2026 owner
    // request) is an operational tool for whoever actually prints receipts,
    // not an admin-only setting -- an Employee needs to change print modes
    // (paper size, contrast, footer) without needing the broader `settings`
    // grant. See routes/settings.ts's settingsBucketPermissionFor() and
    // permissionDefinitions.ts's own 'receipt_settings' row for the rest of
    // this key's plumbing.
    receipt_settings: true,
    // Owner, 5 Oct 2026: front-line staff edit product information and upload
    // images, and nothing else on Products. The section is Full with every other
    // action switched off (an override can only remove what the tier grants), so
    // View, Edit and Image stay on. Evening revision: the DEFAULT selling and
    // wholesale price is its own action, off here (they adjust a price per sale in
    // the POS cart instead). Cost is a separate pair of grants that stays
    // off by default: cost price is never visible or editable to an Employee
    // until an admin turns product_cost_view / product_cost_edit on.
    products: true,
    'products:add': false,
    'products:delete': false,
    'products:bulk_delete': false,
    'products:variant': false,
    'products:import': false,
    'products:import_replace_all': false,
    'products:export': false,
    'products:merge_duplicates': false,
    'products:zero_qty_cleanup': false,
    'products:manage_lookups': false,
    'products:price': false,
    'products:history': false,
    product_cost_view: false,
    product_cost_edit: false,
    sales: true,
    'sales:status': true,
    'sales:customer': true,
    'sales:add_items': true,
    'sales:amend': true,
    'sales:bulk': false,
    'sales:import': false,
    'sales:export': false,
    returns: true,
    'returns:bulk': false,
    'returns:export': false,
    contacts: 'review',
    'contacts:bulk': false,
    'contacts:financial_history': false,
    contacts_suppliers: false,
  },
}

export type CoreDataInvariants = {
  organizationId: number
  organizationGroupId: number | null
  branchId: number | null
  adminRoleId: number | null
  adminUserId: number | null
  adminUserCreated: boolean
  adminPassword: string | null
  inactiveStockProducts?: number
}

// The password a first-run admin is seeded with, or null for "do not seed".
//
//   - BUSINESS_OS_ADMIN_PASSWORD, when non-blank, exactly as given.
//   - Otherwise the demo password 'admin123', ONLY in local development:
//     BUSINESS_OS_LOCAL_DEV=1/true (an opt-in that belongs in the gitignored
//     .dev.vars, which only `wrangler dev` reads) AND an unstamped build
//     (scripts/deploy.cjs stamps every production deploy, lib/buildStamp.ts).
//     Both are required: a stray var on a real deploy, or a bare unstamped
//     `wrangler deploy`, each fall through to null.
//   - Otherwise null. Production never seeds a known password. A generated
//     random one was rejected: nothing would ever show it, and once an admin
//     exists seeding never runs again, so the account could not be recovered
//     by setting the secret afterwards. Skipping keeps that recovery path.
export const LOCAL_DEV_ADMIN_PASSWORD = 'admin123'

// The same esbuild define lib/buildStamp.ts reads (scripts/deploy.cjs sets it
// from git for every production deploy). Read directly rather than imported
// so this module keeps its small dependency set; absent or blank = unstamped.
declare const __WORKER_BUILD_REVISION__: string | undefined
function isUnstampedBuild(): boolean {
  const revision = typeof __WORKER_BUILD_REVISION__ !== 'undefined' ? String(__WORKER_BUILD_REVISION__ ?? '').trim() : ''
  return !revision || revision === 'dev'
}

export function resolveSeedAdminPassword(env: Env): string | null {
  const vars = env as unknown as { BUSINESS_OS_ADMIN_PASSWORD?: string; BUSINESS_OS_LOCAL_DEV?: string }
  const configured = vars.BUSINESS_OS_ADMIN_PASSWORD
  if (typeof configured === 'string' && configured.trim()) return configured
  const localFlag = String(vars.BUSINESS_OS_LOCAL_DEV ?? '').trim().toLowerCase()
  if ((localFlag === '1' || localFlag === 'true') && isUnstampedBuild()) return LOCAL_DEV_ADMIN_PASSWORD
  return null
}

// The organization identity this deployment is configured with. See the
// comment in runCoreDataInvariants() on why it is configured, not hardcoded.
function configuredOrganizationIdentity(env: Env): { orgName: string; orgSlug: string; publicId: string } {
  const orgName = String(env.BUSINESS_OS_ORGANIZATION_NAME || '').trim() || 'Business OS'
  const orgSlug = String(env.BUSINESS_OS_ORGANIZATION_SLUG || '').trim().toLowerCase() || 'business-os'
  return { orgName, orgSlug, publicId: `org_${orgSlug.replace(/-/g, '_')}` }
}

// The one expensive question the fast path asks: is there an active product
// with no branch_stock row at all? It reads every active product plus a
// branch_stock probe per product (~16-25k rows at production scale), against
// ~10 rows for every other check in the projection. Kept as one fragment so
// the projection and the once-per-build gate (ensureCoreDataInvariantsForBuild
// below) can never ask two different questions.
const MISSING_BRANCH_STOCK_SQL = `EXISTS(SELECT 1 FROM products p
        WHERE p.is_active = 1 AND p.id NOT IN (SELECT product_id FROM branch_stock))`

export const INACTIVE_PRODUCT_STOCK_COUNT_SQL = `SELECT COUNT(*) AS count FROM products p WHERE p.is_active IS NOT 1 AND ${productHasStockSql()}`

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
// common case ("already set up, nothing to do") into one read-only SQL
// projection, avoiding eight serial D1 round-trips on each cold isolate.
// Returns null if anything is missing/out of date, so the
// caller falls through to the original (write-capable) path below.
async function tryFastPath(
  db: ReturnType<typeof getDb>,
  orgName: string,
  orgSlug: string,
  publicId: string,
  // false = identity checks only (organization, group, branch, roles, admin):
  // ~10 indexed/small-table rows. Used by the once-per-build gate, which asks
  // the stock-coverage question separately and at most once per build.
  options: { checkStockCoverage?: boolean } = {},
): Promise<CoreDataInvariants | null> {
  const stockCoverageSql = options.checkStockCoverage === false ? '0' : MISSING_BRANCH_STOCK_SQL
  const inactiveStockSql = options.checkStockCoverage === false ? '0' : `(${INACTIVE_PRODUCT_STOCK_COUNT_SQL})`
  // Keep each selector's original predicates and ordering. In particular,
  // check permissions AFTER choosing the admin role, and retain NOT IN's
  // semantics for stock coverage. Scalar subqueries preserve missing rows
  // as null without joining unrelated identities or multiplying results.
  const state = await db.prepare(`
    WITH org AS (
      SELECT id FROM organizations
      WHERE (public_id = @publicId OR slug = @slug)
        AND name = @name AND is_active = 1 AND setup_enabled = 0
      ORDER BY CASE WHEN public_id = @publicId THEN 0 ELSE 1 END, id ASC LIMIT 1
    ), admin_role AS (
      -- roles.code is not UNIQUE, and this CTE is read twice below (id and
      -- permissions): ORDER BY pins both reads to the same, lowest-id row.
      SELECT id, permissions FROM roles
      WHERE code = 'admin' AND name = 'Admin' AND is_system = 1 ORDER BY id ASC LIMIT 1
    )
    SELECT org.id AS organizationId,
      (SELECT id FROM organization_groups
        WHERE organization_id = org.id AND slug = 'main' AND is_default = 1 AND is_active = 1
        LIMIT 1) AS organizationGroupId,
      (SELECT id FROM branches WHERE is_active = 1 AND is_default = 1 ORDER BY id ASC LIMIT 1) AS branchId,
      (SELECT id FROM admin_role) AS adminRoleId,
      (SELECT permissions FROM admin_role) AS adminPermissions,
      (SELECT id FROM roles WHERE code = 'manager' LIMIT 1) AS managerRoleId,
      (SELECT id FROM roles WHERE code = 'employee' LIMIT 1) AS employeeRoleId,
      (SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1) AS adminUserId,
      ${stockCoverageSql} AS missingBranchStock,
      ${inactiveStockSql} AS inactiveStockProducts
    FROM org
  `).get<{
    organizationId: number
    organizationGroupId: number | null
    branchId: number | null
    adminRoleId: number | null
    adminPermissions: string | null
    managerRoleId: number | null
    employeeRoleId: number | null
    adminUserId: number | null
    missingBranchStock: number
    inactiveStockProducts: number
  }>({ publicId, slug: orgSlug, name: orgName })
  if (!state?.organizationId || !state.organizationGroupId || !state.branchId || !state.adminRoleId
    || state.adminPermissions !== JSON.stringify(DEFAULT_ROLE_PERMISSIONS.admin)
    || !state.managerRoleId || !state.employeeRoleId || !state.adminUserId
    || Number(state.missingBranchStock || 0)) return null

  return {
    organizationId: state.organizationId,
    organizationGroupId: state.organizationGroupId,
    branchId: state.branchId,
    adminRoleId: state.adminRoleId,
    adminUserId: state.adminUserId,
    adminUserCreated: false,
    adminPassword: null,
    ...(Number(state.inactiveStockProducts ?? 0) ? { inactiveStockProducts: Number(state.inactiveStockProducts) } : {}),
  }
}

export async function ensureCoreDataInvariants(env: Env): Promise<CoreDataInvariants> {
  return (await runCoreDataInvariants(env)).invariants
}

export type CoreDataInvariantsRun = {
  invariants: CoreDataInvariants
  // True only when the READ-ONLY fast path certified every invariant,
  // including stock coverage. False whenever the write-capable path ran:
  // that path can legitimately finish with something still missing (no seed
  // password, a maintenance fence on the backfill), so it never certifies
  // anything. The once-per-build gate records a build as verified only on
  // true.
  certifiedHealthy: boolean
}

export async function runCoreDataInvariants(env: Env): Promise<CoreDataInvariantsRun> {
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
  const { orgName, orgSlug, publicId } = configuredOrganizationIdentity(env)

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
  if (fastPathResult) {
    const certifiedHealthy = !fastPathResult.inactiveStockProducts
    if (!certifiedHealthy) console.warn('[core-invariants] inactive_product_stock: stock requires review; no automatic repair performed')
    return { invariants: fastPathResult, certifiedHealthy }
  }

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
      COUNT(*) AS total_count,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN is_active = 1 AND is_default = 1 THEN 1 ELSE 0 END) AS default_count
    FROM branches
  `).get<{ total_count: number; active_count: number | null; default_count: number | null }>()

  let branchId: number | null = null
  if (Number(branchState?.total_count || 0) === 0) {
    // Factory reset and a genuinely fresh database are the only states that
    // create branch identities. One conditional statement inserts the whole
    // pair, so concurrent cold isolates cannot each create another pair.
    await db.prepare(`
      INSERT INTO branches (name, notes, is_default, is_active, updated_at)
      SELECT seed.name, seed.notes, seed.is_default, 1, CURRENT_TIMESTAMP
      FROM (
        SELECT 'Shop' AS name, 'Default branch created during setup.' AS notes, 1 AS is_default
        UNION ALL
        SELECT 'Warehouse', 'Warehouse branch created during setup.', 0
      ) AS seed
      WHERE NOT EXISTS (SELECT 1 FROM branches)
    `).run()
    const shop = await db.prepare(`
      SELECT id FROM branches WHERE lower(trim(name)) = 'shop' AND is_active = 1 ORDER BY id ASC LIMIT 1
    `).get<{ id: number }>()
    branchId = shop?.id ?? null
  }

  const roleDefs: Array<[string, string, number, Record<string, DefaultRolePermissionValue>]> = [
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

  const adminRole = await db.prepare(`SELECT id FROM roles WHERE code = 'admin' ORDER BY id ASC LIMIT 1`).get<{ id: number }>()
  const existingAdmin = await db.prepare(`
    SELECT id FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL LIMIT 1
  `).get<{ id: number }>()
  // Seeding is keyed on "no active user holds the admin role", NEVER on the
  // literal username 'admin' (security review, 26 Sep 2026). Keying on the
  // username meant renaming or soft-deleting the admin account made every
  // cold isolate re-create `admin` with a password printed in this public
  // repository: a remote takeover.
  const activeAdmin = await db.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'admin' AND u.is_active = 1 AND u.deleted_at IS NULL
    ORDER BY u.id ASC LIMIT 1
  `).get<{ id: number }>()

  let adminUserId: number | null = existingAdmin?.id ?? activeAdmin?.id ?? null
  let adminUserCreated = false
  let adminPassword: string | null = null
  const seedPassword = !activeAdmin?.id && !existingAdmin?.id ? resolveSeedAdminPassword(env) : null
  if (!activeAdmin?.id && existingAdmin?.id) {
    // An 'admin' row exists but no one active holds the role. Never create a
    // second 'admin' or touch that row's password from here.
    console.warn('[core-invariants] No active admin-role user exists, but a user named "admin" does. Not seeding; restore an administrator deliberately.')
  } else if (!activeAdmin?.id && !seedPassword) {
    console.warn('[core-invariants] No active admin-role user exists and BUSINESS_OS_ADMIN_PASSWORD is not set, so no admin was seeded. Set it (wrangler secret put BUSINESS_OS_ADMIN_PASSWORD) and the next cold start seeds the admin.')
  } else if (!activeAdmin?.id && seedPassword) {
    adminPassword = seedPassword
    const passwordHash = await hashPassword(adminPassword, env)
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
        AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance')
        AND @branchId = (
          SELECT id FROM branches WHERE is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1
        )
    `).run({ branchId: activeDefaultBranch.id })
  }

  return {
    invariants: {
      organizationId,
      organizationGroupId,
      branchId,
      adminRoleId: adminRole?.id ?? null,
      adminUserId,
      adminUserCreated,
      adminPassword,
    },
    certifiedHealthy: false,
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

// ---------------------------------------------------------------------------
// Once-per-build gate for the stock-coverage scan (G39 efficiency item 3).
//
// WHY: ensureCoreDataInvariantsOnce() runs the fast path once per ISOLATE, and
// every cold isolate therefore paid the MISSING_BRANCH_STOCK_SQL scan (~16-25k
// rows at production scale) to re-learn what the previous isolate of the same
// build had just learned. Everything else in the projection is ~10 rows.
//
// WHAT CHANGES, AND WHAT DOES NOT:
//   - The identity checks (organization, group, default branch, the three
//     roles, admin permissions, the admin user) still run on every cold
//     isolate, exactly as before, and an unhealthy answer still takes the
//     write-capable repair path before the request continues.
//   - The FULL stock-coverage scan runs once per deployed build (and again
//     after `reverifyAfterMs`), by ONE isolate holding a short lease in
//     system_flags, and is recorded only when the read-only fast path
//     certified the whole state healthy.
//   - Every other cold isolate of a verified build checks only the products
//     created since that scan (products.id is AUTOINCREMENT, so "id > the
//     recorded watermark" is exactly the set the scan has not seen). A product
//     created without a branch_stock row is therefore still healed on the next
//     cold isolate, as before. Coverage lost any other way (a product
//     re-activated, a branch_stock row deleted, a restore) is healed on the
//     next build or within `reverifyAfterMs`.
//
// FAIL SAFE: any failure to read the flag or take the lease runs the full
// legacy check in this isolate. A failure to RECORD the result only costs the
// next isolate another scan. Nothing here ever skips a check because a write
// failed.
//
// system_flags (0089) is excluded from backups and every reader filters by
// key, so one more key is invisible to them.
export const CORE_INVARIANTS_BUILD_FLAG_KEY = 'core_invariants_build'
export const CORE_INVARIANTS_LEASE_MS = 30_000

export type CoreInvariantsGateOptions = {
  // Identity of the deployed build (lib/coreInvariantsGate.ts derives it from
  // the build stamp). Never blank: an unstamped build uses the legacy path.
  buildKey: string
  // How long a recorded verification stays valid for the same build.
  reverifyAfterMs: number
  leaseMs?: number
  now?: () => number
  newToken?: () => string
}

// 'verified'  identity healthy; build verified, no product created since is uncovered
// 'checked'   this isolate held the lease, scanned, and the state was certified
// 'repaired'  the write-capable path ran (identity unhealthy or coverage missing)
// 'deferred'  identity healthy; another isolate holds the scan lease right now
// 'fallback'  reading the flag or taking the lease failed; the legacy check ran
export type CoreInvariantsGateOutcome = 'verified' | 'checked' | 'repaired' | 'deferred' | 'fallback'

type GateFlagRow = { flag: string | null; newUncovered: number | null }
type GateFlag =
  | { status: 'verified'; build: string; at: number; watermark: number }
  | { status: 'checking'; build: string; until: number; token: string }

export function parseCoreInvariantsBuildFlag(raw: unknown): GateFlag | null {
  if (typeof raw !== 'string') return null
  let value: Record<string, unknown>
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || typeof value.build !== 'string' || !value.build) return null
  if (value.status === 'verified' && Number.isFinite(value.at) && Number.isInteger(value.watermark) && Number(value.watermark) >= 0) {
    return { status: 'verified', build: value.build, at: Number(value.at), watermark: Number(value.watermark) }
  }
  if (value.status === 'checking' && Number.isFinite(value.until) && typeof value.token === 'string' && value.token) {
    return { status: 'checking', build: value.build, until: Number(value.until), token: value.token }
  }
  return null
}

// The flag, plus -- only when the flag is a fresh verification of THIS build --
// whether an active product created after its watermark lacks branch_stock.
// The nested CASE keeps json_extract away from malformed JSON and keeps the
// products probe from running at all unless the flag is usable.
//
// `+p.is_active` is deliberate: without it the planner (no sqlite_stat1)
// prefers idx_products_active_grouped_pg's is_active equality and walks every
// active product -- the very scan this gate exists to avoid. The unary plus
// only removes that term from index selection; for an INTEGER column holding
// 0/1 the comparison is unchanged. The probe then seeks the primary key
// (rowid > watermark), pinned by scripts/test-core-invariants-build-gate-pure.cjs.
const GATE_FLAG_SQL = `
  SELECT value AS flag,
    CASE WHEN json_valid(value) THEN
      CASE WHEN json_extract(value, '$.status') = 'verified'
             AND json_extract(value, '$.build') = @build
             AND json_extract(value, '$.at') > @freshAfter
             AND json_type(value, '$.watermark') = 'integer'
      THEN EXISTS(SELECT 1 FROM products p
        WHERE p.id > json_extract(system_flags.value, '$.watermark')
          AND +p.is_active = 1 AND p.id NOT IN (SELECT product_id FROM branch_stock))
      END
    END AS newUncovered
  FROM system_flags WHERE key = @key`

// Conditional upsert: takes the lease unless THIS build is already verified
// and fresh, or another isolate holds an unexpired lease for it. A row from
// another build, an expired lease or malformed JSON is simply replaced.
const GATE_LEASE_SQL = `
  INSERT INTO system_flags (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  WHERE CASE WHEN json_valid(system_flags.value) THEN NOT (
    json_extract(system_flags.value, '$.build') = @build AND (
      (json_extract(system_flags.value, '$.status') = 'verified' AND json_extract(system_flags.value, '$.at') > @freshAfter)
      OR (json_extract(system_flags.value, '$.status') = 'checking' AND json_extract(system_flags.value, '$.until') > @now)
    )) ELSE 1 END`

const GATE_OWNS_LEASE_SQL = `key = @key AND CASE WHEN json_valid(value) THEN json_extract(value, '$.token') = @token ELSE 0 END`

export async function ensureCoreDataInvariantsForBuild(env: Env, options: CoreInvariantsGateOptions): Promise<CoreInvariantsGateOutcome> {
  const clock = options.now ?? Date.now
  const now = clock()
  const build = options.buildKey
  const freshAfter = now - options.reverifyAfterMs
  const key = CORE_INVARIANTS_BUILD_FLAG_KEY
  const db = getDb(env)
  const { orgName, orgSlug, publicId } = configuredOrganizationIdentity(env)

  let identity: CoreDataInvariants | null
  let gate: GateFlagRow | null | undefined
  try {
    ;[identity, gate] = await Promise.all([
      tryFastPath(db, orgName, orgSlug, publicId, { checkStockCoverage: false }),
      db.prepare(GATE_FLAG_SQL).get<GateFlagRow>({ key, build, freshAfter }),
    ])
  } catch (error) {
    console.warn('[core-invariants] build gate read failed; running the full check', error)
    await runCoreDataInvariants(env)
    return 'fallback'
  }
  // Same contract as before for identity: anything missing is repaired now.
  if (!identity) {
    await runCoreDataInvariants(env)
    return 'repaired'
  }

  const flag = parseCoreInvariantsBuildFlag(gate?.flag ?? null)
  if (flag?.status === 'verified' && flag.build === build && flag.at > freshAfter && gate?.newUncovered != null) {
    if (!Number(gate.newUncovered)) return 'verified'
    // A product created since the scan has no branch_stock row: heal exactly
    // as the per-isolate check did. The flag stays; its watermark is still true
    // for every product the scan saw.
    await runCoreDataInvariants(env)
    return 'repaired'
  }
  if (flag?.status === 'checking' && flag.build === build && flag.until > now) return 'deferred'

  const token = (options.newToken ?? (() => crypto.randomUUID()))()
  let acquired: boolean
  try {
    const lease = JSON.stringify({ status: 'checking', build, until: now + (options.leaseMs ?? CORE_INVARIANTS_LEASE_MS), token })
    const result = await db.prepare(GATE_LEASE_SQL).run({ key, value: lease, build, freshAfter, now })
    acquired = result.changes === 1
  } catch (error) {
    console.warn('[core-invariants] could not take the build-check lease; running the full check', error)
    await runCoreDataInvariants(env)
    return 'fallback'
  }
  if (!acquired) return 'deferred'

  let run: CoreDataInvariantsRun
  try {
    // Read the watermark BEFORE the scan: every product at or below it already
    // existed when the scan started, so the scan saw it.
    const top = await db.prepare('SELECT COALESCE(MAX(id), 0) AS watermark FROM products').get<{ watermark: number }>()
    const watermark = Math.max(0, Math.trunc(Number(top?.watermark || 0)))
    run = await runCoreDataInvariants(env)
    if (run.certifiedHealthy) {
      try {
        await db.prepare(`UPDATE system_flags SET value = @value, updated_at = CURRENT_TIMESTAMP WHERE ${GATE_OWNS_LEASE_SQL}`)
          .run({ key, token, value: JSON.stringify({ status: 'verified', build, at: now, watermark }) })
      } catch (error) {
        // Fail safe: an unrecorded result only means another isolate scans again.
        console.warn('[core-invariants] could not record the build verification', error)
      }
      return 'checked'
    }
  } catch (error) {
    await db.prepare(`DELETE FROM system_flags WHERE ${GATE_OWNS_LEASE_SQL}`).run({ key, token }).catch(() => {})
    throw error
  }
  // The repair path ran, so nothing is certified: drop the lease so the next
  // cold isolate checks again immediately, exactly as before this gate existed.
  await db.prepare(`DELETE FROM system_flags WHERE ${GATE_OWNS_LEASE_SQL}`).run({ key, token }).catch(() => {})
  return 'repaired'
}

// Per-isolate memo, as ensureCoreDataInvariantsOnce: a settled outcome is
// kept for the isolate's lifetime; 'deferred' is retried once the other
// isolate's lease could have expired; a rejection is never cached.
let buildGateEntry: { buildKey: string; retryAt: number; promise: Promise<CoreInvariantsGateOutcome> } | null = null

export function ensureCoreDataInvariantsForBuildOnce(env: Env, options: CoreInvariantsGateOptions): Promise<CoreInvariantsGateOutcome> {
  const clock = options.now ?? Date.now
  const current = buildGateEntry
  if (current && current.buildKey === options.buildKey && clock() < current.retryAt) return current.promise
  const entry: { buildKey: string; retryAt: number; promise: Promise<CoreInvariantsGateOutcome> } = {
    buildKey: options.buildKey,
    retryAt: Number.POSITIVE_INFINITY,
    promise: Promise.resolve('deferred' as CoreInvariantsGateOutcome),
  }
  entry.promise = ensureCoreDataInvariantsForBuild(env, options).then((outcome) => {
    if (outcome === 'deferred') entry.retryAt = clock() + (options.leaseMs ?? CORE_INVARIANTS_LEASE_MS)
    return outcome
  }, (error) => {
    if (buildGateEntry === entry) buildGateEntry = null
    throw error
  })
  buildGateEntry = entry
  return entry.promise
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
  'transfer_operation_members',
  'transfer_operation_receipts',
  // Immutable Sales Records must be cleared before their sales/receipt
  // parents, under the atomic reset guard in routes/system.ts.
  'sale_record_events',
  'return_mutation_receipts',
  'return_create_receipts',
  'return_create_guards',
  // Reviewed conflict actions cannot survive product identity reuse. Clear
  // both child receipt sets before their groups/reviews and product/history
  // parents.
  'product_conflict_action_group_members',
  'product_remove_operations',
  'product_conflict_action_groups',
  'product_conflict_action_reviews',
  // Selected-conflict cases reference their run, products, and action history.
  // Clear children first so no request receipt survives a factory reset.
  'product_conflict_merge_run_cases',
  'product_conflict_merge_runs',
  // Durable monetary-mutation members reference their receipts, whose history
  // parent is cleared below. Guards are transient but must not survive reset.
  'sale_mutation_members',
  'sale_mutation_receipts',
  'sale_mutation_guards',
  'sale_incident_recovery_members',
  'sale_incident_recovery_receipts',
  'sale_incident_recovery_guards',
  'sale_not_paid_stock_recovery_members',
  'sale_not_paid_stock_recovery_receipts',
  'sale_not_paid_stock_recovery_guards',
  // Receipt children must go before their product/lot/movement/history parents.
  // Keep revision tombstones: reused identities must never resurrect old guards.
  'stock_session_members',
  'stock_session_operations',
  'stock_session_guards',
  // Scoped Set operations (0193) reference action_history; clear them first.
  'stock_lot_adjustment_operations',
  'return_bulk_members',
  'return_bulk_operations',
  'return_write_revisions',
  'return_item_batch_allocations',
  'sale_item_batch_allocations',
  'return_items',
  'returns',
  // Expense receipts must be cleared before fees so their immutable replay
  // provenance lasts until the reset guard authorizes the complete reset.
  'fee_operation_receipts',
  'fees',
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
  'transfer_operation_members',
  'transfer_operation_receipts',
  // Global reviewed-action receipts bind immutable product identities and
  // graph snapshots, so products reset clears them child-first as well.
  'product_conflict_action_group_members',
  'product_remove_operations',
  'product_conflict_action_groups',
  'product_conflict_action_reviews',
  // Product-conflict receipts cannot survive product identity reuse. Cases
  // reference runs and products, so reset them child-first.
  'product_conflict_merge_run_cases',
  'product_conflict_merge_runs',
  'stock_session_members',
  'stock_session_operations',
  'stock_session_guards',
  // Scoped Set operations snapshot product/lot identities (0193).
  'stock_lot_adjustment_operations',
  'product_images',
  'rfid_tags',
  'branch_batch_stock',
  'product_batches',
  'branch_stock',
  'products',
]

/**
 * Reset-list tables whose migration may legitimately not be applied yet where
 * this Worker runs (the repo ships migrations ahead of the applied chain).
 * `DELETE FROM` a missing table aborts the whole reset batch, so these are
 * dropped from the list when absent -- there is nothing in them to clear.
 * Every other reset table stays mandatory: a missing one is a real defect.
 */
export const MIGRATION_GATED_RESET_TABLES: readonly string[] = ['stock_lot_adjustment_operations']

export async function presentResetTables(
  db: { prepare(sql: string): { all<T>(params?: Record<string, unknown>): Promise<T[]> } },
  tables: readonly string[],
): Promise<string[]> {
  const gated = tables.filter((table) => MIGRATION_GATED_RESET_TABLES.includes(table))
  if (!gated.length) return [...tables]
  const rows = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (SELECT value FROM json_each(@names))",
  ).all<{ name: string }>({ names: JSON.stringify(gated) })
  const present = new Set(rows.map((row) => row.name))
  return tables.filter((table) => !MIGRATION_GATED_RESET_TABLES.includes(table) || present.has(table))
}

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
  // Validate the entire set before the first DDL. A later invalid row must
  // not leave an earlier valid custom table already dropped.
  for (const row of rows) assertCustomTableName(row.name)
  const dropped: string[] = []
  for (const row of rows) {
    const safeName = row.name.replace(/"/g, '""')
    await db.prepare(`DROP TABLE IF EXISTS "${safeName}"`).run()
    dropped.push(row.name)
  }
  await db.prepare(`DELETE FROM custom_tables`).run()
  return dropped
}
