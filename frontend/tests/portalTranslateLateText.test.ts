// Measured 21 Nov 2026 against Google's real translate script: text that React adds LATER inside an
// element carrying aria-label or title, at any depth, is never translated. aria-labelledby, role and
// aria-describedby do not do this, and a leaf control's own aria-label does not affect its parent.
// So a container whose content can change after it mounts is named through aria-labelledby pointing
// at a hidden label. Do not "simplify" the header back to an aria-label: the search field and the
// Filters button join it late and would stay English under French, Spanish and Chinese.
//
// This file is a ratchet: the header is pinned exactly, every other container the rule flags is on
// KNOWN_NOT_YET_CONVERTED (the work list), a NEW one fails, and a listed one that stops matching fails.
//
// Run: node tests/portalTranslateLateText.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import ts from 'typescript'
import { SRC, parseSource, storefrontModules } from './storefrontCopyScan.ts'

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

// Controls that name themselves; a late child inside them is not what Google skips on the parent.
const LEAF_TAGS = new Set([
  'button', 'a', 'input', 'select', 'textarea', 'img', 'svg', 'option', 'iframe', 'abbr', 'time', 'progress', 'meter', 'video', 'audio', 'canvas',
  'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'defs', 'clipPath', 'mask', 'text', 'tspan',
])
const GUARDED_ATTRIBUTES = ['aria-label', 'title']

function attributeText(attribute: ts.JsxAttribute, source: ts.SourceFile): string {
  const initializer = attribute.initializer
  if (!initializer) return 'true'
  if (ts.isJsxExpression(initializer)) return initializer.expression ? initializer.expression.getText(source) : ''
  return initializer.getText(source)
}

function findAttribute(element: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string, source: ts.SourceFile): ts.JsxAttribute | undefined {
  return element.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === name)
}

type Flagged = { tag: string; attribute: string; expression: string }

// (a) intrinsic non-leaf tag, (b) aria-label or title, (c) at least one element, fragment or {expression} child.
export function flaggedContainers(source: ts.SourceFile): Flagged[] {
  const found: Flagged[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source)
      if (/^[a-z]/.test(tag) && !LEAF_TAGS.has(tag)) {
        const hasLateChild = node.children.some((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child) || ts.isJsxExpression(child))
        if (hasLateChild) {
          for (const name of GUARDED_ATTRIBUTES) {
            const attribute = findAttribute(node.openingElement, name, source)
            if (attribute) found.push({ tag, attribute: name, expression: attributeText(attribute, source) })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function inlineSource(code: string): ts.SourceFile {
  return ts.createSourceFile('inline.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

// ---- the header pin ------------------------------------------------------------------------------
// The copy call that fed the nav's aria-label on base b6b54c73f (CatalogPreviewSurface.tsx):
//   aria-label={copy('publicNavigation', 'Section navigation')}
const HEADER_NAME_CALL = "copy('publicNavigation', 'Section navigation')"

function jsxChildrenOf(node: ts.Node): ts.Node[] {
  return ts.isJsxElement(node) || ts.isJsxFragment(node) ? [...node.children] : []
}

function containsSearchSlot(node: ts.Node, source: ts.SourceFile): boolean {
  let found = false
  const visit = (child: ts.Node) => {
    if (ts.isJsxAttribute(child) && child.name.getText(source) === 'data-portal-nav-search-slot') found = true
    if (!found) ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function isHiddenLabel(node: ts.Node, source: ts.SourceFile): node is ts.JsxElement {
  if (!ts.isJsxElement(node)) return false
  const tag = node.openingElement.tagName.getText(source)
  if (tag === 'PortalHiddenLabel') return true
  const className = findAttribute(node.openingElement, 'className', source)
  return tag === 'span' && !!className && /\bsr-only\b/.test(className.getText(source))
}

// Returns the list of problems; empty means the header is named correctly.
export function headerNavProblems(source: ts.SourceFile): string[] {
  let nav: ts.JsxElement | undefined
  const find = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'nav' && containsSearchSlot(node, source)) nav = nav ?? node
    ts.forEachChild(node, find)
  }
  find(source)
  if (!nav) return ['no nav element contains data-portal-nav-search-slot']
  const found = nav as ts.JsxElement
  const problems: string[] = []
  for (const name of GUARDED_ATTRIBUTES) {
    if (findAttribute(found.openingElement, name, source)) problems.push(`the header nav carries ${name}`)
  }
  const labelledBy = findAttribute(found.openingElement, 'aria-labelledby', source)
  const expression = labelledBy?.initializer && ts.isJsxExpression(labelledBy.initializer) ? labelledBy.initializer.expression : undefined
  if (!expression || !ts.isIdentifier(expression)) {
    problems.push('the header nav needs aria-labelledby={identifier}')
    return problems
  }
  const id = expression.text
  const candidates: ts.Node[] = []
  const collect = (node: ts.Node) => {
    if (isHiddenLabel(node, source)) candidates.push(node)
    ts.forEachChild(node, collect)
  }
  collect(found)
  // The immediately preceding sibling (ignoring whitespace text) also counts.
  const siblings = found.parent ? jsxChildrenOf(found.parent).filter((child) => !(ts.isJsxText(child) && !child.getText(source).trim())) : []
  const previous = siblings[siblings.indexOf(found) - 1]
  if (previous && isHiddenLabel(previous, source)) candidates.push(previous)
  const label = candidates.find((candidate) => {
    const idAttribute = findAttribute((candidate as ts.JsxElement).openingElement, 'id', source)
    const idExpression = idAttribute?.initializer && ts.isJsxExpression(idAttribute.initializer) ? idAttribute.initializer.expression : undefined
    return !!idExpression && ts.isIdentifier(idExpression) && idExpression.text === id
  }) as ts.JsxElement | undefined
  if (!label) {
    problems.push(`no hidden label with id={${id}} inside the nav or directly before it`)
    return problems
  }
  const kids = label.children.filter((child) => !(ts.isJsxText(child) && !child.getText(source).trim()))
  const kid = kids.length === 1 ? kids[0] : undefined
  const text = kid && ts.isJsxExpression(kid) && kid.expression ? kid.expression.getText(source) : ''
  if (text !== HEADER_NAME_CALL) problems.push(`the hidden label holds ${text || 'something that is not one expression'}, not ${HEADER_NAME_CALL}`)
  return problems
}

const HEADER_OK = `const x = (
  <nav aria-labelledby={navLabelId} className="sticky">
    <PortalHiddenLabel id={navLabelId}>{copy('publicNavigation', 'Section navigation')}</PortalHiddenLabel>
    <div data-portal-nav-search-slot="true" />
  </nav>
)`

runTest('the real header nav is named by a hidden label carrying the same copy call', () => {
  const problems = headerNavProblems(parseSource(path.join(SRC, 'components/catalog/CatalogPreviewSurface.tsx')))
  assert.deepEqual(problems, [])
})

runTest('header pin control: the correct shape is green', () => {
  assert.deepEqual(headerNavProblems(inlineSource(HEADER_OK)), [])
})

runTest('header pin control: the label as the preceding sibling is green', () => {
  const code = `const x = (<><PortalHiddenLabel id={navLabelId}>{copy('publicNavigation', 'Section navigation')}</PortalHiddenLabel><nav aria-labelledby={navLabelId}><div data-portal-nav-search-slot="true" /></nav></>)`
  assert.deepEqual(headerNavProblems(inlineSource(code)), [])
})

runTest('header pin control: a nav still on aria-label is red', () => {
  const code = `const x = (<nav aria-label={copy('publicNavigation', 'Section navigation')}><div data-portal-nav-search-slot="true" /></nav>)`
  const problems = headerNavProblems(inlineSource(code))
  assert.ok(problems.some((problem) => problem.includes('carries aria-label')), problems.join('; '))
})

runTest('header pin control: a nav with a title is red', () => {
  const code = HEADER_OK.replace('className="sticky"', 'title="x"')
  assert.ok(headerNavProblems(inlineSource(code)).some((problem) => problem.includes('carries title')))
})

runTest('header pin control: aria-labelledby pointing at an id nothing in the render has is red', () => {
  const problems = headerNavProblems(inlineSource(HEADER_OK.replace('id={navLabelId}>', 'id={otherId}>')))
  assert.ok(problems.some((problem) => problem.includes('no hidden label with id={navLabelId}')), problems.join('; '))
})

runTest('header pin control: a string aria-labelledby is red', () => {
  assert.ok(headerNavProblems(inlineSource(HEADER_OK.replace('{navLabelId} className', '"navLabel" className'))).length > 0)
})

runTest('header pin control: a hidden label with a different copy key is red', () => {
  const problems = headerNavProblems(inlineSource(HEADER_OK.replace("'publicNavigation'", "'somethingElse'")))
  assert.ok(problems.some((problem) => problem.includes('the hidden label holds')), problems.join('; '))
})

runTest('header pin control: a hidden label with a different English fallback is red', () => {
  assert.ok(headerNavProblems(inlineSource(HEADER_OK.replace("'Section navigation'", "'Navigation'"))).length > 0)
})

// ---- the rule, with controls ---------------------------------------------------------------------
const flagged = (code: string) => flaggedContainers(inlineSource(`const x = (${code})`))

runTest('rule control: a nav with aria-label and an element child is flagged', () => {
  assert.equal(flagged('<nav aria-label={x}><div>{y}</div></nav>').length, 1)
})
runTest('rule control: a div with a title and an expression child is flagged', () => {
  assert.equal(flagged('<div title="t">{y}</div>').length, 1)
})
runTest('rule control: a button with aria-label and a child is not flagged', () => {
  assert.equal(flagged('<button aria-label={x}><span>{y}</span></button>').length, 0)
})
runTest('rule control: a nav named by aria-labelledby with a hidden label is not flagged', () => {
  assert.equal(flagged('<nav aria-labelledby={id}><span id={id} className="sr-only">{x}</span>{y}</nav>').length, 0)
})
runTest('rule control: a ul with aria-label and items is flagged', () => {
  assert.equal(flagged('<ul aria-label={x}>{items}</ul>').length, 1)
})
runTest('rule control: static text under a title is not flagged', () => {
  assert.equal(flagged('<div title="t">plain</div>').length, 0)
})

// ---- the ratchet ---------------------------------------------------------------------------------
// Every other container the rule flags today. file | tag | attribute=expression, no line numbers.
// Count is how many identical occurrences the file has. "late" says whether content can arrive after
// the container mounts: yes, no, or unsure. This is the work list for the conversion lane; it may only shrink.
type Known = { count: number; late: 'yes' | 'no' | 'unsure'; note: string }
const KNOWN_NOT_YET_CONVERTED: Record<string, Known> = {
  'components/shared/PaginationControls.tsx|nav|aria-label=pageLabel': { count: 1, late: 'yes', note: 'pager text changes with the page' },
  'components/catalog/PortalContactMenu.tsx|ul|aria-label=label': { count: 1, late: 'no', note: 'menu rows and label mount together; list needs a sibling label' },
  'components/catalog/PortalSheet.tsx|div|aria-label=label': { count: 1, late: 'yes', note: 'every sheet (Contact, assistant, lists) fills after it opens' },
  "components/catalog/CatalogPreviewSurface.tsx|div|aria-label=copy('publicTranslation', 'Language tools')": { count: 1, late: 'no', note: 'language menu group, static options' },
  'components/catalog/PortalListPage.tsx|span|aria-label=question': { count: 1, late: 'no', note: 'clear-all question; its visible text is the same string, point at it' },
  'components/catalog/PortalListPage.tsx|section|aria-label=`${listLabel} / ${savedLabel}`': { count: 1, late: 'yes', note: 'rows added and removed; parent uses space-y, so put the label inside the header row' },
  "components/catalog/legal/LegalPages.tsx|footer|aria-label=text('portal_legal_footer_landmark')": { count: 1, late: 'yes', note: 'footer details and links arrive after mount' },
  "components/catalog/legal/LegalPages.tsx|nav|aria-label=text('portal_legal_footer_quick_links')": { count: 1, late: 'yes', note: 'has a visible heading with the same text, point at it' },
  "components/catalog/legal/LegalPages.tsx|nav|aria-label=text('portal_legal_policies')": { count: 2, late: 'no', note: 'footer nav (visible heading, point at it) and reader nav (hidden label); static links' },
  "components/catalog/CatalogProductsSection.tsx|div|aria-label=copy('filters', 'Filters')": { count: 1, late: 'yes', note: 'filter dialog; visible heading with the same text, point at it' },
  "components/catalog/CatalogProductsSection.tsx|ul|aria-label=copy('filters', 'Filters')": { count: 1, late: 'yes', note: 'active filter chips come and go; sibling label' },
  'components/catalog/CatalogProductsSection.tsx|div|title=productHeading': { count: 1, late: 'no', note: 'owner product name, translate=no, so Google never touches it; safe to allow' },
  'components/catalog/CatalogSecondaryTabs.tsx|div|title=item.value': { count: 1, late: 'no', note: 'value is translate=no but the label span beside it is not; move the title onto the value span' },
  'components/catalog/legal/ConsentRenewalPrompt.tsx|div|aria-label=title': { count: 1, late: 'yes', note: 'error line appears after mount; visible heading with the same text, point at it' },
  "components/catalog/PortalPromotionsBanner.tsx|section|aria-label=copy('announcementStripSection', 'Announcements'": { count: 1, late: 'yes', note: 'promotions load after the page' },
  "components/catalog/PortalAnnouncementStrip.tsx|div|aria-label=copy('portal_a11y_announcement', 'Announcement',": { count: 1, late: 'no', note: 'message is translate=no; only the dismiss button is UI' },
  'components/catalog/PortalFilterCombobox.tsx|div|aria-label=label': { count: 2, late: 'yes', note: 'dialog and listbox; options and the no-matches line change with the query; one hidden label can name both' },
  'components/catalog/PortalFilterCombobox.tsx|div|aria-label=group.mainLabel': { count: 1, late: 'unsure', note: 'category group inside the listbox' },
  'components/catalog/PortalBrowseRow.tsx|div|aria-label=label': { count: 1, late: 'no', note: 'static chips' },
  'components/shared/AlphaIndexRail.tsx|div|aria-label=railLabel': { count: 1, late: 'unsure', note: 'shared with admin lists' },
  'components/shared/AppSelect.tsx|div|aria-label=ariaLabel': { count: 1, late: 'unsure', note: 'shared with admin forms; listbox container' },
  "components/shared/Modal.tsx|h2|title=typeof title === 'string' ? title : undefined": { count: 1, late: 'no', note: 'heading whose text is the title itself' },
  "utils/LazyImportRecovery.tsx|div|aria-label=text('lazy_load_retryable', 'This part could not": { count: 1, late: 'unsure', note: 'retry panel for a failed chunk' },
  'components/shared/ImageGalleryLightbox.tsx|div|aria-label=title || undefined': { count: 1, late: 'unsure', note: 'lightbox dialog; caption and counter change' },
  'components/files/FilePickerModal.tsx|div|title=asset.original_name': { count: 1, late: 'no', note: 'ADMIN-ONLY by reading (lazy import from the editor branch); left for the lead to rule on' },
}

function relativeToSrc(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/')
}

function currentFlagged(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of storefrontModules()) {
    if (!file.endsWith('.tsx')) continue
    const source = parseSource(file)
    for (const item of flaggedContainers(source)) {
      // Long expressions are cut to their first 48 characters so a copy call with long Khmer text keeps a readable key.
      const key = `${relativeToSrc(file)}|${item.tag}|${item.attribute}=${item.expression.replace(/\s+/g, ' ').slice(0, 48)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

runTest('no new container with aria-label or title and late children appears in the storefront', () => {
  const now = currentFlagged()
  const fresh: string[] = []
  for (const [key, count] of now) {
    const known = KNOWN_NOT_YET_CONVERTED[key]
    if (!known || count > known.count) fresh.push(`${key} x${count}`)
  }
  assert.deepEqual(fresh, [], 'name it with aria-labelledby and a PortalHiddenLabel (or its visible heading) instead; see the header of this file')
})

runTest('every KNOWN_NOT_YET_CONVERTED entry still matches something (the list only shrinks)', () => {
  const now = currentFlagged()
  const stale = Object.entries(KNOWN_NOT_YET_CONVERTED)
    .filter(([key, known]) => (now.get(key) ?? 0) !== known.count)
    .map(([key, known]) => `${key} listed x${known.count}, found x${now.get(key) ?? 0}`)
  assert.deepEqual(stale, [], 'remove or lower the entry you converted')
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
