// The Website Editor fits a phone (WEB-2, owner 24 Sep 2026: "userfriendly,
// doesn't break page boundary etc... responsive").
//
// Pinned here:
//   1. Announcement Strip cards. On a phone the strip modal leaves each card
//      a narrow row, and as one row the grip, picture, Active pill, Edit and
//      Delete took nearly all of it: the title was cut to a few letters. On a
//      phone a card is now two lines -- the card itself (picture, title,
//      subtitle), then its actions -- and from `sm:` up it is one row again.
//
// Run: node tests/websiteEditorLayout.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const count = (text: string, pattern: RegExp) => (text.match(pattern) || []).length

// 1. Announcement Strip cards.
const strip = read('../src/components/catalog/ManagePromotionsModal.tsx')
const rowStart = strip.indexOf('draggable={!orderSaving}')
assert.ok(rowStart > 0, 'the strip renders its cards')
const row = strip.slice(rowStart, strip.indexOf('\n            ))}', rowStart))
const rowClass = row.match(/className=\{`([^`$]*)/)?.[1] || ''
assert.match(rowClass, /(?:^|\s)flex-col(?:\s|$)/, 'on a phone a card stacks its two lines')
assert.match(rowClass, /(?:^|\s)sm:flex-row(?:\s|$)/, 'from sm: up a card is one row')
assert.doesNotMatch(rowClass, /(?:^|\s)items-center(?:\s|$)/, 'a stacked card is not centred sideways (only sm:items-center)')

const cardLine = row.indexOf('<div className="flex min-w-0 flex-1 items-center gap-3">')
const actionLine = row.indexOf('<div className="flex shrink-0 items-center justify-end gap-3">')
assert.ok(cardLine > 0, 'the first line can shrink and takes the free width')
assert.ok(actionLine > cardLine, 'the actions line comes after the first line')
const first = row.slice(cardLine, actionLine)
assert.equal(count(first, /<div\b/g), count(first, /<\/div>/g), 'the first line closes before the actions line opens: they are siblings, not nested')
assert.ok(first.includes('{promo.title}'), 'the title sits on the first line')
const actions = row.slice(actionLine)
assert.equal(count(actions, /<\/div>/g) - count(actions, /<div\b/g), 1, 'the actions line is the last thing on the card')
for (const action of ['moveCard(promotions, index, index - 1)', 'moveCard(promotions, index, index + 1)', 'handleToggleActive(promo)', 'startEdit(promo)', 'setPendingDelete(promo)']) {
  assert.ok(actions.includes(action), `${action} sits on the actions line`)
}
// Dragging needs a mouse, so the grip only shows where it works; on a phone
// the Up/Down buttons open the actions line instead.
const grip = first.match(/<GripVertical className="([^"]*)"/)?.[1] || ''
assert.match(grip, /(?:^|\s)hidden(?:\s|$)/, 'no drag grip on a phone')
assert.match(grip, /(?:^|\s)sm:block(?:\s|$)/, 'the drag grip is back from sm: up')
assert.match(actions, /<div className="mr-auto flex items-center gap-1 sm:mr-0">\s*\n\s*<button[\s\S]*?index - 1/, 'on a phone Up/Down start the actions line, apart from the rest')

console.log('PASS websiteEditorLayout: strip cards give the title its own line on a phone')

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

runTest('T-L9: every module under catalog/editor/ is pinned to the lazy catalog-editor chunk', () => {
  const vite = read('../vite.config.ts')
  const returnAt = vite.indexOf("return 'catalog-editor'")
  assert.ok(returnAt > 0, 'vite.config.ts still names the catalog-editor chunk')
  const rule = vite.slice(vite.lastIndexOf('if (', returnAt), returnAt)
  assert.match(rule, /normalized\.includes\('\/src\/components\/catalog\/editor\/'\)/, 'editor modules left to the catch-all land in the catalog route chunk')
  assert.match(rule, /CatalogPageContext\.tsx'\)\s*\n\s*\|\| normalized\.includes\('\/src\/components\/catalog\/editor\/'\)/, 'the editor/ line follows the CatalogPageContext line (performanceLoadingUx.test.ts reads that order)')
})

const workerAboutCap = (name: string): number => {
  const portalRoute = read('../../cloudflare/src/routes/portal.ts')
  const value = portalRoute.match(new RegExp(`const ${name} = (\\d+)`))?.[1]
  assert.ok(value, `cloudflare/src/routes/portal.ts still defines ${name}`)
  return Number(value)
}
const editorCap = (editor: string, name: string): number => {
  const value = editor.match(new RegExp(`const ${name} = (\\d+)`))?.[1]
  assert.ok(value, `CatalogEditorSurface.tsx defines ${name}`)
  return Number(value)
}
const elementWithId = (source: string, id: string): string => {
  const at = source.indexOf(id)
  assert.ok(at > 0, `the editor renders ${id}`)
  const start = Math.max(source.lastIndexOf('<input', at), source.lastIndexOf('<textarea', at))
  return source.slice(start, source.indexOf('/>', at))
}

runTest('T-L7: the About block limits in the editor are the Worker\'s, so nothing typed is cut off on the shop (R2)', () => {
  const editor = read('../src/components/catalog/CatalogEditorSurface.tsx')
  assert.equal(editorCap(editor, 'ABOUT_TITLE_MAX_LENGTH'), workerAboutCap('MAX_PORTAL_ABOUT_TITLE_LENGTH'))
  assert.equal(editorCap(editor, 'ABOUT_TEXT_MAX_LENGTH'), workerAboutCap('MAX_PORTAL_ABOUT_TEXT_LENGTH'))
  assert.equal(editorCap(editor, 'ABOUT_BLOCKS_MAX'), workerAboutCap('MAX_PORTAL_ABOUT_BLOCKS'))
  assert.match(elementWithId(editor, 'id={`portal-about-block-title-${block.id}`}'), /maxLength=\{ABOUT_TITLE_MAX_LENGTH\}/, 'a block title stops where the shop cuts it')
  assert.match(elementWithId(editor, 'id={`portal-about-block-body-${block.id}`}'), /maxLength=\{ABOUT_TEXT_MAX_LENGTH\}/, 'block text stops where the shop cuts it')
  assert.match(elementWithId(editor, 'id="portal-about-title"'), /maxLength=\{ABOUT_TITLE_MAX_LENGTH\}/, 'the About title is capped like a block title (portal.ts aboutTitle)')
  assert.match(elementWithId(editor, 'id="portal-about-content"'), /maxLength=\{ABOUT_TEXT_MAX_LENGTH\}/, 'the About text is capped like block text (portal.ts aboutContent)')
  const addButtons = [...editor.matchAll(/onClick=\{\(\) => addAboutBlock\('(?:text|image|video)'\)\}/g)]
  assert.equal(addButtons.length, 3, 'three Add block buttons')
  for (const button of addButtons) {
    const tag = editor.slice(editor.lastIndexOf('<button', button.index), editor.indexOf('>', button.index))
    assert.match(tag, /disabled=\{aboutBlocksFull\}/, 'Add block stops at the limit')
    assert.match(tag, /aria-describedby=\{aboutBlocksFull \? 'portal-about-blocks-max' : undefined\}/, 'the disabled button is described by the reason')
    const buttonClass = tag.match(/className="([^"]*)"/)?.[1].split(/\s+/) ?? []
    for (const look of ['disabled:opacity-50', 'disabled:cursor-not-allowed']) {
      assert.ok(buttonClass.includes(look), `a stopped Add block looks stopped (btn-secondary has no disabled look of its own): ${look}`)
    }
  }
  assert.match(editor, /const aboutBlocksFull = aboutBlocks\.length >= ABOUT_BLOCKS_MAX/)
  assert.match(editor, /\{aboutBlocksFull \? \(\s*<p id="portal-about-blocks-max" role="status"[^>]*>\{ed\('web_editor_blocks_max', 'Up to 30 blocks\.', 'រហូតដល់ ៣០ ប្លុក។'\)\}<\/p>/, 'the reason is shown, not only hovered')
})

runTest('T-L6: a post card always shows its product picker and its web link field; the chosen link type enables one (B6)', () => {
  const editor = read('../src/components/catalog/CatalogEditorSurface.tsx')
  const cardStart = editor.indexOf('promoItems.length ? promoItems.map(')
  assert.ok(cardStart > 0, 'the post cards render')
  const card = editor.slice(cardStart, editor.indexOf('noPromotionCards', cardStart))
  assert.doesNotMatch(card, /linkType === 'product'|linkType === 'url'|if \(linkMode === /, 'no link field appears only after the type changes (a new card never got one)')
  assert.match(card, /const linkMode = promoLinkModes\[item\.id\] \?\? promoLinkModeOf\(item\)/, 'the card holds its own link type, first read from the data')
  const picker = card.slice(card.lastIndexOf('<AppSelect', card.indexOf('id={`portal-promo-product-${item.id}`}')), card.indexOf('/>', card.indexOf('id={`portal-promo-product-${item.id}`}')))
  assert.match(picker, /disabled=\{linkMode !== 'product'\}/, 'the product picker is always there, enabled only for a product link')
  const url = elementWithId(card, 'id={`portal-promo-link-${item.id}`}')
  assert.match(url, /disabled=\{linkMode !== 'url'\}/, 'the web link field is always there, enabled only for a web link')
  assert.match(url, /aria-invalid=\{linkRefused\(`promo_items\[\$\{index\}\]\.linkUrl`, item\.linkUrl\)\}/, 'a refused link is marked on its own field')
  const modeChange = card.slice(card.indexOf('id={`portal-promo-link-type-${item.id}`}'), card.indexOf('id={`portal-promo-product-${item.id}`}'))
  assert.match(modeChange, /setPromoLinkModes\(\(current\) => \(\{ \.\.\.current, \[item\.id\]: nextMode \}\)\)/)
  assert.match(modeChange, /updatePromoItemFields\(item\.id, linkFieldsOutside\(nextMode\)\)/, 'switching clears the other link in one write')
  assert.match(picker, /updatePromoItemFields\(item\.id, \{ linkProductId: nextId, linkProductName: /, 'choosing a product writes its id and name together (two writes from one render kept only the name)')
  assert.doesNotMatch(card, /updatePromoItem\(item\.id, 'link(?:ProductId|ProductName|Url)', [^)]*\)\s*\n\s*updatePromoItem\(/, 'no two link writes in a row from the same render')
  const outside = editor.slice(editor.indexOf('function linkFieldsOutside('), editor.indexOf('\n}\n', editor.indexOf('function linkFieldsOutside(')))
  assert.match(outside, /mode === 'url' \? \{\} : \{ linkUrl: '' \}/)
  assert.match(outside, /mode === 'product' \? \{\} : \{ linkProductId: '', linkProductName: '' \}/)
  const page = read('../src/components/catalog/CatalogPage.tsx')
  assert.match(page, /function updatePromoItemFields\(itemId: string, fields: Record<string, unknown>\) \{\n\s*setPromoItemsDraft\(promoItems\.map\(\(item\) => \(\n\s*item\.id === itemId \? \{ \.\.\.item, \.\.\.fields \} : item/)
})

// ED-1a (EDITOR-REDESIGN-REFRESH section C): the bar. Button policy: Save keeps icon + word, every other bar control is
// icon-only with label = aria-label = tooltip. Sticky and opaque with no backdrop blur; one row, 56 px on a phone, 52 px from md.
const editorFile = (name: string): string => read(`../src/components/catalog/editor/${name}`)
const noComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

runTest('T-L1: among the bar\'s buttons only Save shows text; the old text buttons are gone', () => {
  const bar = noComments(editorFile('EditorBar.tsx'))
  const buttons = [...bar.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0])
  assert.equal(buttons.length, 1, 'EditorBar draws one <button>: Save. Every other control is an EditorIconButton')
  assert.match(buttons[0], /<Save\b/, 'Save keeps its icon')
  assert.match(buttons[0], /ed\('web_editor_save'/, '... and its word')
  assert.match(buttons[0], /aria-disabled=/, 'idle and blocked Save stay focusable and ignore the press (aria-disabled, never disabled)')
  assert.doesNotMatch(buttons[0], /(?<![-\w])disabled=/)
  const surface = noComments(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  assert.doesNotMatch(surface, /jumpToPreview|saveChanges/, 'the "Jump to preview" and "Save changes" text buttons are gone from the surface')
  assert.doesNotMatch(surface, /data-editor-section=/, 'the section buttons moved into EditorSectionNav')
  const nav = noComments(editorFile('EditorSectionNav.tsx'))
  assert.match(nav, /<EditorIconButton\b/, 'an inactive chip is an icon-only EditorIconButton')
})

runTest('T-L2: an EditorIconButton\'s visible name, accessible name and tooltip are one string', () => {
  const button = noComments(editorFile('EditorIconButton.tsx'))
  assert.match(button, /\blabel: string\b/, 'label is required')
  assert.equal([...button.matchAll(/aria-label=\{([^}]*)\}/g)].map((match) => match[1]).join(','), 'label', 'aria-label is the label')
  assert.equal([...button.matchAll(/\btitle=\{([^}]*)\}/g)].map((match) => match[1]).join(','), 'label', 'the tooltip is the label')
  assert.doesNotMatch(button, />[^<>{}]*[A-Za-z]{2,}[^<>{}]*</, 'no text child: the icon is the face')
})

runTest('T-L3: the bar is sticky, opaque and not blurred, one row of 56 px (52 px from md), with the status below it on a phone', () => {
  const bar = noComments(editorFile('EditorBar.tsx'))
  assert.match(bar, /\bsticky\b/)
  assert.doesNotMatch(bar, /backdrop-blur|bg-white\/|bg-slate-950\/|bg-white\/\d/, 'opaque: a blur over a near-opaque fill costs a GPU pass per scroll frame (stickyHeaderBlurRemoval)')
  assert.match(bar, /data-testid="editor-bar-row"[^>]*\bh-14\b[^>]*\bmd:h-\[52px\]/, 'the row is 56 px on a phone and 52 px from md')
  assert.match(bar, /role="status"/, 'the status is one live line')
  assert.match(bar, /aria-busy=\{/, 'Save says busy while it saves')
})

runTest('T-L3b: the bar can stick: nothing between it and the page scroller is a scroll container', () => {
  // CATCHES: overflow-x: hidden on the aside. CSS rewrites the paired overflow-y to auto, which makes the aside the scrollport
  // every sticky descendant resolves against -- a box that never scrolls -- so the bar scrolled away with the page. clip is the
  // one overflow value that is not rewritten (CatalogPreviewSurface.tsx records the same trap on the storefront).
  const surface = noComments(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  const aside = surface.match(/<aside id="portal-editor-top" className="([^"]*)"/)?.[1] || ''
  assert.ok(aside, 'the aside is found')
  assert.match(aside, /(?:^|\s)overflow-x-clip(?:\s|$)/, 'the aside contains sideways overflow with clip')
  assert.doesNotMatch(aside, /overflow-(?:x-|y-)?(?:hidden|auto|scroll)/, 'a hidden, auto or scroll aside would be the sticky bar its scrollport')
})

runTest('T-L3c: a refused field is centred inside the page scroller only, never with scrollIntoView on the app shell', () => {
  // CATCHES: field.scrollIntoView({ block: 'center' }) after a refused Save. It scrolls every scrollable ancestor, the app shell around the
  // page scroller included, which pushed the sticky bar about half out of the top of a 360 px phone (viewport ratio 0.57 in the e2e).
  const surface = noComments(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  const start = surface.indexOf('function focusEditorField(')
  assert.ok(start > 0, 'focusEditorField exists')
  const body = surface.slice(start, surface.indexOf('\n}\n', start))
  assert.match(body, /closest<HTMLElement>\('\.page-scroll'\)/, 'it finds the page scroller')
  assert.match(body, /scroller\.scrollTop \+=/, 'and scrolls that one element')
  assert.equal(count(body, /scrollIntoView/g), 1, 'scrollIntoView survives only as the fallback')
  assert.ok(body.indexOf('scrollIntoView') > body.indexOf('if (!scroller)'), 'and only when there is no page scroller')
})

runTest('T-L5: the markers are in the accessible names, and every section is a tab panel named by what opened it', () => {
  // CATCHES: an aria-label that replaces the inner text of a closed tab or the picker button, so a screen reader never heard "unsaved changes" or
  // "seller details missing" (the dot and the triangle were the only carriers).
  const nav = noComments(editorFile('EditorSectionNav.tsx'))
  assert.match(nav, /label=\{nameWithMarkers\(ed\(\.\.\.section\.label\), words\)\}/, 'a closed tab is named with its markers')
  assert.match(nav, /nameWithMarkers = \(name: string, \{ unsaved, seller \}: MarkerWords\)[^\n]*\[name, unsaved, seller\]\.filter\(Boolean\)\.join\(', '\)/, 'name, then the unsaved words, then the seller words')
  assert.match(nav, /id=\{sectionTabId\(section\.id\)\}[\s\S]*role="tab"[\s\S]*id=\{sectionTabId\(section\.id\)\}[\s\S]*role="tab"/, 'both the open and the closed tab carry the id a panel names itself by')
  assert.match(nav, /id=\{SECTION_PICKER_ID\}/, 'and so does the picker button')
  const surface = noComments(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  assert.match(surface, /const panel = \(id: EditorSectionId\) => \(\{ role: 'tabpanel', 'aria-labelledby': compact \? SECTION_PICKER_ID : sectionTabId\(id\) \}\)/)
  for (const id of ['shop', 'contact', 'products', 'posts', 'about', 'faq', 'features']) {
    assert.match(surface, new RegExp('<div id="portal-section-' + id + '" className=\\{[^\\n]*\\} \\{\\.\\.\\.panel\\(\'' + id + '\'\\)\\}>'), id + ' is a tab panel')
  }
})

runTest('T-L4: the section picker is a menu of seven radio items; the chips are a tablist with a roving tabindex', () => {
  const nav = noComments(editorFile('EditorSectionNav.tsx'))
  assert.match(nav, /aria-haspopup="menu"/)
  assert.match(nav, /role="menuitemradio"[\s\S]*aria-checked=/)
  assert.match(nav, /aria-label=\{nameWithMarkers\(`\$\{sectionsLabel\}: \$\{currentLabel\}`, currentMarks\)\}/, 'the picker\'s name reads "Sections: Shop", plus the words of its markers')
  assert.equal(count(nav, /ed\('web_editor_sections'/g), 1, 'the word "Sections" is asked for once and handed down')
  assert.match(nav, /role="tablist"/)
  assert.match(nav, /role="tab"[\s\S]*tabIndex=\{/, 'a roving tabindex')
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Escape']) assert.ok(nav.includes(`'${key}'`), `${key} is handled`)
  // The open tab is a different element from a closed one, so selecting by key remounts the tab reached: focus must follow the commit.
  assert.match(nav, /focusAfterSelect\.current = true\s*onSelect\(target\.id\)/, 'an arrow key selects, then focus moves once the new tab is mounted')
  assert.match(nav, /useEffect\(\(\) => \{\s*if \(!focusAfterSelect\.current\) return\s*focusAfterSelect\.current = false\s*chips\.current\.get\(active\)\?\.focus\(\)\s*\}, \[active\]\)/)
  // The menu hangs from its button, so it moves with the bar however the page shifts (a scroll, a collapsing app header, a resize). Fixed to the
  // screen it closed on every scroll event, and a late one shut it as it opened.
  assert.match(nav, /role="menu"[\s\S]*className="absolute left-0 top-full /, 'the menu is absolute under its button')
  assert.match(nav, /className="absolute left-0 top-full [^"]*\bw-max\b[^"]*\bmin-w-full\b/, 'as wide as its longest name (an absolute box is otherwise capped at the button width and wraps Khmer)')
  assert.doesNotMatch(nav, /\bfixed\b/, 'and not fixed to the screen')
  assert.doesNotMatch(nav, /addEventListener\('(?:scroll|resize)'/, 'so there is no scroll or resize handler to close it')
  assert.match(nav, /web_editor_unsaved/, 'a dirty dot has sr-only text')
  assert.match(nav, /web_editor_seller_missing/, 'the amber Contact marker has sr-only text')
  assert.match(nav, /amber/, 'and differs in colour from the dirty dot')
})

runTest('T-L4b: on a short row the picker\'s word gives way (an ellipsis, with room for Khmer) and its icon, chevron and markers never do', () => {
  const nav = noComments(editorFile('EditorSectionNav.tsx'))
  // The word is the only part that may shrink: min-w-0 down the chain (a flex item is otherwise as wide as its text) and an ellipsis at the end.
  // py-1 because overflow:hidden clips at the line box, and Khmer vowel signs and subscripts stand outside a box sized for Latin text.
  assert.match(nav, /<span className="min-w-0 truncate py-1">\{currentLabel\}<\/span>/, 'the picker word truncates, with vertical room')
  assert.match(nav, /<button\s+ref=\{buttonRef\}[\s\S]*?className="inline-flex min-h-11 min-w-0 max-w-full /, 'the picker button may shrink below its text')
  // At 320 px in Khmer the chevron crossed the button's edge and the dot was drawn under Save: none of these may give up its room.
  const picker = nav.slice(nav.indexOf('<CurrentIcon'), nav.indexOf('{open ? ('))
  assert.match(picker, /<CurrentIcon className="h-5 w-5 shrink-0"/, 'the section icon keeps its room')
  assert.match(picker, /<ChevronDown className="h-4 w-4 shrink-0"/, 'the chevron keeps its room')
  const markers = nav.slice(nav.indexOf('function Markers'), nav.indexOf('type InnerProps'))
  assert.match(markers, /className="h-2 w-2 shrink-0 rounded-full/, 'the unsaved dot keeps its room')
  assert.match(markers, /<AlertTriangle aria-hidden className="h-3\.5 w-3\.5 shrink-0/, 'the amber triangle keeps its room')
  // Below 360 px the gaps and padding tighten so less of the word is lost.
  assert.match(nav, /max-\[359px\]:gap-1\.5 max-\[359px\]:px-2/, 'the picker tightens on the narrowest phones')
  const bar = noComments(editorFile('EditorBar.tsx'))
  assert.match(bar, /max-\[359px\]:px-2/, 'and so does the bar')
  assert.match(bar, /max-\[359px\]:gap-1\.5/)
})

if (failed) process.exit(1)
