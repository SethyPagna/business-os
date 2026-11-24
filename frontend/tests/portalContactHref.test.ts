// One rule for the public tel: / mailto: links (audit PW6). The footer, the About rows, the Contact menu and both
// business-facts builders (live page and editor preview) all go through contactHref; a malformed e-mail makes no link
// and no Contact-menu entry, and an e-mail that could add a header or a second address is refused.
//
// Run: node tests/portalContactHref.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPortalContactEntries } from '../src/components/catalog/portalSocialLinks.ts'
import { contactHref } from '../src/utils/socialLinks.ts'

let failed = 0
function runCase(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runCase('tel: the Contact menu helper rebuilds the link from digits (moved from derivePhoneCallLink)', () => {
  assert.equal(contactHref('tel', '+855 12 345 678'), 'tel:+85512345678')
  assert.equal(contactHref('tel', 'tel:+85512345678'), 'tel:+85512345678')
  assert.equal(contactHref('tel', ''), '')
  assert.equal(contactHref('tel', '12345'), '')
})

runCase('tel: the Contact menu row and the About link agree on a short or tel:-prefixed value', () => {
  const rows = (phone: string) => buildPortalContactEntries({ phone }).chat.filter((entry) => entry.platform === 'phone')
  assert.equal(rows('12345').length, 0, 'fewer than 6 digits: no menu row')
  assert.equal(rows('tel:+85512345678')[0]?.href, 'tel:+85512345678')
})

runCase('contactHref trims the value first for both kinds', () => {
  assert.equal(contactHref('mailto', ' shop@example.com '), 'mailto:shop@example.com')
  assert.equal(contactHref('tel', '  012 345 678 '), 'tel:012345678')
  assert.equal(contactHref('mailto', 'shop @example.com'), '', 'a space inside still makes no link')
  assert.equal(contactHref('mailto', '   '), '')
})

runCase('mailto: ordinary addresses keep a link', () => {
  assert.equal(contactHref('mailto', 'shop@example.com'), 'mailto:shop@example.com')
  assert.equal(contactHref('mailto', 'first.last+tag@sub-domain.example.co'), 'mailto:first.last+tag@sub-domain.example.co')
  assert.equal(contactHref('mailto', 'a_b@c.d'), 'mailto:a_b@c.d')
})

runCase('mailto: malformed or header-injecting values make no link', () => {
  for (const bad of [
    '', 'not an email', 'plain', 'a@b', 'a@b.', '@b.c', 'a@@b.c',
    'a@b.c?cc=x@y.z', 'a@b.c&bcc=x@y.z', 'a@b.c\nbcc:x@y.z', 'a@b.c\r\nbcc:x@y.z', 'a @b.c', 'a@b .c',
    'a@b.c,x@y.z', 'a@b.c;x@y.z', 'a@b.c%0Abcc:x@y.z', '<a@b.c>', '"a"@b.c', "a'b@c.d", 'a@b.c\u0000', 'a\\b@c.d',
    'javascript:alert(1)',
  ]) assert.equal(contactHref('mailto', bad), '', JSON.stringify(bad))
  assert.equal(contactHref('mailto', undefined), '')
  assert.equal(contactHref('mailto', null), '')
})

runCase('tel: needs six digits and is rebuilt from digits and +', () => {
  assert.equal(contactHref('tel', '+855 12 345 678'), 'tel:+85512345678')
  assert.equal(contactHref('tel', '012 345 678'), 'tel:012345678')
  assert.equal(contactHref('tel', '(012) 345-678'), 'tel:012345678')
  for (const bad of ['', '12345', 'abc', 'javascript:alert(1)', '+++', undefined]) assert.equal(contactHref('tel', bad), '', String(bad))
})

runCase('Contact entries: an e-mail is not a way to chat, so it is no entry at all (the footer prints the address itself)', () => {
  const built = buildPortalContactEntries({ phone: '012 345 678', shopName: 'Shop', language: 'en' }) as { chat: unknown[]; accounts: unknown[] }
  assert.equal(JSON.stringify(built).includes('mailto:'), false)
  assert.equal(built.chat.length, 1, 'control: the phone is still a chat row')
})

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogDir = path.join(here, '..', 'src', 'components', 'catalog')
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : [])
const BUILDS_LINK = /`(?:mailto|tel):\$\{/

runCase('source pin: no catalog file builds a mailto: or tel: link by hand', () => {
  assert.equal(BUILDS_LINK.test('const href = `mailto:${email}`'), true, 'the pin flags a hand-built mailto:')
  assert.equal(BUILDS_LINK.test('const href = `tel:${phone}`'), true, 'the pin flags a hand-built tel:')
  const offenders = walk(catalogDir).filter((file) => BUILDS_LINK.test(fs.readFileSync(file, 'utf8')))
  assert.deepEqual(offenders.map((file) => path.relative(catalogDir, file)), [])
})

runCase('source pin: the four places call the shared rule', () => {
  const read = (...parts: string[]) => fs.readFileSync(path.join(catalogDir, ...parts), 'utf8')
  assert.match(read('portalSocialLinks.ts'), /contactHref\('tel', phone\)/)
  // The pages no longer build a phone or e-mail link of their own: the phone goes to the builder as a number and the footer prints the e-mail itself.
  assert.equal((read('PublicCatalogPage.tsx').match(/contactHref\(/g) || []).length, 0)
  assert.equal((read('CatalogPage.tsx').match(/contactHref\(/g) || []).length, 0)
  assert.match(read('legal', 'LegalPages.tsx'), /import \{ contactHref \} from '\.\.\/\.\.\/\.\.\/utils\/socialLinks\.ts'/)
  assert.doesNotMatch(read('legal', 'LegalPages.tsx'), /function contactHref/)
})

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('portalContactHref: ok')
