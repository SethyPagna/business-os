// Pure-logic regression test for lib/permissions.ts's hasPermission/
// hasAnyPermission/isAdminControlUser, plus a source lock-in check on
// routes/sales.ts and routes/returns.ts.
//
// Why this exists: sales.ts and returns.ts used to only check requireAuth
// (any logged-in user) and never called hasPermission at all -- meaning a
// user with zero role permissions could still create/list/edit sales and
// returns directly via the API, even though the frontend correctly hid
// those pages from them (see AppContext.tsx's PAGE_PERMISSIONS). Fixed by
// adding real permission checks to both route files. This test locks that
// fix in two ways: (1) exercises the shared permission-decision functions
// against the exact scenarios those routes rely on (POS-only cashier can
// create a sale but not list sales history; sales-only user can list/edit
// but the create-sale check also accepts them; a user with neither is
// denied everywhere; an admin-control user always passes), and (2) greps
// the actual route source for the specific hasPermission/hasAnyPermission
// call sites so a future edit that silently drops one of them fails CI
// instead of shipping unnoticed.
//
// Run: node scripts/test-route-permissions-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const permissionsSrcPath = path.join(__dirname, '..', 'src', 'lib', 'permissions.ts')
const permissionsSrc = fs.readFileSync(permissionsSrcPath, 'utf8')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-permissions-'))
const tsPath = path.join(tmpDir, 'permissions.ts')
fs.writeFileSync(tsPath, permissionsSrc)
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, {
  cwd: tmpDir,
  stdio: 'inherit',
})
const lib = require(path.join(tmpDir, 'permissions.js'))
const { hasPermission, hasAnyPermission, isAdminControlUser } = lib

// ---- scenario: POS-only cashier (role grants { pos: true } only) ----
{
  const posOnlyUser = { role_permissions: JSON.stringify({ pos: true }), permissions: null, username: 'cashier1', role_code: 'cashier' }
  assert.equal(hasPermission(posOnlyUser, 'pos'), true, 'pos-only user should have pos permission')
  assert.equal(hasPermission(posOnlyUser, 'sales'), false, 'pos-only user should NOT have sales permission')
  assert.equal(hasAnyPermission(posOnlyUser, ['pos', 'sales']), true, 'sale creation check (pos OR sales) should pass for a pos-only user')
  console.log('PASS POS-only cashier can create sales (pos-or-sales check) but cannot access sales-gated endpoints')
}

// ---- scenario: sales-only user (e.g. a manager without POS access) ----
{
  const salesOnlyUser = { role_permissions: JSON.stringify({ sales: true }), permissions: null, username: 'manager1', role_code: 'manager' }
  assert.equal(hasPermission(salesOnlyUser, 'sales'), true, 'sales-only user should have sales permission')
  assert.equal(hasPermission(salesOnlyUser, 'pos'), false, 'sales-only user should NOT have pos permission')
  assert.equal(hasAnyPermission(salesOnlyUser, ['pos', 'sales']), true, 'sale creation check (pos OR sales) should pass for a sales-only user too')
  // 'sales' and 'returns' are separate, independently-grantable keys (see
  // lib/permissions.ts's ENTITY_PERMISSION_MAP) -- a sales grant alone must
  // NOT imply returns access, so Sales can stay Full/None-only while
  // Returns can later get its own Review Required tier without the two
  // being coupled.
  assert.equal(hasPermission(salesOnlyUser, 'returns'), false, 'a sales-only grant must NOT imply returns permission -- the two keys are independent')
  console.log('PASS sales-only user can list/edit sales but does NOT get implicit returns access')
}

// ---- scenario: returns-only user ----
{
  const returnsOnlyUser = { role_permissions: JSON.stringify({ returns: true }), permissions: null, username: 'returns_clerk1', role_code: 'returns_clerk' }
  assert.equal(hasPermission(returnsOnlyUser, 'returns'), true, 'returns-only user should have returns permission')
  assert.equal(hasPermission(returnsOnlyUser, 'sales'), false, 'a returns-only grant must NOT imply sales permission')
  console.log('PASS returns-only user can access returns but not the sales-gated endpoints')
}

// ---- scenario: a user with neither pos nor sales permission ----
{
  const noAccessUser = { role_permissions: JSON.stringify({ products: true }), permissions: null, username: 'stocker1', role_code: 'inventory_clerk' }
  assert.equal(hasPermission(noAccessUser, 'sales'), false, 'a products-only user must not have sales permission')
  assert.equal(hasAnyPermission(noAccessUser, ['pos', 'sales']), false, 'a products-only user must not be able to create a sale')
  console.log('PASS a user with neither pos nor sales permission is denied on both the create check and the sales-gated endpoints')
}

// ---- scenario: user-level override wins over role default ----
{
  const overriddenUser = { role_permissions: JSON.stringify({ sales: true }), permissions: JSON.stringify({ sales: false }), username: 'demoted1', role_code: 'manager' }
  assert.equal(hasPermission(overriddenUser, 'sales'), false, 'an explicit user-level sales:false override must beat the role default of true')
  console.log('PASS user-level permission override still wins over the role default for sales/returns gating')
}

// ---- scenario: admin-control user always passes ----
{
  const adminUser = { role_permissions: null, permissions: null, username: 'admin', role_code: 'admin' }
  assert.equal(isAdminControlUser(adminUser), true)
  assert.equal(hasPermission(adminUser, 'sales'), true, 'the reserved admin username must pass every permission check regardless of explicit grants')
  const allFlagUser = { role_permissions: null, permissions: JSON.stringify({ all: true }), username: 'owner1', role_code: 'owner' }
  assert.equal(hasPermission(allFlagUser, 'sales'), true, 'an explicit permissions.all:true grant must also pass every check')
  console.log('PASS admin-control users (reserved admin username, admin role, or an explicit all:true grant) always pass')
}

// ---- source lock-in: routes/sales.ts and routes/returns.ts actually call these ----
{
  const salesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(salesSrc, /hasAnyPermission\(c\.get\('user'\), \['pos', 'sales'\]\)/, 'POST / (create sale) must check hasAnyPermission([pos, sales])')
  const salesPermissionChecks = salesSrc.match(/hasPermission\(c\.get\('user'\), 'sales'\)|hasPermission\(user, 'sales'\)/g) || []
  assert.ok(salesPermissionChecks.length >= 4, `expected at least 4 hasPermission(..., 'sales') call sites in sales.ts (GET /, GET /stats, PATCH /:id/status, PATCH /:id/customer), found ${salesPermissionChecks.length}`)
  console.log('PASS routes/sales.ts still gates create (pos-or-sales) and list/stats/status/customer (sales) behind real permission checks')
}
{
  const returnsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
  // Part 154: switched from the strict hasPermission() to the tier-aware
  // getPermissionTier() !== 'none' (same fix inventory.ts got in Part
  // 153) so a Review Required user isn't 403'd out of reads -- updated
  // regex to match, still asserting a real router-wide returns-permission
  // gate exists.
  assert.match(returnsSrc, /app\.use\('\*', async \(c, next\) => \{\s*const user = c\.get\('user'\)/, "returns.ts must have a router-wide 'returns' permission gate, matching the pattern already used by inventory.ts/contacts.ts")
  assert.match(returnsSrc, /getPermissionTier\(user, 'returns'\) === 'none'/, "returns.ts's router-wide gate must be tier-aware (getPermissionTier !== full/review block), not the strict hasPermission() boolean")
  console.log('PASS routes/returns.ts still has its router-wide returns-permission gate, now tier-aware')
}
{
  // Contacts gate+applier wiring (picked up from Part 154's flagged next
  // step): same strict-hasPermission() router-wide-gate bug as
  // inventory.ts/returns.ts, plus Contacts' own narrower spec -- add
  // applies directly under Review Required, edit is restricted to the
  // name field only, delete is blocked outright for that tier.
  const contactsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
  // The gate is registered per owned path prefix rather than as a single
  // `app.use('*', ...)`. It has to be: contacts.ts is mounted at the BARE
  // `/api` prefix (index.ts), so a `'*'` middleware here registers as
  // `/api/*` and runs for every other `/api/...` route mounted after it --
  // which 401'd the deliberately-public `/api/organizations/*` endpoints the
  // login screen calls, making login impossible on a fresh browser. Still a
  // router-wide gate in effect, just scoped to the paths this router owns.
  assert.match(contactsSrc, /for \(const prefix of CONTACT_PATH_PREFIXES\) \{\s*\n\s*app\.use\(prefix, requireContactsAccess\)/, 'contacts.ts must apply its contacts-permission gate across every owned path prefix')
  assert.match(contactsSrc, /const requireContactsAccess = async \(c: Context<[^>]*>, next: Next\) => \{\s*\n\s*const user = c\.get\('user'\)/, 'contacts.ts must define its permission gate as a single shared handler so the per-prefix registrations cannot drift apart')
  // Anchored to the start of a line so this checks real code, not the
  // explanatory comments in that file which quote the old broken form.
  assert.doesNotMatch(contactsSrc, /^app\.use\('\*',/m, "contacts.ts must not use a bare '*' middleware -- it is mounted at /api and would leak onto every later-mounted route (see the organizations/login regression)")
  // Each prefix must be registered as BOTH the exact path and its subtree.
  // Hono does not treat a bare trailing `*` (`/customers*`) as a wildcard --
  // that form matches nothing and silently leaves the routes unauthenticated.
  assert.match(contactsSrc, /app\.use\(`\$\{prefix\}\/\*`, requireAuth\)/, 'contacts.ts must guard each prefix subtree with the `${prefix}/*` form Hono actually matches')
  assert.match(contactsSrc, /getPermissionTier\(user, 'contacts'\) === 'none'/, "contacts.ts's router-wide gate must be tier-aware (getPermissionTier !== none), not the strict hasPermission() boolean")
  assert.match(contactsSrc, /tier === 'review' \? \['name'\] : config\.columns/, 'contacts.ts PUT /:id must restrict a Review Required edit to the name column only')
  assert.match(contactsSrc, /getPermissionTier\(user, 'contacts'\) === 'review'[\s\S]{0,120}?Deleting a \$\{config\.entity\}/, 'contacts.ts DELETE /:id must explicitly block Review Required rather than leave it reachable')
  assert.doesNotMatch(contactsSrc, /import \{ hasPermission \} from '\.\.\/lib\/permissions'/, 'contacts.ts should no longer import the strict hasPermission for its router-wide gate')
  console.log('PASS routes/contacts.ts has a tier-aware router-wide gate, name-only Review Required edits, and a blocked Review Required delete')
  // Part 157: the response for a Review Required name-only edit must flag
  // itself as partial so the frontend can tell the user their other
  // changes weren't saved, instead of a silent 200 (flagged as a UX gap
  // in Part 155, fixed here).
  assert.match(contactsSrc, /const droppedColumns = tier === 'review'\s*\n\s*\? config\.columns\.filter/, 'contacts.ts PUT /:id must compute which non-name columns a Review Required edit actually dropped')
  assert.match(contactsSrc, /if \(wasPartial\) \{\s*\n\s*return c\.json\(\{ \.\.\.item, partial: true, partialFields: droppedColumns \}\)/, 'contacts.ts PUT /:id must return partial:true (with the dropped field list) when a Review Required edit silently dropped non-name fields')
  console.log('PASS routes/contacts.ts PUT /:id flags a Review Required name-only edit as partial when other fields were dropped')
}
{
  // Library view/manage split (chat session, supersedes Part 156's
  // Review-Required shape): browsing/searching/previewing the library is
  // now free for any authenticated user (GET / has no permission check
  // beyond the router-wide requireAuth), while upload/download/rename/
  // delete are all management actions gated on real Full Access to
  // `library` (or the legacy `settings` full grant, same transitional OR
  // Part 156 established). There is no longer a router-wide gate, and
  // Review Required no longer grants any management action -- it behaves
  // identically to None for all of them.
  const filesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'files.ts'), 'utf8')
  assert.match(filesSrc, /function hasFullLibraryAccess\(user: SessionUser\): boolean \{\s*\n\s*return getPermissionTier\(user, 'library'\) === 'full' \|\| hasPermission\(user, 'settings'\)/, "files.ts must define hasFullLibraryAccess() requiring real Full Access to 'library' (or the legacy 'settings' grant)")
  assert.match(filesSrc, /if \(!hasFullLibraryAccess\(user\)\) \{\s*\n\s*return c\.json\(\{ error: 'Deleting a file requires Full Access to Library\.' \}/, 'files.ts DELETE /:id must block anyone without real Full Access to Library, including Review Required')
  assert.match(filesSrc, /if \(!hasFullLibraryAccess\(user\)\) \{\s*\n\s*return c\.json\(\{ error: 'Renaming a file requires Full Access to Library\.' \}/, 'files.ts PATCH /:id must block anyone without real Full Access to Library')
  assert.doesNotMatch(filesSrc, /app\.use\('\*', async \(c, next\) => \{\s*\n\s*const user = c\.get\('user'\)\s*\n\s*const hasLibraryAccess/, 'files.ts must no longer have a router-wide library gate -- GET / is unconditional for any authenticated user')
  console.log('PASS routes/files.ts splits library view (unconditional) from management actions (Full Access to library or settings only, no Review Required carve-out)')
}

{
  // Branches gate+applier wiring (this session): branch used to share the
  // 'inventory' permission key entirely -- split into its own 'branches'
  // key, wired the same tier-aware way as inventory/returns/contacts/
  // library before it. Create/update queue directly for Review Required;
  // delete also queues but its applier re-checks the not-default/no-stock
  // rules at approval time; transfer/transfer-bulk/stock-integrity-repair
  // are deliberately blocked outright for Review Required rather than
  // half-wired (same live-quantity-movement caution as inventory's own
  // adjust/transfer).
  const branchesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8')
  assert.doesNotMatch(branchesSrc, /import \{ hasPermission[^}]*\} from '\.\.\/lib\/permissions'/, "branches.ts should no longer import the strict hasPermission() -- every check must be tier-aware via getPermissionTier('branches')")
  assert.doesNotMatch(branchesSrc, /if \(!hasPermission\(/, 'branches.ts should have no remaining strict hasPermission() gate checks')
  assert.match(branchesSrc, /getPermissionTier\(c\.get\('user'\), 'branches'\) === 'none'/, 'branches.ts GET /summary must be tier-aware so a Review Required user can still view it')
  assert.match(branchesSrc, /maybeQueueForReview\(c\.env, user, 'branches', \{\s*\n\s*actionType: 'create'/, "branches.ts POST / must queue for review via maybeQueueForReview when the user's tier is 'review'")
  assert.match(branchesSrc, /maybeQueueForReview\(c\.env, user, 'branches', \{\s*\n\s*actionType: 'update'/, 'branches.ts PUT /:id must queue for review too')
  assert.match(branchesSrc, /maybeQueueForReview\(c\.env, user, 'branches', \{\s*\n\s*actionType: 'delete'/, 'branches.ts DELETE /:id must queue for review too, not apply directly for a Review Required user')
  assert.match(branchesSrc, /transferTier === 'review'\)\s*\{\s*\n\s*return c\.json\(\{ error: 'Transferring stock requires Full Access/, 'branches.ts POST /transfer must explicitly block Review Required rather than leave it reachable')
  assert.match(branchesSrc, /bulkTransferTier === 'review'\)\s*\{\s*\n\s*return c\.json\(\{ error: 'Transferring stock requires Full Access/, 'branches.ts POST /transfer-bulk must explicitly block Review Required too')
  assert.match(branchesSrc, /tier === 'review'\)\s*\{\s*\n\s*return c\.json\(\{ success: false, error: 'Repairing misplaced stock requires Full Access/, 'branches.ts POST /stock-integrity/repair must explicitly block Review Required too')
  console.log("PASS routes/branches.ts's permission checks are now tier-aware under its own 'branches' key, with create/update/delete queued for review and the three live-stock-movement routes explicitly blocked for Review Required")
}
{
  const reviewApplySrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'reviewApply.ts'), 'utf8')
  assert.match(reviewApplySrc, /registerApplier\('branches', 'create', 'branch'/, 'reviewApply.ts must register an applier for branches/create/branch')
  assert.match(reviewApplySrc, /registerApplier\('branches', 'update', 'branch'/, 'reviewApply.ts must register an applier for branches/update/branch')
  assert.match(reviewApplySrc, /registerApplier\('branches', 'delete', 'branch'/, 'reviewApply.ts must register an applier for branches/delete/branch')
  assert.match(reviewApplySrc, /if \(branch\.is_default\) throw new Error/, "the branches/delete/branch applier must re-check the not-default rule against the row's CURRENT state at approval time, not just trust the request-time check")
  assert.match(reviewApplySrc, /if \(stockCheck && Number\(stockCheck\.total\) > 0\) \{\s*\n\s*throw new Error/, 'the branches/delete/branch applier must re-check the no-stock-left rule at approval time too')
  console.log('PASS lib/reviewApply.ts has appliers registered for all three branches action types, with the delete applier re-validating live state at approval time rather than trusting the original request')
}
{
  const permissionsLibSrc = fs.readFileSync(permissionsSrcPath, 'utf8')
  assert.match(permissionsLibSrc, /\['branch', 'branches'\]/, "permissions.ts's ENTITY_PERMISSION_MAP must map 'branch' to the new standalone 'branches' key, not 'inventory'")
  assert.match(permissionsLibSrc, /\['branches', 'branches'\]/, "permissions.ts's ENTITY_PERMISSION_MAP must map 'branches' to itself, not 'inventory'")
  console.log("PASS lib/permissions.ts's ENTITY_PERMISSION_MAP now points branch/branches entities at the standalone 'branches' permission key")
}

// ---- scenario: backup_restore no longer falls back from plain 'backup' ----
{
  const exportOnlyUser = { role_permissions: JSON.stringify({ backup: true }), permissions: null, username: 'ops1', role_code: 'ops' }
  assert.equal(hasPermission(exportOnlyUser, 'backup'), true, 'a backup-only user should still be able to export/list backups')
  assert.equal(hasPermission(exportOnlyUser, 'backup_restore'), false, 'a backup-only user must NOT be able to restore -- this fallback was the bug: granting "Backup export" used to silently also grant full database restore power')
  const restoreGrantedUser = { role_permissions: JSON.stringify({ backup_restore: true }), permissions: null, username: 'ops2', role_code: 'ops' }
  assert.equal(hasPermission(restoreGrantedUser, 'backup_restore'), true, 'a user explicitly granted backup_restore should be able to restore')
  assert.equal(hasPermission(restoreGrantedUser, 'backup'), false, 'granting backup_restore alone should not imply plain backup/export access either -- the two are independent, not a hierarchy')
  console.log('PASS backup (export) and backup_restore (restore/reset) are independently grantable, no one-way fallback either direction')
}

// ---- source lock-in: routes/backups.ts actually checks backup_restore on the destructive path ----
{
  const backupsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'backups.ts'), 'utf8')
  // `user` is hoisted to the top of the handler since the I1 audit pass
  // (audit() needs it before this branch), so the pin only requires the
  // permission check to be the FIRST statement inside the branch.
  assert.match(backupsSrc, /if \(type === 'import-folder'\) \{\s*if \(!hasPermission\(user, 'backup_restore'\)\)/, "the import-folder (restore) branch must check hasPermission(user, 'backup_restore') specifically, not rely on the router-wide 'backup' gate alone")
  console.log('PASS routes/backups.ts requires backup_restore specifically on the destructive restore branch, not just the router-wide backup gate')
}
{
  const permissionsSrcCheck = fs.readFileSync(permissionsSrcPath, 'utf8')
  assert.doesNotMatch(permissionsSrcCheck, /normalized === 'backup_restore' && permissions\.backup/, 'the backup_restore-falls-back-from-backup rule must stay removed')
  console.log('PASS lib/permissions.ts no longer has the backup->backup_restore fallback rule')
}

// ---- source lock-in: compat.ts's dashboard/analytics/startup routes all
// check the 'dashboard' permission (Part 249 audit: the page-level gate,
// canAccessPage/Sidebar filtering, and default-role-starts-at-none behavior
// all turned out to already be shipped and correct; this test file just
// never locked in the backend route side of it the way sales.ts/returns.ts
// are locked in above, so a future edit dropping one of these three checks
// would have shipped unnoticed) ----
{
  const compatSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  const dashboardChecks = compatSrc.match(/denyUnless\(c, 'dashboard'\)/g) || []
  assert.equal(dashboardChecks.length, 3, `expected exactly 3 denyUnless(c, 'dashboard') call sites (GET /dashboard, GET /analytics, GET /dashboard/startup), found ${dashboardChecks.length}`)
  // Was asserting the literal `app.use('/dashboard*', requireAuth)` form.
  // That form is DEAD -- Hono does not treat a bare trailing `*` as a
  // wildcard, so all thirteen of compat.ts's guards matched nothing (proved
  // against the bundled Hono, and by an unauthenticated GET /api/transfers
  // returning live rows). The guards are now registered as `${prefix}/*`,
  // the form Hono actually matches, which also covers the bare `/prefix`.
  assert.match(compatSrc, /for \(const prefix of \[[\s\S]*?'\/dashboard'[\s\S]*?\]\) \{\s*\n\s*app\.use\(`\$\{prefix\}\/\*`, requireAuth\)/, "compat.ts must require a session on the /dashboard subtree using the `${prefix}/*` form Hono actually matches")
  assert.doesNotMatch(compatSrc, /^app\.use\('\/[a-z-]+\*',/m, "compat.ts must not use the bare-trailing-`*` middleware form -- it matches nothing in Hono and silently leaves routes unguarded")
  assert.match(compatSrc, /app\.get\('\/transfers', async \(c\) => \{\s*\n\s*const denied = denyUnless\(c, 'inventory', 'branches'\)/, 'compat.ts GET /transfers must check a permission -- it was reachable completely unauthenticated')
  console.log("PASS routes/compat.ts's dashboard/analytics/dashboard-startup endpoints all check the 'dashboard' permission")
}

// ---- scenario: dashboard page access is a plain Full/None grant, same
// shape as any other non-tiered key -- 'dashboard' is deliberately NOT in
// REVIEW_TIER_KEYS (no create/edit/delete workflow to queue), so a role
// with no explicit grant gets 'none', matching manager/employee's default
// empty {} permission set (coreDataInvariants.ts's DEFAULT_ROLE_PERMISSIONS) ----
{
  const noGrantUser = { role_permissions: JSON.stringify({}), permissions: null, username: 'employee1', role_code: 'employee' }
  assert.equal(hasPermission(noGrantUser, 'dashboard'), false, 'a default (empty-permissions) non-admin role must NOT have dashboard access -- this is the "No access" default the top-priority ask required')
  const dashboardGrantedUser = { role_permissions: JSON.stringify({ dashboard: true }), permissions: null, username: 'manager1', role_code: 'manager' }
  assert.equal(hasPermission(dashboardGrantedUser, 'dashboard'), true, 'a role explicitly granted dashboard: true should have dashboard access')
  // 'dashboard_export' is a second, independent boolean (not a tier of
  // 'dashboard') -- checked entirely client-side by Dashboard.tsx around
  // its own already-fetched data, so there's no backend route to lock in
  // here the way there is for the page-access key above.
  assert.equal(hasPermission(dashboardGrantedUser, 'dashboard_export'), false, '"View only, no export" must be expressible: dashboard: true, dashboard_export: false/absent')
  const fullAccessUser = { role_permissions: JSON.stringify({ dashboard: true, dashboard_export: true }), permissions: null, username: 'manager2', role_code: 'manager' }
  assert.equal(hasPermission(fullAccessUser, 'dashboard_export'), true, '"Full access" must be expressible: dashboard: true, dashboard_export: true')
  console.log('PASS dashboard access (page) and dashboard_export (export button) are independent Full/None grants, and the no-grant default is "No access"')
}

// ---- scenario + source lock-in: supplier privacy (Part 383 R2) --------
// The suppliers section is admin territory: everything under /suppliers
// needs the grantable 'contacts_suppliers' key on top of the general
// contacts gate (admin-control users pass), with ONE carve-out -- the
// name-only list (GET /suppliers?fields=names) that the supplier-return
// picker and product-form autocomplete need. Supplier-credit reminders
// (money owed) are admin-control only.
{
  const contactsOnlyUser = { role_permissions: JSON.stringify({ contacts: true }), permissions: null, username: 'clerk1', role_code: 'employee' }
  assert.equal(hasPermission(contactsOnlyUser, 'contacts_suppliers'), false, 'plain contacts access must NOT include the suppliers section')
  const supplierGrantedUser = { role_permissions: JSON.stringify({ contacts: true, contacts_suppliers: true }), permissions: null, username: 'manager1', role_code: 'manager' }
  assert.equal(hasPermission(supplierGrantedUser, 'contacts_suppliers'), true, 'the suppliers section must be grantable per role')
  const adminUser = { role_permissions: JSON.stringify({ all: true }), permissions: null, username: 'admin', role_code: 'admin' }
  assert.equal(hasPermission(adminUser, 'contacts_suppliers'), true, "the 'all' grant must cover the suppliers section")

  const contactsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
  assert.match(contactsSrc, /isAdminControlUser\(user\) \|\| hasPermission\(user, 'contacts_suppliers'\)/, 'contacts.ts must gate suppliers on admin-control OR contacts_suppliers')
  assert.match(contactsSrc, /app\.use\('\/suppliers', requireSupplierAccess\)\s*\n\s*app\.use\('\/suppliers\/\*', requireSupplierAccess\)/, 'the supplier gate must cover both /suppliers and /suppliers/*')
  assert.match(contactsSrc, /c\.req\.query\('fields'\) \|\| ''\) === 'names'\) return next\(\)/, 'the fields=names carve-out must exist for the name-only pickers')
  assert.match(contactsSrc, /SELECT id, name FROM \$\{config\.table\} ORDER BY/, 'the fields=names list must select id + name ONLY -- it is reachable without the suppliers grant')

  const notificationsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'notifications.ts'), 'utf8')
  assert.match(notificationsSrc, /preferences\.supplierCreditEnabled && isAdminControlUser\(user\)/, 'supplier-credit reminders (money owed) must be admin-control only')
  // D5: the purchases drill (per-lot received totals x unit cost = money
  // spent with a supplier) must live under /suppliers/* so the same gate
  // covers it -- registering it anywhere else would leak cost data past
  // the contacts_suppliers permission.
  assert.match(contactsSrc, /app\.get\('\/suppliers\/:id\/purchases', async \(c\) => \{/, 'the supplier purchases endpoint must sit under the gated /suppliers/* prefix')
  assert.match(contactsSrc, /pb\.received_quantity,\s*\n\s*pb\.unit_cost_usd, pb\.payment_status, pb\.credit_due_date/, 'purchases rows carry received totals + cost + credit state')
  console.log('PASS suppliers section is gated (contacts_suppliers / admin), name-only list stays open, credit reminders are admin-only, purchases drill sits inside the gate')
}

console.log('\nAll route-permission regression checks passed.')
