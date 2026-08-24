import assert from 'node:assert/strict'
import {
  deriveMessengerLink,
  deriveTelegramLink,
  deriveWhatsappLink,
  deriveInstagramLink,
  derivePhoneCallLink,
  resolveMessengerLink,
} from '../src/utils/socialLinks.ts'

// deriveMessengerLink
assert.equal(deriveMessengerLink('https://facebook.com/mystore'), 'https://m.me/mystore')
assert.equal(deriveMessengerLink('https://www.facebook.com/My.Store.Page/'), 'https://m.me/My.Store.Page')
assert.equal(deriveMessengerLink('facebook.com/mystore'), 'https://m.me/mystore', 'accepts a schemeless facebook.com URL')
assert.equal(deriveMessengerLink('https://facebook.com/profile.php?id=100012345'), '', 'a numeric profile URL has no usable username for m.me')
assert.equal(deriveMessengerLink('https://facebook.com/groups/somegroup'), '', 'a group URL is not a page/username')
assert.equal(deriveMessengerLink('https://instagram.com/mystore'), '', 'non-Facebook hosts are rejected')
assert.equal(deriveMessengerLink(''), '')
assert.equal(deriveMessengerLink('not a url at all'), '')

// resolveMessengerLink (accepts bare handle / m.me link / facebook.com link)
assert.equal(resolveMessengerLink('mystore'), 'https://m.me/mystore', 'accepts a bare handle')
assert.equal(resolveMessengerLink('@mystore'), 'https://m.me/mystore', 'strips a leading @')
assert.equal(resolveMessengerLink('https://m.me/mystore'), 'https://m.me/mystore', 'accepts a full m.me URL')
assert.equal(resolveMessengerLink('https://facebook.com/mystore'), 'https://m.me/mystore', 'falls back to page-URL derivation')
assert.equal(resolveMessengerLink('https://instagram.com/mystore'), '', 'rejects non-Messenger hosts')
assert.equal(resolveMessengerLink(''), '')

// deriveTelegramLink
assert.equal(deriveTelegramLink('mystore'), 'https://t.me/mystore', 'accepts a bare handle')
assert.equal(deriveTelegramLink('@mystore'), 'https://t.me/mystore', 'strips a leading @')
assert.equal(deriveTelegramLink('https://t.me/mystore'), 'https://t.me/mystore', 'accepts a full t.me URL')
assert.equal(deriveTelegramLink('https://telegram.me/mystore'), 'https://t.me/mystore', 'normalizes the telegram.me alias to t.me')
assert.equal(deriveTelegramLink('https://facebook.com/mystore'), '', 'rejects a non-Telegram URL')
assert.equal(deriveTelegramLink(''), '')
assert.equal(deriveTelegramLink('not valid!!'), '')
// Real bug, found+fixed part 234: the newer t.me/+<code> invite format
// already worked (the code is segments[0] itself), but the older
// t.me/joinchat/<code> format wrongly used "joinchat" as if it were the
// handle, dropping the real invite code and producing a dead link.
assert.equal(deriveTelegramLink('https://t.me/+AbCdEf12345'), 'https://t.me/+AbCdEf12345', 'newer + invite format already worked')
assert.equal(deriveTelegramLink('https://t.me/joinchat/AbCdEf12345'), 'https://t.me/joinchat/AbCdEf12345', 'older joinchat invite format keeps its real invite code instead of dropping it')

// deriveWhatsappLink
assert.equal(deriveWhatsappLink('+855 12 345 678'), 'https://wa.me/85512345678', 'strips formatting from a raw phone number')
assert.equal(deriveWhatsappLink('https://wa.me/85512345678'), 'https://wa.me/85512345678', 'accepts a full wa.me URL')
assert.equal(deriveWhatsappLink('https://facebook.com/mystore'), '', 'rejects a non-WhatsApp URL')
assert.equal(deriveWhatsappLink(''), '')

// derivePhoneCallLink -- backs the receipt-settings "remove Viber, add clickable Call"
// contact channel (business-os QR/contact merge session).
assert.equal(derivePhoneCallLink('+855 12 345 678'), 'tel:+85512345678', 'normalizes a raw phone number to a tel: link')
assert.equal(derivePhoneCallLink('tel:+85512345678'), 'tel:+85512345678', 'passes through an already-normalized tel: link')
assert.equal(derivePhoneCallLink(''), '')

// deriveInstagramLink -- Part 234 item 3, contact-us channel fix: Instagram
// previously only linked to the profile, with no one-tap DM equivalent to
// the Messenger/WhatsApp/Telegram deep links above. ig.me/m/<username> is
// Meta's own documented mechanism for opening a DM thread directly.
assert.equal(deriveInstagramLink('mystore'), 'https://ig.me/m/mystore', 'accepts a bare handle')
assert.equal(deriveInstagramLink('@mystore'), 'https://ig.me/m/mystore', 'strips a leading @')
assert.equal(deriveInstagramLink('https://instagram.com/mystore'), 'https://ig.me/m/mystore', 'derives from a profile URL')
assert.equal(deriveInstagramLink('https://instagram.com/my.store_1/'), 'https://ig.me/m/my.store_1', 'allows periods/underscores/digits, trailing slash')
assert.equal(deriveInstagramLink('https://ig.me/m/mystore'), 'https://ig.me/m/mystore', 'accepts an existing ig.me/m/ link')
assert.equal(deriveInstagramLink('https://ig.me/mystore'), 'https://ig.me/m/mystore', 'normalizes an ig.me link missing the /m/ segment')
assert.equal(deriveInstagramLink('https://instagram.com/p/Cabc123XYZ/'), '', 'a post URL is not a profile username')
assert.equal(deriveInstagramLink('https://facebook.com/mystore'), '', 'rejects a non-Instagram URL')
assert.equal(deriveInstagramLink(''), '')
assert.equal(deriveInstagramLink('not valid!!'), '')

// Viber support was intentionally removed in favor of the clickable phone/Call
// contact channel -- lock in that the helper no longer exists.
assert.equal((await import('../src/utils/socialLinks.ts') as Record<string, unknown>).deriveViberLink, undefined, 'deriveViberLink should not be exported anymore')

console.log('PASS socialLinks helpers (Messenger/Telegram/WhatsApp/phone-call deep-link derivation, Viber removed)')
