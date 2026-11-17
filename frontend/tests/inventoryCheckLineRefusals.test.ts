import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'

// Every refusal the line decision and Approve-lines routes can answer (docs/contracts/inventory-check-requests-20261117.md sections 1, 2 and 5b) has its own translated sentence in both
// packs, so a refused line says why. Only outcome_unknown (503) is not a refusal: its request is repeated, and it has no sentence here.
const CONTRACT_CODES = ['inventory_check_invalid_request', 'inventory_check_request_id_required', 'inventory_check_invalid_id', 'inventory_check_invalid_action', 'inventory_check_invalid_note', 'inventory_check_quantity_required',
  'inventory_check_invalid_quantity', 'inventory_check_target_not_whole', 'inventory_check_lots_required', 'inventory_check_lots_not_allowed', 'inventory_check_line_date_not_counted', 'inventory_check_approve_required',
  'inventory_check_adjust_required', 'inventory_check_self_approval', 'inventory_check_authority_changed', 'inventory_check_session_not_found', 'inventory_check_approval_not_found', 'inventory_check_line_not_found',
  'inventory_check_approval_decided', 'inventory_check_approval_lines_changed', 'inventory_check_line_applied', 'inventory_check_line_in_progress', 'inventory_check_count_superseded', 'inventory_check_line_already_rejected',
  'inventory_check_line_not_decided', 'inventory_check_baseline_missing', 'inventory_check_modify_matches_seen', 'inventory_check_conflict', 'inventory_check_request_reused',
  'inventory_check_line_rejected', 'inventory_check_approval_in_progress', 'inventory_check_product_ids_required', 'inventory_check_count_in_progress']
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const missing = CONTRACT_CODES.filter(code => !Object.hasOwn(REFUSAL_MESSAGES, code))
assert.deepEqual(missing, [], `refusal codes with no sentence: ${missing.join(', ')}`)
assert.equal(Object.hasOwn(REFUSAL_MESSAGES, 'inventory_check_outcome_unknown'), false, 'an unknown outcome is repeated, never shown as a definite refusal')
const own = new Set<string>()
for (const code of CONTRACT_CODES) {
  const { key, fallback } = REFUSAL_MESSAGES[code]
  assert.ok(en[key], `en has ${key}`); assert.ok(km[key], `km has ${key}`)
  assert.match(km[key], /[\u1780-\u17FF]/, `${key}: km is Khmer`); assert.notEqual(km[key], en[key], `${key}: km is not the English text`)
  assert.equal(en[key], fallback, `${key}: the in-code fallback is the English text`)
  own.add(key)
}
// The codes the contract gives distinct meanings must not collapse onto one sentence (the invalid-request family and the two not-found codes share one on purpose).
for (const code of ['inventory_check_line_applied', 'inventory_check_line_in_progress', 'inventory_check_line_rejected', 'inventory_check_line_already_rejected', 'inventory_check_line_not_decided', 'inventory_check_line_not_found',
  'inventory_check_lots_required', 'inventory_check_lots_not_allowed', 'inventory_check_line_date_not_counted', 'inventory_check_quantity_required', 'inventory_check_invalid_quantity', 'inventory_check_modify_matches_seen',
  'inventory_check_request_reused', 'inventory_check_conflict']) {
  const holders = Object.entries(REFUSAL_MESSAGES).filter(([, value]) => value.key === REFUSAL_MESSAGES[code].key)
  assert.equal(holders.length, 1, `${code} has a sentence of its own`)
}
console.log(`PASS Inventory check line refusals: ${CONTRACT_CODES.length} contract codes, each with an English and a Khmer sentence`)
