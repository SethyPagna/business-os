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
import { isRuleActive, normalizePromotionRule, promotionAutoLabel, type PromotionRule } from './promotionRules'
import { MAX_LINK_URL_LENGTH, normalizeSafeLinkUrl } from './safeLinkUrl'
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

// ---------------------------------------------------------------------------
// Staff side: the posts as routes/portal.ts's /api/portal/posts endpoints read
// and write them. Every write of a post goes through applyPortalPostInput, so
// the rules below hold whichever client sends it.
// ---------------------------------------------------------------------------

const POST_ID = /^[A-Za-z0-9_-]{1,64}$/

export function isPortalPostId(value: string): boolean {
  return POST_ID.test(value)
}

// Character caps per field, in each language. Every storefront visit carries
// the Live posts, so their size is bounded where they are written; text
// stored before the caps existed is kept until that field is edited.
export const PORTAL_POST_TEXT_LIMITS = {
  eyebrow: 60,
  title: 120,
  subtitle: 200,
  body: 2200,
  ctaLabel: 40,
  location: 160,
  linkProductName: 200,
} as const

// Pictures only, no video: a picture address naming a video file is refused.
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv|3gp|wmv|flv)(?:[?#]|$)/i

export interface PortalPostInputError {
  code: string
  error: string
  field?: string
  max?: number
}

class PostInputRefused extends Error {
  constructor(readonly detail: PortalPostInputError) {
    super(detail.error)
  }
}

function refuse(detail: PortalPostInputError): never {
  throw new PostInputRefused(detail)
}

function hasField(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function textInput(value: unknown, field: string, max: number): string {
  if (value == null) return ''
  if (typeof value !== 'string') refuse({ code: 'invalid_post_field', error: `${field} must be text.`, field })
  const text = value.trim()
  if (text.length > max) refuse({ code: 'post_field_too_long', error: `${field} is longer than ${max} characters.`, field, max })
  return text
}

function linkInput(value: unknown, field: 'ctaHref' | 'image'): string {
  const text = textInput(value, field, MAX_LINK_URL_LENGTH)
  if (!text) return ''
  if (!normalizeSafeLinkUrl(text)) {
    refuse({ code: 'invalid_post_link', error: `${field} must be an http(s) address or a path on this site.`, field })
  }
  if (field === 'image' && VIDEO_FILE.test(text)) {
    refuse({ code: 'post_image_not_picture', error: 'A post shows pictures only, not video.', field })
  }
  return text
}

function dayInput(value: unknown, field: string): string {
  if (value == null || value === '') return ''
  const day = typeof value === 'string' ? normalizeTypedDate(value) : null
  if (!day) refuse({ code: 'invalid_post_date', error: `${field} must be a date (dd/mm/yyyy).`, field })
  return day
}

function flagInput(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') refuse({ code: 'invalid_post_field', error: `${field} must be true or false.`, field })
  return value
}

function recordIdInput(value: unknown, field: string): number | null {
  if (value == null || value === '' || value === 0) return null
  const id = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(id) || id <= 0) refuse({ code: 'invalid_post_field', error: `${field} must be a record id.`, field })
  return id
}

function blankPost(id: string): PortalPost {
  return {
    id,
    kind: 'promotion',
    eyebrow: '',
    title: '',
    subtitle: '',
    body: '',
    ctaLabel: '',
    ctaHref: '',
    image: '',
    linkProductId: null,
    linkProductName: '',
    km: kmOf(null),
    startsOn: '',
    endsOn: '',
    postedAt: '',
    pinned: false,
    hidden: false,
    ruleId: null,
    eventDate: '',
    location: '',
    version: 0,
    updatedAt: '',
  }
}

// One post as a write leaves it. `existing` is the stored post (null to
// create it); only the fields present in `input` change, each validated, and
// then the kind's own rules apply:
//   - a Story is Live for 24 hours from postedAt, so it has no start/end day;
//   - only an Event keeps an event date and a location;
//   - only a Discount keeps a rule id;
//   - a post links to a product OR to ctaHref -- the product wins, as it
//     always has in the editor.
// postedAt is stamped when the post is created, when it becomes a Story (its
// 24 hours start then), and on the first write of a post stored before
// postedAt existed. version counts the post's writes; updatedAt is the last.
export function applyPortalPostInput(
  existing: PortalPost | null,
  id: string,
  input: Record<string, unknown>,
  nowIso: string,
): { post: PortalPost } | { error: PortalPostInputError } {
  try {
    const post: PortalPost = existing ? { ...existing, km: { ...existing.km } } : blankPost(id)
    if (hasField(input, 'kind')) {
      if (!POST_KINDS.has(String(input.kind))) {
        refuse({ code: 'invalid_post_kind', error: `kind must be one of: ${PORTAL_POST_KINDS.join(', ')}.`, field: 'kind' })
      }
      post.kind = input.kind as PortalPostKind
    }
    for (const field of PORTAL_POST_TEXT_FIELDS) {
      if (hasField(input, field)) post[field] = textInput(input[field], field, PORTAL_POST_TEXT_LIMITS[field])
    }
    if (hasField(input, 'km')) {
      const km = input.km
      if (km !== null && (typeof km !== 'object' || Array.isArray(km))) {
        refuse({ code: 'invalid_post_field', error: 'km must be an object of Khmer text.', field: 'km' })
      }
      for (const field of PORTAL_POST_TEXT_FIELDS) {
        if (km === null) post.km[field] = ''
        else if (hasField(km as Record<string, unknown>, field)) {
          post.km[field] = textInput((km as Record<string, unknown>)[field], `km.${field}`, PORTAL_POST_TEXT_LIMITS[field])
        }
      }
    }
    if (hasField(input, 'ctaHref')) post.ctaHref = linkInput(input.ctaHref, 'ctaHref')
    if (hasField(input, 'image')) post.image = linkInput(input.image, 'image')
    if (hasField(input, 'linkProductId')) post.linkProductId = recordIdInput(input.linkProductId, 'linkProductId')
    if (hasField(input, 'linkProductName')) {
      post.linkProductName = textInput(input.linkProductName, 'linkProductName', PORTAL_POST_TEXT_LIMITS.linkProductName)
    }
    if (hasField(input, 'startsOn')) post.startsOn = dayInput(input.startsOn, 'startsOn')
    if (hasField(input, 'endsOn')) post.endsOn = dayInput(input.endsOn, 'endsOn')
    if (hasField(input, 'eventDate')) post.eventDate = dayInput(input.eventDate, 'eventDate')
    if (hasField(input, 'location')) post.location = textInput(input.location, 'location', PORTAL_POST_TEXT_LIMITS.location)
    if (hasField(input, 'pinned')) post.pinned = flagInput(input.pinned, 'pinned')
    if (hasField(input, 'hidden')) post.hidden = flagInput(input.hidden, 'hidden')
    if (hasField(input, 'ruleId')) post.ruleId = recordIdInput(input.ruleId, 'ruleId')

    if (post.kind === 'story') {
      post.startsOn = ''
      post.endsOn = ''
    }
    if (post.kind !== 'event') {
      post.eventDate = ''
      post.location = ''
    }
    if (post.kind !== 'discount') post.ruleId = null
    if (post.linkProductId) post.ctaHref = ''
    else post.linkProductName = ''

    if (!(post.title || post.subtitle || post.body || post.image)) {
      refuse({ code: 'post_empty', error: 'A post needs a title, some text or a picture.' })
    }
    if (post.startsOn && post.endsOn && post.endsOn < post.startsOn) {
      refuse({ code: 'post_dates_reversed', error: 'The end day is before the start day.', field: 'endsOn' })
    }

    if (!existing || !post.postedAt || (post.kind === 'story' && existing.kind !== 'story')) post.postedAt = nowIso
    post.version = existing ? existing.version + 1 : 1
    post.updatedAt = nowIso
    return { post }
  } catch (error) {
    if (error instanceof PostInputRefused) return { error: error.detail }
    throw error
  }
}

// A created post goes to the top of the list; an edited one keeps its place.
export function withPortalPost(posts: readonly PortalPost[], post: PortalPost): PortalPost[] {
  const index = posts.findIndex((candidate) => candidate.id === post.id)
  if (index < 0) return [post, ...posts]
  const next = [...posts]
  next[index] = post
  return next
}

// A new order names every post exactly once. An id that is not in the list,
// or a post the order leaves out (created or deleted meanwhile), means the
// caller's list is stale: the answer is 'stale', never a guessed merge.
export function reorderPortalPosts(posts: readonly PortalPost[], order: unknown): PortalPost[] | 'invalid' | 'stale' {
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) return 'invalid'
  if (new Set(order).size !== order.length) return 'invalid'
  const byId = new Map(posts.map((post) => [post.id, post]))
  if (order.length !== posts.length || !order.every((id) => byId.has(id))) return 'stale'
  return order.map((id) => byId.get(id) as PortalPost)
}

// The rule ids the editor's list needs, in any state: an Ended Discount post
// still names its rule.
export function portalPostRuleIds(posts: readonly PortalPost[]): number[] {
  return [...new Set(posts.flatMap((post) => (post.kind === 'discount' && post.ruleId != null ? [post.ruleId] : [])))]
}

export interface PortalPostRuleSummary {
  id: number
  state: PortalPostRuleState
  label: string
  badgeColor: string
  startsAt: string | null
  endsAt: string | null
}

export interface StaffPortalPost extends PortalPost {
  status: PortalPostStatus
  rule: PortalPostRuleSummary | null
}

// The editor's list: every post in stored order with its derived status and,
// for a Discount post, where its rule stands. `ruleRows` are the
// promotion_rules rows for portalPostRuleIds(posts).
export function staffPortalPosts(posts: readonly PortalPost[], ruleRows: readonly Record<string, unknown>[], nowMs: number): StaffPortalPost[] {
  const rulesById = new Map<number, PromotionRule>()
  for (const row of ruleRows) {
    const rule = normalizePromotionRule(row)
    if (rule) rulesById.set(rule.id, rule)
  }
  return posts.map((post) => {
    let rule: PortalPostRuleSummary | null = null
    if (post.kind === 'discount' && post.ruleId != null) {
      const linked = rulesById.get(post.ruleId)
      rule = linked
        ? { id: linked.id, state: portalPostRuleState(linked, nowMs), label: portalPostRuleLabel(linked), badgeColor: linked.badge_color, startsAt: linked.starts_at, endsAt: linked.ends_at }
        : { id: post.ruleId, state: 'missing', label: '', badgeColor: '', startsAt: null, endsAt: null }
    }
    return { ...post, km: { ...post.km }, status: portalPostStatus(post, nowMs, rulesById), rule }
  })
}
