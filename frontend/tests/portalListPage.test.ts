// Public-web overhaul, lane SHELL, spec section 4: Saved and List are one full page with two segments, not three drawers.
//   - the page renders its real content from the first paint, in English and Khmer, for both segments;
//   - one payment line, shown once, on the List segment; no second notice, no hint under the title;
//   - List rows: picture or a plain tile, name, quantity stepper, remove. Saved rows: picture or tile, name, add-to-list, remove;
//   - the header has the heart (Saved) and a list icon (List); the floating button is Products-only and only with a non-empty list;
//   - opening pushes one history entry and Back (popstate) closes it; the old drawers are gone from PublicCatalogPage.tsx.
//
// Run: node tests/portalListPage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { rememberImage } from '../src/components/catalog/portalListImages.ts'
import { SRC, storefrontTranslator } from './storefrontCopyScan.ts'

const requireActual = createRequire(import.meta.url)
const t = storefrontTranslator()
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').split(String.fromCharCode(13)).join('')
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const copyFor = (language: 'en' | 'km') => (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, t, key, fallback, fallbackKm)

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    process.exitCode = 1
    console.log(`FAIL ${name}: ${(error as Error).message}`)
  }
}

function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)],
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
}
const ListPage = loadModule('components/catalog/PortalListPage.tsx').default as React.ComponentType<Record<string, unknown>>

const noop = () => {}
const baseProps = {
  segment: 'list', onSegment: noop, onBack: noop,
  listItems: [
    { id: 1, name: 'Rose Cleanser', priceText: '$4.50', qty: 2 },
    { id: 2, name: 'ក្រែមលាបមុខ', priceText: '$9.00', qty: 1 },
  ],
  savedItems: [{ id: 3, name: 'Lip Balm', priceText: '$2.00' }],
  imageFor: (id: string | number) => (String(id) === '1' ? '/uploads/rose.jpg' : ''),
  inList: (id: string | number) => String(id) === '1',
  onSetQty: noop, onRemoveFromList: noop, onClearList: noop, onAddSaved: noop, onRemoveSaved: noop, onClearSaved: noop,
  contactEntries: [{ key: 'phone', platform: 'phone', href: 'tel:012345678', label: '012 345 678', accessibleName: 'Phone: 012 345 678', latin: true }],
  onCopy: noop, onDownload: noop, copyState: 'idle',
}
const PAYMENT = { en: 'You cannot pay on this website. Send us your list to order.', km: 'មិនមានការទូទាត់អនឡាញទេ។ ផ្ញើបញ្ជីមកយើងដើម្បីបញ្ជាទិញ។' }
const render = (language: 'en' | 'km', extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(React.createElement(ListPage, { ...baseProps, copy: copyFor(language), ...extra }))

for (const language of ['en', 'km'] as const) {
  const copy = copyFor(language)
  await check(`${language}: the List segment shows the rows, one payment line, and Contact and the chat rows inline`, () => {
    const html = render(language)
    const text = visibleText(html)
    assert.ok(text.includes('Rose Cleanser') && text.includes('ក្រែមលាបមុខ'), 'both rows are there from the first paint')
    assert.equal(text.split(PAYMENT[language]).length - 1, 1, 'the payment line is said once')
    assert.doesNotMatch(text, /(^|\s)Contact(\s|$)|ទាក់ទង(\s|$)/, 'no Contact button any more')
    assert.match(html, /data-portal-list-contact=""[\s\S]*?data-portal-contact-inline="true"[\s\S]*?href="tel:012345678"/, 'the chat rows themselves, tappable, under the payment line')
    assert.ok(html.indexOf('data-portal-list-contact') > html.indexOf(PAYMENT[language]), 'the rows come after the no-payment line')
    assert.ok(text.includes('012 345 678'), 'the real number is shown')
    assert.doesNotMatch(render(language, { listItems: [] }), /data-portal-list-contact/, 'control: an empty list shows no rows')
    assert.match(html, /aria-pressed="true"[^>]*data-portal-list-segment="list"|data-portal-list-segment="list"[^>]*aria-pressed="true"/, 'List is the pressed segment')
    const fallbacks: Record<string, string> = { decreaseQty: 'Decrease quantity', increaseQty: 'Increase quantity', removeFromBucket: 'Remove', copyList: 'Copy the list', downloadList: 'Download' }
    for (const [key, fallback] of Object.entries(fallbacks)) {
      const label = copy(key, fallback)
      assert.ok(label && html.includes(`aria-label="${label}"`) && html.includes(`title="${label}"`), `${key}: an icon-only button has an aria-label and a tooltip`)
    }
    assert.ok(text.includes(copy('clearBucket', 'Clear all', 'សម្អាតទាំងអស់')), 'Clear all is a words button, not an icon (portalClearConfirm.test.ts covers the two-step)')
    assert.doesNotMatch(text, /No payment here|shortlist/, 'the old hint under the title is gone')
  })

  await check(`${language}: a row shows its picture when one is known here and a plain tile when not`, () => {
    const html = render(language)
    // The picture loads after mount (CatalogProductImage sets its url in an effect), so the first paint of a row with a picture is its quiet placeholder.
    assert.equal((html.match(/<svg[^>]*lucide-shopping-bag/g) || []).length, 1, 'only the row with no known picture has the plain tile')
    const none = render(language, { imageFor: () => '' })
    assert.equal((none.match(/<svg[^>]*lucide-shopping-bag/g) || []).length, 2, 'with no pictures known every row has the tile')
  })

  await check(`${language}: the Saved segment has image, name, add-to-list and remove, and no payment line`, () => {
    const html = render(language, { segment: 'saved' })
    const text = visibleText(html)
    assert.ok(text.includes('Lip Balm'))
    assert.ok(!text.includes(PAYMENT[language]), 'the payment line belongs to List only')
    assert.ok(html.includes(`aria-label="${copy('addToList', 'Add', 'បន្ថែម')}"`), 'add-to-list')
    assert.ok(html.includes(`aria-label="${copy('removeSavedItem', 'Remove', 'លុបចេញ')}"`), 'remove')
    assert.doesNotMatch(html, /data-portal-list-contact/, 'Contact lives on the List segment')
  })

  await check(`${language}: empty states are one line each`, () => {
    const emptyList = visibleText(render(language, { listItems: [] }))
    assert.ok(emptyList.includes(copy('listEmptyLine', 'Your list is empty.', 'បញ្ជីរបស់អ្នកនៅទទេ។')))
    assert.doesNotMatch(emptyList, /Tap "Add"/, 'the long empty text is gone')
    const emptySaved = visibleText(render(language, { segment: 'saved', savedItems: [] }))
    assert.ok(emptySaved.includes(copy('savedEmptyLine', 'Nothing saved yet.', 'មិនទាន់មានអ្វីរក្សាទុកទេ។')))
  })
}

await check('remembered pictures keep the newest 300 and ignore empty paths', () => {
  let images: Record<string, string> = {}
  assert.deepEqual(rememberImage(images, 1, ''), {}, 'no path, nothing remembered')
  images = rememberImage(images, 1, '/a.jpg')
  assert.equal(rememberImage(images, 1, '/a.jpg'), images, 'the same picture is not a new state')
  for (let id = 2; id <= 305; id += 1) images = rememberImage(images, id, `/p${id}.jpg`)
  assert.equal(Object.keys(images).length, 300)
  assert.equal(images['1'], undefined, 'the oldest went first')
  assert.equal(images['305'], '/p305.jpg')
})

await check('the dock has one shop button for List and a Saved row on the phone menu, both with an accessible name', () => {
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  const dock = read('components/catalog/PortalDock.tsx')
  assert.match(dock, /data-portal-dock-button="shop"[^>]*onClick=\{onOpenList\}[^>]*aria-label=\{copy\('bucketTitle', 'My List'\)\}/, 'the shop button opens List')
  assert.match(dock, /<MenuRow icon=\{Heart\} label=\{copy\('saved', 'Saved'\)\}[^\n]*onClick=\{run\(props\.onOpenWishlist\)\}/, 'the phone menu Saved row opens Saved')
  assert.match(surface, /onOpenList=\{onOpenList\}/, 'the surface hands both openers to the dock')
  assert.match(surface, /onOpenWishlist=\{onOpenWishlist\}/)
  assert.match(surface, /\{listPage \? listPage : \(/, 'the page replaces the tab content while it is open')
})

await check('the page opens the full page, pushes one history entry, and Back closes it', () => {
  const page = read('components/catalog/PublicCatalogPage.tsx')
  assert.match(page, /window\.history\.pushState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), portalListView: true \}/)
  assert.match(page, /window\.addEventListener\('popstate', onPopState\)/)
  assert.match(page, /onOpenWishlist=\{\(\) => openListView\('saved'\)\}/, 'the heart opens Saved')
  assert.match(page, /onOpenList=\{\(\) => openListView\('list'\)\}/, 'the dock shop button opens List')
  assert.match(page, /listPage=\{listPage\}/)
  const onPop = page.slice(page.indexOf('const onPopState'), page.indexOf("window.addEventListener('popstate'"))
  assert.match(onPop, /setListView\(null\)/)
  assert.match(onPop, /window\.scrollTo\(0, top\)/, 'the visitor lands where they were')
  assert.match(onPop, /opener\.focus/, 'focus goes back to the button that opened it')
})

await check('there is no separate floating List button: the dock shop button (with the count) is the one way in', () => {
  const page = read('components/catalog/PublicCatalogPage.tsx')
  assert.doesNotMatch(page, /bucketFab/, 'the old floating button is gone from the page')
  assert.match(read('components/catalog/PortalDock.tsx'), /listCount > 0 \? <span translate="no" className=\{COUNT_BADGE\}>\{listCount\}<\/span> : null/, 'the count rides on the dock button')
})

await check('the three old drawers and their hints are gone from the page', () => {
  const page = read('components/catalog/PublicCatalogPage.tsx')
  for (const gone of ['bucketDrawer', 'wishlistDrawer', 'closeBucketDrawer', 'setBucketOpen', 'setWishlistOpen', 'bucketHint', 'bucketEmpty', 'wishlistEmpty', 'PortalNoPaymentNotice']) {
    assert.ok(!page.includes(gone), `${gone} is still in PublicCatalogPage.tsx`)
  }
  assert.ok(page.includes('const accountDrawer = accountOpen ? ('), 'the account sheet stays')
  assert.match(page, /<PortalSheet/, 'as PortalSheet')
})

await check('the payment line is one component used once, on the List page only', () => {
  const sources = ['components/catalog/PublicCatalogPage.tsx', 'components/catalog/CatalogAccountSection.tsx', 'components/catalog/CatalogPreviewSurface.tsx']
  for (const rel of sources) assert.doesNotMatch(read(rel), /PortalNoPaymentNotice|noPaymentLine/, `${rel} shows a payment notice`)
  assert.equal((read('components/catalog/PortalListPage.tsx').match(/<PortalNoPaymentNotice /g) || []).length, 1)
})

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}`)
