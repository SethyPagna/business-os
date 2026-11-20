// Public-web overhaul, lane SHELL, spec sections 0 and 1: every surface in the storefront shell is solid.
// No opacity suffix, no backdrop blur and no bg-transparent on anything that carries text or a control, in light
// or dark; one page ground (ivory) under white cards; the sticky tab strip is the page ground; the dark-mode
// overrides in public-portal.css are solid colours, not rgba.
//
// The only translucent thing allowed is a modal SCRIM (the dimming layer behind a dialog, which carries no
// text or control): `bg-slate-950/50`, and never with a blur.
//
// Run: node tests/portalShellSolidSurfaces.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.join(here, '..', 'src')
const read = (rel: string): string => fs.readFileSync(path.join(src, rel), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// The shell files this lane owns. A file listed here that does not exist yet is skipped, so the list can grow
// with each step of the lane; the last step asserts every name is present.
const SHELL_FILES = [
  'components/catalog/CatalogPreviewSurface.tsx',
  // PublicCatalogPage.tsx joins when its drawers are replaced (steps 3 and 4)
  'components/catalog/PortalContactMenu.tsx',
  'components/catalog/PortalSocialRow.tsx',
  // The rest of the lane's files join this list in the commit that makes them solid.
]
const present = SHELL_FILES.filter((file) => fs.existsSync(path.join(src, file)))

// A utility class that makes a background, border or text partly see-through: bg-white/95, dark:bg-neutral-900/80, ...
const OPACITY_SUFFIX = /(?:^|[\s"'`:])(?:[a-z-]+:)*(?:bg|border|ring|text|from|to|via)-(?:[a-z]+-\d{2,3}|\[#[0-9a-fA-F]{3,8}\]|white|black)\/\d{1,3}(?=[\s"'`])/g
const SCRIM = /bg-slate-950\/50/

function offenders(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(OPACITY_SUFFIX)) found.push(match[0].replace(/^[\s"'`]+/, ''))
  return found.filter((cls) => !SCRIM.test(cls))
}

runTest('the guard itself catches the old classes (positive control)', () => {
  assert.deepEqual(offenders('<div className="bg-white/95 backdrop-blur dark:bg-neutral-900/92 dark:border-neutral-800/80">'), ['bg-white/95', 'dark:bg-neutral-900/92', 'dark:border-neutral-800/80'])
  assert.deepEqual(offenders('<div className="fixed inset-0 bg-slate-950/50">'), [], 'a scrim is allowed')
  assert.deepEqual(offenders('<div className="border border-stone-300 bg-white dark:bg-neutral-900">'), [])
})

runTest('no opacity suffix on a colour class in any shell file', () => {
  for (const file of present) assert.deepEqual(offenders(read(file)), [], `${file} still has a see-through colour class`)
})

runTest('no backdrop blur and no bg-transparent in any shell file', () => {
  for (const file of present) {
    const source = read(file)
    assert.doesNotMatch(source, /backdrop-blur/, `${file} still blurs what is behind it`)
    assert.doesNotMatch(source, /bg-transparent/, `${file} still has a transparent surface`)
    assert.doesNotMatch(source, /supports-\[backdrop-filter\]/, `${file} still keys a surface off backdrop-filter support`)
  }
})

runTest('the sticky tab strip is the solid page ground with one line, edge to edge', () => {
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  assert.match(surface, /portal-nav-shell border-b border-stone-300 bg-\[#f4f1ea\] dark:border-neutral-800 dark:bg-\[#0b0b0c\]/)
  assert.match(surface, /className=\{publicView \? 'sticky top-0 z-40' : ''\}/, 'it pins at top-0, so nothing shows above it')
  assert.doesNotMatch(surface, /sticky top-1(?![0-9])/, 'the old 4 px gap above the strip is gone')
  assert.match(surface, /NAV_FULL_BLEED_CLASS = '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-14 xl:px-14'/, 'it runs under the page gutters')
})

runTest('the floating scroll buttons use the surface recipe and are shown without a fade', () => {
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  assert.match(surface, /SCROLL_BUTTON_CLASS = '[^']*border border-stone-300 bg-white[^']*dark:border-neutral-700 dark:bg-neutral-900/)
  assert.match(surface, /publicScrollButtonsVisible \? 'visible pointer-events-auto' : 'invisible pointer-events-none'/)
  assert.doesNotMatch(surface, /opacity-0|opacity-100/, 'visibility is not a translucent state')
})

runTest('public-portal.css paints no translucent background on a surface in dark mode', () => {
  const css = read('styles/public-portal.css')
  const backgrounds = [...css.matchAll(/background-color:\s*([^;]+);/g)].map((match) => match[1].trim())
  const translucent = backgrounds.filter((value) => /rgba\(/.test(value) || /\/\s*\d/.test(value))
  assert.deepEqual(translucent, [], 'every background-color is a solid colour')
  assert.doesNotMatch(css, /rgba\(23, 23, 23, 0\.92\)|rgba\(20, 20, 20, 0\.97\)/, 'the old 92 and 97 percent dark fills are gone')
  assert.match(css, /\.bg-white,[\s\S]*?background-color: #171717 !important;/, 'a white surface is #171717 in dark mode, solid')
  assert.match(css, /\.portal-nav-shell \{\s*background-color: #0b0b0c !important;/, 'the dark tab strip is the dark page ground')
})

runTest('the tab strip scrolls without a scrollbar and fades the hidden edge instead of cutting a label', () => {
  const css = read('styles/public-portal.css')
  assert.match(css, /\.portal-nav-scroll::-webkit-scrollbar \{\s*display: none;/)
  assert.match(css, /\.portal-nav-scroll\[data-fade-end='true'\][\s\S]*?mask-image: linear-gradient\(to right, #000 calc\(100% - 28px\), transparent\)/)
  assert.match(css, /\.portal-nav-scroll\[data-fade-start='true'\]\[data-fade-end='true'\]/)
  const surface = read('components/catalog/CatalogPreviewSurface.tsx')
  assert.match(surface, /data-fade-start=\{tabFade\.start \? 'true' : undefined\}/)
  assert.match(surface, /data-fade-end=\{tabFade\.end \? 'true' : undefined\}/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('portalShellSolidSurfaces: all green')
