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
  }
  assert.match(editor, /const aboutBlocksFull = aboutBlocks\.length >= ABOUT_BLOCKS_MAX/)
  assert.match(editor, /\{aboutBlocksFull \? \(\s*<p id="portal-about-blocks-max" role="status"[^>]*>\{ed\('web_editor_blocks_max', 'Up to 30 blocks\.', 'រហូតដល់ ៣០ ប្លុក។'\)\}<\/p>/, 'the reason is shown, not only hovered')
})

if (failed) process.exit(1)
