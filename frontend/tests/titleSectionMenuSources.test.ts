import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getHubDestinations } from '../src/components/shared/hubNavigation.ts'
import { SECTION_TITLE_MENU_Z } from '../src/utils/mobileNavChrome.ts'
import en from '../src/lang/en.json' with { type: 'json' }
import km from '../src/lang/km.json' with { type: 'json' }

const read = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

// Every page that shows sections gives the bar title the same list its own section row uses.
const hosts: Record<string, string[]> = {
  products: ['components/products/Products.tsx'],
  sales: ['components/sales/SalesHubPage.tsx'],
  inventory: ['components/inventory/InventoryChecksPage.tsx'],
  branches: ['components/branches/BranchesHubPage.tsx'],
  contacts: ['components/contacts/Contacts.tsx'],
  promotions: ['components/promotions/PromotionsPage.tsx'],
  settings: ['components/utils-settings/SettingsHubPage.tsx'],
  review: ['components/review/ReviewLogsPage.tsx'],
}
const everything = { getPermissionTier: () => 'full', hasPermission: () => true, canAccessPage: () => true, can: () => true }
for (const [page, files] of Object.entries(hosts)) {
  const destinations = getHubDestinations(page, everything)
  assert.ok(destinations.length >= 2, `${page} offers at least two sections to the title menu`)
  const source = files.map(read).join('\n')
  for (const destination of destinations) {
    assert.match(source, new RegExp(`['"]${destination.id}['"]`), `${page}: the host page renders the "${destination.id}" section the title menu lists`)
    for (const [name, pack] of [['en', en], ['km', km]] as const) {
      const label = (pack as unknown as Record<string, string>)[destination.key]
      assert.ok(label && label !== destination.key, `${name} pack translates ${destination.key}`)
    }
  }
}

// Owner 14 Nov: the Inventory page's first subpage is called "Inventory", no longer "Products", so it
// cannot be confused with the main Products page. Only the label changes: the section id stays "products"
// (it is a route anchor, hub:inventory:products), and the main Products page keeps its own "Products".
{
  const inventoryProducts = getHubDestinations('inventory', everything).find((destination) => destination.id === 'products')
  assert.ok(inventoryProducts, 'the Inventory page keeps its first subpage id')
  assert.equal(inventoryProducts.key, 'inventory', 'the subpage label comes from the "inventory" key, not "products"')
  assert.equal(inventoryProducts.label, 'Inventory')
  assert.equal((en as unknown as Record<string, string>).inventory, 'Inventory')
  assert.ok((km as unknown as Record<string, string>).inventory && (km as unknown as Record<string, string>).inventory !== 'Inventory', 'Khmer carries its own label')
  const mainProducts = getHubDestinations('products', everything).find((destination) => destination.id === 'products')
  assert.equal(mainProducts?.key, 'products', 'the main Products page keeps "Products"')
}

const sidebar = read('components/navigation/Sidebar.tsx')
assert.match(sidebar, /<SectionTitleMenu[\s\S]*sections=\{moreOpen \? \[\] : currentSections\.map/, 'Sidebar feeds the title menu the current page destinations')
assert.doesNotMatch(sidebar, /<div className="bos-nav-title /, 'Sidebar no longer draws a dead title')
const titleMenu = read('components/navigation/SectionTitleMenu.tsx')
assert.doesNotMatch(titleMenu, /ui_mobile_section_nav|useLayeredSectionNav/, 'the title menu needs no setting')
assert.doesNotMatch(titleMenu, /lucide-react|<svg|shadow|border|rounded-xl|bg-white/, 'the title button has no arrow or icon; the dropdown look lives in nav-chrome.css')
assert.match(titleMenu, /aria-expanded={open}/, 'the title announces expanded/collapsed')

// Owner 14 Nov: the title opens a small dropdown sized to its list; the bar row never expands.
// The bar's own divider/background are untouched while open, and the panel is a floating box.
const chromeCss = read('components/navigation/nav-chrome.css')
assert.doesNotMatch(chromeCss, /bos-nav-topbar:has/, 'nothing about the bar changes while the title list is open')
const panelRule = chromeCss.match(/\.bos-nav-subpages \{([^}]*)\}/)?.[1] || ''
assert.match(panelRule, /border-radius/, 'the dropdown is a rounded box')
assert.match(panelRule, /box-shadow/, 'the dropdown floats with a shadow')
assert.match(panelRule, /border: 1px solid var\(--nav-line\)/, 'the dropdown has its own hairline')
assert.match(titleMenu, /role="menu"/, 'the list is a menu')
assert.match(titleMenu, /role="menuitem"/, 'each subpage is a menu item')
assert.match(titleMenu, /aria-haspopup="menu"/, 'the title announces that it opens a menu')
assert.match(titleMenu, /w-max min-w-\[11rem\]/, 'the panel is sized to its list, not the bar width')
assert.doesNotMatch(titleMenu, /left-0 right-0|inset-x-0/, 'the panel is not stretched across the bar')
assert.match(titleMenu, /getBoundingClientRect\(\)/, 'the panel is anchored to the title button')
assert.match(titleMenu, /trigger\.current\?\.focus\(\)/, 'closing returns focus to the title')

// The menu layer outranks the sticky rows (z-30), bar (z-50) and every float, modal and toast tier.
const zValues = [...(sidebar + read('components/navigation/SectionTitleMenu.tsx')).matchAll(/z-\[?(\d+)\]?/g)].map((m) => Number(m[1]))
assert.ok(SECTION_TITLE_MENU_Z > 1200 && SECTION_TITLE_MENU_Z < 1500, 'menu z sits above the modal, toast and hint tiers, below the update bar')
assert.ok(zValues.every((z) => z < SECTION_TITLE_MENU_Z), 'no nav chrome layer outranks the menu')
const modalZs = [...read('components/shared/Modal.tsx').matchAll(/z-\[(\d+)\]/g)].map((m) => Number(m[1]))
assert.ok(modalZs.every((z) => z < SECTION_TITLE_MENU_Z), 'the shared modal stays below the menu layer')
console.log('PASS title section menu sources')
