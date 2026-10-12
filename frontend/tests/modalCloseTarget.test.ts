import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness, propsOf } from './mountedComponentHarness.ts'

// Daily-use A item 6. The shared Modal's header Close is the control used to
// leave every dialog in the app, and it was 32x32 px: too small for a thumb.
// It must present a target of at least 44x44 px while taking no more room in
// the header than before (the icon stays where it was), and being icon-only it
// carries its translated name as a tooltip as well as an aria-label.

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>

/** Tailwind's default spacing scale: one step is 4 px; `px` is 1 px. */
function pixels(token: string): number | null {
  const match = /^(-?)(?:min-)?(?:[hwm][xytrbl]?)-(px|\d+(?:\.\d+)?)$/.exec(token)
  if (!match) return null
  const size = match[2] === 'px' ? 1 : Number(match[2]) * 4
  return match[1] ? -size : size
}
function dimension(classes: string[], axis: 'w' | 'h'): number {
  const sizes = classes.filter((name) => new RegExp(`^(?:min-)?${axis}-`).test(name)).map(pixels).filter((value): value is number => value !== null)
  return Math.max(0, ...sizes)
}
/** How many px a negative margin pulls the box in on this axis, both sides together. */
function bleed(classes: string[], axis: 'x' | 'y'): number {
  let total = 0
  for (const name of classes) {
    const px = pixels(name)
    const side = /^-m([xytrbl]?)-/.exec(name)?.[1]
    if (px === null || px >= 0 || side === undefined) continue
    if (side === '') total += 2 * -px
    else if (axis === 'x' && 'xlr'.includes(side)) total += side === 'x' ? 2 * -px : -px
    else if (axis === 'y' && 'ytb'.includes(side)) total += side === 'y' ? 2 * -px : -px
  }
  return total
}

const harness = await createHarness()
try {
  for (const lang of ['en', 'km']) {
    const words = packs[lang]
    const surface = await harness.mount({
      component: 'components/shared/Modal.tsx',
      props: { title: 'Probe', onClose() {}, unsavedChanges: 'read-only', children: null },
      app: { t: (key: string) => words[key] || key },
      doubles: {},
    })
    const close = surface.find((node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.close, `the ${lang} Close button`)
    const classes = close.className.split(/\s+/).filter(Boolean)
    assert.ok(dimension(classes, 'w') >= 44, `${lang}: the Close target is at least 44 px wide (classes: ${close.className})`)
    assert.ok(dimension(classes, 'h') >= 44, `${lang}: the Close target is at least 44 px tall`)
    assert.ok(dimension(classes, 'w') - bleed(classes, 'x') <= 32, `${lang}: the header still gives Close a 32 px footprint, so dialogs do not grow taller or shift the title`)
    assert.ok(dimension(classes, 'h') - bleed(classes, 'y') <= 32, `${lang}: and no taller than before`)
    assert.equal(propsOf(close).title, words.close, `${lang}: the icon-only control names itself in a tooltip`)
    assert.equal(close.getAttribute('aria-label'), words.close)
    await surface.unmount()
  }
  console.log('PASS the Modal Close is a 44 px target on a 32 px footprint with a translated tooltip, in English and Khmer')
} finally {
  await harness.close()
}
