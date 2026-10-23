// Permission extras materialization (lane 6.0.967, owner ruling 21 Oct 2026: "Full = main access only").
//
// Until migration 0270 the Worker IMPLIED several grants from a module grant (Settings Full => Drive, Identity, Policies, Receipts,
// the Website Editor areas, the Library and AI provider keys; Inventory Full/Review => the count sessions and their field switches).
// The fallbacks are gone, and 0270 wrote every implied grant out. A backup taken BEFORE 0270 still holds the implicit-only roles
// and users, so a restore of one must apply the same mapping or every Settings Full account would lose access.
//
// This is a pure TypeScript twin of cloudflare/migrations/0270_permission_extras_materialize.sql (same rules, same order:
// roles from the role alone, then each user from the user's merged map after its role changed). It is pinned to the SQL by
// scripts/test-permission-extras-restore-twin-native.cjs, which runs both on the same principals and compares the results.
// It must only ever run on data older than 0270 (see backup.ts): on newer data a stored drive_credentials/ai_providers without
// Settings Full is a deliberate grant, and the mapping below would overwrite it.
import { parseJsonObject } from './permissions'

type Bag = Record<string, unknown>
export type PermissionExtrasRole = { id: number; code?: string | null; permissions: string | null }
export type PermissionExtrasUser = { id: number; role_id?: number | null; permissions: string | null }
export type PermissionExtrasUpdate = { id: number; permissions: string }

const FIELDS = ['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost'] as const
const OR_KEYS = ['business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'library'] as const
const SF_KEYS = ['drive_credentials', 'ai_providers'] as const
const fieldKey = (field: string) => `inventory_check_show_${field}`

// SQL json_type() of a merged member: the user's member when present (even null), else the role's, else undefined.
function typeOf(own: Bag, role: Bag, key: string): string | undefined {
  const bag = Object.hasOwn(own, key) ? own : Object.hasOwn(role, key) ? role : null
  if (!bag) return undefined
  const value = bag[key]
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null) return 'null'
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real'
  return Array.isArray(value) ? 'array' : 'object'
}
function valueOf(own: Bag, role: Bag, key: string): unknown {
  return Object.hasOwn(own, key) ? own[key] : role[key]
}
const roleCodeOf = (code: string | null | undefined): string => String(code ?? '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').toLowerCase()

type State = { admin: boolean; oldBits: Record<string, boolean>; newBits: Record<string, boolean>; mt: Record<string, string | undefined> }

function stateOf(own: Bag, role: Bag, code: string | null | undefined): State {
  const t = (key: string) => typeOf(own, role, key)
  const admin = roleCodeOf(code) === 'admin' || t('all') === 'true'
  const sf = t('settings') === 'true'
  const inventoryTier = t('inventory') === 'true' ? 'full' : t('inventory') === 'text' && valueOf(own, role, 'inventory') === 'review' ? 'review' : 'none'
  const ic = t('inventory_checks'), icv = t('inventory_checks:view'), icc = t('inventory_checks:check')
  const iv = t('inventory:view'), ick = t('inventory:check')
  const oldView = ic !== undefined ? (ic === 'true' && icv !== 'false') : (inventoryTier !== 'none' && iv !== 'false')
  const newView = ic === 'true' && icv !== 'false'
  const oldCheck = oldView && (ic !== undefined ? (ic === 'true' && icc !== 'false') : (inventoryTier !== 'none' && ick !== 'false'))
  const newCheck = newView && icc !== 'false'
  const oldBits: Record<string, boolean> = {}
  const newBits: Record<string, boolean> = {}
  for (const key of OR_KEYS) { oldBits[key] = t(key) === 'true' || sf; newBits[key] = t(key) === 'true' }
  for (const key of SF_KEYS) { oldBits[key] = sf; newBits[key] = t(key) === 'true' }
  oldBits.inventory_checks = oldView; newBits.inventory_checks = newView
  oldBits['inventory_checks:check'] = oldCheck; newBits['inventory_checks:check'] = newCheck
  for (const field of FIELDS) {
    const type = t(fieldKey(field))
    oldBits[fieldKey(field)] = oldView && (type === 'true' || type === 'false' ? type === 'true' : inventoryTier === 'full')
    newBits[fieldKey(field)] = newView && type === 'true'
  }
  return { admin, oldBits, newBits, mt: { ic, icv, icc, ...Object.fromEntries(FIELDS.map((field) => [`f_${field}`, t(fieldKey(field))])) } }
}

// The keys to write for one principal: `before` holds the old-rule bits, `now` the state the new rules read (the same state for a
// role; the user's merged map after its role was fixed for a user).
function fixesFor(before: State, now: State): Record<string, boolean> {
  const fix: Record<string, boolean> = {}
  if (before.admin) return fix
  for (const key of [...OR_KEYS, ...SF_KEYS]) if (before.oldBits[key] !== now.newBits[key]) fix[key] = before.oldBits[key]
  const oldView = before.oldBits.inventory_checks
  const newView = now.newBits.inventory_checks
  if (oldView !== newView && (!oldView || now.mt.ic !== 'true')) fix.inventory_checks = oldView
  if (oldView && !newView && now.mt.icv === 'false') fix['inventory_checks:view'] = true
  if (oldView) {
    const wantCheck = before.oldBits['inventory_checks:check']
    const blocked = now.mt.icc === 'false'
    if (wantCheck && blocked) fix['inventory_checks:check'] = true
    else if (!wantCheck && !blocked) fix['inventory_checks:check'] = false
    for (const field of FIELDS) {
      const key = fieldKey(field)
      const want = before.oldBits[key]
      const type = now.mt[`f_${field}`]
      if (want && type !== 'true') fix[key] = true
      else if (!want && type === 'true') fix[key] = false
    }
  }
  return fix
}

/**
 * The permission text each role and user must hold so that dropping the implied grants changes nothing. Rows that need no change
 * are not returned. Mirrors migration 0270; call it only for data older than 0270.
 */
export function materializePermissionExtras(roles: PermissionExtrasRole[], users: PermissionExtrasUser[]): { roles: PermissionExtrasUpdate[]; users: PermissionExtrasUpdate[] } {
  const roleBefore = new Map<number, Bag>()
  const roleCode = new Map<number, string | null | undefined>()
  const roleUpdates: PermissionExtrasUpdate[] = []
  const roleAfter = new Map<number, Bag>()
  for (const role of roles) {
    const base = parseJsonObject(role.permissions) as Bag
    roleBefore.set(role.id, base)
    roleCode.set(role.id, role.code)
    const fix = fixesFor(stateOf({}, base, role.code), stateOf({}, base, role.code))
    if (Object.keys(fix).length) {
      const next = { ...base, ...fix }
      roleAfter.set(role.id, next)
      roleUpdates.push({ id: role.id, permissions: JSON.stringify(next) })
    } else roleAfter.set(role.id, base)
  }
  const userUpdates: PermissionExtrasUpdate[] = []
  for (const user of users) {
    const own = parseJsonObject(user.permissions) as Bag
    const hasRole = user.role_id != null && roleBefore.has(user.role_id)
    const before = stateOf(own, hasRole ? roleBefore.get(user.role_id as number) as Bag : {}, hasRole ? roleCode.get(user.role_id as number) : null)
    const now = stateOf(own, hasRole ? roleAfter.get(user.role_id as number) as Bag : {}, hasRole ? roleCode.get(user.role_id as number) : null)
    const fix = fixesFor(before, now)
    if (Object.keys(fix).length) userUpdates.push({ id: user.id, permissions: JSON.stringify({ ...own, ...fix }) })
  }
  return { roles: roleUpdates, users: userUpdates }
}
