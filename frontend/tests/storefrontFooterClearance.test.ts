// The storefront ends with room for its floating buttons (the bottom-right dock, and the scroll buttons on the other side), so at the page end none of them covers a
// footer link on a phone. Heights come from the buttons' own classes; the browser twin is
// e2e/storefront-footer-clearance.spec.ts.
//
// Run: node tests/storefrontFooterClearance.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const CATALOG = path.join(import.meta.dirname, '..', 'src', 'components', 'catalog')
const read = (file: string) => fs.readFileSync(path.join(CATALOG, file), 'utf8').replace(/\r\n/g, '\n')

const surface = read('CatalogPreviewSurface.tsx')
const publicPage = read('PublicCatalogPage.tsx')
const dock = read('PortalDock.tsx')

const REM_PER_SPACING_UNIT = 0.25

function block(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, `block ${startMarker} ... ${endMarker} not found`)
  return source.slice(start, end)
}
const classNames = (source: string) => [...source.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map((match) => match[1] ?? match[2])
function spacingRem(classes: string, utility: 'h' | 'gap' | 'py'): number {
  const match = new RegExp(`(?:^|\\s)${utility}-(\\d+(?:\\.\\d+)?)(?=\\s|$)`).exec(classes)
  assert.ok(match, `expected ${utility}-* in: ${classes.slice(0, 140)}`)
  return Number(match[1]) * REM_PER_SPACING_UNIT
}
// A stack may also ride above the install notice: `+var(--install-band-clearance,0px)`. The page root pads its end by that same amount
// (asserted below), so the stack keeps its distance from the page end and the rem figure is still the whole reserve.
function calcRem(classes: string, utility: string): number | null {
  const match = new RegExp(`(?:^|\\s)${utility}-\\[calc\\((\\d+(?:\\.\\d+)?)rem\\+env\\(safe-area-inset-bottom\\)(?:\\+var\\(--install-band-clearance,0px\\))?\\)\\]`).exec(classes)
  return match ? Number(match[1]) : null
}
function bottomRem(classes: string, variant = ''): number {
  const rem = calcRem(classes, `${variant}bottom`)
  assert.ok(rem !== null, `expected ${variant}bottom-[calc(<rem>+env(safe-area-inset-bottom))] in: ${classes.slice(0, 140)}`)
  return rem
}

const scrollStack = block(surface, 'fixed bottom-[calc(', '\n      ) : null}')
const scrollWrapper = classNames(`className={\`${scrollStack}`)[0]
// Both buttons wear SCROLL_BUTTON_CLASS (the round 2 review found this once measured the 1 rem arrow icons inside them, not the 2.5 rem buttons).
const scrollButtonClass = /const SCROLL_BUTTON_CLASS = '([^']+)'/.exec(surface)?.[1] ?? ''
const scrollButtons = [...scrollStack.matchAll(/className={SCROLL_BUTTON_CLASS}/g)].map(() => scrollButtonClass)
assert.equal(scrollButtons.length, 2, 'the scroll-to-top and scroll-to-bottom buttons')
const scrollHeight = scrollButtons.reduce((sum, classes) => sum + spacingRem(classes, 'h'), 0) + spacingRem(scrollWrapper, 'gap') * (scrollButtons.length - 1)

// The dock: a stack of five 48 px buttons with 8 px gaps from md up, and one 56 px button below md. Heights come from its own classes.
const constant = (name: string) => {
  const match = new RegExp(name + ' = [' + String.fromCharCode(96) + "'][^" + String.fromCharCode(96) + "']*").exec(dock)
  assert.ok(match, name + ' exists')
  return match[0]
}
const dockWrapper = classNames(block(dock, 'data-portal-dock=""', '>'))[0] ?? /className="([^"]+)"/.exec(block(dock, 'data-portal-dock=""', '\n    >\n'))?.[1] ?? ''
const wideStackClasses = /data-portal-dock-wide="" className="([^"]+)"/.exec(dock)?.[1] ?? ''
assert.ok(dockWrapper && wideStackClasses, 'the dock wrapper and its wide stack are found')
const DOCK_WIDE_BUTTONS = 5
const wideButtonRem = spacingRem(constant('ROUND_WIDE'), 'h')
const phoneButtonRem = spacingRem(constant('ROUND_SMALL'), 'h')
assert.equal(spacingRem(constant('CONTACT_BUTTON'), 'h'), wideButtonRem, 'the Contact pill is as tall as the round buttons, so the stack height is five equal rows')
const dockBottomRem = bottomRem(dockWrapper)
assert.match(dockWrapper, /max-\[767px\]:bottom-\[max\(calc\(1rem\+env\(safe-area-inset-bottom\)\),calc\(var\(--install-band-clearance,0px\)\+0\.5rem\)\)\]/, 'on a phone the dock rides above the notice')
// The floating chat buttons are gone (the Contact menu is the one entry point) and so is the old List button.
assert.doesNotMatch(surface, /floatingStackClearanceRem/, 'the surface no longer takes a reserve for a column of contact buttons')
assert.doesNotMatch(publicPage, /floatingStackClearanceRem|portalFloatClearanceRem|PortalContactFloat|bucketFab/, 'and the page no longer computes one or draws a List button')

const floatingTopsRem = {
  scrollButtonsPhone: bottomRem(scrollWrapper) + scrollHeight,
  scrollButtonsWide: bottomRem(scrollWrapper, 'sm:') + scrollHeight,
  dockPhone: dockBottomRem + phoneButtonRem,
  dockWide: dockBottomRem + wideButtonRem * DOCK_WIDE_BUTTONS + spacingRem(wideStackClasses, 'gap') * (DOCK_WIDE_BUTTONS - 1),
}

const shellClasses = classNames(block(surface, 'className={`mx-auto max-w-[1680px]', '\n'))[0]
const publicOnly = /\$\{publicView \? '([^']*)'/.exec(shellClasses)
assert.ok(publicOnly, 'the shell carries publicView-only classes')
const reserve = (variant: string) => calcRem(publicOnly[1], `${variant}pb`) ?? 0

// Round 2 rule: the page ends the tallest floating control plus 1 rem above the safe area, at EVERY width (no blank band under the footer): the last
// footer line, the pager and the last card's Add button scroll clear of the dock and the scroll buttons.
const tallestFloating = Math.max(floatingTopsRem.scrollButtonsPhone, floatingTopsRem.scrollButtonsWide, floatingTopsRem.dockPhone)
assert.ok(reserve('') >= tallestFloating + 1, `the storefront ends ${reserve('')}rem above the safe area; its tallest floating control reaches ${tallestFloating}rem, plus 1rem of air ${JSON.stringify(floatingTopsRem)}`)
assert.ok(reserve('sm:') >= tallestFloating + 1, `from 640px sm:py-4 replaces the phone reserve, so sm: must keep it (${reserve('sm:')}rem)`)
assert.equal(reserve('md:'), 0, 'no wider override: no blank band under the footer on a desktop')
assert.ok(reserve('') <= tallestFloating + 1.5, 'and no more than half a rem of slack beyond the rule')

// The wide stack only exists where there is room BESIDE the content: the container is max-w-[1680px] with xl:px-14 (56 px) of padding, so beside the
// content there are (viewport - 1680) / 2 + 56 px. The stack needs its right offset + the Contact pill (w-32 = 128 px) + 16 px of air.
const containerMax = Number(/max-w-\[(\d+)px\]/.exec(shellClasses)?.[1])
const containerPadX = Number(/xl:px-(\d+)/.exec(shellClasses)?.[1]) * 4
const wideFrom = Number(/min-\[(\d+)px\]:flex/.exec(dock)?.[1])
const hideFrom = Number(/min-\[(\d+)px\]:hidden/.exec(dock)?.[1])
const pillPx = Number(/w-(\d+)/.exec(constant('CONTACT_BUTTON'))?.[1]) * 4
const rightOffsetPx = Number(/right-\[calc\((\d+)rem\+/.exec(dockWrapper)?.[1]) * 16
assert.ok(containerMax === 1680 && containerPadX === 56 && wideFrom && pillPx === 128 && rightOffsetPx === 16, 'the layout numbers were read from the source')
assert.equal(hideFrom, wideFrom, 'the phone button hides exactly where the stack appears: always one of the two')
const roomBeside = (viewport: number) => (Math.max(viewport, containerMax) - containerMax) / 2 + containerPadX
const needed = rightOffsetPx + pillPx + 16
assert.ok(roomBeside(wideFrom) >= needed, `at ${wideFrom}px there are ${roomBeside(wideFrom)}px beside the content, the stack needs ${needed}px`)
assert.ok(roomBeside(wideFrom - 1) < needed, 'control: one pixel narrower the stack would touch the content, so it is not shown there')
assert.ok(roomBeside(1366) < needed && roomBeside(800) < needed, 'control: at 1366 and 800 px the stack would sit on the content')
assert.doesNotMatch(shellClasses.replace(publicOnly[0], ''), /pb-\[calc/, 'the editor preview has no floating buttons, so it keeps its own padding')
// The install notice (iOS Safari) is pinned to the bottom. The page ends that much higher, and both stacks on its side ride above it.
assert.match(publicPage, /className="relative pb-\[var\(--install-band-clearance,0px\)\]"/, 'the page pads its end by what the install notice covers')
assert.match(scrollWrapper, /(?:^|\s)bottom-\[calc\(1\.25rem\+env\(safe-area-inset-bottom\)\+var\(--install-band-clearance,0px\)\)\]/, 'the scroll buttons ride above the notice on a phone')
assert.match(scrollWrapper, /sm:bottom-\[calc\(1\.5rem\+env\(safe-area-inset-bottom\)\+var\(--install-band-clearance,0px\)\)\]/, 'and from sm, where the notice takes their corner')

console.log(`storefrontFooterClearance: the storefront ends ${reserve('')}rem above the safe area, one rem above its tallest floating control (${tallestFloating}rem); the wide stack appears from ${wideFrom}px, where it has ${roomBeside(wideFrom)}px beside the content`)
