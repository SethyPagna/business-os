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
  contactHref,
  deriveInstagramLink,
  deriveMessengerLink,
  deriveTelegramLink,
  deriveWhatsappLink,
  resolveMessengerLink,
} from '../../utils/socialLinks.ts'
import { SOCIAL_PLATFORM_NAMES, resolveSocialDisplay, type SocialDisplayKind, type SocialLanguage, type SocialPlatform } from '../../utils/socialHandles.ts'

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
  phone: (value) => contactHref('tel', value),
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

// The storefront's contact data, split in two (owner A57, 21 Nov 2026: "the contact don't merge the chat with the account"):
//   - CHAT entries are ways to message or call the shop: Phone, Messenger, Telegram (chat link), WhatsApp, in that order. They are the Contact
//     panel behind the bottom-right dock button, and the inline rows wherever a page used to carry a Contact button;
//   - ACCOUNT entries are information: Facebook page, Instagram, TikTok, Telegram channel, Website. They sit in the About details card and the
//     footer column, never in the Contact panel.
// A name is decided in exactly one place, so every surface shows the same text.
export type PortalChatPlatform = 'phone' | 'messenger' | 'telegram' | 'whatsapp'
export type PortalAccountPlatform = 'facebook' | 'instagram' | 'tiktok' | 'telegram' | 'website'
export type PortalContactPlatform = PortalChatPlatform | PortalAccountPlatform

export type PortalContactEntry = {
  key: string
  platform: PortalContactPlatform
  href: string
  /** The account name or number a visitor reads. Never "@name" and never just the platform word (unless nothing else is known). */
  label: string
  /** "Facebook: leanggirlactik": the platform stays available to a screen reader. */
  accessibleName: string
  latin: boolean
}

export const PORTAL_CHAT_ORDER: readonly PortalChatPlatform[] = ['phone', 'messenger', 'telegram', 'whatsapp']
export const PORTAL_ACCOUNT_ORDER: readonly PortalAccountPlatform[] = ['facebook', 'instagram', 'tiktok', 'telegram', 'website']

const KHMER_TEXT = /[ក-៿᧠-᧿]/
const clean = (value: unknown): string => String(value ?? '').trim()

/** One account is one row however it is typed: a number by its digits, anything else by platform and name. */
const entryIdentity = (entry: Pick<PortalContactEntry, 'platform' | 'href' | 'label'>): string =>
  entry.platform === 'phone' ? `phone|${entry.href.replace(/\D/g, '').replace(/^855/, '').replace(/^0+/, '')}` : `${entry.platform}|${entry.label.toLowerCase()}`

/**
 * The chat entries and the account entries. `contact` are the direct-message channels (Messenger, Telegram, WhatsApp, Call, Instagram),
 * `social` the page links (website, Facebook, Instagram, TikTok, Telegram), `phone` the shop's business phone. The same account listed twice
 * under one list is one row; a platform with two accounts gets two rows. The one Telegram account that is both chat link and channel is in BOTH
 * lists (the panel and the information rows); a screen that shows both drops the second with `portalAccountsNotShown`.
 * Instagram is an account here: its chat link is used only when no page link names the same account.
 *
 * A Facebook link with no readable name (the live shop's is a facebook.com/share/ link) takes, in this order: the owner's label (already
 * applied by resolveSocialDisplay), the account name of the same business's Messenger link, then the shop name.
 */
export function buildPortalContactEntries(input: {
  social?: readonly PortalSocialGroup[]
  contact?: readonly PortalSocialGroup[]
  phone?: unknown
  shopName?: unknown
  language?: string
}): { chat: PortalContactEntry[]; accounts: PortalContactEntry[] } {
  const language: SocialLanguage = input.language === 'km' ? 'km' : 'en'
  const shopName = clean(input.shopName)
  const make = (platform: PortalContactPlatform, href: string, label: string, accessibleName: string): PortalContactEntry | null =>
    href && label ? { key: '', platform, href, label, accessibleName, latin: !KHMER_TEXT.test(label) } : null
  const collect = (order: readonly PortalContactPlatform[], candidates: Array<PortalContactEntry | null>): PortalContactEntry[] => {
    const seen = new Set<string>()
    const found: PortalContactEntry[] = []
    for (const entry of candidates) {
      if (!entry || !order.includes(entry.platform)) continue
      const identity = entryIdentity(entry)
      if (seen.has(identity)) continue
      seen.add(identity)
      found.push(entry)
    }
    return found
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => order.indexOf(a.entry.platform) - order.indexOf(b.entry.platform) || a.index - b.index)
      .map(({ entry }, position) => ({ ...entry, key: `${entry.platform}-${position}` }))
  }

  const messengerName = (input.contact ?? [])
    .filter((group) => group.platform === 'messenger')
    .flatMap((group) => group.links)
    .find((link) => link.kind === 'username')?.visibleText || ''
  const fromGroup = (group: PortalSocialGroup): Array<PortalContactEntry | null> => group.links.map((link) => {
    if (group.platform === 'facebook' && link.kind === 'platform') {
      const name = messengerName || shopName
      if (name) return make('facebook', link.href, name, `${SOCIAL_PLATFORM_NAMES.facebook[language]}: ${name}`)
    }
    return make(group.platform, link.href, link.visibleText, link.accessibleName)
  })

  const phone = clean(input.phone)
  const businessPhone = phone ? (() => {
    const display = resolveSocialDisplay({ platform: 'phone', href: phone, language })
    return make('phone', contactHref('tel', phone), display.visibleText, display.accessibleName)
  })() : null
  const chat = collect(PORTAL_CHAT_ORDER, [
    ...(input.contact ?? []).flatMap(fromGroup),
    businessPhone,
  ])
  const accounts = collect(PORTAL_ACCOUNT_ORDER, [
    ...(input.social ?? []).flatMap(fromGroup),
    ...(input.contact ?? []).filter((group) => group.platform === 'instagram').flatMap(fromGroup),
  ])
  return { chat, accounts }
}

/**
 * Where "Open in Maps" goes: the shop's own Google Maps link when the owner set one, else a plain Maps search for the address, else nothing.
 * Both are https links the visitor opens themselves.
 */
export function portalMapOpenHref(addressLink: unknown, address: unknown): string {
  const link = String(addressLink ?? '').trim()
  if (link) return link
  const text = String(address ?? '').trim()
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : ''
}

/** The accounts a screen has not already shown as chat rows: the same account never appears twice on one screen. */
export function portalAccountsNotShown(accounts: readonly PortalContactEntry[], shown: readonly PortalContactEntry[]): PortalContactEntry[] {
  const taken = new Set(shown.map(entryIdentity))
  return accounts.filter((entry) => !taken.has(entryIdentity(entry)))
}

/**
 * The accounts the footer column lists on this screen. About prints every account in its details card, so the footer prints none there; the FAQ
 * and the List page print the chat rows inline, so the footer leaves out the same account; every other screen lists them all.
 *
 * One exception, kept on purpose: the footer's Telegram entry stays on every screen. The footer's takedown sentence ("if you or a picture of you is
 * on this site, contact us via ...", legal/LegalPages.tsx) reads its link from this list, so dropping Telegram would leave that legal route with
 * no link. The entry comes from the accounts, else from the chat rows.
 */
export function portalFooterAccounts(accounts: readonly PortalContactEntry[], chat: readonly PortalContactEntry[], screen: { tab: string; listOpen: boolean }): PortalContactEntry[] {
  const aboutCovers = screen.tab === 'about' && !screen.listOpen
  const shown = aboutCovers ? [] : screen.listOpen || screen.tab === 'faq' ? portalAccountsNotShown(accounts, chat) : [...accounts]
  const telegram = accounts.find((entry) => entry.platform === 'telegram') ?? chat.find((entry) => entry.platform === 'telegram')
  if (telegram && !shown.some((entry) => entry.platform === 'telegram')) shown.push(telegram)
  return shown
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => PORTAL_ACCOUNT_ORDER.indexOf(a.entry.platform as PortalAccountPlatform) - PORTAL_ACCOUNT_ORDER.indexOf(b.entry.platform as PortalAccountPlatform) || a.index - b.index)
    .map(({ entry }) => entry)
}

/** The footer's column lists the account entries. */
export function portalContactFooterLinks(accounts: readonly PortalContactEntry[]): PortalFlatSocialLink[] {
  return accounts
    .filter((entry): entry is PortalContactEntry & { platform: SocialPlatform } => entry.platform !== 'phone')
    .map((entry) => ({ key: entry.key, platform: entry.platform, value: entry.href, label: entry.label, accessibleName: entry.accessibleName, latin: entry.latin }))
}


type ContactFocusNode = { isConnected: boolean; focus: () => void }
type ContactFocusHost = { querySelector: (selector: string) => unknown }

export const PORTAL_CONTACT_TRIGGER_SELECTOR = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Where focus goes when the Contact menu closes: nowhere if the visitor already put focus on something else, else the element that
 * opened the menu if it is still on the page, else the trigger now inside the menu's host.
 */
export function resolveContactFocusTarget<T extends ContactFocusNode>(opener: T | null, host: ContactFocusHost | null, active: unknown, body: unknown): T | null {
  const focusIsFree = !active || active === body || (active as ContactFocusNode).isConnected === false
  if (!focusIsFree) return null
  if (opener?.isConnected) return opener
  return (host?.querySelector(PORTAL_CONTACT_TRIGGER_SELECTOR) as T | null | undefined) ?? null
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
