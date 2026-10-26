// 6.0.992: who is offered "Convert to current format" for a locked old-format return, and that every surface shows the
// lock. The Worker is the enforcement (cloudflare/scripts/test-return-legacy-convert-native.cjs drives the 403 for a
// Returns Full + Edit manager); this pins the screen to the same rule so it never offers a button the Worker refuses,
// and never hides the reason from someone who cannot convert.
//
// Run: node tests/returnLegacyConvert.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canConvertLegacyReturns, isLegacyReturnOnExactSale, legacyConvertAccess, legacyConvertFailureText, legacyConvertReasonText } from '../src/components/returns/helpers/returnLegacyConvert.ts'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

// --- the lock -------------------------------------------------------------------------------------------------------
const locked = { money_precision_version: 0, sale_money_precision_version: 1 }
assert.equal(isLegacyReturnOnExactSale(locked), true, 'a v0 return on a v1 sale is locked')
assert.equal(isLegacyReturnOnExactSale({ money_precision_version: '0', sale_money_precision_version: '1' }), true, 'string columns read the same')
assert.equal(isLegacyReturnOnExactSale({ money_precision_version: null, sale_money_precision_version: 1 }), true, 'a NULL version is the old format')
assert.equal(isLegacyReturnOnExactSale({ money_precision_version: 1, sale_money_precision_version: 1 }), false, 'a v1 return is not this lock')
assert.equal(isLegacyReturnOnExactSale({ money_precision_version: 0, sale_money_precision_version: 0 }), false, 'old return on an old sale stays editable')
assert.equal(isLegacyReturnOnExactSale({ money_precision_version: 0 }), false, 'a row without the sale version (manual return, older Worker) is not locked')
assert.equal(isLegacyReturnOnExactSale({ ...locked, return_scope: 'supplier' }), false, 'supplier returns are never this lock')
assert.equal(isLegacyReturnOnExactSale(null), false)

// --- who may convert --------------------------------------------------------------------------------------------------
const admin = { role_code: 'admin', permissions: '{}' }
const allGrant = { role_code: 'owner', permissions: JSON.stringify({ all: true }) }
const manager = { role_code: 'manager', permissions: JSON.stringify({ returns: true, 'returns:edit': true }) }
const cashier = { role_code: 'cashier', permissions: JSON.stringify({ returns: true, 'returns:edit': false }) }
assert.equal(canConvertLegacyReturns(admin), true)
assert.equal(canConvertLegacyReturns(allGrant), true, 'the effective all grant is an admin, as on the Worker')
assert.equal(canConvertLegacyReturns(manager), false, 'Returns Full + Edit is not enough: the Worker answers 403')
assert.equal(canConvertLegacyReturns(cashier), false)
assert.equal(canConvertLegacyReturns(null), false)
assert.equal(canConvertLegacyReturns({ username: 'admin', role_code: 'cashier', permissions: '{}' }), false, 'a name is not a credential')

assert.equal(legacyConvertAccess(locked, admin), 'convert', 'admin: reason + Convert')
assert.equal(legacyConvertAccess(locked, manager), 'reason_only', 'manager: reason + "an admin can review and convert it"')
assert.equal(legacyConvertAccess(locked, cashier), 'reason_only')
assert.equal(legacyConvertAccess(locked, null), 'reason_only', 'the reason is never hidden')
assert.equal(legacyConvertAccess({ money_precision_version: 1, sale_money_precision_version: 1 }, admin), null, 'nothing shown when not locked')
console.log('PASS legacy convert access: the lock shows for everyone, Convert only for an admin')

// --- reason sentences -------------------------------------------------------------------------------------------------
const T = (key: string, fallback: string) => ({ return_convert_amount_changed: 'KM {before} -> {after}' } as Record<string, string>)[key] ?? fallback
assert.equal(legacyConvertReasonText('return_convert_amount_changed', { before: 30.03, after: 10.01 }, T, { usd: (v) => `$${v.toFixed(2)}` }),
  'KM $30.03 -> $10.01', 'the pack sentence, with the amounts formatted')
assert.match(legacyConvertReasonText('return_convert_riel_changed', { before: 40040, after: 40000 }, (_k, f) => f, { khr: (v) => `${v} ៛` }), /40040 ៛/)
assert.match(legacyConvertReasonText('return_convert_report_changed', { before: 18.9067, after: 16.6833 }, (_k, f) => f, { usd: (v) => '$' + v }), /\$18\.9067 to \$16\.6833/)
assert.match(legacyConvertReasonText('return_convert_sale_amended', null, (_k, f) => f), /Record a new return/)
// Every failure code the Worker sends resolves to a pack key (a Khmer session never shows the Worker's English).
const seen: string[] = []
const spy = (key: string, fallback: string) => { seen.push(key); return fallback }
for (const code of ['return_convert_forbidden', 'return_convert_preview_stale', 'return_convert_changed', 'return_convert_not_found',
  'maintenance_active', 'return_convert_uncertain', 'return_convert_invalid', 'client_request_id_required', '']) legacyConvertFailureText(code, spy)
assert.deepEqual([...new Set(seen)].sort(), ['return_convert_admin_only', 'return_convert_failed', 'return_convert_not_found', 'return_convert_paused',
  'return_convert_stale', 'return_convert_uncertain'], 'each failure maps to its own sentence, never the raw message')
assert.match(legacyConvertReasonText('something_new', null, (_k, f) => f), /cannot be converted/, 'an unknown code still reads as a reason with a way through')
for (const code of ['return_convert_amount_changed', 'return_convert_line_changed', 'return_convert_riel_changed', 'return_convert_line_unlinked', 'return_convert_quote_refused', 'return_convert_report_changed']) {
  assert.match(legacyConvertReasonText(code, {}, (_k, f) => f), /cancel this return and record it again|Cancel this return and record it again/i,
    `${code} names the way through, never a dead end`)
}
console.log('PASS every refusal names its figures and the way through')

// --- parity with the Worker ---------------------------------------------------------------------------------------------
const lib = read('../../cloudflare/src/lib/returnLegacyConvert.ts')
assert.match(lib, /export function canConvertLegacyReturns\(user[^)]*\): boolean \{\n\s*return !!user && Number\.isSafeInteger\(Number\(user\.id\)\) && isAdminControlUser\(user\) && getActionTier\(user, 'returns', 'edit'\) === 'full'/)
const routes = read('../../cloudflare/src/routes/returns.ts')
const previewRoute = routes.slice(routes.indexOf("app.post('/legacy-convert/preview'"), routes.indexOf("app.post('/legacy-convert', async"))
assert.match(previewRoute, /if \(!canConvertLegacyReturns\(c\.get\('user'\)\)\)/, 'the preview is admin-only too, not just the write')
const listRoute = routes.slice(routes.indexOf("app.get('/', async"), routes.indexOf("app.get('/damaged-lots'"))
assert.match(listRoute, /list_origin_sale\.money_precision_version AS sale_money_precision_version/, 'the list row can show the lock')
assert.match(listRoute, /LEFT JOIN sales list_origin_sale ON list_origin_sale\.id = r\.sale_id/)
const history = read('../../cloudflare/src/routes/actionHistory.ts')
assert.match(history, /applier\?\.name === RETURN_LEGACY_CONVERT_KIND\) \{\n\s*if \(!canConvertLegacyReturns\(user\)\) return false/, 'History offers Undo/Redo only to whoever may convert')
assert.match(history, /kind === RETURN_LEGACY_CONVERT_KIND \|\|/, 'a client cannot record a forged conversion history row')
console.log('PASS the screen rule is the Worker rule')

// --- wiring ---------------------------------------------------------------------------------------------------------------
const modal = read('../src/components/returns/EditReturnModal.tsx')
assert.match(modal, /if \(isLegacyReturnOnExactSale\(ret\)\) return <ReturnLegacyLockPanel ret=\{ret\}/, 'Edit Return shows the lock panel, never the form')
assert.ok(modal.indexOf('if (isLegacyReturnOnExactSale(ret))') > modal.indexOf('const closeGuard = useCloseGuard('), 'after every hook')
const surface = read('../src/components/returns/ReturnsListSurface.tsx')
assert.equal((surface.match(/<ReturnLegacyLockTag ret=\{ret\} onConvert=\{onConvertLegacy\} \/>/g) || []).length, 2, 'desktop and mobile rows both show the lock')
const page = read('../src/components/returns/Returns.tsx')
assert.match(page, /onConvertLegacy=\{canConvertLegacy \? /, 'the row gets Convert only for an admin')
assert.match(page, /canConvertLegacy && selectedReturns\.some\(isLegacyReturnOnExactSale\)/, 'the bulk bar offers Convert for a selection that holds a locked return')
const panel = read('../src/components/returns/ReturnLegacyConvert.tsx')
assert.match(panel, /useConfirmDialog/, 'the shared compact confirm dialog, never native confirm()')
assert.ok(!/window\.confirm\(|\bconfirm\(/.test(panel.replace(/askToConfirm\(/g, '')), 'no native confirm')
assert.match(panel, /access === 'convert' \?[\s\S]*?<RefreshCcw[\s\S]*?T\('return_convert_action', 'Convert'\)[\s\S]*?: \([\s\S]*?T\('return_convert_admin_only'/, 'main action: icon + one word; others read the admin hint')

assert.ok(!/notify\(String\(/.test(panel), 'no raw Worker message reaches the toast')
const tag = panel.slice(panel.indexOf('export function ReturnLegacyLockTag'))
assert.match(tag, /data-return-legacy-lock="convert"[\s\S]*?<RefreshCcw /, 'the row Convert uses the same icon as the panel and the bulk bar')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const keys = [...new Set([...panel.matchAll(/\bT\('([a-z0-9_]+)'/g), ...read('../src/components/returns/helpers/returnLegacyConvert.ts').matchAll(/\bT\('([a-z0-9_]+)'/g)]
  .map((match) => match[1]).filter((key) => key.startsWith('return_convert') || key.startsWith('return_legacy')))]
assert.ok(keys.length >= 15, `every new sentence is a pack key (${keys.length})`)
for (const key of keys) {
  assert.ok(en[key], `en.json has ${key}`)
  assert.ok(km[key] && /[ក-៿]/.test(km[key]) && km[key] !== en[key], `km.json has Khmer for ${key}`)
}
assert.equal(en.return_convert_partial_note, "Returns that can't be converted stay as they are.")
assert.ok(!('return_convert_sale_blocked' in en) && !('return_convert_sale_blocked' in km), 'the retired all-or-nothing sentence is gone from both packs')
assert.equal(en.return_convert_admin_only, 'An admin can review and convert it.', 'matches the refusal copy: "an admin can review and convert it"')
console.log('PASS the lock reaches the Edit form, both list rows and the bulk bar, in both languages')
