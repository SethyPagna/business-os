import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Every storefront control the review listed is 44 x 44 px below 640 px wide; desktop keeps 40.
const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string) => fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', name), 'utf8').replace(/\r\n/g, '\n')
const classOf = (source: string, constant: string) => {
  const match = new RegExp(`${constant} = [\`']([^\`']*)[\`']`).exec(source)
  assert.ok(match, `${constant} exists`)
  return match[1]
}
const phone44 = (classes: string, label: string) => {
  assert.match(classes, /\bh-11\b/, `${label}: 44 px tall on a phone`)
  assert.match(classes, /\b(w-11|min-w-11)\b|sm:w-auto/, `${label}: 44 px wide on a phone`)
  assert.doesNotMatch(classes, /(^|\s)(h-10|w-10|w-9)(\s|$)/, `${label}: no bare 40 / 36 px size left for phones`)
}

// The dock is 48 px on a wide screen and 56 px on a phone, above the 44 px floor everywhere (the header no longer holds buttons).
const dock = read('PortalDock.tsx')
assert.match(classOf(dock, 'ROUND_WIDE'), /\bh-12 w-12\b/, 'dock buttons: 48 px')
assert.match(classOf(dock, 'ROUND_SMALL'), /\bh-14 w-14\b/, 'dock menu button: 56 px')
assert.match(classOf(dock, 'CONTACT_BUTTON'), /\bh-12\b/, 'dock Contact: 48 px tall')
assert.doesNotMatch(read('CatalogPreviewSurface.tsx'), /HEADER_ICON_CLASS|HEADER_CONTACT_CLASS|data-portal-header-icons/, 'the header icon classes are gone')

const list = read('PortalListPage.tsx')
phone44(classOf(list, 'ICON_BUTTON'), 'list icon button (minus, plus, copy, download)')
phone44(classOf(list, 'DANGER_BUTTON'), 'list remove')
assert.match(list, /\$\{DANGER_BUTTON\} ml-2`\} onClick=\{\(\) => onRemoveFromList/, 'Remove sits 8 px from Plus')

const sheet = read('PortalSheet.tsx')
assert.match(sheet, /inline-flex h-11 w-11 items-center justify-center rounded-full[^"]*sm:h-10 sm:w-10/, 'sheet close is 44 px on a phone')

const products = read('CatalogProductsSection.tsx')
assert.match(products, /inline-flex h-11 w-11 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full/, 'card heart')
assert.match(products, /inline-flex h-11 min-w-11 sm:h-10 sm:min-w-10/, 'card Add')

console.log('PASS the listed storefront controls are 44 px on a phone')
