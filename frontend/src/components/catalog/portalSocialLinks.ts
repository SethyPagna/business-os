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

/** One account of a platform as the About chips and the footer list it (no picker there). */
export type PortalFlatSocialLink = {
  key: string
  platform: SocialPlatform
  value: string
  label: string
  accessibleName: string
  latin: boolean
}

export function flattenPortalSocialGroups(groups: readonly PortalSocialGroup[]): PortalFlatSocialLink[] {
  return groups.flatMap((group) => group.links.map((link, index) => ({
    key: `${group.platform}-${index}`,
    platform: group.platform,
    value: link.href,
    label: link.visibleText,
    accessibleName: link.accessibleName,
    latin: link.latin,
  })))
}

// The floating contact buttons (owner, 2 Nov 2026): one round brand-colour button per chat account, each opening the
// chat itself (t.me/<name>, m.me/<page>, ig.me/m/<name>, wa.me/<number>), never a profile page. The accounts are the
// Website Editor's own contact settings (buildPortalContactChannels above); nothing is hard-coded here.
export const PORTAL_CONTACT_FLOAT = { bottomRem: 4.5, buttonRem: 2.75, gapRem: 0.5, endRem: 0.75, minReserveRem: 7.5 } as const

// Fill behind a white glyph. Every colour is at least 3:1 against white (a graphical object, WCAG 1.4.11); the
// instagram gradient is checked at every stop. tests/portalContactFloat.test.ts holds the numbers.
export const PORTAL_CONTACT_BRAND: Readonly<Record<'telegram' | 'messenger' | 'instagram' | 'whatsapp' | 'phone', { background: string; stops: readonly string[] }>> = {
  telegram: { background: '#1d93d2', stops: ['#1d93d2'] },
  messenger: { background: '#0084ff', stops: ['#0084ff'] },
  instagram: { background: 'linear-gradient(135deg, #e1306c 0%, #c13584 50%, #833ab4 100%)', stops: ['#e1306c', '#c13584', '#833ab4'] },
  whatsapp: { background: '#128c7e', stops: ['#128c7e'] },
  phone: { background: '#9c7a3c', stops: ['#9c7a3c'] },
}

const DIRECT_CHAT_HOSTS: Readonly<Partial<Record<SocialPlatform, RegExp>>> = {
  telegram: /^(?:t\.me|telegram\.me)$/i,
  messenger: /^m\.me$/i,
  instagram: /^ig\.me$/i,
  whatsapp: /^wa\.me$/i,
}

/**
 * True only for a link that opens the chat itself: https on the platform's own chat host, or a tel: link for Call.
 * The derive* helpers already produce nothing else; this is the second check at the point a visitor taps.
 */
export function isDirectContactHref(platform: SocialPlatform, href: unknown): boolean {
  const value = String(href ?? '').trim()
  if (platform === 'phone') return /^tel:\+?[0-9]{3,20}$/.test(value)
  const host = DIRECT_CHAT_HOSTS[platform]
  if (!host) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && host.test(url.hostname) && !url.username && !url.password && url.pathname.length > 1
  } catch {
    return false
  }
}

const FLOAT_PLATFORMS: readonly SocialPlatform[] = ['messenger', 'telegram', 'instagram', 'whatsapp', 'phone']

/** The first valid account of each chat platform, in the Contact us order. A second account stays in the Contact us list. */
export function buildPortalContactFloat(channels: readonly PortalFlatSocialLink[]): PortalFlatSocialLink[] {
  const out: PortalFlatSocialLink[] = []
  for (const platform of FLOAT_PLATFORMS) {
    const first = channels.find((channel) => channel.platform === platform && isDirectContactHref(platform, channel.value))
    if (first) out.push(first)
  }
  return out
}

/** How far above the safe area the page must end so the stack of `count` buttons never covers the footer. */
export function portalFloatClearanceRem(count: number): number {
  const { bottomRem, buttonRem, gapRem, endRem, minReserveRem } = PORTAL_CONTACT_FLOAT
  if (!(count > 0)) return minReserveRem
  return Math.max(minReserveRem, bottomRem + count * buttonRem + (count - 1) * gapRem + endRem)
}

type PortalSocialConfig = {
  links?: PortalAccountMap
  linkLabels?: PortalLabelMap
  contactLinks?: PortalAccountMap
  contactLinkLabels?: PortalLabelMap
  showWebsite?: unknown
  showFacebook?: unknown
  showInstagram?: unknown
  showTelegram?: unknown
  showContactMessenger?: unknown
  showContactTelegram?: unknown
  showContactWhatsapp?: unknown
  showContactPhone?: unknown
  showContactInstagram?: unknown
}

/** Both page builders (live and editor preview) read the portal config through this one function. */
export function buildPortalSocialFromConfig(config: PortalSocialConfig, language: string): { social: PortalSocialGroup[]; contact: PortalSocialGroup[] } {
  const show: PortalShowMap = { website: config.showWebsite, facebook: config.showFacebook, instagram: config.showInstagram, telegram: config.showTelegram }
  return {
    social: buildPortalSocialLinks({ links: config.links, labels: config.linkLabels, show, language }),
    contact: buildPortalContactChannels({
      contactLinks: config.contactLinks,
      contactLabels: config.contactLinkLabels,
      showContact: { messenger: config.showContactMessenger, telegram: config.showContactTelegram, whatsapp: config.showContactWhatsapp, phone: config.showContactPhone, instagram: config.showContactInstagram },
      links: config.links,
      show,
      language,
    }),
  }
}
