// Website Editor posts: the storefront's posts, pinned at the top of every
// tab and on their own Posts page. Five kinds -- Promotion, Discount, Event,
// Announcement and Story -- each with English text and optional Khmer text
// (empty Khmer falls back to English on the site).
//
// Storage. The posts live where the editor's "Promotions and posts" cards
// always lived: ONE settings row, customer_portal_promo_items, holding a JSON
// array. Rows written before posts existed hold v1 cards (id, eyebrow, title,
// subtitle, body, mediaUrl, ctaLabel, linkUrl, linkProductId,
// linkProductName); readPortalPosts turns each into a v2 Promotion post that
// renders exactly as the card did, and the first post write stores the whole
// list as v2. A v2 post is told apart by its kind and integer version, which
// no v1 card ever carried.
//
// Status is derived, never stored: Hidden (switched off) > Ended > Scheduled
// > Live. Promotion, Event and Announcement posts run on their own
// startsOn/endsOn, which are Phnom Penh business days (an Event with no end
// date ends after its event date). A Story is Live for 24 hours from
// postedAt. A Discount post is the POS promotion rule it links (ruleId): it
// is Live exactly while that rule is active, so ending or switching off the
// rule ends the offer on the site and at the till together, and the post
// shows the rule's own label rather than a website-only copy of the deal.
import { businessToday } from './businessDateWindow'
import { isRuleActive, promotionAutoLabel, type PromotionRule } from './promotionRules'
import { normalizeSafeLinkUrl } from './safeLinkUrl'
import { normalizeTypedDate } from './batchCode'

export const PORTAL_POSTS_SETTING_KEY = 'customer_portal_promo_items'
export const MAX_PORTAL_POSTS = 50
export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000

export const PORTAL_POST_KINDS = ['promotion', 'discount', 'event', 'announcement', 'story'] as const
export type PortalPostKind = (typeof PORTAL_POST_KINDS)[number]
const POST_KINDS: ReadonlySet<string> = new Set(PORTAL_POST_KINDS)

// The text a post shows, in English at the top level and in Khmer under km.
export const PORTAL_POST_TEXT_FIELDS = ['eyebrow', 'title', 'subtitle', 'body', 'ctaLabel'] as const
export type PortalPostTextField = (typeof PORTAL_POST_TEXT_FIELDS)[number]
export type PortalPostKm = Record<PortalPostTextField, string>

export type PortalPostStatus = 'live' | 'scheduled' | 'ended' | 'hidden'

export interface PortalPost extends Record<PortalPostTextField, string> {
  id: string
  kind: PortalPostKind
  ctaHref: string
  image: string
  // A post links to a product (opened in the product flyout) OR to ctaHref.
  linkProductId: number | null
  linkProductName: string
  km: PortalPostKm
  startsOn: string // YYYY-MM-DD business day, '' = from posting
  endsOn: string // YYYY-MM-DD business day, '' = no end
  postedAt: string // ISO instant of the first post, '' = posted before v2
  pinned: boolean
  hidden: boolean
  ruleId: number | null // Discount posts only
  eventDate: string // Event posts only, YYYY-MM-DD
  location: string // Event posts only
  version: number
  updatedAt: string
}

// What a visitor receives: Live posts only, no editing metadata.
export interface PublicPortalPost extends Record<PortalPostTextField, string> {
  id: string
  kind: PortalPostKind
  ctaHref: string
  image: string
  linkProductId: number | null
  linkProductName: string
  km: PortalPostKm
  startsOn: string
  endsOn: string
  postedAt: string
  pinned: boolean
  eventDate: string
  location: string
  ruleId: number | null
  ruleLabel: string
  ruleBadgeColor: string
}

function textOf(row: Record<string, unknown>, key: string): string {
  return String(row[key] || '').trim()
}

function positiveIdOf(value: unknown): number | null {
  const id = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

function dayOf(value: unknown): string {
  return normalizeTypedDate(String(value ?? '')) || ''
}

function instantOf(value: unknown): string {
  const raw = String(value ?? '').trim()
  return raw && Number.isFinite(Date.parse(raw)) ? raw : ''
}

function kmOf(value: unknown): PortalPostKm {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    eyebrow: textOf(row, 'eyebrow'),
    title: textOf(row, 'title'),
    subtitle: textOf(row, 'subtitle'),
    body: textOf(row, 'body'),
    ctaLabel: textOf(row, 'ctaLabel'),
  }
}

function isV2Post(row: Record<string, unknown>): boolean {
  return typeof row.kind === 'string' && Number.isInteger(row.version) && Number(row.version) >= 1
}

// BOTH of a post's URLs -- the link it navigates to and the image it renders
// -- go through the allowlist the announcement strip's link_url uses
// (lib/safeLinkUrl.ts), once, here, so an unsafe value stored before that
// guard existed never reaches a visitor. The image gets the link rule rather
// than a looser image-only one: a real post picture is an uploaded /uploads/
// path or an https:// URL, which is exactly what the allowlist admits, and an
// <img src> is no harmless place for javascript:/data:/protocol-relative
// values either (a data: document behind an onerror, a //evil.example beacon
// that leaks every visitor's IP and referrer).
function postFromRow(row: Record<string, unknown>, index: number): PortalPost {
  if (!isV2Post(row)) {
    // A v1 card, field for field as normalizePortalPromoItems served it.
    return {
      id: textOf(row, 'id') || `promo-${index + 1}`,
      kind: 'promotion',
      eyebrow: textOf(row, 'eyebrow'),
      title: textOf(row, 'title'),
      subtitle: textOf(row, 'subtitle'),
      body: textOf(row, 'body'),
      ctaLabel: textOf(row, 'ctaLabel'),
      ctaHref: normalizeSafeLinkUrl(row.linkUrl) || '',
      image: normalizeSafeLinkUrl(row.mediaUrl) || '',
      linkProductId: positiveIdOf(row.linkProductId),
      linkProductName: textOf(row, 'linkProductName'),
      km: kmOf(null),
      startsOn: '',
      endsOn: '',
      postedAt: '',
      pinned: false,
      hidden: false,
      ruleId: null,
      eventDate: '',
      location: '',
      version: 1,
      updatedAt: '',
    }
  }
  return {
    id: textOf(row, 'id') || `post-${index + 1}`,
    kind: POST_KINDS.has(String(row.kind)) ? row.kind as PortalPostKind : 'promotion',
    eyebrow: textOf(row, 'eyebrow'),
    title: textOf(row, 'title'),
    subtitle: textOf(row, 'subtitle'),
    body: textOf(row, 'body'),
    ctaLabel: textOf(row, 'ctaLabel'),
    ctaHref: normalizeSafeLinkUrl(row.ctaHref) || '',
    image: normalizeSafeLinkUrl(row.image) || '',
    linkProductId: positiveIdOf(row.linkProductId),
    linkProductName: textOf(row, 'linkProductName'),
    km: kmOf(row.km),
    startsOn: dayOf(row.startsOn),
    endsOn: dayOf(row.endsOn),
    postedAt: instantOf(row.postedAt),
    pinned: row.pinned === true,
    hidden: row.hidden === true,
    ruleId: positiveIdOf(row.ruleId),
    eventDate: dayOf(row.eventDate),
    location: textOf(row, 'location'),
    version: Number(row.version),
    updatedAt: instantOf(row.updatedAt),
  }
}

// A post with nothing to show is not a post (the v1 rule: a lone link is not
// a card). Malformed JSON, a non-array or an absent setting fail closed to no
// posts. A repeated id -- possible only in hand-edited or v1 data -- is made
// unique so every post can be addressed on its own.
export function readPortalPosts(value: unknown): PortalPost[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch (_) {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const posts: PortalPost[] = []
  parsed.slice(0, MAX_PORTAL_POSTS).forEach((item, index) => {
    const post = postFromRow(item && typeof item === 'object' ? item as Record<string, unknown> : {}, index)
    if (!(post.title || post.subtitle || post.body || post.image)) return
    while (seen.has(post.id)) post.id = `${post.id}-${index + 1}`
    seen.add(post.id)
    posts.push(post)
  })
  return posts
}

export type PortalPostRuleState = 'live' | 'scheduled' | 'ended' | 'missing'

// Where a Discount post's rule stands, through the POS kernel's own
// isRuleActive: a rule that is not active now but would be at its own start
// is Scheduled; anything else not active (switched off, past its end, no
// benefit left) is Ended.
export function portalPostRuleState(rule: PromotionRule | null | undefined, nowMs: number): PortalPostRuleState {
  if (!rule) return 'missing'
  if (isRuleActive(rule, nowMs)) return 'live'
  const startMs = rule.starts_at ? new Date(rule.starts_at).getTime() : Number.NaN
  return Number.isFinite(startMs) && startMs > nowMs && isRuleActive(rule, startMs) ? 'scheduled' : 'ended'
}

export function portalPostStatus(post: PortalPost, nowMs: number, rulesById: ReadonlyMap<number, PromotionRule>): PortalPostStatus {
  if (post.hidden) return 'hidden'
  if (post.kind === 'story') {
    const postedMs = Date.parse(post.postedAt)
    return Number.isFinite(postedMs) && nowMs < postedMs + STORY_LIFETIME_MS ? 'live' : 'ended'
  }
  if (post.kind === 'discount') {
    const state = portalPostRuleState(post.ruleId == null ? null : rulesById.get(post.ruleId), nowMs)
    return state === 'missing' ? 'ended' : state
  }
  const today = businessToday(nowMs)
  const endsOn = post.endsOn || (post.kind === 'event' ? post.eventDate : '')
  if (endsOn && endsOn < today) return 'ended'
  if (post.startsOn && post.startsOn > today) return 'scheduled'
  return 'live'
}

// The label a Discount post carries is the rule's: its typed title when the
// rule shows one, otherwise the POS kernel's auto-label ("Buy 3+ Save $5"),
// so the post always names the deal the till will actually give.
export function portalPostRuleLabel(rule: PromotionRule): string {
  return rule.show_title && rule.title ? rule.title : promotionAutoLabel(rule)
}

// Only Discount posts depend on the rule set, so a caller without it at hand
// can skip the read when there is none.
export function hasDiscountPost(posts: readonly PortalPost[]): boolean {
  return posts.some((post) => post.kind === 'discount' && !post.hidden)
}

// The storefront's posts: Live ones only, pinned first, each otherwise in
// the editor's order. `activeRules` is the rule set the POS prices with
// (loadActivePromotionRules); a Discount post whose rule is not in it -- or
// is no longer active -- is dropped.
export function publicPortalPosts(posts: readonly PortalPost[], activeRules: readonly PromotionRule[], nowMs: number): PublicPortalPost[] {
  const rulesById = new Map(activeRules.map((rule) => [rule.id, rule]))
  const live = posts.filter((post) => portalPostStatus(post, nowMs, rulesById) === 'live')
  return [...live.filter((post) => post.pinned), ...live.filter((post) => !post.pinned)].map((post) => {
    const rule = post.kind === 'discount' && post.ruleId != null ? rulesById.get(post.ruleId) : undefined
    return {
      id: post.id,
      kind: post.kind,
      eyebrow: post.eyebrow,
      title: post.title,
      subtitle: post.subtitle,
      body: post.body,
      ctaLabel: post.ctaLabel,
      ctaHref: post.ctaHref,
      image: post.image,
      linkProductId: post.linkProductId,
      linkProductName: post.linkProductName,
      km: { ...post.km },
      startsOn: post.startsOn,
      endsOn: post.endsOn,
      postedAt: post.postedAt,
      pinned: post.pinned,
      eventDate: post.eventDate,
      location: post.location,
      ruleId: rule ? rule.id : null,
      ruleLabel: rule ? portalPostRuleLabel(rule) : '',
      ruleBadgeColor: rule ? rule.badge_color : '',
    }
  })
}

// The same Live posts in the v1 card shape, for a storefront bundle cached
// before posts existed (it reads config.promoItems). Drop it once no such
// bundle can still be running.
export function portalPromoCards(posts: readonly PublicPortalPost[]) {
  return posts.map((post) => ({
    id: post.id,
    eyebrow: post.eyebrow,
    title: post.title,
    subtitle: post.subtitle,
    body: post.body,
    mediaUrl: post.image,
    ctaLabel: post.ctaLabel,
    linkUrl: post.ctaHref,
    linkProductId: post.linkProductId,
    linkProductName: post.linkProductName,
  }))
}
