// The before/after effective-permission oracle for migration 0270 (lane 6.0.967).
//
//   OLD rules  a frozen copy of what the Worker did before the fallbacks were removed: the hasPermission() fallback for
//              drive_credentials / business_identity / sales_policy, every route predicate that also accepted Settings Full
//              ("bucket OR settings"), and the count-session reading that follows Inventory when inventory_checks is absent.
//   NEW rules  the REAL transpiled lib/permissions.ts and lib/inventoryCheckAccess.ts, plus the route predicates as the routes now
//              write them (each pinned to its route's source by test-permission-extras-route-gates-pure.cjs).
//
// capabilities(rules, user) returns one flat object of booleans: every capability the removed fallbacks could have changed.
// The oracle is the proof that applying the update changes nothing: for every principal,
//   OLD(before data) === NEW(after data) === OLD(after data).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', '..', 'src')

function loadTs(rel, requires = {}) {
  const full = path.join(SRC, rel)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: full,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((request) => {
    if (Object.hasOwn(requires, request)) return requires[request]
    throw new Error(`unexpected require ${request} in ${rel}`)
  }, mod, mod.exports)
  return mod.exports
}

function loadRealRules() {
  const permissions = loadTs('lib/permissions.ts', { './db': {} })
  const acquisition = loadTs('lib/acquisitionCostAccess.ts', { './permissions': permissions })
  const inventory = loadTs('lib/inventoryCheckAccess.ts', { './permissions': permissions, './acquisitionCostAccess': acquisition })
  return { permissions, acquisition, inventory }
}

const BUCKETS = ['business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal']
const FIELDS = ['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost']

// ---- OLD rules, frozen -----------------------------------------------------------------------------------------------------
function oldRules(real) {
  const P = real.permissions
  const hasPermission = (user, key) => {
    const normalized = String(key || '').trim().toLowerCase()
    if (!normalized) return !!user
    if (P.isAdminControlUser(user)) return true
    const permissions = P.getMergedPermissions(user)
    if (permissions[normalized] === true) return true
    if (normalized === 'drive_credentials' && permissions.settings === true) return true
    if (normalized === 'business_identity' && permissions.settings === true) return true
    if (normalized === 'sales_policy' && permissions.settings === true) return true
    return false
  }
  const tier = (user, key) => P.getPermissionTier(user, key)
  // lib/inventoryCheckAccess.ts as it was before 0270.
  const inventoryAccess = (user) => {
    const permissions = P.getMergedPermissions(user)
    const admin = P.isAdminControlUser(user)
    const dedicated = Object.hasOwn(permissions, 'inventory_checks')
    const canView = admin || (dedicated ? P.getActionTier(user, 'inventory_checks', 'view') === 'full' : P.getActionTier(user, 'inventory', 'view') !== 'none')
    const invTier = P.getPermissionTier(user, 'inventory')
    const fields = Object.fromEntries(FIELDS.map((field) => {
      const explicit = permissions[`inventory_check_show_${field}`]
      return [field, canView && (admin || (typeof explicit === 'boolean' ? explicit : invTier === 'full'))]
    }))
    fields.cost = fields.cost && real.acquisition.canViewAcquisitionCosts(user)
    const checkTier = P.getActionTier(user, 'inventory', 'check')
    return {
      canView,
      canCheck: admin || canView && (dedicated ? P.getActionTier(user, 'inventory_checks', 'check') === 'full' : checkTier === 'full' || checkTier === 'review'),
      fields,
    }
  }
  return {
    name: 'old',
    hasPermission,
    tier,
    bucket: (user, bucket) => hasPermission(user, bucket) || hasPermission(user, 'settings'),
    paymentWrite: (user) => hasPermission(user, 'sales_policy') || hasPermission(user, 'settings'),
    moderation: (user) => hasPermission(user, 'customer_portal') || hasPermission(user, 'settings'),
    strip: (user) => ['portal_posts', 'customer_portal', 'settings'].some((key) => hasPermission(user, key)),
    library: (user) => tier(user, 'library') === 'full' || hasPermission(user, 'settings'),
    driveControl: (user) => hasPermission(user, 'settings'),
    driveStatus: (user) => hasPermission(user, 'backup') || hasPermission(user, 'settings'),
    ai: (user) => hasPermission(user, 'settings'),
    inventoryAccess,
  }
}

// ---- NEW rules: the real modules and the routes' predicates ---------------------------------------------------------------------
function newRules(real) {
  const P = real.permissions
  const hasPermission = P.hasPermission
  const tier = P.getPermissionTier
  return {
    name: 'new',
    hasPermission,
    tier,
    bucket: (user, bucket) => hasPermission(user, bucket),
    paymentWrite: (user) => hasPermission(user, 'sales_policy'),
    moderation: (user) => hasPermission(user, 'customer_portal'),
    strip: (user) => ['portal_posts', 'customer_portal'].some((key) => hasPermission(user, key)),
    library: (user) => tier(user, 'library') === 'full',
    driveControl: (user) => hasPermission(user, 'drive_credentials'),
    driveStatus: (user) => hasPermission(user, 'backup') || hasPermission(user, 'drive_credentials'),
    ai: (user) => hasPermission(user, 'ai_providers'),
    inventoryAccess: (user) => real.inventory.getInventoryCheckAccess(user),
  }
}

// Keys whose answer must not move at all.
const UNRELATED_KEYS = ['all', 'settings', 'backup', 'backup_restore', 'pos', 'products', 'inventory', 'sales', 'returns', 'fees', 'contacts', 'contacts_suppliers',
  'branches', 'dashboard', 'dashboard_export', 'audit_log', 'review', 'promotions', 'users', 'security_settings', 'destructive_delete', 'product_cost_view', 'product_cost_edit']

function capabilities(rules, user) {
  const out = {}
  for (const bucket of BUCKETS) out[`bucket:${bucket}`] = rules.bucket(user, bucket)
  out['payment_method_write'] = rules.paymentWrite(user)
  out['portal_moderation'] = rules.moderation(user)
  out['announcement_strip_write'] = rules.strip(user)
  out['library_manage'] = rules.library(user)
  out['drive_control'] = rules.driveControl(user)
  out['drive_status_and_jobs'] = rules.driveStatus(user)
  out['ai_providers'] = rules.ai(user)
  const access = rules.inventoryAccess(user)
  out['count:view'] = access.canView
  out['count:check'] = access.canCheck
  for (const field of FIELDS) out[`count:field:${field}`] = access.fields[field]
  for (const key of UNRELATED_KEYS) {
    out[`has:${key}`] = rules.hasPermission(user, key)
    out[`tier:${key}`] = rules.tier(user, key)
  }
  return out
}

function diff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((key) => a[key] !== b[key]).map((key) => `${key}: ${a[key]} -> ${b[key]}`)
}

// ---- principals -------------------------------------------------------------------------------------------------------------------
// A role is judged on its own (as a user with no override); a user on role + own text, exactly as lib/auth.ts joins them.
const roleUser = (role) => ({ permissions: null, role_permissions: role.permissions, role_code: role.code })
const userUser = (row) => ({ permissions: row.permissions, role_permissions: row.role_permissions ?? null, role_code: row.role_code ?? null })

function readPrincipals(db) {
  const roles = db.prepare('SELECT id, code, permissions FROM roles ORDER BY id').all().map((role) => ({ key: `role:${role.id}`, raw: role.permissions, user: roleUser(role) }))
  const users = db.prepare(`SELECT u.id, u.permissions, r.permissions AS role_permissions, r.code AS role_code
    FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id`).all().map((row) => ({ key: `user:${row.id}`, raw: row.permissions, user: userUser(row) }))
  return [...roles, ...users]
}

// ---- deterministic fuzz --------------------------------------------------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const SCALARS = [true, false, null, 1, 0, 'true', 'yes']
const VOCAB = {
  settings: [true, true, false, 'view', null, 1, 'true'],
  backup: [true, false], backup_restore: [true, false], all: [false, false, false, true],
  inventory: [true, true, false, 'review', 'review', 'view', null, 'yes', 1],
  inventory_checks: [true, false, null, 'true', 1],
  'inventory_checks:view': [false, true, null], 'inventory_checks:check': [false, true, null],
  'inventory:view': [false, true, null], 'inventory:check': [false, true, null],
  library: [true, false, 'review', null], business_identity: SCALARS, sales_policy: SCALARS, receipt_settings: SCALARS,
  portal_posts: SCALARS, portal_faq: SCALARS, portal_about: SCALARS, customer_portal: SCALARS,
  drive_credentials: [true, false, null], ai_providers: [true, false, null],
  product_cost_view: [true, false], product_cost_edit: [true, false],
  pos: [true, false], products: [true, 'review', false], sales: [true, 'view', false], contacts: [true, 'review', false],
}
for (const field of FIELDS) VOCAB[`inventory_check_show_${field}`] = [true, false, null, 'yes', 1]

function randomMap(next, density) {
  const map = {}
  for (const [key, values] of Object.entries(VOCAB)) {
    if (next() < density) map[key] = values[Math.floor(next() * values.length)]
  }
  return map
}
const CODES = ['admin', ' Admin ', 'manager', 'employee', 'custom', 'ADMIN', null, '']
function randomRoleText(next) {
  const roll = next()
  if (roll < 0.03) return 'not json'
  if (roll < 0.05) return '[]'
  if (roll < 0.07) return null
  if (roll < 0.08) return '"{}"'
  return JSON.stringify(randomMap(next, 0.3))
}
function randomUserText(next) {
  const roll = next()
  if (roll < 0.35) return '{}'
  if (roll < 0.37) return 'oops'
  if (roll < 0.38) return null
  return JSON.stringify(randomMap(next, 0.12))
}
function fuzzRows(seed, roleCount, userCount) {
  const next = rng(seed)
  const roles = Array.from({ length: roleCount }, () => ({ code: CODES[Math.floor(next() * CODES.length)], permissions: randomRoleText(next) }))
  const users = Array.from({ length: userCount }, () => {
    const pick = next()
    const roleIndex = pick < 0.04 ? null : pick < 0.07 ? roleCount + 50 : Math.floor(next() * roleCount)
    return { roleIndex, permissions: randomUserText(next) }
  })
  return { roles, users }
}

// ---- named fixtures (the design's list) ----------------------------------------------------------------------------------------------------
const EMPLOYEE = {
  pos: true, inventory_checks: true, inventory_check_show_price: true, inventory_check_show_barcode: true, inventory_check_show_category: true,
  inventory_check_show_brand: true, inventory_check_show_stock: true, inventory_check_show_received: true, inventory_check_show_sales: true,
  inventory_check_show_customers: true, inventory_check_show_cost: false, receipt_settings: true, products: true, sales: true, contacts: true,
}
const ROLE_FIXTURES = {
  admin: ['admin', { all: true }],
  admin_spaced: [' Admin ', {}],
  settings_full: ['sf', { settings: true }],
  settings_view: ['sv', { settings: 'view' }],
  settings_explicit_off: ['seo', { settings: true, drive_credentials: false, library: false }],
  settings_numeric: ['sn', { settings: 1 }],
  inventory_full: ['if', { inventory: true }],
  inventory_review: ['ir', { inventory: 'review' }],
  inventory_no_check: ['inc', { inventory: true, 'inventory:check': false }],
  inventory_no_view: ['inv', { inventory: true, 'inventory:view': false }],
  inventory_fields: ['ifd', { inventory: true, inventory_check_show_price: false, inventory_check_show_stock: 'yes' }],
  employee: ['employee', EMPLOYEE],
  inventory_checks_false: ['icf', { inventory: true, inventory_checks: false }],
  orphan_view_false: ['ovf', { 'inventory_checks:view': false }],
  custom_all: ['ca', { all: true }],
  invalid_json: ['bad', 'not json'],
  json_array: ['arr', '[]'],
  null_permissions: ['nul', null],
  customer_portal_only: ['cpo', { customer_portal: true }],
  portal_posts_only: ['ppo', { portal_posts: true }],
  library_review: ['lr', { library: 'review' }],
  dormant_drive: ['dd', { drive_credentials: true }],
  dormant_ai: ['dai', { ai_providers: true }],
  review_with_checks: ['rwc', { inventory: 'review', inventory_checks: true }],
  checks_null: ['icn', { inventory: true, inventory_checks: null }],
  settings_inventory_backup: ['sib', { settings: true, inventory: true, backup: true }],
  manager_preset: ['mgr', { settings: true, backup: true, customer_portal: true, inventory: true, library: true }],
}
const USER_FIXTURES = [
  ['settings_full', {}], ['settings_full', { settings: false }], ['settings_full', { settings: null }], ['settings_full', { library: false }],
  ['settings_view', { settings: true }], ['inventory_full', { inventory: false }], ['inventory_full', { inventory: 'review' }],
  ['inventory_full', { 'inventory:check': false }], ['inventory_full', { 'inventory:view': false }], ['inventory_full', { inventory_check_show_cost: true }],
  ['inventory_review', { inventory_check_show_cost: true }], ['inventory_review', { inventory: true }],
  ['settings_full', { all: true }], ['admin', { all: false }], ['employee', { inventory: true }], ['employee', {}],
  ['settings_inventory_backup', { backup: false }], ['settings_inventory_backup', { drive_credentials: false }],
  ['settings_full', { inventory: true }], ['dormant_drive', { settings: true }], ['dormant_drive', {}], ['dormant_ai', {}],
  ['settings_full', 'invalid'], ['inventory_full', { 'inventory_checks:view': false }], ['inventory_full', { inventory_checks: true }],
  ['customer_portal_only', { settings: true }], ['library_review', { settings: true }], ['review_with_checks', { inventory_checks: null }],
  [null, { settings: true }], ['dangling', { settings: true }], [null, { inventory: true }],
]

const textOf = (value) => (value === null || typeof value === 'string' ? value : JSON.stringify(value))

// Seeds: the named fixtures first, then the fuzz. Returns { roleIds, userKeys } so a failure names its fixture.
function seed(db, { fuzz = true, seedValue = 270, roleCount = 300, userCount = 3000 } = {}) {
  const names = new Map()
  db.prepare('DELETE FROM users').run()
  db.prepare('DELETE FROM roles').run()
  const insertRole = db.prepare('INSERT INTO roles(name, code, permissions) VALUES(?, ?, ?)')
  const insertUser = db.prepare('INSERT INTO users(username, name, password, role_id, permissions) VALUES(?, ?, ?, ?, ?)')
  const roleIds = {}
  for (const [name, [code, permissions]] of Object.entries(ROLE_FIXTURES)) {
    const id = Number(insertRole.run(name, code, textOf(permissions)).lastInsertRowid)
    roleIds[name] = id
    names.set(`role:${id}`, `role ${name}`)
  }
  let n = 0
  for (const [roleName, own] of USER_FIXTURES) {
    const roleId = roleName === null ? null : roleName === 'dangling' ? 99999 : roleIds[roleName]
    const id = Number(insertUser.run(`fx${++n}`, `Fixture ${n}`, 'x', roleId, own === 'invalid' ? 'oops' : JSON.stringify(own)).lastInsertRowid)
    names.set(`user:${id}`, `user on ${roleName} with ${JSON.stringify(own)}`)
  }
  if (fuzz) {
    const rows = fuzzRows(seedValue, roleCount, userCount)
    const ids = rows.roles.map((role, i) => {
      const id = Number(insertRole.run(`fz${i}`, role.code, role.permissions).lastInsertRowid)
      names.set(`role:${id}`, `fuzz role ${i} ${role.code} ${role.permissions}`)
      return id
    })
    rows.users.forEach((user, i) => {
      const roleId = user.roleIndex === null ? null : user.roleIndex >= ids.length ? 99999 : ids[user.roleIndex]
      const id = Number(insertUser.run(`fzu${i}`, `Fuzz ${i}`, 'x', roleId, user.permissions).lastInsertRowid)
      names.set(`user:${id}`, `fuzz user ${i} on ${user.roleIndex} ${user.permissions}`)
    })
  }
  return { names, roleIds }
}


module.exports = {
  seed, loadRealRules, oldRules, newRules, capabilities, diff, readPrincipals, roleUser, userUser,
  fuzzRows, ROLE_FIXTURES, USER_FIXTURES, BUCKETS, FIELDS, UNRELATED_KEYS,
}
