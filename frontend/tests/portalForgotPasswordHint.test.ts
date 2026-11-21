// "Forgot password?" on the sign-in form (storefront dock lane, spec D2.3): no button that opens a menu. One short line tells the shopper to ask the
// shop, and the shop's chat rows (Phone, Messenger, Telegram, WhatsApp) sit under it, tappable. With no chat channel configured the line stands alone.
//
// Run: node tests/portalForgotPasswordHint.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogAccountSection.tsx'), 'utf8').replace(/\r\n/g, '\n')

const KM = 'ភ្លេចពាក្យសម្ងាត់? សូមសុំហាងកំណត់ថ្មី។'
assert.equal(getPortalLanguageText('km', 'forgotPasswordAskShop'), KM, 'the Khmer pack carries the hint')
assert.equal(getPortalLanguageText('km', 'forgotPasswordLink'), '', 'the old button text key is retired from the pack')

assert.match(source, /data-portal-forgot-password=""[\s\S]*?<p data-portal-forgot-password-hint=""[\s\S]*?<PortalContactRows inline entries=\{contactEntries\}/, 'the hint line, then the inline chat rows')
assert.doesNotMatch(source, /PortalContactMenu|forgotPasswordLink/, 'no menu and no button text any more')
assert.match(source, /copy\('forgotPasswordAskShop', 'Forgot your password\? Ask the shop to reset it\.', 'ភ្លេចពាក្យសម្ងាត់\? សូមសុំហាងកំណត់ថ្មី។'\)/, 'hint goes through copy() with both languages')
assert.match(source, /<p data-portal-forgot-password-hint="" className="text-sm text-stone-600 dark:text-neutral-300">/, 'muted, passes contrast in both modes')
assert.match(source, /The chat entries \(Phone, Messenger, Telegram, WhatsApp\) shown under the "Forgot password\?" line/, 'the contactEntries JSDoc is updated')
console.log('PASS portalForgotPasswordHint')
