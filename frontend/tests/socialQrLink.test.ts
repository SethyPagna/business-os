import assert from 'node:assert/strict'
import { normalizeSocialQrUrl } from '../src/utils/socialQrLink.ts'

// Facebook -- mobile subdomain and tracking params normalized away,
// canonical page path kept intact so Universal Link matching fires.
assert.equal(normalizeSocialQrUrl('facebook.com/mybeautyshop').url, 'https://www.facebook.com/mybeautyshop')
assert.equal(normalizeSocialQrUrl('https://m.facebook.com/mybeautyshop?fbclid=abc123').url, 'https://www.facebook.com/mybeautyshop')
assert.equal(normalizeSocialQrUrl('https://m.facebook.com/mybeautyshop?fbclid=abc123').platform, 'facebook')
// profile.php's id= is real addressing, not tracking -- must survive even
// though fbclid on the same URL is stripped.
assert.equal(
  normalizeSocialQrUrl('https://facebook.com/profile.php?id=100012345678901&fbclid=xyz').url,
  'https://www.facebook.com/profile.php?id=100012345678901',
)
// A bare facebook.com link has nowhere to land -- flagged, not silently accepted.
assert.ok(normalizeSocialQrUrl('https://www.facebook.com/').warning, 'bare facebook.com URL should warn')

// Telegram -- telegram.me alias folded to t.me; group invite hash kept as-is.
assert.equal(normalizeSocialQrUrl('t.me/mystoregroup').url, 'https://t.me/mystoregroup')
assert.equal(normalizeSocialQrUrl('t.me/mystoregroup').platform, 'telegram')
assert.equal(normalizeSocialQrUrl('https://telegram.me/mystoregroup').url, 'https://t.me/mystoregroup')
assert.equal(normalizeSocialQrUrl('https://t.me/+AbCdEf12345').url, 'https://t.me/+AbCdEf12345')
assert.ok(normalizeSocialQrUrl('https://t.me/').warning, 'bare t.me URL should warn')

// WhatsApp -- api.whatsapp.com/send?phone=&text= folded into the current
// wa.me/<phone>?text= share-link shape; chat.whatsapp.com group invites
// (a different platform label) pass through untouched.
assert.equal(normalizeSocialQrUrl('wa.me/85512345678').url, 'https://wa.me/85512345678')
assert.equal(
  normalizeSocialQrUrl('https://api.whatsapp.com/send?phone=85512345678&text=Hi').url,
  'https://wa.me/85512345678?text=Hi',
)
assert.equal(normalizeSocialQrUrl('https://chat.whatsapp.com/AbCd1234Ef').url, 'https://chat.whatsapp.com/AbCd1234Ef')
assert.equal(normalizeSocialQrUrl('https://chat.whatsapp.com/AbCd1234Ef').platformLabel, 'WhatsApp Group')
assert.ok(normalizeSocialQrUrl('https://chat.whatsapp.com/').warning, 'bare group-invite host should warn')

// Instagram / TikTok -- www forced, tracking stripped, bare profile warns.
assert.equal(normalizeSocialQrUrl('instagram.com/mybeautyshop').url, 'https://www.instagram.com/mybeautyshop')
assert.equal(normalizeSocialQrUrl('https://www.tiktok.com/@mybeautyshop?is_from_webapp=1').platform, 'tiktok')

// YouTube -- v=/list= addressing params must survive; only tracking dropped.
assert.equal(normalizeSocialQrUrl('https://youtu.be/dQw4w9WgXcQ?si=trackingjunk').url, 'https://youtu.be/dQw4w9WgXcQ')
assert.equal(
  normalizeSocialQrUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&si=x').url,
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
)

// Viber invite -- 'g' is the real invite code, not tracking, so it survives.
assert.equal(normalizeSocialQrUrl('invite.viber.com/?g=AbCdEfGh').url, 'https://invite.viber.com/?g=AbCdEfGh')
assert.equal(normalizeSocialQrUrl('invite.viber.com/?g=AbCdEfGh').platform, 'viber')

// Line -- lin.ee is Line's own first-party shortlink domain, not flagged
// the way a generic shortener is.
assert.equal(normalizeSocialQrUrl('https://lin.ee/abcd123').warning, undefined)

// Generic link shorteners are flagged regardless of platform -- their
// domain isn't registered by any app for Universal/App Links, so a
// scanned QR always lands in a browser first no matter what it redirects to.
assert.ok(normalizeSocialQrUrl('https://bit.ly/abcd1234').warning, 'shortened link should warn')
assert.equal(normalizeSocialQrUrl('https://bit.ly/abcd1234').platform, 'other')

// Empty/garbage input never throws, just falls through untouched.
assert.equal(normalizeSocialQrUrl('').url, '')
assert.equal(normalizeSocialQrUrl('   ').url, '')

console.log('PASS socialQrLink platform detection + canonical Universal-Link normalization (Facebook/Messenger/Telegram/WhatsApp/Instagram/TikTok/YouTube/Zalo/Viber/Line)')
