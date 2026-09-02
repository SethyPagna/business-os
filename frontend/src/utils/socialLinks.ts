// Pure helpers for the portal's social contact links. Kept dependency-free
// (no DOM) so they're directly unit-testable, same convention as
// imageCompression.ts's pure helpers.

// Facebook page paths that are never a page/person username -- following
// m.me/<this> would not open a real conversation.
const RESERVED_FACEBOOK_PATHS = new Set([
  'pages', 'profile.php', 'groups', 'events', 'watch', 'marketplace',
  'photo', 'photo.php', 'video.php', 'permalink.php', 'sharer', 'share', 'share.php',
  'login', 'help', 'business', 'ads',
])

/**
 * Given the merchant's configured Facebook page URL, derives a Messenger
 * (m.me) deep link -- a separate, one-tap-to-chat channel distinct from
 * just linking to the Facebook page itself. Returns '' when the URL isn't
 * a plain page/username link (e.g. profile.php?id=..., a group, a post)
 * since m.me only works for an actual page or username.
 */
export function deriveMessengerLink(facebookUrl: string): string {
  const raw = String(facebookUrl || '').trim()
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return ''
  }
  if (!/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(url.hostname)) return ''
  const segments = url.pathname.split('/').filter(Boolean)
  const username = segments[0] || ''
  if (!username) return ''
  if (RESERVED_FACEBOOK_PATHS.has(username.toLowerCase())) return ''
  if (!/^[A-Za-z0-9._-]+$/.test(username)) return ''
  return `https://m.me/${username}`
}

/**
 * Resolves a direct Messenger (m.me) link from an explicit contact-us
 * configuration value. Unlike deriveMessengerLink (which only works off a
 * Facebook *page* URL), this accepts a bare Messenger username, a full
 * m.me link, or a facebook.com page link -- since staff configuring the
 * "Contact us" channel may paste any of those.
 */
export function resolveMessengerLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      if (/(^|\.)m\.me$/i.test(url.hostname)) {
        const handle = url.pathname.split('/').filter(Boolean)[0] || ''
        return handle ? `https://m.me/${handle}` : ''
      }
      if (/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(url.hostname)) {
        return deriveMessengerLink(raw)
      }
      return ''
    } catch {
      return ''
    }
  }
  const handle = raw.replace(/^@/, '').trim()
  return /^[A-Za-z0-9._-]+$/.test(handle) ? `https://m.me/${handle}` : ''
}

/**
 * Given a WhatsApp number or wa.me link, returns a normalized
 * https://wa.me/<digits> deep link, or '' if nothing usable was given.
 */
export function deriveWhatsappLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      if (!/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(url.hostname)) return ''
      const digits = (url.pathname.split('/').filter(Boolean)[0] || url.searchParams.get('phone') || '').replace(/\D/g, '')
      return digits ? `https://wa.me/${digits}` : ''
    } catch {
      return ''
    }
  }
  const digits = raw.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : ''
}

/**
 * Given a phone number (or an existing tel: link), returns a normalized
 * tel: deep link so it opens the device's dialer, or '' if nothing usable
 * was given.
 */
export function derivePhoneCallLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^tel:/i.test(raw)) return raw
  const digits = raw.replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : ''
}
/**
 * Given the merchant's configured Telegram link/handle, derives a
 * consistent t.me deep link. Accepts a bare handle ("mystore"), a
 * "@handle", a full t.me URL, or a group/channel invite link
 * (t.me/joinchat/<code> or the newer t.me/+<code> form), and returns a
 * full https://t.me/... link -- or '' if nothing usable was given.
 */
export function deriveTelegramLink(telegramValue: string): string {
  const raw = String(telegramValue || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      if (!/(^|\.)t\.me$|(^|\.)telegram\.me$/i.test(url.hostname)) return ''
      const segments = url.pathname.split('/').filter(Boolean)
      const first = segments[0] || ''
      // Telegram accepts the query-only `?direct` hint used by the store's
      // configured contact URL. Keep that one intentional flag when
      // normalizing a profile link; dropping the whole query changed
      // `https://t.me/Leangcosmetic?direct` into a different destination.
      // Other query parameters are discarded so a pasted tracking URL does
      // not leak campaign/user data into every public contact click.
      const directSuffix = url.searchParams.has('direct') ? '?direct' : ''
      // Real bug, found+fixed part 234: a group/channel invite link is
      // t.me/joinchat/<code> (older format) -- treating "joinchat" as if
      // it were the handle (the naive `segments[0]`) drops the actual
      // invite code entirely, producing a broken https://t.me/joinchat
      // link that opens nothing. The newer t.me/+<code> invite format
      // isn't affected (the code IS segments[0], with its leading "+"
      // preserved) -- confirmed both forms against Telegram's own
      // documented link shapes, not assumed.
      if (first.toLowerCase() === 'joinchat' && segments[1]) return `https://t.me/joinchat/${segments[1]}`
      return first ? `https://t.me/${first}${directSuffix}` : ''
    } catch {
      return ''
    }
  }
  const handle = raw.replace(/^@/, '').trim()
  return /^[A-Za-z0-9_]+$/.test(handle) ? `https://t.me/${handle}` : ''
}

// Instagram profile paths that are never a person/business username -- an
// ig.me/m/<this> link would not open a real DM thread.
const RESERVED_INSTAGRAM_PATHS = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'about', 'legal', 'developer', 'privacy', 'help',
])

/**
 * Given the merchant's configured Instagram value, derives an ig.me DM
 * deep link -- confirmed against Meta's own developer docs (ig.me links
 * open a new or existing message thread with the account, same mechanism
 * class as m.me/wa.me/t.me above). Accepts a bare handle ("mystore"), a
 * "@handle", a full instagram.com profile URL, or an existing ig.me link
 * (including the documented ig.me/m/<username> form), and returns a full
 * https://ig.me/m/<username> link -- or '' if nothing usable was given.
 * Note: unlike m.me/wa.me/t.me, Meta's own docs flag ig.me as inconsistent
 * on desktop web for signed-out visitors -- this only produces the link,
 * it doesn't change that platform limitation.
 */
export function deriveInstagramLink(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      if (/(^|\.)ig\.me$/i.test(url.hostname)) {
        const segments = url.pathname.split('/').filter(Boolean)
        // The documented shape is ig.me/m/<username> -- drop the literal
        // "m" segment rather than treating it as the handle.
        const handle = (segments[0]?.toLowerCase() === 'm' ? segments[1] : segments[0]) || ''
        return handle ? `https://ig.me/m/${handle}` : ''
      }
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return ''
      const segments = url.pathname.split('/').filter(Boolean)
      const username = segments[0] || ''
      if (!username) return ''
      if (RESERVED_INSTAGRAM_PATHS.has(username.toLowerCase())) return ''
      if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return ''
      return `https://ig.me/m/${username}`
    } catch {
      return ''
    }
  }
  const handle = raw.replace(/^@/, '').trim()
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://ig.me/m/${handle}` : ''
}
