// Stored Website Editor JSON is untrusted: a field that is not a string publishes as empty.
export function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const KHMER_COENG = '\u17D2'
const ZERO_WIDTH_JOINER = '\u200D'
const JOINS_PREVIOUS_CHARACTER = /^[\p{M}\p{Grapheme_Extend}\p{Emoji_Modifier}\u200D]$/u
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u

function regionalIndicatorsBefore(characters: readonly string[], index: number): number {
  let count = 0
  while (count < index && REGIONAL_INDICATOR.test(characters[index - count - 1])) count += 1
  return count
}

function isCharacterBoundary(characters: readonly string[], index: number): boolean {
  const before = characters[index - 1]
  const after = characters[index]
  if (before === KHMER_COENG || before === ZERO_WIDTH_JOINER || JOINS_PREVIOUS_CHARACTER.test(after)) return false
  return !REGIONAL_INDICATOR.test(after) || regionalIndicatorsBefore(characters, index) % 2 === 0
}

// A cap is a code-point budget, so one huge cluster cannot slip past it. Not Intl.Segmenter: workerd's
// splits a Khmer coeng cluster ('ស្' + 'រ'), so the cut would end on a bare coeng in the Worker only.
export function capPortalText(value: unknown, maxCodePoints: number): string {
  const text = plainText(value)
  if (text.length <= maxCodePoints) return text
  const characters = Array.from(text)
  if (characters.length <= maxCodePoints) return text
  let cut = maxCodePoints
  while (cut > 0 && !isCharacterBoundary(characters, cut)) cut -= 1
  return characters.slice(0, cut).join('')
}

// Owner decision, 27 Sep 2026: the storefront is English and Khmer only (frontend PUBLIC_STOREFRONT_LANGUAGE_OPTIONS).
export const PORTAL_LANGUAGE_CODES: ReadonlySet<string> = new Set(['en', 'km'])
export const AUTOMATIC_PORTAL_LANGUAGE = 'auto'

export function portalLanguageCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return PORTAL_LANGUAGE_CODES.has(code) ? code : ''
}

export function portalLanguageSetting(value: unknown): string | null {
  if (value == null) return AUTOMATIC_PORTAL_LANGUAGE
  if (typeof value !== 'string') return null
  const setting = value.trim().toLowerCase()
  if (!setting || setting === AUTOMATIC_PORTAL_LANGUAGE) return AUTOMATIC_PORTAL_LANGUAGE
  return portalLanguageCode(setting) || null
}

function parsedTranslations(stored: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return null
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

// Leaves every storefront-language block as sent, so the storefront publishes exactly what it did before.
export function withoutOtherLanguageTranslations(stored: string): string {
  const translations = parsedTranslations(stored)
  if (!translations) return stored
  const blocks = Object.entries(translations)
  const storefrontBlocks = blocks.filter(([code]) => portalLanguageCode(code))
  return storefrontBlocks.length === blocks.length ? stored : JSON.stringify(Object.fromEntries(storefrontBlocks))
}

// Field names that may never appear in anything the storefront publishes: raw stock counts and thresholds,
// cost/wholesale/supplier data and the assistant's private settings. routes/portal.ts scans every public body
// with this before caching it; the settings save refuses a translation key that would trip that scan.
const PRIVATE_STOREFRONT_FIELD_NAMES: ReadonlySet<string> = new Set([
  'stock_quantity', 'low_stock_threshold', 'out_of_stock_threshold', 'branch_stock', 'quantity',
  'aiPrompt', 'aiProviderId', 'password_hash', 'token_hash',
])
const PRIVATE_STOREFRONT_FIELD_PATTERN = /cost|wholesale|supplier|margin|vip_price/i

export function isPrivateStorefrontFieldName(name: string): boolean {
  return PRIVATE_STOREFRONT_FIELD_NAMES.has(name) || PRIVATE_STOREFRONT_FIELD_PATTERN.test(name)
}

// Translated collections an editor may key by its own names (an id per entry) -- the only staff-named keys the
// storefront publishes. routes/portal.ts publishes exactly these.
export const PORTAL_TRANSLATED_COLLECTION_NAMES = ['aboutBlocks', 'promoItems', 'faqItems', 'products', 'catalogProducts', 'catalog'] as const
export type PortalTranslatedCollectionName = typeof PORTAL_TRANSLATED_COLLECTION_NAMES[number]

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

// The first staff-named entry key in stored translations that names a private field, or null. Fixed field
// names are not checked: publishing keeps only its own allowlist of those, whatever was stored.
export function privateTranslationKey(stored: string): string | null {
  for (const block of Object.values(parsedTranslations(stored) ?? {})) {
    if (!isRecord(block)) continue
    for (const name of PORTAL_TRANSLATED_COLLECTION_NAMES) {
      const collection = block[name]
      if (!isRecord(collection)) continue
      const found = Object.keys(collection).find(isPrivateStorefrontFieldName)
      if (found) return found
    }
  }
  return null
}

export const MAX_PORTAL_IMAGE_ALT_LENGTH = 200
const CONTROL_CHARACTERS = /\p{Cc}/gu

export function normalizePortalImageAlt(value: unknown): string {
  return capPortalText(plainText(value).replace(CONTROL_CHARACTERS, ''), MAX_PORTAL_IMAGE_ALT_LENGTH)
}

// ---------------------------------------------------------------------------
// Announcement bar (owner, 2 Nov 2026). One short message at the top of the storefront: English and Khmer text, an
// optional link, an on/off switch and optional first/last day. It is stored as plain customer_portal_announcement_*
// settings, so it is written with the existing "Manage portal config" grant and published inside the one cached
// public config (portal.ts buildPortalConfig); it adds no read, no permission and no time-keyed cache. The days are
// compared by the visitor's browser in the shop's day (Asia/Phnom_Penh), never against this server's clock.
//
// Stored Website Editor values are untrusted, so the same normalisers run when a value is written and when it is
// published. The text stays plain text: the storefront renders it as text, so nothing here HTML-encodes it.
// ---------------------------------------------------------------------------
export const MAX_PORTAL_ANNOUNCEMENT_LENGTH = 200
export const MAX_PORTAL_ANNOUNCEMENT_LINK_LENGTH = 500
export const PORTAL_ANNOUNCEMENT_KEYS = {
  enabled: 'customer_portal_announcement_enabled',
  textEn: 'customer_portal_announcement_text_en',
  textKm: 'customer_portal_announcement_text_km',
  link: 'customer_portal_announcement_link',
  start: 'customer_portal_announcement_start',
  end: 'customer_portal_announcement_end',
} as const

// Bidi overrides would reorder how the message reads; control characters and any whitespace run (a pasted newline or
// tab) become one space. Zero-width characters stay: a Khmer keyboard types U+200B between words.
const ANNOUNCEMENT_BIDI_CONTROLS = /[‪-‮⁦-⁩]/gu
const ANNOUNCEMENT_WHITESPACE_RUN = /[\p{Cc}\s]+/gu
const ANNOUNCEMENT_LINK_UNSAFE = /[\p{Cc}\p{Cf}\s\\]/u
const ANNOUNCEMENT_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

export function cleanPortalAnnouncementText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(ANNOUNCEMENT_BIDI_CONTROLS, '').replace(ANNOUNCEMENT_WHITESPACE_RUN, ' ').trim()
}

/** '' for no link, the trimmed link when it is an absolute http(s) URL with no credentials, otherwise null. */
export function normalizePortalAnnouncementLink(value: string): string | null {
  const raw = value.trim()
  if (!raw) return ''
  if (raw.length > MAX_PORTAL_ANNOUNCEMENT_LINK_LENGTH || ANNOUNCEMENT_LINK_UNSAFE.test(raw) || !/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
  return raw
}

/** '' for no day, the trimmed YYYY-MM-DD when it is a real calendar day from 2000 to 2100, otherwise null. */
export function normalizePortalAnnouncementDay(value: string): string | null {
  const raw = value.trim()
  if (!raw) return ''
  const parts = ANNOUNCEMENT_DAY.exec(raw)
  if (!parts) return null
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (year < 2000 || year > 2100) return null
  const real = new Date(Date.UTC(year, month - 1, day))
  return real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day ? raw : null
}

/** The dismissal version: it changes when the message or its link changes, never when only the days or the switch do. */
export function portalAnnouncementVersion(textEn: string, textKm: string, link: string): string {
  if (!textEn && !textKm) return ''
  let hash = 0x811c9dc5
  const input = `${textEn}\u0001${textKm}\u0001${link}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** The announcement fields of the public portal config, from untrusted stored values. */
export function portalAnnouncementConfig(input: { enabled: boolean; textEn: unknown; textKm: unknown; link: unknown; start: unknown; end: unknown }) {
  const textEn = capPortalText(cleanPortalAnnouncementText(input.textEn), MAX_PORTAL_ANNOUNCEMENT_LENGTH)
  const textKm = capPortalText(cleanPortalAnnouncementText(input.textKm), MAX_PORTAL_ANNOUNCEMENT_LENGTH)
  const link = typeof input.link === 'string' ? normalizePortalAnnouncementLink(input.link) ?? '' : ''
  const start = typeof input.start === 'string' ? normalizePortalAnnouncementDay(input.start) ?? '' : ''
  const end = typeof input.end === 'string' ? normalizePortalAnnouncementDay(input.end) ?? '' : ''
  return {
    announcementEnabled: input.enabled,
    announcementTextEn: textEn,
    announcementTextKm: textKm,
    announcementLink: link,
    announcementStart: start,
    announcementEnd: end,
    announcementVersion: portalAnnouncementVersion(textEn, textKm, link),
  }
}

const ANNOUNCEMENT_SWITCH_ON = new Set(['true', '1', 'on', 'yes'])
const ANNOUNCEMENT_SWITCH_OFF = new Set(['false', '0', 'off', 'no'])

export type PortalAnnouncementWriteResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; code: string; error: string }

/**
 * Checks the announcement keys a settings save names. Nothing is clamped: a message cut short or a link quietly
 * rewritten is how a shop ends up showing something nobody wrote, so a bad value is refused with a code. The value of
 * a start/end key this save does not name is read through storedValue, so the pair is checked whichever one changed.
 */
export function validatePortalAnnouncementWrite(body: Record<string, unknown>, storedValue: (key: string) => string | undefined): PortalAnnouncementWriteResult {
  const values: Record<string, string> = {}
  const named = (key: string) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined
  const fail = (code: string, error: string): PortalAnnouncementWriteResult => ({ ok: false, code, error })

  if (named(PORTAL_ANNOUNCEMENT_KEYS.enabled)) {
    const raw = body[PORTAL_ANNOUNCEMENT_KEYS.enabled]
    const word = typeof raw === 'boolean' ? String(raw) : typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (!ANNOUNCEMENT_SWITCH_ON.has(word) && !ANNOUNCEMENT_SWITCH_OFF.has(word)) return fail('invalid_announcement_enabled', 'The announcement bar switch must be on or off.')
    values[PORTAL_ANNOUNCEMENT_KEYS.enabled] = ANNOUNCEMENT_SWITCH_ON.has(word) ? 'true' : 'false'
  }

  for (const key of [PORTAL_ANNOUNCEMENT_KEYS.textEn, PORTAL_ANNOUNCEMENT_KEYS.textKm]) {
    if (!named(key)) continue
    const raw = body[key]
    if (typeof raw !== 'string') return fail('invalid_announcement_text', 'The announcement text must be plain text.')
    const text = cleanPortalAnnouncementText(raw)
    if (Array.from(text).length > MAX_PORTAL_ANNOUNCEMENT_LENGTH) return fail('invalid_announcement_text', `The announcement text can be at most ${MAX_PORTAL_ANNOUNCEMENT_LENGTH} characters.`)
    values[key] = text
  }

  if (named(PORTAL_ANNOUNCEMENT_KEYS.link)) {
    const raw = body[PORTAL_ANNOUNCEMENT_KEYS.link]
    const link = typeof raw === 'string' ? normalizePortalAnnouncementLink(raw) : null
    if (link === null) return fail('invalid_announcement_link', 'The announcement link must start with http:// or https:// and have no spaces or password.')
    values[PORTAL_ANNOUNCEMENT_KEYS.link] = link
  }

  for (const key of [PORTAL_ANNOUNCEMENT_KEYS.start, PORTAL_ANNOUNCEMENT_KEYS.end]) {
    if (!named(key)) continue
    const raw = body[key]
    const day = typeof raw === 'string' ? normalizePortalAnnouncementDay(raw) : null
    if (day === null) return fail('invalid_announcement_date', 'The announcement dates must be real days written as YYYY-MM-DD.')
    values[key] = day
  }

  if (named(PORTAL_ANNOUNCEMENT_KEYS.start) || named(PORTAL_ANNOUNCEMENT_KEYS.end)) {
    const effective = (key: string) => (key in values ? values[key] : normalizePortalAnnouncementDay(storedValue(key) ?? '') ?? '')
    const start = effective(PORTAL_ANNOUNCEMENT_KEYS.start)
    const end = effective(PORTAL_ANNOUNCEMENT_KEYS.end)
    if (start && end && end < start) return fail('invalid_announcement_range', 'The announcement end day cannot be before its start day.')
  }

  return { ok: true, values }
}
