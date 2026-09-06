// i18n:13 / i18n:14 (audit lane "manage-lists-i18n"): ReturnReasonManagerModal
// hardcoded its title, placeholder, tooltips, empty state, and every
// prompt/confirm string in English -- unlike its sibling
// InventoryReasonManagerModal, which already threads a translator through
// every user-facing string. ManageBrandsModal also hardcoded one leftover
// placeholder ("e.g. L'Oreal") after the rest of that modal's strings were
// keyed. This is a source-scan test (these are modals with no render harness
// in this suite) run against 6e3abfea: it fails there because the modal took
// only `t` and never called a translator for these strings at all.
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const modalSource = fs.readFileSync(new URL('../src/components/returns/ReturnReasonManagerModal.tsx', import.meta.url), 'utf8')
const returnsSource = fs.readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const brandsSource = fs.readFileSync(new URL('../src/components/products/lookups/ManageBrandsModal.tsx', import.meta.url), 'utf8')
const enPack = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const kmPack = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

runTest('ReturnReasonManagerModal accepts a fallback-aware translator like its InventoryReasonManagerModal sibling', () => {
  assert.match(modalSource, /tr:\s*Translate/, 'Props should declare a tr translator (key, fallbackEn?, fallbackKm?) => string')
  assert.match(modalSource, /export default function ReturnReasonManagerModal\(\{[^}]*\btr\b/, 'the component should destructure tr from props')
})

runTest('Returns.tsx wires its own tr into the reason manager modal', () => {
  assert.match(returnsSource, /<ReturnReasonManagerModal[\s\S]{0,200}tr=\{tr\}/, 'Returns.tsx should pass its local tr into ReturnReasonManagerModal')
})

runTest('the modal title, tab labels, and add-row are translated, not hardcoded', () => {
  assert.doesNotMatch(modalSource, /title="Return reasons"/, 'the Modal title should no longer be a bare English literal')
  assert.match(modalSource, /tr\('return_reasons_title'/, 'the title should resolve through tr(\'return_reasons_title\', ...)')
  assert.doesNotMatch(modalSource, />\s*\{value\}\s*<\/button>/, 'the customer/supplier tab should not render the raw scope value untranslated')
  assert.match(modalSource, /tr\(value,/, 'the tab label should translate the scope value through tr(value, ...)')
  assert.doesNotMatch(modalSource, /placeholder="Add reusable reason"/, 'the add-reason input should not hardcode its placeholder')
  assert.match(modalSource, /tr\('new_reason_placeholder'/, 'the placeholder should reuse the shared new_reason_placeholder key (see InventoryReasonManagerModal)')
})

runTest('the per-row rename/remove tooltips and aria-labels are translated, reusing the shared rename/remove/preview_and_replace keys', () => {
  assert.doesNotMatch(modalSource, /title="Preview and rename"/, 'the pencil tooltip should not be a bare English literal')
  assert.doesNotMatch(modalSource, /title="Remove saved choice"/, 'the trash tooltip should not be a bare English literal')
  assert.doesNotMatch(modalSource, /aria-label=\{`Rename \$\{reason\}`\}/, 'the pencil aria-label should not string-interpolate a raw English word')
  assert.doesNotMatch(modalSource, /aria-label=\{`Remove \$\{reason\}`\}/, 'the trash aria-label should not string-interpolate a raw English word')
  assert.match(modalSource, /tr\('preview_and_replace'/, 'the pencil tooltip should reuse the shared preview_and_replace key (see ExpenseLabelManagerModal)')
  assert.match(modalSource, /tr\('remove_saved_reason_choice'/, 'the trash tooltip should use a translated key')
  assert.match(modalSource, /tr\('rename', 'Rename'\)\}\s*\$\{reason\}/, 'the pencil aria-label should translate the verb via the shared rename key')
  assert.match(modalSource, /tr\('remove', 'Remove'\)\}\s*\$\{reason\}/, 'the trash aria-label should translate the verb via the shared remove key')
})

runTest('the empty state and loading text are translated', () => {
  assert.doesNotMatch(modalSource, /No saved reasons\. Free-text entry remains available\./, 'the empty-state sentence should not be a hardcoded literal')
  assert.match(modalSource, /tr\('no_saved_reasons'/, 'the empty state should reuse the shared no_saved_reasons key (see InventoryReasonManagerModal)')
  assert.match(modalSource, /tr\('return_reason_free_text_note'/, 'the free-text remark should resolve through a translated key')
  assert.doesNotMatch(modalSource, />Loading…</, 'the loading placeholder should not be a hardcoded literal')
  assert.match(modalSource, /tr\('loading'/, 'the loading placeholder should reuse the shared loading key')
})

runTest('every prompt/confirm/notify string in the rename and remove flows is translated', () => {
  // Each pattern is anchored on the EXACT old call shape (the argument
  // immediately follows the opening paren/colon with no tr(...) wrapper) so
  // it cannot accidentally match the new tr('key', 'same English fallback')
  // call, which still legitimately carries the same English text as its
  // fallback argument.
  const hardcodedLiterals: RegExp[] = [
    /window\.prompt\('Rename saved return reason', from\)/,
    /notify\('That reason already exists\.', 'info'\)/,
    /persist\(\{ \.\.\.presets, \[scope\]: nextList \}, 'Saved return reason added\.'\)/,
    /`\$\{linked\} live \$\{scope\} return\$\{linked === 1/,
    /notify\(replaceLinked \? 'Saved reason and linked returns updated\.' : 'Saved reason updated; existing returns were preserved\.', 'success'\)/,
    /: 'Failed to rename return reason', 'error'\)/,
    /window\.confirm\(`Remove "\$\{value\}" from saved choices/,
    /persist\(removeReturnReasonPreset\(presets, scope, value\), 'Saved choice removed; existing returns were preserved\.'\)/,
    /: 'Failed to load saved return reasons', 'error'\)/,
    /: 'Failed to save return reasons', 'error'\)/,
  ]
  for (const pattern of hardcodedLiterals) {
    assert.doesNotMatch(modalSource, pattern, `found a still-hardcoded literal matching ${pattern}`)
  }
  assert.match(modalSource, /tr\('rename_reason_prompt'/, 'the rename prompt should reuse the shared rename_reason_prompt key (see StockAdjustModal/Inventory.tsx)')
  assert.match(modalSource, /tr\('return_reason_exists_notice'/)
  assert.match(modalSource, /tr\('return_reason_added'/)
  assert.match(modalSource, /tr\('return_reason_replace_confirm_intro'/)
  assert.match(modalSource, /tr\('return_reason_updated_linked'/)
  assert.match(modalSource, /tr\('return_reason_updated_only'/)
  assert.match(modalSource, /tr\('return_reason_rename_failed'/)
  assert.match(modalSource, /tr\('return_reason_remove_confirm'/)
  assert.match(modalSource, /tr\('return_reason_removed'/)
  assert.match(modalSource, /tr\('return_reason_load_failed'/)
  assert.match(modalSource, /tr\('return_reason_save_failed'/)
})

runTest('ManageBrandsModal no longer hardcodes the "e.g. L\'Oreal" placeholder (i18n-14)', () => {
  assert.doesNotMatch(brandsSource, /placeholder="e\.g\. L'Oreal"/, 'the add-brand placeholder should not be a bare English literal')
  assert.match(brandsSource, /t\('brand_name_example_placeholder'\)/, 'the placeholder should resolve through a translated key')
})

const NEW_KEYS = [
  'return_reasons_title',
  'return_reason_added',
  'return_reason_exists_notice',
  'return_reason_free_text_note',
  'return_reason_load_failed',
  'return_reason_merge_notice',
  'return_reason_remove_confirm',
  'return_reason_removed',
  'return_reason_rename_failed',
  'return_reason_replace_confirm_cancel',
  'return_reason_replace_confirm_intro',
  'return_reason_replace_confirm_note',
  'return_reason_replace_confirm_ok',
  'return_reason_save_failed',
  'return_reason_updated_linked',
  'return_reason_updated_only',
  'remove_saved_reason_choice',
  'brand_name_example_placeholder',
]

runTest('every new key this lane adds exists as a real string in both lang packs', () => {
  for (const key of NEW_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(enPack, key), `en.json is missing "${key}"`)
    assert.ok(Object.prototype.hasOwnProperty.call(kmPack, key), `km.json is missing "${key}"`)
    assert.equal(typeof enPack[key], 'string', `en.json "${key}" should be a string`)
    assert.equal(typeof kmPack[key], 'string', `km.json "${key}" should be a string`)
    assert.ok((enPack[key] as string).length > 0, `en.json "${key}" should not be empty`)
    assert.ok((kmPack[key] as string).length > 0, `km.json "${key}" should not be empty`)
    // The Khmer value must be genuinely Khmer, not a copy-pasted English
    // fallback left behind (verify:i18n's isBrokenLocalizedString covers
    // other breakage shapes, but a plain equal-to-English string still
    // parses as "present" -- catch that here too).
    assert.notEqual(kmPack[key], enPack[key], `km.json "${key}" looks identical to the English string`)
  }
})

runTest('the reused sibling keys this lane depends on actually exist in both packs', () => {
  const reused = ['new_reason_placeholder', 'no_saved_reasons', 'loading', 'rename', 'remove', 'preview_and_replace', 'rename_reason_prompt', 'add', 'customer', 'supplier']
  for (const key of reused) {
    assert.ok(Object.prototype.hasOwnProperty.call(enPack, key), `en.json is missing reused key "${key}"`)
    assert.ok(Object.prototype.hasOwnProperty.call(kmPack, key), `km.json is missing reused key "${key}"`)
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exitCode = 1
} else {
  console.log('returnReasonManagerI18n tests passed')
}
