// Storefront wording for shoppers on Google-translated pages (21 Nov 2026). Measured with Google Translate's real
// script: the old no-payment line came out as "online payment only" in French; one-word labels were translated
// without context (Back as the body part, Clear as the adjective, A-Z as Arizona); a number React rewrote after Google
// translated its neighbourhood stayed stale. The wording table is the result of real-script runs kept under
// Records/Design/2026-11-21/real-google/wording/. This test keeps the measured-bad strings out and pins the markup.
//
// Run: node tests/portalGoogleWording.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { defaultConfigText, resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { LEGAL_KEYS, SRC, parseSource, scanStorefrontCopy, storefrontModules, storefrontTranslator } from './storefrontCopyScan.ts'
import type { StorefrontCopyEntry } from './storefrontCopyScan.ts'

const requireActual = createRequire(import.meta.url)
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').split(String.fromCharCode(13)).join('')

let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
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

// ---- 1. Strings Google measurably mistranslates may not come back --------------------------------------------------

// English string -> what the real script made of it (the wrong rendering stays here as data, so a failure explains itself).
const MEASURED_BAD: Record<string, string> = {
  'No online payment. Send us your list to order.': 'French "Paiement en ligne uniquement": online payment ONLY, the opposite of the truth',
  Deal: '"Accord" / "Trato" / "交易": a business agreement',
  Back: '"Dos": the body part',
  Clear: '"Clair" / "Claro": the adjective',
  'Clear filters': 'Clear read as the adjective, as for the one word Clear',
  'Clear search': 'Clear read as the adjective, as for the one word Clear',
  'Search products': 'French "Produits de recherche": products of research',
  'Search categories...': 'measured wrong by the real script',
  'Search questions': 'measured wrong by the real script',
  'Refreshing...': 'French "Rafraichissant...": refreshing as of a drink',
  View: '"看法": an opinion',
  Sort: '"种类": a kind',
  Retry: 'Spanish "Rever": to review',
  Call: 'measured wrong by the real script',
  'Copy list': 'measured wrong by the real script',
  'Thinking...': 'measured wrong by the real script',
  'Why this match': 'measured wrong by the real script (the reasoning label of an AI result)',
  'Close announcement': 'measured wrong by the real script',
  'Jump to promotion': 'measured wrong by the real script',
  Combination: 'measured wrong by the real script',
}

// What the shopper reads in English: the storefront translator is the identity, so resolveStorefrontCopy gives the
// call site's own fallback unless a portal pack holds English for the key (it holds Khmer only). Resolving through the
// same function the page uses keeps this test on the shopper's text and not on the source text.
const t = storefrontTranslator()
const shopperEnglish = (entry: Pick<StorefrontCopyEntry, 'key' | 'en' | 'km'>) => resolveStorefrontCopy('en', t, entry.key, entry.en, entry.km ?? entry.en)

// Legal text is judged by its own tests (portal_legal_footer_contact is the single word Contact in the legal footer).
function deniedEntries(entries: StorefrontCopyEntry[]): string[] {
  return entries
    .filter((entry) => !LEGAL_KEYS.has(entry.key))
    .filter((entry) => Object.prototype.hasOwnProperty.call(MEASURED_BAD, shopperEnglish(entry).trim()))
    .map((entry) => `${entry.site} ${entry.key} = "${shopperEnglish(entry).trim()}" (${MEASURED_BAD[shopperEnglish(entry).trim()]})`)
}

const scan = scanStorefrontCopy()

check('no storefront copy entry is a string Google was measured to mistranslate', () => {
  assert.deepEqual(deniedEntries(scan.entries), [])
})
check('control: the denylist reports a fake entry of Back and not one of Previous', () => {
  assert.equal(deniedEntries([{ key: 'fake', en: 'Back', site: 'fake.tsx:1' }]).length, 1)
  assert.equal(deniedEntries([{ key: 'fake', en: ' Back ', site: 'fake.tsx:1' }]).length, 1, 'trimmed')
  assert.equal(deniedEntries([{ key: 'fake', en: 'Previous', site: 'fake.tsx:1' }]).length, 0)
  assert.equal(deniedEntries([{ key: 'portal_legal_footer_contact', en: 'Back', site: 'fake.tsx:1' }]).length, 0, 'legal keys are exempt')
})

// ---- 2. Pins --------------------------------------------------------------------------------------------------------

const NO_PAYMENT = 'You cannot pay on this website. Send us your list to order.'
const AI_NOTE = 'Written by AI, for reference only. For exact answers, please contact our shop on Instagram or Facebook.'
const entriesFor = (key: string) => scan.entries.filter((entry) => entry.key === key)

check('the no-payment line says plainly that the shopper cannot pay on the website', () => {
  const entries = entriesFor('noPaymentLine')
  assert.ok(entries.length >= 1)
  for (const entry of entries) assert.equal(shopperEnglish(entry), NO_PAYMENT)
})
check('the AI note is the same text in both places it is defined', () => {
  const entries = entriesFor('aiDisclaimer')
  assert.ok(entries.length >= 1)
  for (const entry of entries) assert.equal(shopperEnglish(entry), AI_NOTE)
  assert.ok(read('components/catalog/portalLanguagePacks.ts').includes(`aiDisclaimer: ['${AI_NOTE}', 'aiDisclaimer'`), 'the default-config tuple names the new text')
  const earlier = 'AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.'
  assert.equal(defaultConfigText('en', 'aiDisclaimer', earlier), AI_NOTE, 'the Worker may still send the earlier wording; it shows as the new default')
  assert.equal(defaultConfigText('en', 'aiDisclaimer', 'Our own note.'), 'Our own note.', 'a merchant note is kept')
})
check('the assistant maps a stored earlier default before deciding it is the owner\'s own note (the editor preview passes config unlocalized)', () => {
  const source = read('components/catalog/CatalogSecondaryTabs.tsx')
  const pinned = /const ownerDisclaimer = String\(defaultConfigText\(language, 'aiDisclaimer', previewConfig\.aiDisclaimer\) \|\| ''\)\.trim\(\)/
  assert.ok(pinned.test(source), 'ownerDisclaimer goes through defaultConfigText')
  assert.ok(!pinned.test(source.replace("defaultConfigText(language, 'aiDisclaimer', previewConfig.aiDisclaimer)", 'previewConfig.aiDisclaimer')), 'control: the raw config value fails the pin')
})
check('the storefront pager says Previous through its own key', () => {
  const entries = entriesFor('portalPagerPrevious')
  assert.ok(entries.length >= 1)
  for (const entry of entries) assert.equal(shopperEnglish(entry), 'Previous')
})

function sourceOf(code: string) {
  return ts.createSourceFile('inline.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
type JsxOpen = ts.JsxOpeningElement | ts.JsxSelfClosingElement
const openOf = (node: ts.Node): JsxOpen | undefined =>
  ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined
const attributeOf = (open: JsxOpen, name: string) =>
  open.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name)

function classMentionsNoTranslate(attribute: ts.JsxAttribute | undefined, source: ts.SourceFile): boolean {
  if (!attribute?.initializer) return false
  if (attribute.initializer.getText(source).includes('notranslate')) return true
  const expression = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined
  if (!expression || !ts.isIdentifier(expression)) return false
  let found = false
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expression.text && node.initializer?.getText(source).includes('notranslate')) found = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
// translate="no" AND a class named notranslate, on this very element.
function markedNoTranslate(node: ts.Node, source: ts.SourceFile): boolean {
  const open = openOf(node)
  if (!open) return false
  const translate = attributeOf(open, 'translate')
  const noValue = !!translate?.initializer && ts.isStringLiteral(translate.initializer) && translate.initializer.text === 'no'
  return noValue && classMentionsNoTranslate(attributeOf(open, 'className'), source)
}
function markedWithAncestors(node: ts.Node, source: ts.SourceFile): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) if (markedNoTranslate(current, source)) return true
  return false
}
function elements(source: ts.SourceFile, keep: (node: ts.JsxElement | ts.JsxSelfClosingElement) => boolean): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && keep(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
const line = (node: ts.Node, source: ts.SourceFile) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
const describe = (node: ts.Node, source: ts.SourceFile) => `line ${line(node, source)}: ${node.getText(source).replace(/\s+/g, ' ').slice(0, 90)}`

// Sort labels A-Z and Z-A are not words: rendered through the no-translate path.
check('the A-Z and Z-A sort options are rendered with translate="no" and notranslate', () => {
  const products = parseSource(path.join(SRC, 'components/catalog/CatalogProductsSection.tsx'))
  const flagged: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const label = node.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText() === 'label')
      const text = label?.initializer.getText(products) || ''
      const key = /copy\('(portalSortName(?:Asc|Desc))'/.exec(text)?.[1]
      if (key) {
        const noTranslate = node.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && property.name.getText() === 'noTranslate')
        assert.ok(noTranslate && noTranslate.initializer.kind === ts.SyntaxKind.TrueKeyword, `${key} option sets noTranslate: true`)
        flagged.push(key)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(products)
  assert.deepEqual(flagged.sort(), ['portalSortNameAsc', 'portalSortNameDesc'])
  const row = parseSource(path.join(SRC, 'components/catalog/PortalBrowseRow.tsx'))
  const labelSpans = elements(row, (node) => ts.isJsxElement(node) && node.children.some((child) => ts.isJsxExpression(child) && child.expression?.getText(row) === 'option.label'))
  assert.equal(labelSpans.length, 1)
  const open = openOf(labelSpans[0]) as JsxOpen
  assert.ok(attributeOf(open, 'translate')?.initializer?.getText(row).includes('option.noTranslate'), 'translate follows the option flag')
  assert.ok(attributeOf(open, 'className')?.initializer?.getText(row).includes('notranslate'), 'class follows the option flag')
})
check('PortalBrowseRow really renders the flag, and only on flagged options', () => {
  const Row = loadModule('components/catalog/PortalBrowseRow.tsx').default as React.ComponentType<Record<string, unknown>>
  const Icon = () => null
  const html = renderToStaticMarkup(React.createElement(Row, {
    label: 'Sort by', value: 'a', defaultValue: 'a', onChange: () => {},
    options: [
      { value: 'a', icon: Icon, label: 'A-Z', tip: 'x', noTranslate: true },
      { value: 'b', icon: Icon, label: 'Featured', tip: 'y' },
    ],
  }))
  assert.ok(html.includes('<span translate="no" class="notranslate">A-Z</span>'), html)
  assert.ok(html.includes('<span>Featured</span>'), 'an ordinary word stays translatable')
})

// ---- 3. Page totals are not left for Google to rewrite -----------------------------------------------------------

// Children of this element may be a bare identifier or an expression that reads it; a template literal is one whole
// string React replaces at once, so it is not looked into; nested elements are judged on their own.
function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node)) return node.text === name
  if (ts.isTemplateExpression(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return false
  return ts.forEachChild(node, (child) => mentions(child, name) || undefined) ?? false
}
function pagerViolations(source: ts.SourceFile): string[] {
  return elements(source, (node) => {
    const open = openOf(node) as JsxOpen
    const byAttribute = !!attributeOf(open, 'data-pager-range') || !!attributeOf(open, 'data-pager-page')
    const byTotal = ts.isJsxElement(node) && node.children.some((child) => ts.isJsxExpression(child) && !!child.expression && mentions(child.expression, 'totalPages'))
    return byAttribute || byTotal
  }).filter((node) => !markedWithAncestors(node, source)).map((node) => describe(node, source))
}
check('PaginationControls: every page total and pager range is translate="no" with a notranslate class', () => {
  const source = parseSource(path.join(SRC, 'components/shared/PaginationControls.tsx'))
  assert.ok(elements(source, (node) => ts.isJsxElement(node) && node.children.some((child) => ts.isJsxExpression(child) && !!child.expression && mentions(child.expression, 'totalPages'))).length >= 4, 'the checker finds the total spans')
  assert.deepEqual(pagerViolations(source), [])
})
check('control: the pager checker flags an unmarked total and range, and accepts marked ones', () => {
  assert.equal(pagerViolations(sourceOf('const a = <span className="x">/ {totalPages}</span>')).length, 1)
  assert.equal(pagerViolations(sourceOf('const a = <span className="x">/ {ok ? "-" : totalPages}</span>')).length, 1)
  assert.equal(pagerViolations(sourceOf('const a = <span data-pager-range className="x">{rangeText}</span>')).length, 1)
  assert.equal(pagerViolations(sourceOf('const a = <span data-pager-page className="x">{page}</span>')).length, 1)
  assert.equal(pagerViolations(sourceOf('const a = <span translate="no" className="x notranslate">/ {totalPages}</span>')).length, 0)
  assert.equal(pagerViolations(sourceOf('const a = <span data-pager-range translate="no" className="notranslate x">{rangeText}</span>')).length, 0)
  assert.equal(pagerViolations(sourceOf('const a = <span translate="no" className="notranslate"><b>{safePage} / {totalPages}</b></span>')).length, 0, 'an ancestor counts')
  assert.equal(pagerViolations(sourceOf('const a = <span>{`${label} ${totalPages}`}</span>')).length, 0, 'one whole template string is replaced as a whole')
})

// ---- 4. Counts next to a translatable word ---------------------------------------------------------------------------

function unmarkedCountElements(file: string, keep: (node: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile) => boolean) {
  const source = parseSource(path.join(SRC, file))
  const found = elements(source, (node) => keep(node, source))
  return { found, unmarked: found.filter((node) => !markedNoTranslate(node, source)).map((node) => describe(node, source)) }
}
const childIdentifier = (names: string[]) => (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
  ts.isJsxElement(node) && node.children.some((child) => ts.isJsxExpression(child) && !!child.expression && ts.isIdentifier(child.expression) && names.includes(child.expression.text))
const classIdentifier = (name: string) => (node: ts.JsxElement | ts.JsxSelfClosingElement) => {
  const attribute = attributeOf(openOf(node) as JsxOpen, 'className')
  return !!attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText() === name
}
check('the count next to a word is its own notranslate element: list segment, header badge, filter badge, Add quantity', () => {
  const segment = unmarkedCountElements('components/catalog/PortalListPage.tsx', childIdentifier(['count']))
  assert.equal(segment.found.length, 1, 'one list-segment count')
  const header = unmarkedCountElements('components/catalog/PortalDock.tsx', classIdentifier('COUNT_BADGE'))
  assert.equal(header.found.length, 2, 'the dock list badge on the wide stack and on the phone menu button')
  const filters = unmarkedCountElements('components/catalog/CatalogProductsSection.tsx', childIdentifier(['portalActiveFilterCount']))
  assert.equal(filters.found.length, 2, 'phone and desktop Filters counts')
  const addQty = unmarkedCountElements('components/catalog/CatalogProductsSection.tsx', childIdentifier(['qty']))
  assert.equal(addQty.found.length, 1, 'the product card Add quantity')
  const sheetQty = unmarkedCountElements('components/catalog/ProductDetailFlyout.tsx', (node) => !!attributeOf(openOf(node) as JsxOpen, 'data-product-detail-bucket-qty'))
  assert.equal(sheetQty.found.length, 1, 'the detail sheet Add quantity')
  assert.deepEqual([...segment.unmarked, ...header.unmarked, ...filters.unmarked, ...addQty.unmarked, ...sheetQty.unmarked], [])
})
check('PortalListPage: the segment word is its own element beside its count', () => {
  const source = parseSource(path.join(SRC, 'components/catalog/PortalListPage.tsx'))
  const buttons = elements(source, (node) => !!attributeOf(openOf(node) as JsxOpen, 'data-portal-list-segment'))
  assert.equal(buttons.length, 1)
  const kids = (buttons[0] as ts.JsxElement).children.filter((child) => !ts.isJsxText(child) || child.getText(source).trim())
  assert.ok(kids.every((child) => ts.isJsxElement(child) || (ts.isJsxExpression(child) && !!child.expression && !ts.isIdentifier(child.expression))), 'no bare word text node: the label is wrapped')
})
check('control: the count checker flags an unmarked count and accepts a marked one', () => {
  const bad = sourceOf('const a = <b>{label}<span className="x">{count}</span></b>')
  const good = sourceOf('const a = <b>{label}<span translate="no" className="x notranslate">{count}</span></b>')
  const keep = childIdentifier(['count'])
  assert.equal(elements(bad, keep).filter((node) => !markedNoTranslate(node, bad)).length, 1)
  assert.equal(elements(good, keep).filter((node) => !markedNoTranslate(node, good)).length, 0)
  const constBad = sourceOf('const C = "a"; const a = <span className={C}>{n}</span>')
  const constGood = sourceOf('const C = "a notranslate"; const a = <span translate="no" className={C}>{n}</span>')
  assert.equal(elements(constBad, classIdentifier('C')).filter((node) => !markedNoTranslate(node, constBad)).length, 1)
  assert.equal(elements(constGood, classIdentifier('C')).filter((node) => !markedNoTranslate(node, constGood)).length, 0)
})

// ---- 5. Contact stays one word and is not translated --------------------------------------------------------------

function unmarkedContactButtons(source: ts.SourceFile) {
  const found = elements(source, (node) => ts.isJsxElement(node) && node.children.some((child) => {
    if (!ts.isJsxExpression(child) || !child.expression || !ts.isCallExpression(child.expression)) return false
    const [first] = child.expression.arguments
    return child.expression.expression.getText(source) === 'copy' && !!first && ts.isStringLiteral(first) && first.text === 'contactButton'
  }))
  return { found, unmarked: found.filter((node) => !markedNoTranslate(node, source)).map((node) => describe(node, source)) }
}
check('every visible contactButton text sits in an element with translate="no" and notranslate', () => {
  let total = 0
  const unmarked: string[] = []
  for (const file of storefrontModules()) {
    const result = unmarkedContactButtons(parseSource(file))
    total += result.found.length
    unmarked.push(...result.unmarked.map((entry) => `${path.relative(SRC, file)} ${entry}`))
  }
  assert.ok(total >= 1, `found the dock Contact button (${total})`)
  assert.deepEqual(unmarked, [])
  assert.deepEqual(entriesFor('contactButton').map((entry) => shopperEnglish(entry)).filter((text) => text !== 'Contact'), [], 'the visible word stays Contact')
})
check('control: an unmarked Contact text is flagged and a marked one is not', () => {
  assert.equal(unmarkedContactButtons(sourceOf("const a = <button>{copy('contactButton', 'Contact')}</button>")).unmarked.length, 1)
  assert.equal(unmarkedContactButtons(sourceOf("const a = <span translate=\"no\" className=\"notranslate\">{copy('contactButton', 'Contact')}</span>")).unmarked.length, 0)
})

// ---- 6. The shopper's own typed words are never translated ---------------------------------------------------------

check('the typed search term and FAQ query sit in their own notranslate span', () => {
  const products = read('components/catalog/CatalogProductsSection.tsx')
  const tabs = read('components/catalog/CatalogSecondaryTabs.tsx')
  assert.ok(products.includes("withTypedTerm(copy('noProductsForSearch'") && products.includes("'{term}', searchTerm)"), 'empty search state')
  assert.ok(tabs.includes("withTypedTerm(copy('faqNoMatch'") && tabs.includes("'{query}', activeQuery)"), 'FAQ no-match line')
  const { withTypedTerm } = loadModule('components/catalog/catalogUi.tsx') as { withTypedTerm: (template: string, placeholder: string, term: string) => React.ReactNode }
  const html = renderToStaticMarkup(React.createElement('p', null, withTypedTerm('No products match "{term}".', '{term}', 'a<b')))
  assert.equal(html, '<p>No products match &quot;<span translate="no" class="notranslate">a&lt;b</span>&quot;.</p>')
  assert.equal(renderToStaticMarkup(React.createElement('p', null, withTypedTerm('No products match "{term}".', '{term}', 'rose'))).includes('<span translate="no" class="notranslate">rose</span>'), true)
  assert.equal(renderToStaticMarkup(React.createElement('p', null, withTypedTerm('Nothing here.', '{term}', 'rose'))), '<p>Nothing here.</p>', 'no placeholder: the text as written')
  assert.equal(renderToStaticMarkup(React.createElement('p', null, withTypedTerm('{q} and "{q}"', '{q}', 'x'))).split('notranslate').length - 1, 2, 'every placeholder')
})

// ---- 7. The assistant: AI-written text is never translated, and a label that toggles is remounted ---------------------

// Google rewrites text nodes it translates; React's later in-place update of that node then shows nothing. So the AI's
// own words carry no-translate, and the two labels that toggle sit in a span keyed by their state (a new key mounts a
// new node, which Google translates afresh).
function assistantViolations(source: ts.SourceFile): string[] {
  const problems: string[] = []
  const withChild = (test: (child: ts.JsxExpression) => boolean) =>
    elements(source, (node) => ts.isJsxElement(node) && node.children.some((child) => ts.isJsxExpression(child) && !!child.expression && test(child)))
  const text = (child: ts.JsxExpression) => (child.expression as ts.Expression).getText(source)
  const sites: [string, (child: ts.JsxExpression) => boolean][] = [
    ['the answer summary', (child) => text(child) === 'assistantResponse.summary'],
    ['a follow-up question chip', (child) => text(child) === 'question'],
    ['a recommendation reason', (child) => text(child) === 'item.reason'],
    ['a fit summary', (child) => text(child) === 'item.fit_summary'],
  ]
  for (const [name, test] of sites) {
    const found = withChild(test)
    if (found.length !== 1) problems.push(`${name}: expected one element, found ${found.length}`)
    for (const node of found) if (!markedNoTranslate(node, source)) problems.push(`${name} is not translate="no" with notranslate`)
  }
  const keyed = (state: string, label: string) => {
    const found = elements(source, (node) => {
      const key = attributeOf(openOf(node) as JsxOpen, 'key')
      return ts.isJsxElement(node) && !!key?.initializer?.getText(source).includes(state)
    })
    const ok = found.length === 1 && (found[0] as ts.JsxElement).children.some((child) => ts.isJsxExpression(child) && !!child.expression && text(child).includes(label))
    if (!ok) problems.push(`the ${label} label is not in a span keyed by ${state}`)
  }
  keyed('assistantLoading', 'assistantSend')
  keyed('added.has(addKey)', 'addToList')
  return problems
}
check('CatalogAiSection: AI text is notranslate and the toggling Send and Add labels are keyed spans', () => {
  assert.deepEqual(assistantViolations(parseSource(path.join(SRC, 'components/catalog/CatalogSecondaryTabs.tsx'))), [])
})
check('control: removing any one of the four marks or either key turns the assistant check red', () => {
  const original = read('components/catalog/CatalogSecondaryTabs.tsx')
  const mutants: [string, string, string][] = [
    ['summary mark', 'translate="no" className="notranslate mt-1 text-sm', 'className="mt-1 text-sm'],
    ['follow-up chip mark', 'translate="no" className={`notranslate ${CHIP} ${CHIP_IDLE}`}', 'className={`${CHIP} ${CHIP_IDLE}`}'],
    ['reason mark', 'translate="no" className="notranslate mt-2 text-sm', 'className="mt-2 text-sm'],
    ['fit summary mark', '<span translate="no" className="notranslate">{item.fit_summary}', '<span>{item.fit_summary}'],
    ['Send label key', " key={assistantLoading ? 'wait' : 'send'}", ''],
    ['Add label key', " key={added.has(addKey) ? 'in' : 'add'}", ''],
  ]
  for (const [name, from, to] of mutants) {
    assert.equal(original.split(from).length, 2, `${name}: the mutant site exists once`)
    const problems = assistantViolations(sourceOf(original.replace(from, () => to)))
    assert.ok(problems.length >= 1, `${name}: removing it must turn the check red`)
  }
  assert.deepEqual(assistantViolations(sourceOf(original)), [], 'the unmutated source is clean')
})

console.log(`portalGoogleWording: ${passed} checks passed`)
