// Sign in with no contact channel configured: the "Forgot password?" button has no menu to open, so one plain
// line tells the shopper to ask the shop. With contacts, the button stays.
//
// Run: node tests/portalForgotPasswordHint.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPortalLanguageText } from '../src/components/catalog/portalLanguagePacks.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogAccountSection.tsx'), 'utf8')

const KM = 'ភ្លេចពាក្យសម្ងាត់? សូមសុំហាងកំណត់ថ្មី។'
assert.equal(getPortalLanguageText('km', 'forgotPasswordAskShop'), KM, 'the Khmer pack carries the hint')
assert.notEqual(getPortalLanguageText('km', 'forgotPasswordLink'), '', 'the button text key is still in the pack')

assert.match(source, /contactEntries\.length > 0 \? \(\s*<PortalContactMenu[\s\S]*?data-portal-forgot-password=""[\s\S]*?\) : \(\s*<p data-portal-forgot-password-hint=""/, 'zero entries show the hint <p> in the button place')
assert.match(source, /copy\('forgotPasswordAskShop', 'Forgot your password\? Ask the shop to reset it\.', 'ភ្លេចពាក្យសម្ងាត់\? សូមសុំហាងកំណត់ថ្មី។'\)/, 'hint goes through copy() with both languages')
assert.match(source, /<p data-portal-forgot-password-hint="" className="text-sm text-stone-600 dark:text-neutral-300">/, 'muted, same size as the button, passes contrast in both modes')
assert.doesNotMatch(source, /None: the link is not shown/, 'the contactEntries JSDoc is updated')
console.log('PASS portalForgotPasswordHint')
