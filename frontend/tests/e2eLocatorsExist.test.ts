import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The browser specs name the app's markup by CSS class (`page.locator('.hub-section-pills .chip-rail-item')`). When the markup is renamed the spec does not fail to compile: it fails at run time,
// 72 times over, on a browser nobody runs before the gate (button.hub-section-pill, left behind when the hub's section buttons became chips). This test needs no browser: every class a spec
// puts in a locator string must be a WHOLE class the app still renders (or styles), found in src/ as a standalone token.
const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}
const sourceText = walk(path.join(frontend, 'src')).filter(file => /\.(tsx?|css)$/.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n')
// A class is "there" when it stands alone: not a prefix of a longer class (hub-section-pill inside hub-section-pills), not a suffix of one.
export const rendersClass = (text: string, name: string): boolean => new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(text)
// Classes that belong to the browser, a library or the spec's own fixture pages, not to the app's source.
const NOT_OURS = new Set<string>([])

export function classesInLocators(specText: string): Array<{ cls: string; locator: string }> {
  const found: Array<{ cls: string; locator: string }> = []
  for (const match of specText.matchAll(/locator\((['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    // drop attribute selectors ([data-x="a.b"]) and quoted text so a dot inside a value is not read as a class
    const selector = match[2].replace(/\[[^\]]*\]/g, '').replace(/(['"]).*?\1/g, '')
    for (const cls of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) found.push({ cls: cls[1], locator: match[2] })
  }
  return found
}

// ---- the rule can tell the stale class from the live one (the instrument sees the failure it exists for) ----
assert.equal(rendersClass(sourceText, 'hub-section-pill'), false, 'the class the 72 failing locators used is not rendered by any element any more')
assert.equal(rendersClass(sourceText, 'hub-section-pills'), true, 'its replacement wrapper is')
assert.equal(rendersClass(sourceText, 'chip-rail-item'), true, 'and so is the button class inside it')
assert.deepEqual(classesInLocators("await page.locator('button.hub-section-pill').nth(1).click()").map(entry => entry.cls), ['hub-section-pill'])
assert.deepEqual(classesInLocators("page.locator('[data-x=\"a.b\"] .real-class')").map(entry => entry.cls), ['real-class'], 'a dot inside an attribute value is not a class')
assert.deepEqual(classesInLocators("page.getByRole('button', { name: 'Save.' })"), [], 'only locator() strings are read')

// ---- every spec ----
const specDir = path.join(frontend, 'e2e')
const specs = walk(specDir).filter(file => file.endsWith('.ts') && !file.includes(`${path.sep}fixtures${path.sep}`) && !file.includes(`${path.sep}server${path.sep}`))
assert.ok(specs.length > 20, `positive control: the specs were found (${specs.length})`)
const stale: string[] = []
let checked = 0
for (const file of specs) {
  for (const { cls, locator } of classesInLocators(fs.readFileSync(file, 'utf8'))) {
    checked++
    if (!NOT_OURS.has(cls) && !rendersClass(sourceText, cls)) stale.push(`${path.relative(frontend, file)}: .${cls} in locator('${locator}')`)
  }
}
assert.ok(checked > 10, `positive control: class selectors were read (${checked})`)
assert.deepEqual(stale, [], 'every class a browser spec locates is still rendered by the app')
console.log(`e2eLocatorsExist passed (${checked} class selectors in ${specs.length} spec files)`)
