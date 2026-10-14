import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { accessibleText, createHarness, propsOf } from './mountedComponentHarness.ts'
import { bleed, bleedOnSide, classesOf, dimension, gapPx, horizontalPadding } from './tailwindPixels.ts'

// Daily-use A item 6. The shared Modal's header Close is the control used to
// leave every dialog in the app, and it was 32x32 px: too small for a thumb.
// It must present a target of at least 44x44 px while taking no more room in
// the header than before (the icon stays where it was), and being icon-only it
// carries its translated name as a tooltip as well as an aria-label.
//
// The -m-1.5 reaches 6 px past the Close's box, so the gap beside a header control must be wider than that; and the
// tooltip repeats the aria-label word for word, so the control has one accessible name.

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

// A real header neighbour: the Minimize button every draft-keeping form puts beside the Close (44 px wide, no margin).
const neighbour = createElement('button', { type: 'button', 'aria-label': 'Neighbour', className: 'flex h-11 w-11 shrink-0 items-center justify-center' })

const harness = await createHarness()
try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const surface = await harness.mount({
      component: 'components/shared/Modal.tsx',
      props: { title: 'Probe', onClose() {}, unsavedChanges: 'read-only', children: null, headerExtra: neighbour },
      app: { t: (key: string) => words[key] || key },
      doubles: {},
    })
    const close = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.close, `the ${lang} Close button`)
    const classes = classesOf(close.className)
    assert.ok(dimension(classes, 'w') >= 44, `${lang}: the Close target is at least 44 px wide (classes: ${close.className})`)
    assert.ok(dimension(classes, 'h') >= 44, `${lang}: the Close target is at least 44 px tall`)
    assert.ok(dimension(classes, 'w') - bleed(classes, 'x') <= 32, `${lang}: the header still gives Close a 32 px footprint, so dialogs do not grow taller or shift the title`)
    assert.ok(dimension(classes, 'h') - bleed(classes, 'y') <= 32, `${lang}: and no taller than before`)
    assert.equal(propsOf(close).title, words.close, `${lang}: the icon-only control names itself in a tooltip`)
    assert.equal(close.getAttribute('aria-label'), words.close)

    // Icon-only, so the name is the aria-label, and the tooltip is the same word rather than a second name.
    assert.equal(close.textContent, '', `${lang}: Close has no visible text to add a second name`)
    assert.equal(close.getAttribute('title'), close.getAttribute('aria-label'), `${lang}: the tooltip repeats the aria-label, it does not add a different name`)
    assert.equal(accessibleText(close), words.close, `${lang}: so the control is named ${JSON.stringify(words.close)} once`)

    // The gap between the two controls, less how far the Close's hit area reaches back over its footprint, must leave room.
    const sibling = surface.find((node) => node.getAttribute('aria-label') === 'Neighbour', 'the header neighbour')
    const row = close.parentNode!
    assert.equal(row, sibling.parentNode, `${lang}: the neighbour and Close share one header row`)
    const clearance = gapPx(classesOf(row.className)) - bleedOnSide(classes, 'l')
    assert.ok(clearance >= 2, `${lang}: the Close hit area starts ${clearance} px clear of its neighbour's (needs at least 2; row ${row.className})`)

    // The other three sides reach into the header's own padding, not out of the dialog or over the title.
    const header = row.parentNode!
    const padding = horizontalPadding(classesOf(header.className)) / 2
    assert.ok(bleedOnSide(classes, 'r') <= padding, `${lang}: the right bleed (${bleedOnSide(classes, 'r')} px) stays inside the header padding (${padding} px)`)
    assert.ok(bleedOnSide(classes, 't') <= padding && bleedOnSide(classes, 'b') <= padding, `${lang}: and so do the top and bottom`)
    await surface.unmount()
  }
  console.log('PASS the Modal Close is a 44 px target on a 32 px footprint, clear of its neighbour, with one translated name, in English and Khmer')
} finally {
  await harness.close()
}
