import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { effectivePermissions } from '../src/utils/permissions.ts'
import { NAV_ITEMS, ACCOUNT_NAV_IDS } from '../src/components/shared/navigationConfig.ts'

// Sep 16 2026 owner request: "Receipt settings should be in page menu as
// well" and "Receipt settings should also show for employees as well."
// Receipt/print settings is an operational tool for whoever prints
// receipts, not an admin-only setting -- these checks lock the frontend
// half of that fix: the page gates on its own 'receipt_settings' key (not
// the blanket 'settings' grant an Employee never carries), and it renders
// as a normal page-menu entry (not folded into the account-only set),
// while still also appearing in the avatar dropdown.

function extractConst(source: string, name: string): unknown {
  const ast = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)
  let text = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.name.getText(ast) === name && decl.initializer) text = decl.initializer.getText(ast)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(text, `${name} not found`)
  const compiled = ts.transpileModule(`module.exports = ${text}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', compiled)(mod, mod.exports)
  return mod.exports
}

console.log('PASS setup')

// --- NAV_ITEMS / ACCOUNT_NAV_IDS: page-menu parity ------------------------
const receiptNavItem = NAV_ITEMS.find((item) => item.id === 'receipt_settings')
assert.ok(receiptNavItem, 'receipt_settings must remain a real NAV_ITEMS entry')
assert.equal(receiptNavItem?.permission, 'receipt_settings', 'nav link visibility must key off its own permission, not the blanket settings grant')
assert.equal(ACCOUNT_NAV_IDS.has('receipt_settings'), false, 'receipt_settings must render as a normal page-menu entry (Sidebar.tsx visibleItems), not be excluded into the account-only set')
assert.equal(ACCOUNT_NAV_IDS.has('settings'), true, 'the plain Settings page is unaffected and stays account-panel-only')
console.log('PASS receipt_settings is a real, independently-permissioned page-menu entry')

// --- AppContext.tsx PAGE_PERMISSIONS: guard matches the nav link ----------
const appContextSource = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
const permissionsBlockMatch = appContextSource.match(/const PAGE_PERMISSIONS: Record<string, string \| null> = \{([\s\S]*?)\n\}/)
assert.ok(permissionsBlockMatch, 'PAGE_PERMISSIONS map should be present in AppContext.tsx')
const declaredPermissions = new Map(
  [...(permissionsBlockMatch?.[1] || '').matchAll(/^\s*([a-zA-Z_]+):\s*(?:'([^']*)'|(null)),/gm)].map((match) => [match[1], match[2] ?? null]),
)
assert.equal(declaredPermissions.get('receipt_settings'), 'receipt_settings', 'the page-load guard must require the dedicated key, not the blanket settings grant')
console.log('PASS AppContext.tsx page-load guard matches the nav-link permission for receipt_settings')

// --- Sidebar.tsx: still reachable from the avatar dropdown too -----------
const sidebarSource = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
assert.match(
  sidebarSource,
  /canAccessPage\('receipt_settings'\) \? \[\{ id: 'receipt_settings'/,
  'Receipt Settings must still appear in the account panel/avatar dropdown alongside its new page-menu entry',
)
console.log('PASS receipt_settings keeps its avatar-dropdown entry point in addition to the page menu')

// --- coreDataInvariants.ts: Employee default carries the key -------------
const coreDataSource = readFileSync(new URL('../../cloudflare/src/lib/coreDataInvariants.ts', import.meta.url), 'utf8')
const defaultRolePermissions = extractConst(coreDataSource, 'DEFAULT_ROLE_PERMISSIONS') as Record<string, Record<string, unknown>>
assert.equal(defaultRolePermissions.employee?.receipt_settings, true, 'Employee must default to full receipt_settings access so front-line staff can change print modes')
assert.equal(defaultRolePermissions.manager?.receipt_settings, undefined, "Manager stays seeded to {} like every other page -- this fix doesn't widen Manager's defaults")
console.log('PASS Employee role defaults to full receipt_settings access; Manager is untouched')

// --- effectivePermissions: an Employee-shaped grant set can use the page --
const employeeGrants = { ...defaultRolePermissions.employee }
assert.equal(effectivePermissions({ permissions: employeeGrants }).hasPermission('receipt_settings'), true, 'an Employee session must reach receipt_settings')
assert.equal(effectivePermissions({ permissions: { pos: true, sales: true } }).hasPermission('receipt_settings'), false, 'a role with the key removed/absent must be refused')
assert.equal(effectivePermissions({ permissions: { settings: true } }).hasPermission('receipt_settings'), false, 'the blanket settings grant does not imply receipt_settings -- they are independent grants now')
console.log('PASS an Employee session reaches receipt_settings; a role without the key does not; settings and receipt_settings are independent grants')
