// Owner, 19 Oct 2026: Employee edits every product detail except prices and the supplier.
//
//   UTIL    canChangeProductSupplier / isProductSupplierLocked: Employee fixture locked, admin and a role with the
//           switch editable, a NEW product's supplier never locked
//   PARITY  the frontend rule equals the Worker rule (PUT /api/products/:id) on one shared case table
//   TABLE   the Supplier column locks only for a user without the switch (it used to lock for everyone)
//   FORM    the supplier input is disabled behind the util, with the translated tooltip
//   PACKS   the editor row label and the tooltip exist in BOTH packs, Khmer not a copy of English
//
// Run: node tests/productSupplierAccess.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  canChangeProductSupplier, isProductSupplierLocked, productSupplierChanged, productSupplierSaveRefused,
} from '../src/utils/productSupplierAccess.ts'
import { isProductColumnLocked, PRODUCT_COLUMNS } from '../src/components/products/config/productTableColumns.ts'
import { loadSource } from './productsSurfaceFixture.ts'
import { ROLE_PRESETS } from '../src/components/users/rolePresetDefaults.ts'
import { PERMISSION_ACTIONS } from '../src/utils/permissionActions.ts'
import { getActionTier } from '../../cloudflare/src/lib/permissions.ts'
import { productSupplierChanged as workerSupplierChanged } from '../../cloudflare/src/lib/productSupplierGate.ts'

const { ProductSupplierCell } = await loadSource('components/products/surfaces/ProductRowParts.tsx')
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
let failed = 0
function test(name: string, run: () => void) {
  try { run(); console.log('PASS ' + name) } catch (error) { failed += 1; console.error('FAIL ' + name, error) }
}

// The API serves permissions as JSON text; the Worker only reads that shape, so both sides get exactly it.
const EMPLOYEE = { role_code: 'employee', role_permissions: JSON.stringify(ROLE_PRESETS.find((preset) => preset.key === 'employee')!.permissions) }
const ADMIN = { role_code: 'admin', role_permissions: JSON.stringify({ all: true }) }
const WITH_SWITCH = { role_code: 'manager', role_permissions: JSON.stringify({ products: true }) }
const SWITCH_OFF = { role_code: 'manager', role_permissions: JSON.stringify({ products: true, 'products:supplier': false }) }
const SWITCH_OFF_ON_USER = { role_code: 'manager', role_permissions: JSON.stringify({ products: true }), permissions: JSON.stringify({ 'products:supplier': false }) }
const REVIEW_TIER = { role_code: 'manager', role_permissions: JSON.stringify({ products: 'review', 'products:supplier': false }) }
const NO_PRODUCTS = { role_code: 'manager', role_permissions: JSON.stringify({}) }

test('UTIL: the Employee fixture cannot change the supplier; admin and a role with the switch can', () => {
  assert.equal(canChangeProductSupplier(EMPLOYEE), false)
  assert.equal(canChangeProductSupplier(ADMIN), true)
  assert.equal(canChangeProductSupplier(WITH_SWITCH), true, 'ABSENT is no opinion: existing roles keep working')
  assert.equal(canChangeProductSupplier(SWITCH_OFF), false)
  assert.equal(canChangeProductSupplier(SWITCH_OFF_ON_USER), false, 'a per-user override narrows the role')
})

test('UTIL: the input is locked on an existing product only; a new product follows Add', () => {
  assert.equal(isProductSupplierLocked(EMPLOYEE, false), true)
  assert.equal(isProductSupplierLocked(EMPLOYEE, true), false)
  assert.equal(isProductSupplierLocked(ADMIN, false), false)
  assert.equal(isProductSupplierLocked(WITH_SWITCH, false), false)
})

test('UTIL: only a different supplier is a change (trim and case are not)', () => {
  assert.equal(productSupplierChanged('Acme', ' acme  '), false)
  assert.equal(productSupplierChanged(null, ''), false)
  assert.equal(productSupplierChanged('Acme', 'Beta'), true)
  assert.equal(productSupplierChanged('', 'Beta'), true)
  assert.equal(productSupplierSaveRefused(EMPLOYEE, 'Acme', ' ACME'), false, 'the form posts the stored supplier back')
  assert.equal(productSupplierSaveRefused(EMPLOYEE, 'Acme', 'Beta'), true)
  assert.equal(productSupplierSaveRefused(ADMIN, 'Acme', 'Beta'), false)
})

test('PARITY: the frontend refuses exactly the saves the Worker refuses, on a shared case table', () => {
  const users = [EMPLOYEE, ADMIN, WITH_SWITCH, SWITCH_OFF, SWITCH_OFF_ON_USER, REVIEW_TIER, NO_PRODUCTS]
  const pairs: Array<[unknown, unknown]> = [
    ['Acme', 'Acme'], ['Acme', ' acme '], ['Acme', 'Beta'], ['Acme', ''], [null, 'Beta'], [null, ''], ['', '  '], [undefined, 'X'], ['Acme', null],
  ]
  let refusals = 0
  let allowedChanges = 0
  for (const user of users) {
    for (const [stored, submitted] of pairs) {
      // The Worker: tier 'none' for products:supplier AND a supplier that differs from the stored one.
      const workerChanged = workerSupplierChanged(stored, { supplier: submitted })
      const worker = getActionTier(user as never, 'products', 'supplier') === 'none' && workerChanged
      const label = `${user.role_code}/${user.role_permissions} ${JSON.stringify(stored)} -> ${JSON.stringify(submitted)}`
      assert.equal(productSupplierSaveRefused(user, stored, submitted), worker, label)
      assert.equal(productSupplierChanged(stored, submitted), workerChanged, label)
      if (worker) refusals += 1
      else if (workerChanged) allowedChanges += 1
    }
  }
  assert.ok(refusals >= 20 && allowedChanges >= 10, 'the table exercises both outcomes (positive control)')
})

test('TABLE: the Supplier column locks only for a user without the switch; the price lock is unchanged', () => {
  const supplier = PRODUCT_COLUMNS.find((column) => column.key === 'supplier')!
  const selling = PRODUCT_COLUMNS.find((column) => column.key === 'selling')!
  const barcode = PRODUCT_COLUMNS.find((column) => column.key === 'barcode')!
  assert.equal(isProductColumnLocked(supplier, { canEditPrices: true, canEditSupplier: true }), false)
  assert.equal(isProductColumnLocked(supplier, { canEditPrices: true, canEditSupplier: false }), true)
  assert.equal(isProductColumnLocked(supplier, { canEditPrices: false, canEditSupplier: true }), false, 'the price switch does not lock the supplier')
  assert.equal(isProductColumnLocked(selling, { canEditPrices: false, canEditSupplier: true }), true)
  assert.equal(isProductColumnLocked(selling, { canEditPrices: true, canEditSupplier: false }), false)
  assert.equal(isProductColumnLocked(barcode, { canEditPrices: false, canEditSupplier: false }), false)
  const cell = (lockTip?: string) => renderToStaticMarkup(React.createElement(ProductSupplierCell as React.ComponentType<Record<string, unknown>>, { supplier: 'Acme', lockTip, tr: (_k: string, f: string) => f }))
  assert.doesNotMatch(cell(undefined), /role="img"/, 'an editor sees no lock')
  assert.match(cell('No supplier permission'), /aria-label="No supplier permission"/)
  const products = read('../src/components/products/Products.tsx')
  assert.doesNotMatch(products, /column\.lock === 'supplier'/, 'the table no longer locks the supplier for everyone')
  assert.match(products, /const supplierLockTip = canEditSupplier \? undefined : tr\('product_supplier_read_only'/)
  assert.match(products, /const canEditSupplier = canChangeProductSupplier\(user\)/)
})

test('FORM: the supplier input is disabled behind the util, with the translated tooltip', () => {
  const form = read('../src/components/products/forms/ProductForm.tsx')
  assert.match(form, /const supplierLocked = isProductSupplierLocked\(user, isCreateMode\)/)
  assert.match(form, /const supplierLockTip = supplierLocked \? tr\('product_supplier_read_only'/)
  const input = form.slice(form.indexOf('id="product-supplier"'), form.indexOf('id="product-supplier"') + 400)
  assert.match(input, /disabled=\{supplierLocked\}/)
  assert.match(form, /<div className="min-w-0" title=\{supplierLockTip\}>\s*<label htmlFor="product-supplier"/)
})

test('EDITOR: the supplier switch is listed under Products and the editor renders switches from that table', () => {
  const action = PERMISSION_ACTIONS.products.find((entry) => entry.key === 'supplier')
  assert.equal(action?.tKey, 'perm_act_products_supplier')
  assert.match(read('../src/components/users/PermissionEditor.tsx'), /actionsForKey\(/)
})

test('PACKS: the supplier switch label and tooltip exist in both packs, Khmer is not English', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['perm_act_products_supplier', 'product_supplier_read_only']) {
    assert.ok(en[key] && km[key], key)
    assert.notEqual(km[key], en[key], `${key} is translated`)
    assert.match(km[key], /[ក-៿]/)
  }
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nproductSupplierAccess: all checks passed')
