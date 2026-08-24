// socialQrLink.ts
//
// Fixes a real, reported QR-code problem: "make sure these ask to open
// apps instead of just opening websites on browsers... because it might
// cause many delays, login etc... and make sure it is persistent in
// actually taking the user all the way to the group/page as well...
// sometimes qr code just takes to browser or enters app without actually
// visiting the group/store page."
//
// The intuitive-but-wrong fix would be to encode a custom URI scheme
// directly in the QR code (fb://, tg://, instagram://, ...). That's
// actually WORSE, not better, for exactly the two symptoms reported:
//   - "enters app without actually visiting the page" -- most custom
//     schemes only open the app to its generic home/feed screen; very few
//     apps expose a documented custom-scheme deep link that can target an
//     arbitrary page/group/profile the way a normal https URL path can.
//   - "sometimes just takes to browser" -- a custom scheme has NO
//     fallback. If the app isn't installed (or the OS blocks an
//     unregistered scheme), it fails outright with nothing to land on,
//     which a QR scanner then often reports as just falling through to a
//     web search or an error, not a graceful open-in-browser.
//
// The correct mechanism (how Facebook/Telegram/WhatsApp/Instagram/TikTok
// *already* solve this for their own share buttons and marketing QR
// codes) is OS-level Universal Links (iOS) / App Links (Android): a
// PLAIN https:// URL, on the platform's own canonical domain, at the
// platform's own canonical path shape. When that app is installed, the OS
// itself intercepts the https:// open and hands it straight to the app,
// landing on the exact page/group/chat encoded in the path -- with an
// automatic, built-in fallback to the mobile browser (still on the right
// page) when the app isn't installed. No custom scheme, no user-visible
// "open in app?" prompt needed.
//
// The reason this sometimes still fails in practice isn't the mechanism,
// it's the URL: Universal Link / App Link matching is strict about the
// domain and path shape. A shortened link (bit.ly/xyz), a redirect, a
// "mobile" subdomain the app doesn't register (m.facebook.com in some
// versions), or a URL with the meaningful ID stripped out by an
// over-eager "remove tracking params" pass all silently fall back to a
// plain browser tab -- which matches BOTH symptoms reported. This module
// canonicalizes a pasted social/messaging URL into the exact shape each
// platform's own app registers for Universal/App Links, so the QR code
// that gets printed is one the OS will actually hand to the app.

export type SocialPlatform =
  | 'facebook' | 'messenger' | 'telegram' | 'whatsapp' | 'instagram'
  | 'tiktok' | 'youtube' | 'zalo' | 'viber' | 'line' | 'other'

export interface NormalizedSocialLink {
  /** Canonicalized https:// URL to encode in the QR code / link out. */
  url: string
  platform: SocialPlatform
  /** Human-readable platform label, for the settings UI's detected-platform hint. */
  platformLabel: string
  /**
   * Set when the pasted URL is unlikely to deep-link reliably (a link
   * shortener, a non-canonical host, or a page/group reference that got
   * stripped down to nothing) -- shown as a warning in ReceiptSettings so
   * the shop owner can paste the direct share link instead.
   */
  warning?: string
}

// Known link-shortener/redirector domains. A shortener sits on its OWN
// domain, which no social app has registered as its Universal Link
// domain -- so opening a shortened link ALWAYS lands in a browser first
// (which then may or may not bounce onward to the app), never a direct
// app hand-off. Flagged rather than silently passed through.
const SHORTENER_HOSTS = new Set([
  'bit.ly', 'tinyurl.com', 'is.gd', 'ow.ly', 't.co', 'cutt.ly', 'rebrand.ly',
  'shorturl.at', 'lnk.bio', 'linktr.ee', 'rb.gy', 'goo.gl',
])

// Tracking/analytics query params that are safe to strip from ANY of
// these platforms' URLs -- they carry no addressing information, only
// attribution, so removing them never changes what the QR code opens.
// Deliberately a small, explicit blocklist rather than "strip the whole
// query string": several platforms put real addressing information in
// the query (YouTube's ?v=/?list=, WhatsApp's ?text=, Viber's ?g=,
// Facebook's profile.php?id=), and wiping the query wholesale would
// silently break exactly the deep link this function exists to fix.
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'igshid', 'igsh', 'si',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'ref_src', 'ref_url', 'mc_cid', 'mc_eid', 'spm', '_rdr',
])

function stripTrackingParams(u: URL): void {
  for (const key of Array.from(u.searchParams.keys())) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key)
  }
}

function withTrailingSlashRemoved(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function normalizeSocialQrUrl(raw: string): NormalizedSocialLink {
  const trimmed = String(raw || '').trim()
  const fallback: NormalizedSocialLink = { url: trimmed, platform: 'other', platformLabel: 'Website' }
  if (!trimmed) return fallback

  let u: URL
  try {
    // A bare domain/path pasted without a scheme (e.g. "t.me/mystore")
    // would otherwise parse as a relative URL and throw.
    u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return fallback
  }
  u.protocol = 'https:'
  const host = u.hostname.toLowerCase().replace(/^www\./, '')

  if (SHORTENER_HOSTS.has(host)) {
    return {
      url: u.toString(),
      platform: 'other',
      platformLabel: 'Shortened link',
      warning: 'This is a shortened link. Shortened/redirect links usually open a browser tab instead of the app directly -- paste the direct share link from the app instead (e.g. long-press Share on the page/group and copy the link it gives you).',
    }
  }

  // --- Facebook page/profile/group -----------------------------------
  if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.com') {
    u.hostname = 'www.facebook.com'
    stripTrackingParams(u)
    // profile.php?id=... has NO addressing info in the path at all --
    // the id query param IS the address, so it's the one case here where
    // the query string must be kept even though it's technically after
    // the tracking-param strip pass (protected because 'id' was never in
    // TRACKING_PARAMS to begin with).
    u.pathname = withTrailingSlashRemoved(u.pathname)
    const isBare = u.pathname === '' || u.pathname === '/'
    const isProfilePhpWithoutId = u.pathname === '/profile.php' && !u.searchParams.get('id')
    return {
      url: u.toString(),
      platform: 'facebook',
      platformLabel: 'Facebook',
      warning: isBare || isProfilePhpWithoutId
        ? 'This link doesn\u2019t point at a specific Facebook page or profile -- scanning it will just open Facebook\u2019s home feed. Paste your Page\u2019s own link (Page \u2192 About \u2192 copy link, or Share \u2192 Copy Link).'
        : undefined,
    }
  }

  // --- Messenger (m.me) -- the correct deep link for "message this
  // Facebook Page", separate from the Page's own facebook.com link.
  if (host === 'm.me' || host === 'messenger.com') {
    u.hostname = 'm.me'
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return {
      url: u.toString(),
      platform: 'messenger',
      platformLabel: 'Messenger',
      warning: (u.pathname === '' || u.pathname === '/')
        ? 'This m.me link is missing your Page name -- it should look like m.me/yourpagename.'
        : undefined,
    }
  }

  // --- Telegram: t.me/<username> (channel/group/user) or
  // t.me/+<invite-hash> / t.me/joinchat/<hash> (private group invite) --
  // all three are genuine Universal Link paths Telegram's own app
  // registers; none need rewriting, just cleaning.
  if (host === 't.me' || host === 'telegram.me' || host === 'telegram.dog') {
    u.hostname = 't.me'
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return {
      url: u.toString(),
      platform: 'telegram',
      platformLabel: 'Telegram',
      warning: (u.pathname === '' || u.pathname === '/')
        ? 'This Telegram link is missing the group/channel name or invite code -- open the group in Telegram, use Share \u2192 Copy Link, and paste that.'
        : undefined,
    }
  }

  // --- WhatsApp: wa.me/<phone>[?text=...] for a direct chat,
  // chat.whatsapp.com/<code> for a group invite. Both are the real
  // Universal Link formats WhatsApp's own "Share" button produces --
  // deliberately NOT rewritten to the older whatsapp://send?phone=...
  // custom scheme some integrations use, since that scheme has no
  // graceful fallback when WhatsApp isn't installed (wa.me does).
  if (host === 'wa.me' || host === 'chat.whatsapp.com' || host === 'api.whatsapp.com') {
    if (host === 'api.whatsapp.com') {
      // api.whatsapp.com/send?phone=NNN&text=... is the older
      // send-link form; wa.me/NNN?text=... is the current canonical
      // Universal Link WhatsApp's own Share button now produces, so
      // fold the older form into it rather than leaving two different
      // link shapes floating around.
      const phone = (u.searchParams.get('phone') || '').replace(/[^\d+]/g, '')
      const text = u.searchParams.get('text')
      const rebuilt = new URL(`https://wa.me/${phone.replace(/^\+/, '')}`)
      if (text) rebuilt.searchParams.set('text', text)
      u = rebuilt
    } else {
      u.hostname = host
      // 'text' is a real pre-filled-message param, not tracking -- kept.
      stripTrackingParams(u)
      u.pathname = withTrailingSlashRemoved(u.pathname)
    }
    const isGroupInvite = host === 'chat.whatsapp.com'
    return {
      url: u.toString(),
      platform: 'whatsapp',
      platformLabel: isGroupInvite ? 'WhatsApp Group' : 'WhatsApp',
      warning: (u.pathname === '' || u.pathname === '/')
        ? (isGroupInvite
          ? 'This WhatsApp group link is missing its invite code -- open the group\u2019s Invite via Link screen and copy the full link.'
          : 'This WhatsApp link is missing a phone number.')
        : undefined,
    }
  }

  // --- Instagram: instagram.com/<username> or /p/<post>, /reel/<id> --
  if (host === 'instagram.com' || host === 'instagr.am') {
    u.hostname = 'www.instagram.com'
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return {
      url: u.toString(),
      platform: 'instagram',
      platformLabel: 'Instagram',
      warning: (u.pathname === '' || u.pathname === '/')
        ? 'This link doesn\u2019t point at a specific Instagram profile or post -- paste your profile link (e.g. instagram.com/yourshop).'
        : undefined,
    }
  }

  // --- TikTok: tiktok.com/@<username> or /video/<id> ------------------
  if (host === 'tiktok.com') {
    u.hostname = 'www.tiktok.com'
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return {
      url: u.toString(),
      platform: 'tiktok',
      platformLabel: 'TikTok',
      warning: (u.pathname === '' || u.pathname === '/')
        ? 'This link doesn\u2019t point at a specific TikTok profile or video -- paste your profile link (e.g. tiktok.com/@yourshop).'
        : undefined,
    }
  }

  // --- YouTube: keep query string as-is (v=/list= are real addressing,
  // not tracking) other than the tracking blocklist. ------------------
  if (host === 'youtube.com' || host === 'youtu.be') {
    stripTrackingParams(u)
    return { url: u.toString(), platform: 'youtube', platformLabel: 'YouTube' }
  }

  // --- Zalo (common in Cambodia/Vietnam): zalo.me/<id or invite> -----
  if (host === 'zalo.me') {
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return { url: u.toString(), platform: 'zalo', platformLabel: 'Zalo' }
  }

  // --- Viber: invite.viber.com/?g=<code> -- 'g' is the real invite
  // code, not tracking, so it's protected by not being in the blocklist.
  if (host === 'invite.viber.com' || host === 'viber.com') {
    stripTrackingParams(u)
    return {
      url: u.toString(),
      platform: 'viber',
      platformLabel: 'Viber',
      warning: !u.searchParams.get('g') ? 'This Viber invite link is missing its invite code.' : undefined,
    }
  }

  // --- Line: line.me/R/ti/g/<code> (group) or lin.ee/<code> shortlink
  // -- lin.ee is Line's OWN first-party shortener (registered by the
  // Line app itself), unlike the generic shorteners above, so it's left
  // alone rather than flagged.
  if (host === 'line.me' || host === 'lin.ee') {
    stripTrackingParams(u)
    u.pathname = withTrailingSlashRemoved(u.pathname)
    return { url: u.toString(), platform: 'line', platformLabel: 'Line' }
  }

  // Anything else (a plain website, an unrecognized platform): leave the
  // URL untouched beyond forcing https and dropping obvious tracking
  // params -- still safe/correct, just not a platform this function has
  // a specific canonical shape for.
  stripTrackingParams(u)
  return { url: u.toString(), platform: 'other', platformLabel: 'Website' }
}
