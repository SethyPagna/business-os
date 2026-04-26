'use strict'

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

function createAboutBlock(type, overrides = {}) {
  const blockType = ABOUT_BLOCK_TYPES.has(type) ? type : 'text'
  return {
    id: overrides.id || `about-${Date.now()}`,
    type: blockType,
    title: toTrimmedString(overrides.title),
    body: String(overrides.body || ''),
    mediaUrl: toTrimmedString(overrides.mediaUrl),
  }
}

function normalizeAboutBlocks(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? safeJsonParse(value, [])
      : []

  if (!Array.isArray(source)) return []

  return source
    .map((item, index) => createAboutBlock(item && item.type, {
      id: item && item.id ? item.id : `about-${index + 1}`,
      title: item && item.title,
      body: item && item.body,
      mediaUrl: item && item.mediaUrl,
    }))
    .filter((item) => item.title || item.body || item.mediaUrl)
}

function extractGoogleMapsEmbedUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const iframeMatch = raw.match(/<iframe[^>]+src=(['"])(.*?)\1/i)
  if (iframeMatch && iframeMatch[2]) return iframeMatch[2].trim()
  return raw
}

function normalizeGoogleMapsEmbed(value) {
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

module.exports = {
  normalizeAboutBlocks,
  normalizeGoogleMapsEmbed,
}
