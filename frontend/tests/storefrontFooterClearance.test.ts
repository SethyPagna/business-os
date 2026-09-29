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
const surface = read('CatalogPreviewSurface.tsx')
const publicPage = read('PublicCatalogPage.tsx')

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
const contact = classNames(block(publicPage, 'const contactFab = contactChannels.length > 0 ?', '\n  ) : null\n'))
const contactAnchors = contact.filter((classes) => /(?:^|\s)fixed(?=\s)/.test(classes))
assert.equal(contactAnchors.length, 2, 'the contact button, minimized and full')
const contactTallest = Math.max(...contact.filter((classes) => /(?:^|\s)h-\d/.test(classes)).map((classes) => spacingRem(classes, 'h')))

const floatingTopsRem = {
  scrollButtonsPhone: bottomRem(scrollWrapper) + scrollHeight,
  scrollButtonsWide: bottomRem(scrollWrapper, 'sm:') + scrollHeight,
  myList: bottomRem(bucketClasses) + spacingRem(bucketClasses, 'py') * 2 + BUCKET_ICON_REM,
  contact: Math.max(...contactAnchors.map((classes) => bottomRem(classes))) + contactTallest,
}
const tallestRem = Math.max(...Object.values(floatingTopsRem))

const shellClasses = classNames(block(surface, '<div className={`mx-auto max-w-[1680px]', '\n'))[0]
const publicOnly = /\$\{publicView \? '([^']*)'/.exec(shellClasses)
assert.ok(publicOnly, 'the shell carries publicView-only classes')
const reserve = (variant: string) => calcRem(publicOnly[1], `${variant}pb`) ?? 0

assert.ok(reserve('') >= tallestRem, `the storefront ends ${reserve('')}rem above the safe area; its tallest floating stack reaches ${tallestRem}rem ${JSON.stringify(floatingTopsRem)}`)
assert.ok(reserve('sm:') >= tallestRem, `from 640px sm:py-4 replaces the phone reserve, so sm: must keep it (${reserve('sm:')}rem)`)
assert.doesNotMatch(shellClasses.replace(publicOnly[0], ''), /pb-\[calc/, 'the editor preview has no floating buttons, so it keeps its own padding')

console.log(`storefrontFooterClearance: the storefront ends ${reserve('')}rem above the safe area, clearing its tallest floating stack (${tallestRem}rem)`)
