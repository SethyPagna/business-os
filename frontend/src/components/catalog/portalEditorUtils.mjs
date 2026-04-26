const ABOUT_BLOCK_TYPES = new Set(['text', 'image', 'video'])

function toTrimmedString(value) {
  return String(value || '').trim()
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

export function createAboutBlock(type = 'text', overrides = {}) {
  const blockType = ABOUT_BLOCK_TYPES.has(type) ? type : 'text'
  const suffix = Math.random().toString(36).slice(2, 8)
  return {
    id: overrides.id || `about-${Date.now()}-${suffix}`,
    type: blockType,
    title: toTrimmedString(overrides.title),
    body: String(overrides.body || ''),
    mediaUrl: toTrimmedString(overrides.mediaUrl),
  }
}

export function normalizeAboutBlocks(value, options = {}) {
  const keepEmpty = !!options.keepEmpty
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? safeJsonParse(value, [])
      : []

  if (!Array.isArray(source)) return []

  return source
    .map((item, index) => createAboutBlock(item?.type, {
      id: item?.id || `about-${index + 1}`,
      title: item?.title,
      body: item?.body,
      mediaUrl: item?.mediaUrl,
    }))
    .filter((item) => keepEmpty || item.title || item.body || item.mediaUrl)
}

export function serializeAboutBlocks(value) {
  return JSON.stringify(normalizeAboutBlocks(value, { keepEmpty: true }))
}

export function moveListItem(list, startIndex, endIndex) {
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

export function extractGoogleMapsEmbedUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const iframeMatch = raw.match(/<iframe[^>]+src=(['"])(.*?)\1/i)
  if (iframeMatch?.[2]) return iframeMatch[2].trim()
  return raw
}

export function normalizeGoogleMapsEmbed(value) {
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
