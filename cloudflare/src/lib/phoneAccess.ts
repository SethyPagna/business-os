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
import { isPhoneShaped, maskPhone, maskPhonesInText, maskQuotedPhones } from './phoneMask'
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
const NAME_KEY = /(^|_)(name|label|title|customer|supplier|contact|driver|recipient|buyer|party|payer|payee|holder|display|note|notes|memo|description|summary)$/
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

function classify(key: string): number {
  const hit = keyClass.get(key)
  if (hit !== undefined) return hit
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  let kind = 0
  if (/(^|_)(phone|phones|mobile|telephone)(_|$)/.test(normalized)) kind |= PHONE
  if (NAME_KEY.test(normalized)) kind |= NAME
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

function walk(node: unknown, depth: number, actorId: string | null): unknown {
  if (node === null || typeof node !== 'object') {
    return typeof node === 'string' ? projectString(node, 0, depth, actorId) : node
  }
  if (depth > MAX_DEPTH) return null
  if (Array.isArray(node)) {
    let out: unknown[] | null = null
    for (let i = 0; i < node.length; i++) {
      const next = walk(node[i], depth + 1, actorId)
      if (next !== node[i] && out === null) out = node.slice(0, i)
      if (out !== null) out.push(next)
    }
    return out ?? node
  }
  const source = node as Record<string, unknown>
  const branch = isBranchRow(source)
  const own = actorId !== null && Object.hasOwn(source, 'username') && source.id != null && String(source.id) === actorId
  // A phone under a generic key: the duplicates list says { type: 'phone', value }, the gender restoration { kind: 'unique_phone', key }.
  const discriminator = typeof source.type === 'string' ? source.type : typeof source.kind === 'string' ? source.kind : ''
  const phoneTyped = discriminator !== '' && /phone/i.test(discriminator)
  // An import-review row names the contact it creates by its number: the identifier is a phone when the row carries a phone cell.
  const phoneRow = typeof source.identifier === 'string' && isPhoneRowData(source.data)
  let out: Record<string, unknown> | null = null
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue
    const value = source[key]
    let next: unknown = value
    let kind = classify(key)
    if (phoneTyped && (key === 'value' || key === 'key')) kind |= PHONE
    if (phoneRow && key === 'identifier') kind |= NAME
    const exempt = (kind & BUSINESS) !== 0 || (branch && (kind & PHONE) !== 0) || (own && key === 'phone')
    if (typeof value === 'string') {
      if (!exempt) {
        if (kind & (PHONE | NAME | SEARCH_TEXT | ENVELOPE | MESSAGE)) next = projectString(value, kind, depth, actorId)
        else if (value.length > 2) next = projectString(value, 0, depth, actorId)
      }
    } else if (value !== null && typeof value === 'object') {
      next = exempt ? value : walk(value, depth + 1, actorId)
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

/**
 * The value as `user` may see it. A holder of the grant gets the very same object back; everybody else gets a copy in
 * which every phone is masked (the input is never modified: caches and server-side callers keep the full value).
 */
export function projectPhones<T>(value: T, user: PhoneActor): T {
  if (canSeeFullPhones(user)) return value
  const id = user && user.id != null ? String(user.id) : null
  return walk(value, 0, id) as T
}
