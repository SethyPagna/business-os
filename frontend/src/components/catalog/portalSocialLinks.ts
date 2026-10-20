// Pure builders for the storefront's social links (header row, footer, About)
// and "Contact us" channels. One implementation for the live page and the
// Website Editor preview, which used to carry two copies of this logic.
//
// A platform holds an ORDERED LIST of accounts, because the header will get a
// per-platform picker. Today's settings hold one link per platform; that shape
// (a plain string, plus the old per-platform `linkLabels` entry) is accepted
// unchanged and yields a one-item list.
//
// URL normalization is never re-implemented here: every contact channel goes
// through the derive*/resolve* helpers in utils/socialLinks.ts. Visible text
// comes from utils/socialHandles.ts (owner label > real handle > platform name).

import {
  deriveInstagramLink,
  deriveMessengerLink,
  derivePhoneCallLink,
  deriveTelegramLink,
  deriveWhatsappLink,
  resolveMessengerLink,
} from '../../utils/socialLinks.ts'
import { resolveSocialDisplay, type SocialDisplayKind, type SocialLanguage, type SocialPlatform } from '../../utils/socialHandles.ts'

export type PortalAccountEntry = string | { href?: unknown; customLabel?: unknown }
export type PortalAccountInput = PortalAccountEntry | readonly PortalAccountEntry[] | null | undefined
export type PortalAccountMap = Partial<Record<SocialPlatform, PortalAccountInput>>
export type PortalLabelMap = Partial<Record<SocialPlatform, unknown>>
export type PortalShowMap = Partial<Record<SocialPlatform, unknown>>

export type PortalSocialLink = {
  platform: SocialPlatform
  href: string
  visibleText: string
  accessibleName: string
  latin: boolean
  kind: SocialDisplayKind
}
export type PortalSocialGroup = { platform: SocialPlatform; links: PortalSocialLink[] }

export const PORTAL_SOCIAL_ORDER: readonly SocialPlatform[] = ['website', 'facebook', 'instagram', 'tiktok', 'telegram']
export const PORTAL_CONTACT_ORDER: readonly SocialPlatform[] = ['messenger', 'telegram', 'whatsapp', 'phone', 'instagram']

/** Keep outbound links to full http/https URLs; adds https:// to a bare domain. Same rule both pages used locally. */
export function normalizePortalExternalUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = /^https?:\/\//i.test(raw)
    ? raw
    : (/^(www\.|[\w-]+(\.[\w-]+)+|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(raw) ? `https://${raw}` : '')
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return /^https?:$/i.test(url.protocol) ? url.toString().replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

function normalizeTiktok(value: unknown): string {
  const raw = String(value || '').trim()
  const bare = /^@?([A-Za-z0-9._]{1,24})$/.exec(raw)
  return bare ? `https://www.tiktok.com/@${bare[1]}` : normalizePortalExternalUrl(raw)
}

// The derive* helpers only accept a full https:// URL or a bare handle, so a
// pasted "t.me/shop" or "instagram.com/shop" (no scheme) would silently vanish.
// Give such a domain-and-path value its scheme first; the helper still decides.
const withScheme = (derive: (value: string) => string) => (value: string): string =>
  derive(/^(?:www\.|[\w-]+(?:\.[\w-]+)+\/)/i.test(value) ? `https://${value}` : value)

const SOCIAL_NORMALIZERS: Partial<Record<SocialPlatform, (value: string) => string>> = {
  website: normalizePortalExternalUrl,
  facebook: normalizePortalExternalUrl,
  instagram: normalizePortalExternalUrl,
  tiktok: normalizeTiktok,
  telegram: withScheme(deriveTelegramLink),
}

const CONTACT_NORMALIZERS: Partial<Record<SocialPlatform, (value: string) => string>> = {
  messenger: withScheme(resolveMessengerLink),
  telegram: withScheme(deriveTelegramLink),
  whatsapp: withScheme(deriveWhatsappLink),
  phone: derivePhoneCallLink,
  instagram: withScheme(deriveInstagramLink),
}

type Account = { href: string; customLabel: string; hasOwnLabel: boolean }

function toEntries(input: PortalAccountInput): PortalAccountEntry[] {
  if (input == null) return []
  return Array.isArray(input) ? [...input] : [input as PortalAccountEntry]
}

function toAccount(entry: PortalAccountEntry): Account {
  if (typeof entry === 'string') return { href: entry, customLabel: '', hasOwnLabel: false }
  const own = !!entry && 'customLabel' in entry
  return { href: String(entry?.href ?? ''), customLabel: own ? String(entry.customLabel ?? '') : '', hasOwnLabel: own }
}

function buildLinks(
  platform: SocialPlatform,
  input: PortalAccountInput,
  legacyLabel: unknown,
  normalize: (value: string) => string,
  language: SocialLanguage,
): PortalSocialLink[] {
  const accounts = toEntries(input).map(toAccount)
  // The old per-platform label belongs to the old single link only.
  const legacy = accounts.length === 1 && !accounts[0].hasOwnLabel ? String(legacyLabel ?? '') : ''
  const seen = new Set<string>()
  const out: PortalSocialLink[] = []
  for (const account of accounts) {
    const href = normalize(String(account.href || '').trim())
    if (!href || seen.has(href)) continue
    seen.add(href)
    const display = resolveSocialDisplay({ platform, customLabel: account.customLabel || legacy, href, language })
    out.push({ platform, href, visibleText: display.visibleText, accessibleName: display.accessibleName, latin: display.latin, kind: display.kind })
  }
  return out
}

const isShown = (show: PortalShowMap | undefined, platform: SocialPlatform): boolean => !show || !!show[platform]

/**
 * Social page links (website, Facebook, Instagram, TikTok, Telegram), grouped
 * by platform in header order. `show` omitted means everything is shown; when
 * given, a platform appears only if its flag is truthy (the portal config
 * always carries explicit showX flags).
 */
export function buildPortalSocialLinks(input: {
  links?: PortalAccountMap
  labels?: PortalLabelMap
  show?: PortalShowMap
  language?: string
}): PortalSocialGroup[] {
  const language: SocialLanguage = input.language === 'km' ? 'km' : 'en'
  const groups: PortalSocialGroup[] = []
  for (const platform of PORTAL_SOCIAL_ORDER) {
    if (!isShown(input.show, platform)) continue
    const links = buildLinks(platform, input.links?.[platform], input.labels?.[platform], SOCIAL_NORMALIZERS[platform]!, language)
    if (links.length) groups.push({ platform, links })
  }
  return groups
}

/**
 * Direct-message channels (Messenger, Telegram, WhatsApp, Call, Instagram).
 * A channel with no explicit contact value falls back to one derived from the
 * matching social link (Messenger from the Facebook page, Telegram and
 * Instagram from their own social link) when that social link is shown --
 * the same fallbacks the storefront has always applied.
 */
export function buildPortalContactChannels(input: {
  contactLinks?: PortalAccountMap
  contactLabels?: PortalLabelMap
  showContact?: PortalShowMap
  links?: PortalAccountMap
  show?: PortalShowMap
  language?: string
}): PortalSocialGroup[] {
  const language: SocialLanguage = input.language === 'km' ? 'km' : 'en'
  const fallbackFor = (platform: SocialPlatform): PortalAccountEntry[] => {
    const source: SocialPlatform | null = platform === 'messenger' ? 'facebook' : (platform === 'telegram' || platform === 'instagram' ? platform : null)
    if (!source || !isShown(input.show, source)) return []
    const accounts = toEntries(input.links?.[source]).map((entry) => toAccount(entry).href)
    if (platform === 'messenger') return accounts.map((href) => deriveMessengerLink(normalizePortalExternalUrl(href)))
    return accounts
  }
  const groups: PortalSocialGroup[] = []
  for (const platform of PORTAL_CONTACT_ORDER) {
    if (!isShown(input.showContact, platform)) continue
    const normalize = CONTACT_NORMALIZERS[platform]!
    let links = buildLinks(platform, input.contactLinks?.[platform], input.contactLabels?.[platform], normalize, language)
    if (!links.length) links = buildLinks(platform, fallbackFor(platform), input.contactLabels?.[platform], normalize, language)
    if (links.length) groups.push({ platform, links })
  }
  return groups
}
