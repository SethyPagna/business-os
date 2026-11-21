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
for (const file of sourceFiles(SRC)) for (const match of readFileSync(file, 'utf8').matchAll(/\bconst ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(['"`])([a-z][a-z_]*)\2/g)) CONSTANTS.set(match[1], (CONSTANTS.get(match[1]) ?? new Set()).add(match[3]))

// A refusal is raised through fail(status, code), a session / query error constructor, the planner's refuse(code) or a statement guard(sql, code, params). The code is read STRICTLY: it must be a quoted
// literal (any quote style, no ${}), an UPPER_CASE constant the scan resolved, or a ternary of those; `refused[0].code` (the first refusal the approval already raised, read by name) is also allowed.
// Anything else (a helper that builds or forwards a code, a variable, an object lookup) hides the code from this test, so it turns the test red instead of passing unseen.
const REFUSAL_CALL = /\b(?:fail|refuse|guard|[A-Z][A-Za-z]*Error)\(/g
const isQuote = (char: string) => char === "'" || char === '"' || char === '`'
const opens = (char: string) => char === '(' || char === '[' || char === '{'
const closes = (char: string) => char === ')' || char === ']' || char === '}'
function closeOf(source: string, open: number): number {
  let depth = 0, quote = ''
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]
    if (quote) { if (char === '\\') at += 1; else if (char === quote) quote = ''; continue }
    if (isQuote(char)) quote = char
    else if (opens(char)) depth += 1
    else if (closes(char) && --depth === 0) return at
  }
  return source.length
}
/** Splits at the commas that are not inside a quote or a bracket. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0, quote = '', from = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (quote) { if (char === '\\') at += 1; else if (char === quote) quote = ''; continue }
    if (isQuote(char)) quote = char
    else if (opens(char)) depth += 1
    else if (closes(char)) depth -= 1
    else if (char === ',' && depth === 0) { parts.push(text.slice(from, at).trim()); from = at + 1 }
  }
  const last = text.slice(from).trim()
  if (last) parts.push(last)
  return parts
}
/** The top-level position of the first `?` (or the `:` that closes the ternary opened before `from`), outside quotes and brackets; the ? of `?.` and `??` does not count. */
function topIndex(text: string, wanted: '?' | ':', from = 0): number {
  let depth = 0, quote = '', nested = 0
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]
    if (quote) { if (char === '\\') at += 1; else if (char === quote) quote = ''; continue }
    if (isQuote(char)) quote = char
    else if (opens(char)) depth += 1
    else if (closes(char)) depth -= 1
    else if (depth === 0 && char === '?' && (text[at + 1] === '?' || text[at + 1] === '.')) at += 1
    else if (depth === 0 && char === '?') { if (wanted === '?') return at; nested += 1 }
    else if (depth === 0 && char === ':' && wanted === ':') { if (nested === 0) return at; nested -= 1 }
  }
  return -1
}
/** The codes an expression can be, or null when its shape is not one the scan can read. */
function codesOf(expression: string): string[] | null {
  const text = expression.trim()
  const literal = /^(['"`])([A-Za-z0-9_]+)\1$/.exec(text)
  if (literal) return [literal[2]]
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return CONSTANTS.has(text) ? [...CONSTANTS.get(text)!] : null
  if (text === 'refused[0].code') return []
  const question = topIndex(text, '?')
  if (question < 0) return null
  const colon = topIndex(text, ':', question + 1)
  if (colon < 0) return null
  const yes = codesOf(text.slice(question + 1, colon)), no = codesOf(text.slice(colon + 1))
  return yes && no ? [...yes, ...no] : null
}
// The only calls allowed to pass a name on: the fail() helper of a file hands its own parameters to the error constructor.
const PASS_THROUGH = ['status, code, details', 'status, code']
type Read = { codes: Set<string>; unreadable: string[] }
const readCalls = (file: string, source = worker(file)): Read => {
  const codes = new Set<string>(), unreadable: string[] = []
  for (const call of source.matchAll(REFUSAL_CALL)) {
    if (/function\s+$/.test(source.slice(Math.max(0, call.index - 12), call.index))) continue
    const open = call.index + call[0].length - 1, args = source.slice(open + 1, closeOf(source, open)), parts = splitTop(args)
    if (!parts.length) continue
    if (PASS_THROUGH.includes(args.trim())) continue
    const wanted = call[0] === 'refuse(' ? parts[0] : parts[1]
    const read = wanted === undefined ? null : codesOf(wanted)
    if (read) for (const code of read) codes.add(code)
    else unreadable.push(`${file}: ${call[0]}${args.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
  return { codes, unreadable }
}
const codesIn = (file: string) => readCalls(file).codes

// The approval and per-line decision routes: every code needs a sentence, bar the unknown results (503), whose request is repeated and never shown as a refusal.
const APPROVAL_FILES = ['lib/inventoryCheckApprovals.ts', 'lib/inventoryCheckLineInput.ts', 'lib/inventoryCheckPlan.ts']
const UNKNOWN_RESULTS = ['inventory_check_outcome_unknown', 'inventory_check_saved_refresh']
// The session, list and observation routes raise more codes, which those screens show in their own words or as the generic "not saved". They are named here, each once, so a NEW code cannot pass unnoticed.
const OTHER_SCREENS = ['inventory_check_revision_required', 'inventory_check_schema_unavailable', 'inventory_check_membership_unavailable', 'inventory_check_invalid_filter', 'inventory_check_invalid_page',
  'inventory_check_stock_schema_unavailable', 'inventory_check_invalid_title', 'inventory_check_invalid_scope', 'inventory_check_invalid_state', 'inventory_check_reason_required', 'inventory_check_item_not_found',
  'inventory_check_session_final', 'inventory_check_invalid_query', 'inventory_check_view_required', 'invalid_session',
  // the list and product-read routes (raised in other files, shown by the Inventory list in its own words or as a failed read)
  'inventory_check_field_hidden', 'inventory_check_filter_too_large', 'inventory_check_family_page_too_large',
  // the marks routes (ic_marks, OFF) answer only the count-list device, which is not built yet; that device's screen slice adds the sentence
  'inventory_check_fix_stock_required']
// A code the error handlers answer with when an error carries none (routes/inventoryChecks.ts, which also answers /approval and /approval/lines, and routes/inventoryCheckProducts.ts). The panel does not read it as
// an unknown outcome and shows its generic failure text, so it is no refusal with a sentence of its own: named here with that reason, and kept out of the codes that need one.
const FALLBACK_CODES: Record<string, string> = { inventory_check_unavailable: 'what the error handlers answer when an error carries no code; shown with the generic failure text' }
const SHARED_FILES = ['lib/inventoryCheckSessions.ts', 'routes/inventoryChecks.ts']
// Strings that begin with inventory_check_ and are not refusals. Each is named with its reason, so a NEW string of that shape cannot be one of them unnoticed.
const NOT_REFUSALS: Record<string, string> = {
  inventory_check_approvals: 'table', inventory_check_events: 'table', inventory_check_items: 'table', inventory_check_lot_lines: 'table', inventory_check_sessions: 'table',
  inventory_check_approvals_claim: 'schema object (trigger or index) probed for presence', inventory_check_approvals_decided: 'schema object probed for presence', inventory_check_approvals_identity: 'schema object probed for presence',
  inventory_check_approvals_no_delete: 'schema object probed for presence', inventory_check_events_no_delete: 'schema object probed for presence', inventory_check_events_no_update: 'schema object probed for presence',
  inventory_check_items_baseline: 'schema object probed for presence', inventory_check_items_no_delete: 'schema object probed for presence', inventory_check_sessions_identity: 'schema object probed for presence',
  inventory_check_sessions_no_delete: 'schema object probed for presence',
  inventory_check_sessions_kind_task: 'schema object probed for presence', inventory_check_sessions_open_task: 'schema object probed for presence', inventory_check_sessions_task_board: 'schema object probed for presence',
  inventory_check_approvals_pending: 'a branch-cutover blocker, shown by the cutover screen, never an answer of the count routes',
  inventory_check_not_applied: 'the reason recorded for a line a close left unapplied when no refusal applies (closed_json), a state of the line and not an answer',
  inventory_check_approve: 'permission extra key', inventory_check_issue: 'permission extra key (issue count tasks)', 'inventory_check_show_${': 'permission extra keys, one per field the count shows (built by name on purpose)',
}

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const approvalCodes = new Set(APPROVAL_FILES.flatMap(file => [...codesIn(file)]))
const sharedCodes = new Set(SHARED_FILES.flatMap(file => [...codesIn(file)]))
assert.ok(approvalCodes.size >= 30 && sharedCodes.size >= 15, `the scan finds the Worker's codes (${approvalCodes.size} in the approval files, ${sharedCodes.size} in the shared ones)`)
for (const code of ['inventory_check_line_in_progress', 'inventory_check_modify_matches_seen', 'inventory_check_approval_in_progress']) assert.ok(approvalCodes.has(code), `the scan reads ${code} from the Worker`)
for (const code of ['inventory_check_not_available', 'inventory_check_permission_required']) assert.ok(sharedCodes.has(code), `the scan reads ${code} from the Worker (finding 8 of the C2 review)`)

const mustHave = new Set([...approvalCodes, ...sharedCodes].filter(code => !UNKNOWN_RESULTS.includes(code) && !OTHER_SCREENS.includes(code) && !Object.hasOwn(FALLBACK_CODES, code)))
const missing = [...mustHave].filter(code => !Object.hasOwn(REFUSAL_MESSAGES, code)).sort()
assert.deepEqual(missing, [], `Worker refusal codes with no sentence (add one to inventoryCheckRefusals.ts and both packs, or name it in OTHER_SCREENS with its reason): ${missing.join(', ')}`)
// Every refusal call of every inventory-check source file is read, not only the approval and shared files: a call whose code this test cannot read is a code it cannot check.
const CHECK_FILES = sourceFiles(SRC).map(url => url.href.slice(SRC.href.length)).filter(name => /inventoryCheck/i.test(name))
const unreadable = CHECK_FILES.flatMap(file => readCalls(file).unreadable)
assert.deepEqual(unreadable, [], 'every refusal call writes its code as a quoted literal, an UPPER_CASE constant or a ternary of those (or refused[0].code); a helper, variable or built string hides the code from this test')
const callCodes = new Set(CHECK_FILES.flatMap(file => [...codesIn(file)]))
// Every string of the shape inventory_check_* in the Worker source (any quote style; a back-tick string that interpolates is read up to the ${): each is a code this test reads, or is named as a screen's own, an unknown result, or not a refusal.
const strings = new Map<string, string[]>()
for (const file of sourceFiles(SRC)) for (const match of readFileSync(file, 'utf8').matchAll(/(['"`])(inventory_check_[a-z0-9_]*)(\1|\$\{)/g)) {
  const name = match[2] + (match[3] === '${' ? '${' : ''), at = file.href.slice(SRC.href.length)
  strings.set(name, [...(strings.get(name) ?? []), at])
}
const everyCode = new Set([...approvalCodes, ...sharedCodes, ...callCodes, ...strings.keys()].filter(code => !Object.hasOwn(NOT_REFUSALS, code)))
const unaccounted = [...strings].filter(([name]) => !approvalCodes.has(name) && !sharedCodes.has(name) && !OTHER_SCREENS.includes(name) && !Object.hasOwn(FALLBACK_CODES, name) && !UNKNOWN_RESULTS.includes(name) && !Object.hasOwn(NOT_REFUSALS, name) && !Object.hasOwn(REFUSAL_MESSAGES, name)).map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`)
assert.deepEqual(unaccounted, [], 'inventory_check_* strings the scan does not read as a refusal of the approval or shared files, and that are named nowhere: read it as a code (a quoted literal in fail/refuse/guard), or give it a sentence, or name it in OTHER_SCREENS, UNKNOWN_RESULTS or NOT_REFUSALS')
assert.deepEqual(Object.keys(NOT_REFUSALS).filter(name => !strings.has(name)), [], 'every name in NOT_REFUSALS is still a string of the Worker source')
assert.deepEqual(Object.keys(NOT_REFUSALS).filter(name => approvalCodes.has(name) || sharedCodes.has(name) || Object.hasOwn(REFUSAL_MESSAGES, name)), [], 'a name in NOT_REFUSALS is not a refusal the count routes raise')
assert.deepEqual(OTHER_SCREENS.filter(code => !everyCode.has(code)), [], 'every name in OTHER_SCREENS is still a code the Worker raises')
assert.deepEqual(Object.keys(FALLBACK_CODES).filter(code => !strings.has(code) || OTHER_SCREENS.includes(code) || Object.hasOwn(REFUSAL_MESSAGES, code) || approvalCodes.has(code) || sharedCodes.has(code)), [], 'every name in FALLBACK_CODES is still a string of the Worker source, is listed nowhere else and has no sentence')
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
