// The storefront ends with room for its floating buttons, so at the page end none of them covers a
// footer link on a phone. Heights come from the buttons' own classes; the browser twin is
// e2e/storefront-footer-clearance.spec.ts.
//
// Run: node tests/storefrontFooterClearance.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const CATALOG = path.join(import.meta.dirname, '..', 'src', 'components', 'catalog')
const read = (file: string) => fs.readFileSync(path.join(CATALOG, file), 'utf8').replace(/\r\n/g, '\n')
import { PORTAL_CONTACT_FLOAT, portalFloatClearanceRem } from '../src/components/catalog/portalSocialLinks.ts'

const surface = read('CatalogPreviewSurface.tsx')
const publicPage = read('PublicCatalogPage.tsx')
const socialRow = read('PortalSocialRow.tsx')

const REM_PER_SPACING_UNIT = 0.25
const BUCKET_ICON_REM = 1.25

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
function calcRem(classes: string, utility: string): number | null {
  const match = new RegExp(`(?:^|\\s)${utility}-\\[calc\\((\\d+(?:\\.\\d+)?)rem\\+env\\(safe-area-inset-bottom\\)\\)\\]`).exec(classes)
  return match ? Number(match[1]) : null
}
function bottomRem(classes: string, variant = ''): number {
  const rem = calcRem(classes, `${variant}bottom`)
  assert.ok(rem !== null, `expected ${variant}bottom-[calc(<rem>+env(safe-area-inset-bottom))] in: ${classes.slice(0, 140)}`)
  return rem
}

const scrollStack = block(surface, 'fixed bottom-[calc(', '\n      ) : null}')
const scrollWrapper = classNames(`className={\`${scrollStack}`)[0]
const scrollButtons = [...scrollStack.matchAll(/<button\b[\s\S]*?className="([^"]+)"/g)].map((match) => match[1])
assert.equal(scrollButtons.length, 2, 'the scroll-to-top and scroll-to-bottom buttons')
const scrollHeight = scrollButtons.reduce((sum, classes) => sum + spacingRem(classes, 'h'), 0) + spacingRem(scrollWrapper, 'gap') * (scrollButtons.length - 1)

const bucketClasses = classNames(block(publicPage, 'const bucketFab = (', '\n  )\n'))[0]
// The contact buttons are a column of 0-5 round links (2 Nov): their height grows with how many are configured,
// so the page passes the reserve for its own count (portalFloatClearanceRem) and this checks the numbers it uses.
const contactSource = block(socialRow, 'export function PortalContactFloat', '/** Handles, numbers and domains stay Latin')
const contactWrapper = classNames(contactSource.slice(contactSource.indexOf('className="')))[0]
const contactButton = classNames(contactSource.slice(contactSource.indexOf('className="flex h-11')))[0]
assert.match(contactWrapper, /(?:^|\s)fixed(?=\s)/)
const contactBottomRem = bottomRem(contactWrapper)
const contactButtonRem = spacingRem(contactButton, 'h')
const contactGapRem = spacingRem(contactWrapper, 'gap')
assert.deepEqual({ bottomRem: contactBottomRem, buttonRem: contactButtonRem, gapRem: contactGapRem }, { bottomRem: PORTAL_CONTACT_FLOAT.bottomRem, buttonRem: PORTAL_CONTACT_FLOAT.buttonRem, gapRem: PORTAL_CONTACT_FLOAT.gapRem }, 'the reserve is computed from the numbers the buttons really use')
const contactTops = (count: number) => contactBottomRem + count * contactButtonRem + (count - 1) * contactGapRem
for (let count = 1; count <= 5; count += 1) {
  assert.ok(portalFloatClearanceRem(count) >= contactTops(count), `${count} contact buttons reach ${contactTops(count)}rem; the page reserves ${portalFloatClearanceRem(count)}rem`)
}
assert.match(surface, /style=\{publicView && floatingStackClearanceRem \? \{ paddingBottom: `calc\(\$\{floatingStackClearanceRem\}rem \+ env\(safe-area-inset-bottom\)\)` \} : undefined\}/, 'the surface applies the reserve it is given')
assert.match(publicPage, /floatingStackClearanceRem=\{portalFloatClearanceRem\(buildPortalContactFloat\(contactChannels\)\.length\)\}/, 'and the page gives it for its own contact buttons')

const floatingTopsRem = {
  scrollButtonsPhone: bottomRem(scrollWrapper) + scrollHeight,
  scrollButtonsWide: bottomRem(scrollWrapper, 'sm:') + scrollHeight,
  myList: bottomRem(bucketClasses) + spacingRem(bucketClasses, 'py') * 2 + BUCKET_ICON_REM,
}
const tallestRem = Math.max(...Object.values(floatingTopsRem))

const shellClasses = classNames(block(surface, 'className={`mx-auto max-w-[1680px]', '\n'))[0]
const publicOnly = /\$\{publicView \? '([^']*)'/.exec(shellClasses)
assert.ok(publicOnly, 'the shell carries publicView-only classes')
const reserve = (variant: string) => calcRem(publicOnly[1], `${variant}pb`) ?? 0

assert.ok(reserve('') >= tallestRem, `the storefront ends ${reserve('')}rem above the safe area; its tallest floating stack reaches ${tallestRem}rem ${JSON.stringify(floatingTopsRem)}`)
assert.ok(reserve('sm:') >= tallestRem, `from 640px sm:py-4 replaces the phone reserve, so sm: must keep it (${reserve('sm:')}rem)`)
assert.doesNotMatch(shellClasses.replace(publicOnly[0], ''), /pb-\[calc/, 'the editor preview has no floating buttons, so it keeps its own padding')

console.log(`storefrontFooterClearance: the storefront ends ${reserve('')}rem above the safe area, clearing its tallest floating stack (${tallestRem}rem)`)
