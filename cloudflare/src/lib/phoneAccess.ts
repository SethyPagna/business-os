// Who sees a full phone number, and the one projection that hides it from everybody else (owner ruling 2 Nov 2026,
// round 1 Q3; builds on the 14 Oct ruling "full phone number is admin-only").
//
// `contacts_full_phone` is a separate, explicit grant (owner, 21 Oct: extras are separate permissions and Full means
// main access only). It is off for every non-admin role until an administrator grants it to a role or a person; an
// administrator-control account holds it implicitly. Nothing else implies it: Contacts Full, Sales Full and Settings
// Full do not.
//
// The projection is a rule on the OUTGOING value, not a per-screen edit. Every JSON body leaves the Worker through
// c.json (lib/phoneMaskMiddleware.ts wraps it for the whole /api surface), so a route added tomorrow inherits the
// mask without knowing about it. The rule names what a phone looks like, not where it happens to be today:
//   - a string under any key that names a phone (phone, customer_phone, driver_phone, phone_key, matchedPhone, ...);
//   - a phone inside serialized JSON text at any depth: the Contact Options kept in an address field, audit details,
//     undo payloads, snapshots, import rows;
//   - a name field that is itself a number (a contact saved under its phone);
//   - the search helper text the sale and return rows carry (search_normalized holds the customer's digits).
// Business phone numbers (the shop's own line on a branch, in Settings and on the storefront) are not personal data
// and keep showing. This is the second wall: a shared server cache that holds a phone-bearing body is keyed on the grant and
// stores the masked variant for everyone else (lib/phoneCache.ts), so neither layer depends on the other.
import { hasPermission, type PermissionUser } from './permissions'
import { hasMaskedQuote, isMaskedPhone, isPhoneShaped, maskPhone, maskPhonesInText, maskQuotedPhones } from './phoneMask'
import type { PhoneSearchAccess } from './phoneSearchGuard'

export const FULL_PHONE_PERMISSION = 'contacts_full_phone'

export type PhoneActor = (NonNullable<PermissionUser> & { id?: number | string | null }) | null | undefined

export function canSeeFullPhones(user: PhoneActor): boolean {
  return !!user && hasPermission(user, 'contacts_full_phone')
}

/** What a search box may match for this account (lib/phoneSearchGuard.ts): every call site names it, none can forget. */
export function phoneSearchAccessOf(user: PhoneActor): PhoneSearchAccess {
  return { fullPhone: canSeeFullPhones(user) }
}

const MAX_DEPTH = 48
const MAX_ENVELOPE_CHARS = 2_000_000

// The shop's own numbers. Matched by key because they sit in flat settings maps.
const BUSINESS_PHONE_KEYS = new Set(['business_phone', 'portal_legal_identity_phone', 'web_editor_phone'])
const BUSINESS_PHONE_PREFIXES = ['customer_portal_']

// Keys whose string is a person or a label. A whole value that is a number there is a phone (a contact saved under its number).
// The people the app names under keys that do not end in "name" are listed too: a supplier's contact_person, a staff account's
// username, a sale's cashier, whoever did something (created_by, actor, owner ...). The security review (B3) found four of them
// leaving a saved-under-its-number person in full.
const NAME_KEY = /(^|_)(name|label|title|customer|supplier|contact|driver|recipient|buyer|party|payer|payee|holder|display|note|notes|memo|description|summary|person|cashier|username|user|staff|employee|actor|author|owner|creator|reviewer|approver|seller|operator|requester|manager|agent|by)$/
// A name that is NOT a person's: a product, brand, category, unit or branch may be named by a long digit code (a supplier's item
// code) and is shown as stored to everybody (review B2). The prefix says what the name belongs to; a bare `name` on a catalog row is
// decided in walk() by the row (isCatalogRow). Anything not listed here stays masked: a missed catalog name hides, it never leaks.
const CATALOG_KEY = /(^|_)(product|item|variant|brand|category|unit|branch|warehouse|lot|batch)_(name|description|title|label|summary)$/
const BARE_CATALOG_KEYS = new Set(['name', 'description', 'title', 'label', 'summary'])
// The rows of a list a response keys `products` / `sample_products` / `topProducts` are products, whatever columns they carry (a ranking row
// is { family_key, name, qty_sold }; a usage sample is { id, name }). Only the rows themselves: whatever they nest is judged on its own.
const PRODUCT_LIST_KEY = /products?$/i
// What only a catalog row (a product, a lookup) carries: no contact row has a barcode, a price or a colour.
const CATALOG_MARKERS = ['barcode', 'sku', 'selling_price_usd', 'selling_price_khr', 'cost_price_usd', 'wholesale_price_usd', 'stock_quantity', 'normalized_name', 'color']
// Keys that hold serialized JSON (audit details, undo payloads, snapshots). Always decoded, not only when the word phone appears.
const ENVELOPE_KEY = /(^|_)(details?|old_value|new_value|payload|snapshot|undo_payload|redo_payload|before|after)$/

// Keys that hold a sentence: the duplicate and import checks quote the number they matched.
const MESSAGE_KEY = /(^|_)(message|messages|error|errors|warning|warnings|reason|hint)$/

const keyClass = new Map<string, number>()
const PHONE = 1
const NAME = 2
const SEARCH_TEXT = 4
const ENVELOPE = 8
const BUSINESS = 16
const MESSAGE = 32
const CATALOG = 64 // a product / brand / category / unit / branch name: never masked, but a mask sent back under it is still not a name

function classify(key: string): number {
  const hit = keyClass.get(key)
  if (hit !== undefined) return hit
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  let kind = 0
  if (/(^|_)(phone|phones|mobile|telephone)(_|$)/.test(normalized)) kind |= PHONE
  if (NAME_KEY.test(normalized)) kind |= CATALOG_KEY.test(normalized) ? CATALOG : NAME
  if (ENVELOPE_KEY.test(normalized) || normalized.endsWith('_json')) kind |= ENVELOPE
  if (/(^|_)(search|searchable|normalized)(_|$)/.test(normalized)) kind |= SEARCH_TEXT
  if (MESSAGE_KEY.test(normalized)) kind |= MESSAGE
  if (BUSINESS_PHONE_KEYS.has(normalized) || BUSINESS_PHONE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) kind |= BUSINESS
  if (keyClass.size < 4096) keyClass.set(key, kind)
  return kind
}

/**
 * How the projection treats a STRING under `key`, which is also the name of the column a list returns it from (`s.notes` leaves
 * as `notes`). The restricted searches ask this instead of keeping a column list of their own (lib/phoneSearchGuard.ts), so a
 * column the projection hides is never searched raw by an account without the grant, and the two cannot drift:
 *   'always': masked whatever it holds (a phone key, the search helper text, serialized JSON): never searchable without the grant;
 *   'name':   masked when the WHOLE value is a number (a name, label or note that is a phone): searchable only when it is not;
 *   'quoted': a sentence whose quoted numbers are masked (a reason, a message): searchable only when it quotes none;
 *   'none':   shown as stored.
 */
export type KeyMask = 'always' | 'name' | 'quoted' | 'none'
export function keyMaskOf(key: string): KeyMask {
  const kind = classify(key)
  if (kind & BUSINESS) return 'none'
  if (kind & (PHONE | SEARCH_TEXT | ENVELOPE)) return 'always'
  if (kind & NAME) return 'name'
  if (kind & MESSAGE) return 'quoted'
  return 'none'
}

/** The branch rows carry the shop's own line: location + manager mark the row (migrations/0001_init.sql). */
function isBranchRow(node: Record<string, unknown>): boolean {
  return Object.hasOwn(node, 'manager') && Object.hasOwn(node, 'location') && !Object.hasOwn(node, 'customer_id')
}

function isCatalogRow(node: Record<string, unknown>): boolean {
  for (const marker of CATALOG_MARKERS) if (Object.hasOwn(node, marker)) return true
  // A notification item of the inventory / products / catalog pages is labelled with the product it is about.
  const page = node.pageId
  if (page === 'inventory' || page === 'products' || page === 'catalog') return true
  return isBranchRow(node)
}

// A number under a phone key is a phone when it is as long as one (a count or an id under such a key stays a number).
const PHONE_NUMBER_MIN = 1_000_000

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return maskPhone(value)
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) >= PHONE_NUMBER_MIN) return maskPhone(String(Math.trunc(Math.abs(value))))
  return value
}

/** Serialized JSON text, decoded, projected and written back only if something changed (formatting untouched otherwise). */
function projectJsonText(text: string, depth: number, actorId: string | null): string {
  try {
    const parsed = JSON.parse(text)
    const projected = walk(parsed, depth + 1, actorId)
    return projected === parsed ? text : JSON.stringify(projected)
  } catch {
    return maskPhonesInText(text)
  }
}

/** Contact Options JSON: [{ label, name, phone, email, address }]. Anything else is returned untouched. */
export function maskContactOptionsText(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('[') && !text.startsWith('{')) return raw
  if (!/phone/i.test(text)) return raw
  return projectJsonText(text, 0, null)
}

function projectString(text: string, kind: number, depth: number, actorId: string | null): string {
  if (kind & PHONE) return maskPhone(text) as string
  if (kind & SEARCH_TEXT) return maskPhonesInText(text)
  if ((kind & NAME) && isPhoneShaped(text)) return maskPhone(text) as string
  if (kind & MESSAGE) return maskQuotedPhones(text)
  if (text.length > 2 && text.length <= MAX_ENVELOPE_CHARS) {
    const first = text.charCodeAt(0)
    if (first === 0x7b || first === 0x5b || first === 0x20 || first === 0x0a) {
      const trimmed = text.trim()
      if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && ((kind & ENVELOPE) !== 0 || /phone/i.test(trimmed))) { const out = projectJsonText(trimmed, depth, actorId); return out === trimmed ? text : out }
    }
  }
  return text
}

function isPhoneRowData(data: unknown): boolean {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false
  for (const key in data as Record<string, unknown>) if (classify(key) & PHONE) return true
  return false
}

function walk(node: unknown, depth: number, actorId: string | null, rowOfProducts = false): unknown {
  if (node === null || typeof node !== 'object') {
    return typeof node === 'string' ? projectString(node, 0, depth, actorId) : node
  }
  if (depth > MAX_DEPTH) return null
  if (Array.isArray(node)) {
    let out: unknown[] | null = null
    for (let i = 0; i < node.length; i++) {
      const next = walk(node[i], depth + 1, actorId, rowOfProducts)
      if (next !== node[i] && out === null) out = node.slice(0, i)
      if (out !== null) out.push(next)
    }
    return out ?? node
  }
  const source = node as Record<string, unknown>
  const branch = isBranchRow(source)
  // The account's own row: its id is the actor's. An audit row also carries `username` and an `id` (its own, from another sequence),
  // so a row with `user_name` is never taken for an account.
  const own = actorId !== null && Object.hasOwn(source, 'username') && source.id != null && String(source.id) === actorId && !Object.hasOwn(source, 'user_name')
  // A phone under a generic key: the duplicates list says { type: 'phone', value }, the gender restoration { kind: 'unique_phone', key }.
  const discriminator = typeof source.type === 'string' ? source.type : typeof source.kind === 'string' ? source.kind : ''
  const phoneTyped = discriminator !== '' && /phone/i.test(discriminator)
  // An import-review row names the contact it creates by its number: the identifier is a phone when the row carries a phone cell.
  const phoneRow = typeof source.identifier === 'string' && isPhoneRowData(source.data)
  let out: Record<string, unknown> | null = null
  let catalog: boolean | null = null
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue
    const value = source[key]
    let next: unknown = value
    let kind = classify(key)
    if (phoneTyped && (key === 'value' || key === 'key')) kind |= PHONE
    if (phoneRow && key === 'identifier') kind |= NAME
    // A product, lookup or branch row is named by what it is, not by a person (review B2): its bare name is shown as stored.
    if ((kind & NAME) && BARE_CATALOG_KEYS.has(key) && (catalog ??= rowOfProducts || isCatalogRow(source))) kind &= ~NAME
    // A product's search text holds its name and its barcode, both shown beside it: it is not a phone hidden in a helper column.
    if ((kind & SEARCH_TEXT) && key === 'name_normalized' && (catalog ??= rowOfProducts || isCatalogRow(source))) kind &= ~SEARCH_TEXT
    // { key, name } pairs: the key is the name lower-cased (the cashiers list a report offers as a filter), so it is the name (review B3).
    if (key === 'key' && typeof value === 'string' && typeof source.name === 'string' && value !== '' && value === source.name.trim().toLowerCase()) kind |= NAME
    const exempt = (kind & BUSINESS) !== 0 || (branch && (kind & PHONE) !== 0) || (own && (key === 'phone' || key === 'username' || key === 'name'))
    if (typeof value === 'string') {
      if (!exempt) {
        if (kind & (PHONE | NAME | SEARCH_TEXT | ENVELOPE | MESSAGE)) next = projectString(value, kind, depth, actorId)
        else if (value.length > 2) next = projectString(value, 0, depth, actorId)
      }
    } else if (value !== null && typeof value === 'object') {
      next = exempt ? value : walk(value, depth + 1, actorId, PRODUCT_LIST_KEY.test(key))
      if ((kind & PHONE) && !exempt && Array.isArray(value)) next = (next as unknown[]).map(maskValue)
      if ((kind & MESSAGE) && !exempt && Array.isArray(value)) next = (next as unknown[]).map((item) => (typeof item === 'string' ? maskQuotedPhones(item) : item))
    } else if (typeof value === 'number' && !exempt && (kind & PHONE)) {
      next = maskValue(value)
    }
    if (next !== value && out === null) out = { ...source }
    if (out !== null) out[key] = next
  }
  return out ?? node
}

// The quoted sentences a person writes (a reason). A message, an error or a warning is the system's own text, and a client that reports
// one back is not editing anything, so those are left as they came.
const AUTHORED_SENTENCE = /reason$/i

/**
 * Review B1: a request body, read by an account that cannot see numbers, minus the values that are only a mask. A form is filled from a
 * read that hid a value (a note, a label, a product name, a contact saved under its number) and sends back what it was shown; saving
 * that would replace the real value with its mask, silently. A value that IS the mask the projection writes means "unchanged", so it is
 * removed from the request, and every writer (create, edit, bulk edit, review queue, replay) already treats an absent field as
 * untouched (a sale line without a name takes the product's). Only the keys the projection masks as a name or a quoted sentence are
 * read (keyMaskOf), at any depth. The input is not modified; the same object comes back when nothing was removed.
 */
export function scrubMaskedInput(node: unknown, depth = 0): unknown {
  if (node === null || typeof node !== 'object' || depth > MAX_DEPTH) return node
  if (Array.isArray(node)) {
    let out: unknown[] | null = null
    for (let i = 0; i < node.length; i++) {
      const next = scrubMaskedInput(node[i], depth + 1)
      if (next !== node[i] && out === null) out = node.slice(0, i)
      if (out !== null) out.push(next)
    }
    return out ?? node
  }
  const source = node as Record<string, unknown>
  let out: Record<string, unknown> | null = null
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue
    const value = source[key]
    let dropped = false
    let next: unknown = value
    if (typeof value === 'string') {
      const mask = keyMaskOf(key)
      dropped = value.includes('*') && ((((classify(key) & (NAME | CATALOG)) !== 0) && isMaskedPhone(value)) || (mask === 'quoted' && AUTHORED_SENTENCE.test(key) && hasMaskedQuote(value)))
    } else if (value !== null && typeof value === 'object') {
      next = scrubMaskedInput(value, depth + 1)
    }
    if ((dropped || next !== value) && out === null) { out = {}; for (const copied in source) { if (copied === key) break; if (Object.hasOwn(source, copied)) out[copied] = source[copied] } }
    if (out !== null && !dropped) out[key] = next
  }
  return out ?? node
}

/** The request text without its masked values, or null when it holds none (the common case costs one substring test). */
export function scrubMaskedRequestText(text: string): string | null {
  if (!text.includes('***')) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  const scrubbed = scrubMaskedInput(parsed)
  return scrubbed === parsed ? null : JSON.stringify(scrubbed)
}

/**
 * The value as `user` may see it. A holder of the grant gets the very same object back; everybody else gets a copy in
 * which every phone is masked (the input is never modified: caches and server-side callers keep the full value).
 */
export function projectPhones<T>(value: T, user: PhoneActor): T {
  if (canSeeFullPhones(user)) return value
  const id = user && user.id != null ? String(user.id) : null
  return walk(value, 0, id) as T
}
