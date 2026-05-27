const ABOUT_BLOCK_TYPES = new Set(['text', 'image', 'video'])

type AboutBlockType = 'text' | 'image' | 'video'

interface AboutBlockInput {
  id?: unknown
  type?: unknown
  title?: unknown
  body?: unknown
  mediaUrl?: unknown
}

interface AboutBlock {
  id: unknown
  type: AboutBlockType
  title: string
  body: string
  mediaUrl: string
}

interface PromoItemInput {
  id?: unknown
  eyebrow?: unknown
  title?: unknown
  subtitle?: unknown
  body?: unknown
  mediaUrl?: unknown
  ctaLabel?: unknown
  linkUrl?: unknown
}

interface PromoItem {
  id: unknown
  eyebrow: string
  title: string
  subtitle: string
  body: string
  mediaUrl: string
  ctaLabel: string
  linkUrl: string
}

interface NormalizeCollectionOptions {
  keepEmpty?: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toTrimmedString(value: unknown): string {
  return String(value || '').trim()
}

function safeJsonParse<TFallback>(value: string, fallback: TFallback): unknown | TFallback {
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

export function createAboutBlock(type: unknown = 'text', overrides: AboutBlockInput = {}): AboutBlock {
  const blockType = ABOUT_BLOCK_TYPES.has(String(type)) ? String(type) as AboutBlockType : 'text'
  const suffix = Math.random().toString(36).slice(2, 8)
  return {
    id: overrides.id || `about-${Date.now()}-${suffix}`,
    type: blockType,
    title: toTrimmedString(overrides.title),
    body: String(overrides.body || ''),
    mediaUrl: toTrimmedString(overrides.mediaUrl),
  }
}

export function normalizeAboutBlocks(value: unknown, options: NormalizeCollectionOptions = {}): AboutBlock[] {
  const keepEmpty = !!options.keepEmpty
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? safeJsonParse(value, [])
      : []

  if (!Array.isArray(source)) return []

  return source
    .map((item, index) => createAboutBlock(item?.type, {
      id: isPlainObject(item) ? item.id || `about-${index + 1}` : `about-${index + 1}`,
      title: isPlainObject(item) ? item.title : '',
      body: isPlainObject(item) ? item.body : '',
      mediaUrl: isPlainObject(item) ? item.mediaUrl : '',
    }))
    .filter((item) => keepEmpty || item.title || item.body || item.mediaUrl)
}

export function serializeAboutBlocks(value: unknown): string {
  return JSON.stringify(normalizeAboutBlocks(value, { keepEmpty: true }))
}

export function createPromoItem(overrides: PromoItemInput = {}): PromoItem {
  const suffix = Math.random().toString(36).slice(2, 8)
  return {
    id: overrides.id || `promo-${Date.now()}-${suffix}`,
    eyebrow: toTrimmedString(overrides.eyebrow || 'Promotion'),
    title: toTrimmedString(overrides.title),
    subtitle: toTrimmedString(overrides.subtitle),
    body: String(overrides.body || ''),
    mediaUrl: toTrimmedString(overrides.mediaUrl),
    ctaLabel: toTrimmedString(overrides.ctaLabel || 'Learn more'),
    linkUrl: toTrimmedString(overrides.linkUrl),
  }
}

export function normalizePromoItems(value: unknown, options: NormalizeCollectionOptions = {}): PromoItem[] {
  const keepEmpty = !!options.keepEmpty
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? safeJsonParse(value, [])
      : []

  if (!Array.isArray(source)) return []

  return source
    .map((item, index) => createPromoItem({
      id: isPlainObject(item) ? item.id || `promo-${index + 1}` : `promo-${index + 1}`,
      eyebrow: isPlainObject(item) ? item.eyebrow : '',
      title: isPlainObject(item) ? item.title : '',
      subtitle: isPlainObject(item) ? item.subtitle : '',
      body: isPlainObject(item) ? item.body : '',
      mediaUrl: isPlainObject(item) ? item.mediaUrl : '',
      ctaLabel: isPlainObject(item) ? item.ctaLabel : '',
      linkUrl: isPlainObject(item) ? item.linkUrl : '',
    }))
    .filter((item) => keepEmpty || item.title || item.subtitle || item.body || item.mediaUrl || item.linkUrl)
}

export function serializePromoItems(value: unknown): string {
  return JSON.stringify(normalizePromoItems(value, { keepEmpty: true }))
}

export function moveListItem<TItem>(list: TItem[], startIndex: number, endIndex: number): TItem[] {
  if (!Array.isArray(list)) return []
  if (startIndex === endIndex) return [...list]
  if (startIndex < 0 || endIndex < 0 || startIndex >= list.length || endIndex >= list.length) {
    return [...list]
  }

  const next = [...list]
  const [item] = next.splice(startIndex, 1)
  next.splice(endIndex, 0, item)
  return next
}

export function extractGoogleMapsEmbedUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const iframeMatch = raw.match(/<iframe[^>]+src=(['"])(.*?)\1/i)
  if (iframeMatch?.[2]) return iframeMatch[2].trim()
  return raw
}

export function normalizeGoogleMapsEmbed(value: unknown): string {
  const raw = extractGoogleMapsEmbedUrl(value)
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) return ''

  try {
    const url = new URL(raw)
    const host = String(url.hostname || '').toLowerCase()
    const hostAllowed = /^(.+\.)?google\.[a-z.]+$/i.test(host)
      || host === 'maps.google.com'
      || host === 'share.google'
      || host === 'maps.app.goo.gl'
      || host === 'goo.gl'

    if (!hostAllowed) return ''

    const path = String(url.pathname || '').toLowerCase()
    if (path.startsWith('/maps/embed')) return url.toString()

    const embedUrl = new URL('https://www.google.com/maps')
    embedUrl.searchParams.set('q', url.toString())
    embedUrl.searchParams.set('output', 'embed')
    return embedUrl.toString()
  } catch (_) {
    return ''
  }
}
