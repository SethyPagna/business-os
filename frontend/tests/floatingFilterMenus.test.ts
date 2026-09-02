import assert from 'node:assert/strict'
import fs from 'node:fs'

const portalMenu = fs.readFileSync(new URL('../src/components/shared/PortalMenu.tsx', import.meta.url), 'utf8')
const filterMenu = fs.readFileSync(new URL('../src/components/shared/FilterMenu.tsx', import.meta.url), 'utf8')
const catalogProducts = fs.readFileSync(new URL('../src/components/catalog/CatalogProductsSection.tsx', import.meta.url), 'utf8')
const portalCombobox = fs.readFileSync(new URL('../src/components/catalog/PortalFilterCombobox.tsx', import.meta.url), 'utf8')

function runTest(name: string, test: () => void): void {
  try {
    test()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

runTest('shared filter menu uses one lazy body portal', () => {
  assert.match(filterMenu, /<LazyPortalMenu/)
  assert.strictEqual((filterMenu.match(/<LazyPortalMenu/g) || []).length, 1)
  assert.match(filterMenu, /max-w-\[calc\(100vw-1rem\)\]/)
})

runTest('shared portal is fixed, viewport bounded, and scroll-container safe', () => {
  assert.match(portalMenu, /createPortal\(/)
  assert.match(portalMenu, /style=\{\{ position: 'fixed',[\s\S]*zIndex: 9999 \}\}/)
  assert.match(portalMenu, /if \(left \+ menuWidth > viewportWidth - 8\)/)
  assert.match(portalMenu, /if \(left < 8\) left = 8/)
  assert.match(portalMenu, /window\.addEventListener\('scroll', scheduleReposition, true\)/)
  assert.match(portalMenu, /resizeObserver\.observe\(menuRef\.current\)/)
})

runTest('shared portal closes outside and Escape restores trigger focus', () => {
  assert.match(portalMenu, /document\.addEventListener\('mousedown', closeIfClickedOutside\)/)
  assert.match(portalMenu, /document\.addEventListener\('touchstart', closeIfClickedOutside\)/)
  assert.match(portalMenu, /if \(event\.key !== 'Escape'\) return/)
  assert.match(portalMenu, /querySelectorAll<HTMLElement>\('\[data-portal-menu-content\]'\)[\s\S]*openPortalMenus\[openPortalMenus\.length - 1\] !== menuRef\.current/, 'nested Escape should close only the topmost filter layer')
  assert.match(portalMenu, /requestAnimationFrame\(\(\) => \{[\s\S]*querySelector<HTMLElement>[\s\S]*trigger\?\.focus\(\)/)
})

runTest('catalog compact filters float instead of inserting a layout row', () => {
  assert.match(catalogProducts, /<LazyPortalMenu[\s\S]*onOpenChange=\{setFiltersOpen\}/)
  assert.match(catalogProducts, /role="dialog"[\s\S]*tabIndex=\{-1\}[\s\S]*100dvh/)
  assert.match(catalogProducts, /filterPanelRef\.current\?\.focus\(\)/)
  assert.doesNotMatch(catalogProducts, /\{filtersOpen \? \(\s*<div className="space-y-2 rounded-\[1\.35rem\]/)
  assert.doesNotMatch(catalogProducts, /setFiltersOpen\(\(current\) => !current\)/)
  assert.match(catalogProducts, /<aside className="hidden[^"]*lg:block/, 'wide screens should retain the permanent filter rail')
})

runTest('catalog option comboboxes share the body portal and searchable focus contract', () => {
  assert.match(portalCombobox, /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/)
  assert.match(portalCombobox, /<LazyPortalMenu[\s\S]*align="auto"[\s\S]*max-w-\[calc\(100vw-1rem\)\]/)
  assert.match(portalCombobox, /onOpenChange=\{setOpen\}/)
  assert.match(portalCombobox, /requestAnimationFrame\(\(\) => inputRef\.current\?\.focus\(\)\)/)
  assert.match(portalCombobox, /role="dialog"[\s\S]*role="listbox"/)
  assert.doesNotMatch(portalCombobox, /absolute top-\[calc\(100%/)
  assert.doesNotMatch(portalCombobox, /alignRight|PANEL_WIDTH_PX|containerRef/)
})

console.log('Floating filter menu contracts passed')
