import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { clearAllFocusLeft, clearAllPressIsOutside, clearAllStep } from '../src/components/catalog/portalClearConfirm.ts'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { storefrontTranslator } from './storefrontCopyScan.ts'

// One tap on Clear all asks; only Clear empties the list.
assert.deepEqual(clearAllStep(false, 'ask'), { confirming: true, clear: false }, 'one tap only asks')
assert.deepEqual(clearAllStep(true, 'confirm'), { confirming: false, clear: true }, 'Clear empties it')
assert.deepEqual(clearAllStep(false, 'confirm'), { confirming: false, clear: false }, 'a confirm without an ask never clears')
for (const event of ['keep', 'escape', 'leave'] as const) {
  assert.deepEqual(clearAllStep(true, event), { confirming: false, clear: false }, `${event} returns to rest without clearing`)
}

// Rendered: at rest the control is a words button, not the row's red trash icon, and nothing is asking yet.
const here = path.dirname(fileURLToPath(import.meta.url))
const requireActual = createRequire(import.meta.url)
const bundle = buildSync({
  entryPoints: [path.join(here, '..', 'src', 'components', 'catalog', 'PortalListPage.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
})
const mod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, mod, mod.exports)
const ListPage = mod.exports.default as React.ComponentType<Record<string, unknown>>
const t = storefrontTranslator()
const noop = () => {}
const render = (language: 'en' | 'km', segment: 'list' | 'saved') => renderToStaticMarkup(React.createElement(ListPage, {
  copy: (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, t, key, fallback, fallbackKm),
  segment, onSegment: noop, onBack: noop,
  listItems: [{ id: 1, name: 'Rose Cleanser', qty: 2 }, { id: 2, name: 'Lip Tint', qty: 1 }],
  savedItems: [{ id: 3, name: 'Lip Balm' }],
  imageFor: () => '', inList: () => false, onSetQty: noop, onRemoveFromList: noop, onClearList: noop, onAddSaved: noop, onRemoveSaved: noop, onClearSaved: noop,
  contactEntries: [], onCopy: noop, onDownload: noop, copyState: 'idle',
}))
for (const segment of ['list', 'saved'] as const) {
  const en = render('en', segment)
  assert.match(en, /data-portal-clear-all="rest"[^>]*>[^<]*Clear all/, `${segment}: a text button reading Clear all`)
  assert.doesNotMatch(en, /data-portal-clear-all="confirm"/, `${segment}: not asking at rest`)
  const km = render('km', segment)
  assert.match(km, /data-portal-clear-all="rest"[^>]*>[^<]*សម្អាតទាំងអស់/, `${segment}: Khmer text button`)
}
// Each row's Remove is still the only trash icon beside a name; Clear all no longer uses it.
const list = render('en', 'list')
assert.equal((list.match(/lucide-trash-?2/g) || []).length, 2, 'two rows, two trash icons, none for Clear all')

// Pressing Clear in Safari (and Firefox on a Mac) blurs Keep with NO next element, because those browsers do not focus a pressed button.
// That blur must not put the question away, or Clear never gets its click and the list is never emptied (delta review D2).
const inside = { id: 'clear' }
const outside = { id: 'search' }
const root = { contains: (node: unknown) => node === inside }
assert.equal(clearAllFocusLeft(root, null), false, 'a blur with no next element is not a leave (the Safari press on Clear)')
assert.equal(clearAllFocusLeft(root, undefined), false)
assert.equal(clearAllFocusLeft(root, inside), false, 'focus moving between Clear and Keep stays in the question')
assert.equal(clearAllFocusLeft(root, outside), true, 'Tab to another control puts the question away')
assert.equal(clearAllFocusLeft(null, outside), false, 'nothing mounted, nothing to leave')
assert.equal(clearAllPressIsOutside(root, inside), false, 'a press on Clear or Keep is theirs')
assert.equal(clearAllPressIsOutside(root, outside), true, 'a press anywhere else puts the question away')
assert.equal(clearAllPressIsOutside(root, null), true)
assert.equal(clearAllPressIsOutside(null, outside), false)
// The whole Safari sequence: ask, then the press on Clear (blur with no target, press inside), then the click.
let confirming = clearAllStep(false, 'ask').confirming
if (clearAllFocusLeft(root, null)) confirming = clearAllStep(confirming, 'leave').confirming
if (clearAllPressIsOutside(root, inside)) confirming = false
assert.deepEqual(clearAllStep(confirming, 'confirm'), { confirming: false, clear: true }, 'Clear still empties the list after that blur')

// The Escape, press-outside and focus-leaving wiring is in the component.
const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'PortalListPage.tsx'), 'utf8')
assert.match(source, /event\.key === 'Escape'/)
assert.match(source, /onBlur=\{\(event\) => \{ if \(clearAllFocusLeft\(rootRef\.current, event\.relatedTarget\)\) step\('leave'\) \}\}/, 'blur goes through the rule above')
assert.match(source, /document\.addEventListener\('pointerdown', onPointerDown, true\)/, 'a press elsewhere is what closes it for mouse and touch')
assert.doesNotMatch(source, /contains\(event\.relatedTarget as Node \| null\)/, 'the bare relatedTarget check that broke Clear in Safari is gone')
assert.doesNotMatch(source, /window\.confirm|[^.\w]confirm\(/, 'never the native confirm')

console.log('PASS Clear all asks first; only Clear empties the list')
