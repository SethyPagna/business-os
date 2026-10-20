// Pure helpers that turn a stored social/contact link into what a visitor
// should SEE: the real account handle (@leangcosmetics, +855 12 345 678,
// example.com/shop) instead of the platform name. Dependency-free apart from
// the phone formatter so it is unit-testable in node.
//
// Owner rule: a social link shows the platform icon plus the actual account
// handle -- never the platform name as visible text. An owner-typed custom
// label wins. A saved label that merely equals the platform's default name
// ("Facebook", "ហ្វេសប៊ុក", ...) counts as unset, because the editor used to
// write the default name into the label on every save. The platform name
// stays available as the accessible name.
//
// Display only: this never changes an href. Query strings, fragments and a
// trailing slash are ignored for display (Telegram's `?direct` stays in the
// href the caller keeps; it just is not shown).

import { formatPhoneInputValue } from './phoneInput.ts'

export type SocialPlatform = 'website' | 'facebook' | 'instagram' | 'telegram' | 'messenger' | 'whatsapp' | 'phone' | 'tiktok'
export type SocialHandleKind = 'username' | 'phone' | 'domain' | 'name'
export type SocialDisplayKind = SocialHandleKind | 'label' | 'platform'
export type SocialLanguage = 'en' | 'km'

export type SocialHandle = { text: string; kind: SocialHandleKind }

/**
 * Names that mean "the owner never typed a label" for each platform. Compared
 * after normalizeSocialLabel and case-folding. Both Khmer spellings of
 * Instagram are listed on purpose (ស្តា and ស្ដា are different code points).
 */
export const SOCIAL_DEFAULT_NAMES: Readonly<Record<SocialPlatform, readonly string[]>> = {
  website: ['Website', 'Web', 'គេហទំព័រ'],
  facebook: ['Facebook', 'FB', 'ហ្វេសប៊ុក'],
  instagram: ['Instagram', 'IG', 'អ៊ីនស្តាក្រាម', 'អ៊ីនស្ដាក្រាម'],
  telegram: ['Telegram', 'តេឡេក្រាម'],
  messenger: ['Messenger'],
  whatsapp: ['WhatsApp'],
  phone: ['Call', 'Phone', 'ហៅទូរស័ព្ទ', 'ទូរស័ព្ទ'],
  tiktok: ['TikTok'],
}

/** Localized platform name used as the fallback text and the accessible name. Brand names stay Latin in Khmer. */
export const SOCIAL_PLATFORM_NAMES: Readonly<Record<SocialPlatform, Readonly<Record<SocialLanguage, string>>>> = {
  website: { en: 'Website', km: 'គេហទំព័រ' },
  facebook: { en: 'Facebook', km: 'Facebook' },
  instagram: { en: 'Instagram', km: 'Instagram' },
  telegram: { en: 'Telegram', km: 'Telegram' },
  messenger: { en: 'Messenger', km: 'Messenger' },
  whatsapp: { en: 'WhatsApp', km: 'WhatsApp' },
  phone: { en: 'Call', km: 'ហៅទូរស័ព្ទ' },
  tiktok: { en: 'TikTok', km: 'TikTok' },
}

const KHMER_CHAR = /[ក-៿᧠-᧿]/
const MAX_WEBSITE_DISPLAY = 32

/** NFC, strip U+200B / U+FEFF, collapse whitespace, trim. */
export function normalizeSocialLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[​﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the label is empty or only the platform's default name (any listed EN/KM default). */
export function isDefaultSocialLabel(platform: SocialPlatform, label: unknown): boolean {
  const normalized = normalizeSocialLabel(label)
  if (!normalized) return true
  const folded = normalized.toLowerCase()
  return SOCIAL_DEFAULT_NAMES[platform].some((name) => name.normalize('NFC').toLowerCase() === folded)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

type ParsedLink = { host: string; segments: string[]; url: URL }

function parseWebLink(href: unknown): ParsedLink | null {
  const raw = normalizeSocialLabel(href)
  if (!raw || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? '' : `https://${raw}`)
  if (!withScheme) return null
  try {
    const url = new URL(withScheme)
    if (!/^https?:$/i.test(url.protocol)) return null
    const host = url.hostname.toLowerCase()
    if (!host) return null
    return { host, segments: url.pathname.split('/').filter(Boolean).map(safeDecode), url }
  } catch {
    return null
  }
}

const hostIs = (host: string, ...domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
const user = (text: string): SocialHandle => ({ text: `@${text}`, kind: 'username' })

// Facebook first segments that are never a page/person vanity name.
const NON_PROFILE_FACEBOOK = new Set([
  'pages', 'people', 'profile.php', 'groups', 'events', 'watch', 'marketplace', 'video.php', 'permalink.php',
  'sharer', 'share', 'share.php', 'login', 'help', 'business', 'ads', 'reel', 'reels', 'stories', 'story.php',
  'hashtag', 'gaming', 'plugins', 'dialog', 'l.php', 'policies', 'privacy', 'terms', 'settings', 'search', 'public',
])

function facebookHandle(link: ParsedLink): SocialHandle | null {
  const [first = '', second = '', third = ''] = link.segments
  const lower = first.toLowerCase()
  if ((lower === 'pages' || lower === 'people') && second && third && second.toLowerCase() !== 'category') {
    const name = second.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    return name ? { text: name, kind: 'name' } : null
  }
  if (!first || NON_PROFILE_FACEBOOK.has(lower) || lower.startsWith('photo')) return null
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(first) || /^\d+$/.test(first)) return null
  return user(first)
}

function messengerHandle(link: ParsedLink): SocialHandle | null {
  // m.me/<name> directly, or the page name of a facebook.com link (what the
  // storefront derives its Messenger fallback from). Numeric ids are not names.
  let name = ''
  if (hostIs(link.host, 'm.me')) name = link.segments[0] || ''
  else if (hostIs(link.host, 'facebook.com', 'fb.com')) {
    const page = facebookHandle(link)
    name = page?.kind === 'username' ? page.text.slice(1) : ''
  }
  if (!name || /^\d+$/.test(name) || !/^[A-Za-z0-9._-]{1,50}$/.test(name)) return null
  return user(name)
}

const RESERVED_INSTAGRAM = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer',
  'privacy', 'help', 'web', 'directory', 'challenge', 'locations', 'api',
])

function instagramHandle(link: ParsedLink): SocialHandle | null {
  let name = link.segments[0] || ''
  if (hostIs(link.host, 'ig.me')) name = (name.toLowerCase() === 'm' ? link.segments[1] : name) || ''
  else if (!hostIs(link.host, 'instagram.com', 'instagr.am')) return null
  if (!name || RESERVED_INSTAGRAM.has(name.toLowerCase())) return null
  return /^[A-Za-z0-9._]{1,30}$/.test(name) ? user(name) : null
}

const NON_PROFILE_TELEGRAM = new Set(['joinchat', 'c', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'login', 'setlanguage', 'iv', 'boost', 'giftcode'])

function telegramHandle(link: ParsedLink): SocialHandle | null {
  if (!hostIs(link.host, 't.me', 'telegram.me', 'telegram.dog')) return null
  const first = link.segments[0] || ''
  const name = first.toLowerCase() === 's' ? (link.segments[1] || '') : first
  if (!name || name.startsWith('+') || NON_PROFILE_TELEGRAM.has(name.toLowerCase())) return null
  return /^[A-Za-z0-9_]{4,32}$/.test(name) ? user(name) : null
}

function tiktokHandle(link: ParsedLink): SocialHandle | null {
  if (!hostIs(link.host, 'tiktok.com') || link.host.startsWith('vm.') || link.host.startsWith('vt.')) return null
  const first = link.segments[0] || ''
  if (!first.startsWith('@')) return null
  const name = first.slice(1)
  return /^[A-Za-z0-9._]{1,24}$/.test(name) ? user(name) : null
}

function phoneText(digits: string, international: boolean): SocialHandle | null {
  if (digits.length < 6) return null
  const withPlus = international || (digits.startsWith('855') && digits.length >= 10)
  const text = formatPhoneInputValue(withPlus ? `+${digits}` : digits)
  return text ? { text, kind: 'phone' } : null
}

function whatsappHandle(link: ParsedLink): SocialHandle | null {
  if (hostIs(link.host, 'chat.whatsapp.com')) return null
  let digits = ''
  if (hostIs(link.host, 'wa.me')) {
    const first = link.segments[0] || ''
    digits = /^[+\d\s().-]+$/.test(first) ? first.replace(/\D/g, '') : ''
  } else if (hostIs(link.host, 'whatsapp.com')) {
    digits = String(link.url.searchParams.get('phone') || '').replace(/\D/g, '')
  } else return null
  return phoneText(digits, true)
}

function phoneHandle(value: string): SocialHandle | null {
  const raw = normalizeSocialLabel(safeDecode(value)).replace(/^tel:/i, '')
  if (!raw || !/^[+\d\s().-]+$/.test(raw)) return null
  return phoneText(raw.replace(/\D/g, ''), raw.trimStart().startsWith('+'))
}

function websiteHandle(link: ParsedLink): SocialHandle | null {
  const host = link.host.replace(/^www\./, '')
  if (!host.includes('.')) return null
  const path = link.segments.join('/')
  const withPath = path ? `${host}/${path}` : host
  return { text: path && withPath.length <= MAX_WEBSITE_DISPLAY ? withPath : host, kind: 'domain' }
}

/** The account handle to display for a stored link, or null when the link names no account. */
export function deriveSocialHandle(platform: SocialPlatform, href: unknown): SocialHandle | null {
  const raw = normalizeSocialLabel(href)
  if (!raw) return null
  if (platform === 'phone') return phoneHandle(raw)
  const link = parseWebLink(raw)
  if (!link) return null
  switch (platform) {
    case 'messenger': return messengerHandle(link)
    case 'facebook': return hostIs(link.host, 'facebook.com', 'fb.com') ? facebookHandle(link) : null
    case 'instagram': return instagramHandle(link)
    case 'telegram': return telegramHandle(link)
    case 'whatsapp': return whatsappHandle(link)
    case 'tiktok': return tiktokHandle(link)
    case 'website': return websiteHandle(link)
    default: return null
  }
}

export type SocialDisplay = {
  visibleText: string
  accessibleName: string
  /** True when visibleText is a handle/number/domain/brand name that must not be translated or Khmer-shaped. */
  latin: boolean
  kind: SocialDisplayKind
}

/**
 * Precedence: owner-typed custom label, then the derived handle, then the
 * localized platform name. The accessible name is "<Platform>: <visible>", or
 * the platform alone when the visible text already is the platform name.
 */
export function resolveSocialDisplay(input: {
  platform: SocialPlatform
  customLabel?: unknown
  href?: unknown
  language?: string
}): SocialDisplay {
  const { platform } = input
  const platformName = SOCIAL_PLATFORM_NAMES[platform][input.language === 'km' ? 'km' : 'en']
  const label = normalizeSocialLabel(input.customLabel)
  let visibleText = platformName
  let kind: SocialDisplayKind = 'platform'
  let latin = !KHMER_CHAR.test(platformName)
  if (label && !isDefaultSocialLabel(platform, label)) {
    visibleText = label
    kind = 'label'
    latin = false
  } else {
    const handle = deriveSocialHandle(platform, input.href)
    if (handle) {
      visibleText = handle.text
      kind = handle.kind
      latin = !KHMER_CHAR.test(handle.text)
    }
  }
  const visibleIsPlatform = visibleText.toLowerCase() === platformName.toLowerCase() || isDefaultSocialLabel(platform, visibleText)
  return { visibleText, accessibleName: visibleIsPlatform ? platformName : `${platformName}: ${visibleText}`, latin, kind }
}
