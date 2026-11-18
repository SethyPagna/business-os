import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { REFUSAL_MESSAGES } from '../src/components/inventory/inventoryCheckRefusals.ts'

// Every refusal the Worker can answer from the count routes has its own translated sentence in both packs, so a refused line says why. The codes are NOT a list copied by hand: they are read from the
// Worker's own source, where a refusal is raised (fail, the session / query error constructors, the planner's refuse(), a statement guard: a code written there, named by a constant or chosen by a ternary). A new Worker code with no
// sentence, and no entry below saying why it needs none, turns this test red.
const SRC = new URL('../../cloudflare/src/', import.meta.url)
const worker = (file: string) => readFileSync(new URL(file, SRC), 'utf8')
const sourceFiles = (directory: URL): URL[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(new URL(`${entry.name}/`, directory)) : entry.name.endsWith('.ts') ? [new URL(entry.name, directory)] : [])
// A code passed as a name (APPROVAL_CLAIM_LOST) is the string its constant holds: every constant of the Worker source, by name (a name declared twice keeps both values).
const CONSTANTS = new Map<string, Set<string>>()
for (const file of sourceFiles(SRC)) for (const match of readFileSync(file, 'utf8').matchAll(/\bconst ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*'([a-z][a-z_]*)'/g)) CONSTANTS.set(match[1], (CONSTANTS.get(match[1]) ?? new Set()).add(match[2]))
// A refusal is raised through fail(status, code), a session / query error constructor, the planner's refuse(code) or a statement guard. The code may be written there, named by a constant, or chosen
// between two by a ternary, so everything inside the call's arguments is read: every 'inventory_check_*' string, the string right after a status, and every constant name.
const REFUSAL_CALL = /\b(?:fail|refuse|guard|[A-Z][A-Za-z]*Error)\(/g
function callArguments(source: string, open: number): string {
  let depth = 0, quote = ''
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]
    if (quote) { if (char === '\\') at += 1; else if (char === quote) quote = ''; continue }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return source.slice(open + 1, at)
  }
  return source.slice(open + 1)
}
const codesIn = (file: string) => {
  const source = worker(file), codes = new Set<string>()
  for (const call of source.matchAll(REFUSAL_CALL)) {
    const args = callArguments(source, call.index + call[0].length - 1)
    for (const match of args.matchAll(/'(inventory_check_[a-z_]+)'/g)) codes.add(match[1])
    for (const match of args.matchAll(/^\s*\d{3},\s*'([a-z_]+)'|^\s*'([a-z_]+)'\s*[,)]/g)) codes.add(match[1] ?? match[2])
    for (const match of args.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)) for (const value of CONSTANTS.get(match[1]) ?? []) codes.add(value)
  }
  return codes
}

// The approval and per-line decision routes: every code needs a sentence, bar the unknown results (503), whose request is repeated and never shown as a refusal.
const APPROVAL_FILES = ['lib/inventoryCheckApprovals.ts', 'lib/inventoryCheckLineInput.ts']
const UNKNOWN_RESULTS = ['inventory_check_outcome_unknown', 'inventory_check_saved_refresh']
// The session, list and observation routes raise more codes, which those screens show in their own words or as the generic "not saved". They are named here, each once, so a NEW code cannot pass unnoticed.
const OTHER_SCREENS = ['inventory_check_revision_required', 'inventory_check_schema_unavailable', 'inventory_check_membership_unavailable', 'inventory_check_invalid_filter', 'inventory_check_invalid_page',
  'inventory_check_stock_schema_unavailable', 'inventory_check_invalid_title', 'inventory_check_invalid_scope', 'inventory_check_invalid_state', 'inventory_check_reason_required', 'inventory_check_item_not_found',
  'inventory_check_session_final', 'inventory_check_invalid_query', 'inventory_check_view_required', 'invalid_session']
const SHARED_FILES = ['lib/inventoryCheckSessions.ts', 'routes/inventoryChecks.ts']

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const approvalCodes = new Set(APPROVAL_FILES.flatMap(file => [...codesIn(file)]))
const sharedCodes = new Set(SHARED_FILES.flatMap(file => [...codesIn(file)]))
assert.ok(approvalCodes.size >= 30 && sharedCodes.size >= 15, `the scan finds the Worker's codes (${approvalCodes.size} in the approval files, ${sharedCodes.size} in the shared ones)`)
for (const code of ['inventory_check_line_in_progress', 'inventory_check_modify_matches_seen', 'inventory_check_approval_in_progress']) assert.ok(approvalCodes.has(code), `the scan reads ${code} from the Worker`)
for (const code of ['inventory_check_not_available', 'inventory_check_permission_required']) assert.ok(sharedCodes.has(code), `the scan reads ${code} from the Worker (finding 8 of the C2 review)`)

const mustHave = new Set([...approvalCodes, ...sharedCodes].filter(code => !UNKNOWN_RESULTS.includes(code) && !OTHER_SCREENS.includes(code)))
const missing = [...mustHave].filter(code => !Object.hasOwn(REFUSAL_MESSAGES, code)).sort()
assert.deepEqual(missing, [], `Worker refusal codes with no sentence (add one to inventoryCheckRefusals.ts and both packs, or name it in OTHER_SCREENS with its reason): ${missing.join(', ')}`)
const everyCode = new Set([...approvalCodes, ...sharedCodes])
assert.deepEqual(OTHER_SCREENS.filter(code => !everyCode.has(code)), [], 'every name in OTHER_SCREENS is still a code the Worker raises')
assert.deepEqual(OTHER_SCREENS.filter(code => Object.hasOwn(REFUSAL_MESSAGES, code)), [], 'a code that has a sentence is not listed as one that needs none')
assert.deepEqual(APPROVAL_FILES.flatMap(file => [...codesIn(file)]).filter(code => OTHER_SCREENS.includes(code)), [], 'no approval or line-decision code hides in OTHER_SCREENS')
for (const code of UNKNOWN_RESULTS) assert.equal(Object.hasOwn(REFUSAL_MESSAGES, code), false, `${code}: an unknown outcome is repeated, never shown as a definite refusal`)

for (const code of mustHave) {
  const { key, fallback } = REFUSAL_MESSAGES[code]
  assert.ok(en[key], `en has ${key}`); assert.ok(km[key], `km has ${key}`)
  assert.match(km[key], /[\u1780-\u17FF]/, `${key}: km is Khmer`); assert.notEqual(km[key], en[key], `${key}: km is not the English text`)
  if (approvalCodes.has(code) || code === 'inventory_check_not_available' || code === 'inventory_check_permission_required') assert.equal(en[key], fallback, `${key}: the in-code fallback is the English text`)
}
// The codes that have distinct meanings must not collapse onto one sentence (the invalid-request family and the two not-found codes share one on purpose).
for (const code of ['inventory_check_line_applied', 'inventory_check_line_in_progress', 'inventory_check_line_rejected', 'inventory_check_line_already_rejected', 'inventory_check_line_not_decided', 'inventory_check_line_not_found',
  'inventory_check_lots_required', 'inventory_check_lots_not_allowed', 'inventory_check_line_date_not_counted', 'inventory_check_quantity_required', 'inventory_check_invalid_quantity', 'inventory_check_modify_matches_seen',
  'inventory_check_request_reused', 'inventory_check_conflict', 'inventory_check_not_available', 'inventory_check_permission_required']) {
  const holders = Object.entries(REFUSAL_MESSAGES).filter(([, value]) => value.key === REFUSAL_MESSAGES[code].key)
  assert.equal(holders.length, 1, `${code} has a sentence of its own`)
}
// The Khmer pack uses the app's own word for a login session, not the word for a count session (finding 13).
assert.match(km.inventory_check_error_authority_changed, /វគ្គចូលប្រើ/, 'authority_changed names the login session')
// An approver who is refused because another person holds the claim is told that, and to try again shortly (the claim ends when its holder has been idle a few minutes), in both packs.
assert.match(en.inventory_check_error_approval_in_progress, /^Another approver is applying this count.* Try again in a few minutes\.$/, 'en: another person is applying it, try again in a few minutes')
assert.match(km.inventory_check_error_approval_in_progress, /អ្នកអនុម័តម្នាក់ទៀតកំពុងអនុវត្តការរាប់នេះ.*ព្យាយាមម្តងទៀតក្នុងរយៈពេលប៉ុន្មាននាទី/, 'km says the same')
assert.equal(REFUSAL_MESSAGES.inventory_check_approval_in_progress.fallback, en.inventory_check_error_approval_in_progress, 'and the in-code fallback is that sentence')
console.log(`PASS Inventory check refusals: ${mustHave.size} Worker codes read from the Worker source, each with an English and a Khmer sentence`)
