import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { laterSetLabel, laterSetsWarning, laterSetsWarningFrame, revertEffectLine, signedQuantity } from '../src/utils/stockRevertPreview.ts'
import { translateMovementRowType } from '../src/components/inventory/movementGroups.ts'
import { fmtDate } from '../src/utils/formatters.ts'

// REVERT-SET (owner report, 6 Oct 2026, SK-II Gentle Cleanser 20g): the owner
// pressed Revert on the delivery of 30 believing it was the Set of +27 two
// rows above. Every Revert confirm now says what it will do and names the
// later Set it leaves applied; a Set row reads "Set stock", not "Adjustment".

const packs = Object.fromEntries(['en', 'km'].map((lang) => [lang, JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8'))])) as Record<string, Record<string, string>>
const trFor = (lang: string) => (key: string, fallback: string) => packs[lang][key] ?? fallback
const en = trFor('en')
const km = trFor('km')

// The production case, as the Worker previews it (lib/stockRevertEffect.ts).
const deliveryEffect = { quantity: -30, batchId: 61482, receivedAt: '2026-09-29', lotCode: '09292026', branchId: 2, branchName: 'Shop', branchBefore: 60, branchAfter: 30 }
const setStillApplied = [{ movementId: 48034, quantity: 27, batchId: 56725, receivedAt: '2026-09-02', createdAt: '2026-09-30 01:44:02' }]

assert.equal(signedQuantity(27), '+27')
assert.equal(signedQuantity(-30), '−30')
assert.equal(signedQuantity(0), '0')

assert.equal(revertEffectLine(deliveryEffect, en, fmtDate), `This Revert: −30 from received ${fmtDate('2026-09-29')} at Shop (60 → 30).`)
assert.equal(revertEffectLine({ ...deliveryEffect, receivedAt: null, lotCode: null, branchName: null }, en, fmtDate), 'This Revert: −30 at this branch (60 → 30).',
  'no lot: the branch-only sentence, and a missing branch name reads "this branch"')
assert.match(revertEffectLine(deliveryEffect, km, fmtDate), /^ការត្រឡប់វិញនេះ៖ −30 /, 'Khmer comes from the km pack, not the English fallback')

assert.equal(laterSetLabel(setStillApplied[0], fmtDate), `+27 · ${fmtDate('2026-09-02')} (#48034)`)
const warning = laterSetsWarning(setStillApplied, en, fmtDate)
assert.ok(warning.includes('+27') && warning.includes('#48034'), warning)
assert.equal(laterSetsWarning([], en, fmtDate), '', 'no later Set: no warning')
assert.equal(laterSetsWarning(null, en, fmtDate), '', 'not checked: no warning, never a guess')
for (const lang of ['en', 'km']) {
  const frame = laterSetsWarningFrame(trFor(lang))
  assert.ok(frame.before.length > 0 && !frame.before.includes('{sets}') && !frame.after.includes('{sets}'), `${lang} frame splits at {sets}`)
  assert.ok(packs[lang].revert_later_sets.includes('{sets}'), `${lang} pack keeps the {sets} slot`)
  for (const slot of ['{change}', '{lot}', '{branch}', '{before}', '{after}']) assert.ok(packs[lang].revert_effect_lot.includes(slot), `${lang} revert_effect_lot has ${slot}`)
}

// A Set's forward rows read "Set stock"; its Undo is a Revert; a plain adjustment stays "Adjustment".
const t = (key: string) => packs.en[key]
assert.equal(translateMovementRowType({ movement_type: 'adjustment', reference_id: 'stock-set:c7b78789-d9ec-45fa-ace6-8bb6612c290a:0' }, t), 'Set stock')
assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: 'stock-set:c7b78789-d9ec-45fa-ace6-8bb6612c290a:2' }, t), 'Set stock')
assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: 'revert:48034' }, t), 'Revert')
assert.equal(translateMovementRowType({ movement_type: 'adjustment', reference_id: null }, t), 'Adjustment')
assert.equal(translateMovementRowType({ movement_type: 'adjustment', reference_id: 'stock-set:x:0' }, (key) => packs.km[key]), packs.km.movement_type_stock_set)
// A stock-in session's History Undo / Redo rows (Worker sessionReplaySql) are
// named as such; the session's own receipt lines stay "Add Stock".
assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: '12', session_replay: 1 }, t), 'Session undo')
assert.equal(translateMovementRowType({ movement_type: 'add', reference_id: '12', session_replay: 1 }, t), 'Session redo')
assert.equal(translateMovementRowType({ movement_type: 'add', reference_id: '12', session_replay: 0 }, t), 'Add Stock')
assert.equal(translateMovementRowType({ movement_type: 'remove', reference_id: '12', session_replay: 1 }, (key) => packs.km[key]), packs.km.movement_type_session_undo)

// Wiring: both confirms render the effect / warning, and the product Records
// float shows both ends of a Revert instead of the raw "revert:48026" token.
const stockChanges = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
assert.match(stockChanges, /data-revert-effect="true"[\s\S]{0,200}revertEffectLine\(revertPreview\.effect/)
assert.match(stockChanges, /data-revert-later-sets="true"[\s\S]{0,900}openMovementById\(set\.movementId\)/, 'each later Set links to its own row')
assert.match(stockChanges, /effect: response\.effect \?\? null, historyEffect: response\.historyEffect \?\? null, laterSets: Array\.isArray\(response\.laterSets\)/)
const sessions = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
assert.match(sessions, /laterSetsWarning\(laterSets, tr, fmtDate\)/)
assert.match(sessions, /row\.later_open_sets \?\? \[\]/)
const records = readFileSync(new URL('../src/components/products/surfaces/ProductDetailReport.tsx', import.meta.url), 'utf8')
assert.match(records, /data-revert-tag="reverted"/)
assert.match(records, /linkTo\(revertsId, tr\('movement_reverts_link'/)
assert.match(records, /linkTo\(revertedById, tr\('movement_reverted_by_link'/)
assert.match(records, /namesNoRecord = revertsId != null \|\| isStockSetMovement\(row\.reference_id\)/, 'a Revert or Set row never shows its raw token as the Source')
assert.match(records, /const source = namesNoRecord \? receipt : receipt \|\|/)

// A History Undo/Redo of a stock record refused with a Stock Changes code reads
// as the Revert of the same row would -- in Khmer too, numbers filled -- and
// the replay-only codes the Worker returns (lib/stockSession.ts) are mapped.
const { STOCK_REVERT_ERRORS, STOCK_REPLAY_ONLY_ERRORS, stockRevertErrorText } = await import('../src/utils/stockRevertError.ts')
const transport = readFileSync(new URL('../src/api/actionHistoryTransport.ts', import.meta.url), 'utf8')
assert.match(transport, /STOCK_REPLAY_ONLY_ERRORS, stockRevertErrorText \} = await import\('\.\.\/utils\/stockRevertError\.ts'\)/)
const session = readFileSync(new URL('../../cloudflare/src/lib/stockSession.ts', import.meta.url), 'utf8')
for (const code of Object.keys(STOCK_REPLAY_ONLY_ERRORS)) {
  assert.ok(session.includes(`'${code}'`), `the Worker returns ${code}`)
  assert.ok(!(code in STOCK_REVERT_ERRORS), `${code} is replay-only`)
  for (const lang of ['en', 'km']) assert.ok(String(packs[lang][STOCK_REPLAY_ONLY_ERRORS[code][0]] || '').trim(), `${lang} pack has ${code}`)
}
for (const code of ['revert_insufficient_lot_stock', 'revert_insufficient_branch_stock', 'revert_stock_in_line_edited', 'revert_session_undone', 'revert_lot_moved', 'stock_changed']) {
  assert.ok(code in STOCK_REVERT_ERRORS, `${code} (returned by the Set, line-edit and session replays) is mapped`)
}
const kmText = stockRevertErrorText({ code: 'revert_insufficient_lot_stock', params: { available: 1, needed: 2 } }, km)
assert.ok(kmText.includes('1') && kmText.includes('2') && !/\{\w+\}/.test(kmText) && !/Cannot/.test(kmText), kmText)
assert.equal(stockRevertErrorText({ code: 'revert_session_line_reverted' }, en), packs.en.revert_err_session_line_reverted)

console.log('stockRevertPreview.test: OK')
