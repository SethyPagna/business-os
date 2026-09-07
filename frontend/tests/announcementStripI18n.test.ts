import assert from 'node:assert/strict'
import fs from 'node:fs'

// The Announcement Strip editor deliberately keeps its operator-facing copy
// in English. This source check protects the complete label/message contract
// without claiming that these strings route through the portal language packs.
// The media-picker labels are the exception: they already use the shared
// portalEditor copy helper and must keep doing so.

const source = fs.readFileSync(
  new URL('../src/components/catalog/ManagePromotionsModal.tsx', import.meta.url),
  'utf8',
)

const requiredPatterns: Array<[string, RegExp]> = [
  ['modal title', /<Modal title="Announcement Strip"/],
  ['editor explanation', /Small, quick banner cards that scroll horizontally at the very top of the public catalog page/],
  ['new-promotion action', />\s*New promotion\s*</],
  ['new/edit heading', /editingId === 'new' \? 'New promotion' : 'Edit promotion'/],
  ['title label', />Title \*</],
  ['subtitle label', />Subtitle</],
  ['badge-text label', />Badge text</],
  ['badge-color label', />Badge color</],
  ['link target label', />Links to</],
  ['product label', />Product \*</],
  ['show-from label', />Show from \(optional\)</],
  ['show-until label', />Show until \(optional\)</],
  ['portal visibility label', />Visible on the portal now</],
  ['empty state', />No promotions yet\.</],
  ['empty-state action hint', /Click "New promotion" above to add your first banner\./],
  ['drag accessible name', /aria-label="Drag to reorder"/],
]

for (const [label, pattern] of requiredPatterns) {
  assert.match(source, pattern, `ManagePromotionsModal must retain its English ${label}`)
}

const requiredNeedles: Array<[string, string]> = [
  ['show-from accessible name', 'ariaLabel="Show from"'],
  ['show-until accessible name', 'ariaLabel="Show until"'],
  ['linked-target summary', '`Links to: ${'],
  ['empty linked-target summary', ": 'No link'"],
  ['product-picker placeholder', "label: 'Select a product…'"],
  ['title placeholder', 'placeholder="Summer Sale"'],
  ['subtitle placeholder', 'placeholder="20% off all skincare this week"'],
  ['badge placeholder', 'placeholder="SALE"'],
  ['link placeholder', 'placeholder="/catalog?category=Skincare or https://…"'],
  ['load failure', "getErrorMessage(error, 'Failed to load promotions')"],
  ['image upload rejection', "|| 'Image upload failed')"],
  ['image failure', "getErrorMessage(error, 'Image upload failed')"],
  ['required title validation', "return 'Title is required'"],
  ['required linked product validation', "return 'Choose a product to link to'"],
  ['required link validation', "return 'Enter a link URL'"],
  ['safe-link validation', "return 'Enter a link URL that starts with http:// or https://'"],
  ['date-order validation', "return 'End date must be after start date'"],
  ['created notice', "notify('Promotion created', 'success')"],
  ['updated notice', "notify('Promotion updated', 'success')"],
  ['save failure', "getErrorMessage(error, 'Failed to save promotion')"],
  ['delete confirmation', 'window.confirm(`Delete "${promo.title}"? This can\'t be undone.`)'],
  ['deleted notice', "notify('Promotion deleted', 'success')"],
  ['delete failure', "getErrorMessage(error, 'Failed to delete promotion')"],
  ['visibility failure', "getErrorMessage(error, 'Failed to update promotion')"],
  ['reorder failure', "getErrorMessage(error, 'Failed to save new order')"],
  ['save progress label', "'Saving…' : 'Save promotion'"],
  ['visibility state labels', "'Active' : 'Hidden'"],
  ['edit tooltip', 'title="Edit"'],
  ['delete tooltip', 'title="Delete"'],
  ['edit accessible name', 'aria-label={`Edit ${promo.title}`}'],
  ['delete accessible name', 'aria-label={`Delete ${promo.title}`}'],
  ['edit visible label', 'sm:inline">Edit</span>'],
  ['delete visible label', 'sm:inline">Delete</span>'],
]

for (const [label, needle] of requiredNeedles) {
  assert.ok(source.includes(needle), `ManagePromotionsModal must retain its English ${label}`)
}

for (const key of ['image', 'noImage', 'uploading', 'replaceImage', 'uploadImage']) {
  assert.match(source, new RegExp(`copy\\('${key}'`), `media control must keep using copy('${key}', ...)`)
}

assert.match(source, /isSafeLinkUrl\(form\.link_url\)/, 'the English URL error must remain backed by the shared URL allowlist')
assert.match(source, /unsavedChanges=\{\{ dirty: editingId !== null \}\}/, 'closing the English editor must still guard a draft')
assert.match(source, />\s*Cancel\s*<\/button>/, 'the edit form keeps its English Cancel action')

console.log('PASS announcementStripI18n: deliberate English editor copy and translated media controls remain complete')
