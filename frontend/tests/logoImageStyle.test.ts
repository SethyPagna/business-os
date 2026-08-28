// Guards the portal-logo crop math and the "preview == applied" contract.
//
// Two bugs this locks down (16.2):
//   1. Vertical/horizontal focus did nothing once zoomed, because the
//      transform scaled from `transform-origin: center` while
//      object-position set a different focus. The fix ties transform-origin
//      to the SAME focus point, so both axes stay meaningful at any zoom.
//   2. The editor preview and the live header computed this separately with
//      DIFFERENT zoom clamps (0.8-1.8 vs 1-1.35), so the preview never
//      matched what shipped. Now both call buildLogoImageStyle, so they are
//      byte-identical for the same config.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildLogoImageStyle, logoFocus, logoZoomScale } from '../src/components/catalog/logoImageStyle.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

runTest('transform-origin equals the object-position focus, so zoom respects horizontal/vertical', () => {
  const style = buildLogoImageStyle({ fit: 'cover', zoom: 150, positionX: 20, positionY: 80 })
  assert.equal(style.objectPosition, '20% 80%')
  assert.equal(style.transformOrigin, '20% 80%', 'zoom must originate at the focus, not the centre')
  assert.equal(style.transform, 'scale(1.5)')
  assert.equal(style.objectFit, 'cover')
})

runTest('fit=contain is honoured; anything else is cover', () => {
  assert.equal(buildLogoImageStyle({ fit: 'contain' }).objectFit, 'contain')
  assert.equal(buildLogoImageStyle({ fit: 'cover' }).objectFit, 'cover')
  assert.equal(buildLogoImageStyle({}).objectFit, 'cover')
})

runTest('focus and zoom are clamped to the editor slider ranges (0-100%, 80-180%)', () => {
  assert.deepEqual(logoFocus({ positionX: -20, positionY: 200 }), { x: 0, y: 100 })
  assert.deepEqual(logoFocus({}), { x: 50, y: 50 })
  assert.equal(logoZoomScale({ zoom: 40 }), 0.8, 'below 80% clamps to 0.8')
  assert.equal(logoZoomScale({ zoom: 500 }), 1.8, 'above 180% clamps to 1.8 -- the live header no longer caps at 1.35')
  assert.equal(logoZoomScale({}), 1)
})

runTest('bad numeric input falls back rather than producing NaN', () => {
  const style = buildLogoImageStyle({ zoom: 'abc', positionX: '', positionY: null })
  assert.equal(style.objectPosition, '50% 50%')
  assert.equal(style.transform, 'scale(1)')
})

runTest('both the editor preview and the live header render through the SAME helper', () => {
  const editor = fs.readFileSync(new URL('../src/components/catalog/CatalogEditorSurface.tsx', import.meta.url), 'utf8')
  // 6.2 (Part 399): the top bar carries no logo any more -- the live logo
  // surface is the About hero (CatalogSecondaryTabs), which must render
  // through the same shared helper as the editor preview.
  const surface = fs.readFileSync(new URL('../src/components/catalog/CatalogSecondaryTabs.tsx', import.meta.url), 'utf8')
  for (const [name, src] of [['editor', editor], ['live surface (About hero)', surface]] as const) {
    assert.match(src, /buildLogoImageStyle\(/, `${name} must build its logo style via buildLogoImageStyle`)
    // Neither may reintroduce a hand-rolled transform-origin: center, which
    // is the exact bug that broke the focus sliders.
    assert.ok(!/transformOrigin: 'center'/.test(src), `${name} must not hard-code transform-origin: center`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll logoImageStyle tests passed')
}
