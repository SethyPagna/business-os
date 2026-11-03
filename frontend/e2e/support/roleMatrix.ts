import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { DEFAULT_ROLE_PERMISSIONS } from '../../../cloudflare/src/lib/roleDefaults.ts'
import { effectivePermissions } from '../../src/utils/permissions.ts'
import { actionsForKey } from '../../src/utils/permissionActions.ts'
import { getInventoryCheckAccess } from '../../src/utils/inventoryCheckAccess.ts'
import { canViewAcquisitionCosts } from '../../src/utils/acquisitionCostAccess.ts'
import { getAdminPathForPage } from '../../src/app/pathRouting.ts'
import { ACCOUNT_NAV_IDS, NAV_ITEMS } from '../../src/components/shared/navigationConfig.ts'
import { getHubDestinations, type HubDestination } from '../../src/components/shared/hubNavigation.ts'
import { PERMISSION_DEFS, PERMISSION_SECTIONS } from '../../src/components/users/permissionDefinitions.ts'
import { ROLE_PRESETS } from '../../src/components/users/rolePresetDefaults.ts'

/**
 * e2e/support/roleMatrix.ts -- the roles of the browser permission matrix and the oracle that says what each may see.
 *
 * NOTHING here is a hand-written copy of a rule. Every role is built out of a real definition, and every expectation is
 * computed by running the app's own pure functions on that role:
 *
 *   Employee default   cloudflare/src/lib/roleDefaults.ts DEFAULT_ROLE_PERMISSIONS.employee (the one seed the Worker
 *                      writes and the role editor resets to)
 *   Manager default    the same file's .manager: the one non-admin default that reaches Dashboard, Review, Settings, Branches
 *   cashier            the lead key of the POS section of permissionDefinitions.ts, and nothing else
 *   viewer             every section of permissionDefinitions.ts whose middle tier is 'view'
 *   image-only         rolePresetDefaults.ts ROLE_PRESETS 'product_viewer'
 *   webmaster          the four Website Editor area keys of permissionDefinitions.ts
 *   cost viewer        the Employee default plus product_cost_view (the grant, not the role code, must drive cost)
 *   admin              rolePresetDefaults.ts ROLE_PRESETS 'admin' (the control)
 *
 *   sidebar / pages    NAV_ITEMS run through the production canAccessPage callback (AppContext.tsx), which is cut out of the
 *                      source and executed -- the technique tests/effectiveViewNavigation.test.ts already uses, because
 *                      the callback lives inside a React hook and cannot be imported
 *   hub sections       hubNavigation.ts getHubDestinations
 *   action buttons     utils/permissions.ts effectivePermissions().can() over utils/permissionActions.ts PERMISSION_ACTIONS
 *
 * What stays hand-written is only the mapping "this button is that action" in the spec, and `grant()` below refuses a
 * (section, action) pair that PERMISSION_ACTIONS does not define, so a typo cannot silently turn a check into "allowed".
 */

type GrantValue = boolean | 'review' | 'view'
export type Grants = Record<string, GrantValue>

export type RoleDef = {
  /** Test-title word. */
  id: string
  label: string
  /** users.role_code. Only 'admin' is meaningful to the app (isAdminControlUser). */
  roleCode: string
  /** roles.permissions: what the role editor saves. */
  grants: Grants
  /** True when the grants hold an explicit product_cost_view. */
  costGranted: boolean
}

const section = (key: string) => {
  const found = PERMISSION_SECTIONS.find((entry) => entry.key === key)
  if (!found) throw new Error(`permissionDefinitions.ts has no section "${key}"`)
  return found
}
const preset = (key: string) => {
  const found = ROLE_PRESETS.find((entry) => entry.key === key)
  if (!found) throw new Error(`rolePresetDefaults.ts has no preset "${key}"`)
  return found.permissions as Grants
}

const posLead = section('pos').permissions.find((entry) => entry.lead)
if (!posLead) throw new Error('the POS section of permissionDefinitions.ts has no lead key')

function define(id: string, label: string, roleCode: string, grants: Grants): RoleDef {
  return { id, label, roleCode, grants, costGranted: grants.product_cost_view === true || grants.all === true }
}

export const ROLES: RoleDef[] = [
  define('employee', 'Employee default', 'employee', { ...DEFAULT_ROLE_PERMISSIONS.employee }),
  define('manager', 'Manager default', 'manager', { ...DEFAULT_ROLE_PERMISSIONS.manager }),
  define('cashier', 'cashier (POS only)', 'cashier', { [posLead.key]: true }),
  define('viewer', 'viewer (view tier)', 'viewer', Object.fromEntries(
    PERMISSION_DEFS.filter((entry) => entry.tier && entry.middleTier === 'view').map((entry) => [entry.key, 'view' as const]),
  )),
  define('image-only', 'image-only (Product Viewer preset)', 'product_viewer', { ...preset('product_viewer') }),
  define('webmaster', 'webmaster (Website Editor areas)', 'webmaster', Object.fromEntries(
    section('customer_portal').permissions.map((entry) => [entry.key, true as const]),
  )),
  define('cost-viewer', 'Employee default + View product costs', 'employee', { ...DEFAULT_ROLE_PERMISSIONS.employee, product_cost_view: true }),
  define('admin', 'admin (control)', 'admin', { ...preset('admin') }),
]

/** The account object the app holds after sign-in, for `role`, keeping the fixture account's identity. */
export function roleUser<T extends { id: number; username: string; name: string }>(role: RoleDef, account: T) {
  return {
    ...account,
    email: null,
    organizationId: 1,
    organization_public_id: 'e2e-org',
    roleId: 900,
    role_code: role.roleCode,
    role_name: role.label,
    permissions: {} as Grants,
    role_permissions: role.grants,
    is_active: 1,
  }
}

/** The same account as the Worker holds it: grants as the JSON text of the D1 columns (lib/permissions.ts PermissionUser). */
export function workerUser(role: RoleDef) {
  return { username: 'cashier_a', role_code: role.roleCode, role_permissions: JSON.stringify(role.grants), permissions: '{}' }
}

// --- canAccessPage, as shipped -----------------------------------------------------------------------------------------
const appSource = readFileSync(new URL('../../src/AppContext.tsx', import.meta.url), 'utf8')
const appAst = ts.createSourceFile('AppContext.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let pageMapSource = ''
let pageCallbackSource = ''
const visit = (node: ts.Node): void => {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const name = node.name.getText(appAst)
    if (name === 'PAGE_PERMISSIONS') pageMapSource = node.initializer.getText(appAst)
    if (name === 'canAccessPage' && ts.isCallExpression(node.initializer)) pageCallbackSource = node.initializer.arguments[0].getText(appAst)
  }
  ts.forEachChild(node, visit)
}
visit(appAst)
if (!pageMapSource || !pageCallbackSource) throw new Error('AppContext.tsx no longer declares PAGE_PERMISSIONS and canAccessPage as the matrix expects')
const pageCallbackJs = ts.transpileModule(`const callback = ${pageCallbackSource}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const PAGE_PERMISSIONS = new Function(`return (${pageMapSource})`)() as Record<string, string | null>

export type RoleAccess = ReturnType<typeof accessFor>

export function accessFor(role: RoleDef) {
  const user = roleUser(role, { id: 11, username: 'cashier_a', name: 'Cashier A' })
  const authority = effectivePermissions(user)
  const canAccessPage = new Function(
    'user', 'can', 'getPermissionTier', 'PAGE_PERMISSIONS', 'getInventoryCheckAccess', `${pageCallbackJs}; return callback`,
  )(user, authority.can, authority.getPermissionTier, PAGE_PERMISSIONS, getInventoryCheckAccess) as (pageId: string) => boolean
  return { role, user, ...authority, canAccessPage }
}

// --- routes ------------------------------------------------------------------------------------------------------------
/** Every admin route: the NAV_ITEMS pages plus the Server page, which the nav no longer lists but the URL still opens. */
export const ADMIN_ROUTES: Array<{ page: string; path: string }> = [...NAV_ITEMS.map((item) => item.id), 'server']
  .map((page) => ({ page, path: page === 'dashboard' ? '/' : getAdminPathForPage(page) }))

if (ADMIN_ROUTES.some((route) => route.page !== 'dashboard' && route.path === '/')) {
  throw new Error('a NAV_ITEMS page has no path in pathRouting.ts ADMIN_PATH_BY_PAGE')
}

/** Sidebar rows (desktop) / home tiles (phone): NAV_ITEMS the role may open, minus the ones that live under Account. */
export function expectedNavIds(access: RoleAccess): string[] {
  return NAV_ITEMS.filter((item) => access.canAccessPage(item.id) && !ACCOUNT_NAV_IDS.has(item.id)).map((item) => item.id)
}

/** The account menu entries that are pages (Settings, Receipt Settings). */
export function expectedAccountPages(access: RoleAccess): string[] {
  return ['settings', 'receipt_settings'].filter((page) => access.canAccessPage(page))
}

/** Hub sections the role is offered on `page`, exactly as Sidebar.tsx asks (it also hands over canAccessPage). */
export function expectedHubSections(access: RoleAccess, page: string): HubDestination[] {
  return access.canAccessPage(page)
    ? getHubDestinations(page, { getPermissionTier: access.getPermissionTier, hasPermission: access.hasPermission, can: access.can, canAccessPage: access.canAccessPage })
    : []
}

/** Pages that are hubs at all: those for which the full-access administrator is offered at least one section. */
export const HUB_PAGES: string[] = (() => {
  const admin = accessFor(ROLES.find((entry) => entry.id === 'admin') as RoleDef)
  return NAV_ITEMS.map((item) => item.id).filter((page) => expectedHubSections(admin, page).length > 0)
})()

/**
 * Where a direct URL to `page` leaves the role. An accessible page renders itself. A denied one is never a dead end:
 * App.tsx moves the shell to the first NAV_ITEMS entry the role can open (the "access-guard" effect), and the denied
 * page's slot keeps only the Access Denied panel.
 */
export function expectedLanding(access: RoleAccess, page: string): string {
  if (access.canAccessPage(page)) return page
  const fallback = NAV_ITEMS.find((item) => access.canAccessPage(item.id))
  if (!fallback) throw new Error(`role ${access.role.id} can open no page at all, not even Notes`)
  return fallback.id
}

// --- action grants -----------------------------------------------------------------------------------------------------
/** May `role` press the control behind permissionActions.ts PERMISSION_ACTIONS[section][action]? Refuses an undefined pair. */
export function grant(access: RoleAccess, section: string, action: string): boolean {
  if (!actionsForKey(section).some((entry) => entry.key === action)) {
    throw new Error(`PERMISSION_ACTIONS has no ${section}:${action}; the matrix would silently answer "allowed" for a typo`)
  }
  return access.can(section, action)
}

export function seesCost(access: RoleAccess): boolean {
  return canViewAcquisitionCosts(access.user)
}
