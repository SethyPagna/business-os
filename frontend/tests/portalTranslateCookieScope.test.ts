// The cookie policy tells a visitor that choosing an external translation
// language "writes a googtrans cookie for this site". That sentence is only
// true if the cookie is host-only. Writing it at `domain=.<host>` as well --
// which is what the storefront used to do -- puts a visitor's translation
// choice on every sibling hostname of the registrable domain, the staff app
// among them, and sends it up with every request to any of them.
//
// The other half matters too: CLEARING has to stay wide. Google's own widget,
// and every build shipped before this change, can have left a domain-wide
// cookie behind, and a narrow delete would not remove it -- "turn translation
// off" has to actually turn it off.
//
// The peer test tests/portalTranslateController.test.ts checks what the cookie
// SAYS. This one checks where it is written, which needs a document stub that
// keeps the attributes instead of parsing them away.
//
// Run: node tests/portalTranslateCookieScope.test.ts
import assert from 'node:assert/strict'
import {
  writePortalTranslateTarget,
  clearGoogleTranslateCookies,
} from '../src/components/catalog/portalTranslateController.ts'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

const writes: string[] = []
const globals = globalThis as unknown as { window: Window; document: Document }

globals.document = {
  documentElement: { className: '' },
  body: { className: '' },
  get cookie() {
    return ''
  },
  set cookie(value: string) {
    writes.push(String(value))
  },
} as unknown as Document
globals.window = {
  location: { hostname: 'shop.example.com', pathname: '/public' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
} as unknown as Window

try {
  // --- writing a preference -------------------------------------------------
  writes.length = 0
  assert.equal(writePortalTranslateTarget('en', 'fr'), 'fr')
  assert.equal(writes.length, 1, `choosing a language must write exactly one cookie, wrote ${writes.length}: ${writes.join(' | ')}`)

  const [written] = writes
  assert.match(written, /^googtrans=\/en\/fr;/, 'the value still has to be the one Google reads')
  assert.match(written, /path=\//, 'the whole site, so the choice survives navigation')
  assert.match(written, /SameSite=Lax/, 'not sent on cross-site subrequests')
  assert.doesNotMatch(
    written,
    /domain=/i,
    'host-only: a domain= attribute hands the visitor\'s translation choice to every sibling hostname, including the staff app',
  )
  assert.doesNotMatch(written, /shop\.example\.com/, 'the hostname has no business being inside the cookie either')

  // --- clearing stays wide --------------------------------------------------
  writes.length = 0
  clearGoogleTranslateCookies()
  const expiredWrites = writes.filter((entry) => /expires=Thu, 01 Jan 1970/i.test(entry))
  assert.equal(expiredWrites.length, writes.length, 'every clearing write must actually expire the cookie')
  assert.ok(
    writes.some((entry) => /domain=\.shop\.example\.com/.test(entry)),
    'clearing must still target the domain-wide cookie an older build or the Google widget may have left',
  )
  assert.ok(
    writes.some((entry) => /domain=\.example\.com/.test(entry)),
    'and the parent-domain variant',
  )
  assert.ok(
    writes.some((entry) => !/domain=/i.test(entry)),
    'and the host-only cookie this build writes',
  )

  // --- returning to the original language clears rather than writes ---------
  writes.length = 0
  assert.equal(writePortalTranslateTarget('en', 'original'), 'original')
  assert.ok(writes.length > 0, 'going back to the original language has to remove the cookie')
  assert.ok(
    writes.every((entry) => /expires=Thu, 01 Jan 1970/i.test(entry)),
    'going back to the original language must only expire cookies, never set one',
  )

  console.log('PASS googtrans is written host-only and cleared everywhere it could have been set')
} finally {
  globals.window = originalWindow as unknown as Window
  globals.document = originalDocument as unknown as Document
}
