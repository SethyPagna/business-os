// A promotion's link_url is a staff-authored string that the PUBLIC
// storefront navigates to. Before N45 the Worker stored any trimmed string and
// PortalPromotionsBanner called window.location.assign() on anything that did
// not begin http(s) -- so `javascript:alert(document.cookie)` in that field
// executed in every visitor's browser. Staff-only to write is not the same as
// safe: an owner pastes a link they were sent, or an account is compromised.
//
// This pins three things:
//   1. the frontend guard's answers, case by case;
//   2. that the Worker's guard gives the SAME answers (a frontend-only rule is
//      not a rule -- a direct POST skips it, and the Worker is what stops the
//      value entering the database);
//   3. that the two code paths that can follow a stored link both go through
//      the guard rather than the raw value.
//
// Run: node tests/promotionLinkUrlParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeLinkUrl, isSafeLinkUrl, MAX_LINK_URL_LENGTH } from '../src/utils/safeLinkUrl.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..', '..')

// The cases. `expected` is what a safe normalizer returns: the value itself,
// or null for a refusal.
const CASES: Array<[string, string | null]> = [
  ['https://example.com/promo', 'https://example.com/promo'],
  ['http://example.com', 'http://example.com'],
  ['HTTPS://EXAMPLE.COM/x', 'HTTPS://EXAMPLE.COM/x'],
  ['  https://example.com/x  ', 'https://example.com/x'],
  ['/promotions', '/promotions'],
  ['/products?category=serum', '/products?category=serum'],
  // The whole reason this file exists.
  ['javascript:alert(1)', null],
  ['JavaScript:alert(1)', null],
  ['  javascript:alert(1)', null],
  ['data:text/html,<script>alert(1)</script>', null],
  ['vbscript:msgbox(1)', null],
  ['blob:https://example.com/abc', null],
  ['file:///c:/windows/system32', null],
  // Protocol-relative reads as a path and behaves as another origin.
  ['//evil.example/x', null],
  // Not a URL and not site-relative: refuse rather than invent an origin.
  ['example.com/promo', null],
  ['', null],
  ['   ', null],
  ['mailto:someone@example.com', null],
  ['tel:012345678', null],
]

for (const [input, expected] of CASES) {
  assert.equal(safeLinkUrl(input), expected, `safeLinkUrl(${JSON.stringify(input)})`)
  assert.equal(isSafeLinkUrl(input), expected !== null, `isSafeLinkUrl(${JSON.stringify(input)})`)
}

// A tab inside the scheme is stripped by the browser before the scheme is
// resolved, so this really is a working javascript: URL in several engines.
assert.equal(safeLinkUrl('java\tscript:alert(1)'), null, 'a control character inside the scheme must not slip through')
assert.equal(safeLinkUrl('java\nscript:alert(1)'), null)
assert.equal(safeLinkUrl('https://example.com/' + 'a'.repeat(MAX_LINK_URL_LENGTH)), null, 'over the length cap is refused')

// --- parity: the Worker must answer the same way --------------------------
// The Worker module is TypeScript on the other side of the repo and imports
// nothing, so its body can be evaluated directly rather than mocked.
const workerSource = fs.readFileSync(path.join(repo, 'cloudflare', 'src', 'lib', 'safeLinkUrl.ts'), 'utf8')
const workerBody = workerSource
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace(/: unknown/g, '')
  .replace(/: string \| null/g, '')
  .replace(/: boolean/g, '')
  .replace(/let parsed: URL/g, 'let parsed')
const workerNormalize = new Function(`${workerBody}; return normalizeSafeLinkUrl`)() as (value: unknown) => string | null

for (const [input, expected] of CASES) {
  assert.equal(workerNormalize(input), expected, `worker normalizeSafeLinkUrl(${JSON.stringify(input)})`)
  assert.equal(workerNormalize(input), safeLinkUrl(input), `worker and frontend disagree on ${JSON.stringify(input)}`)
}
assert.equal(workerNormalize('java\tscript:alert(1)'), null)

// --- the guards are actually wired in -------------------------------------
const portalRoute = fs.readFileSync(path.join(repo, 'cloudflare', 'src', 'routes', 'portal.ts'), 'utf8')
assert.match(portalRoute, /link_url: normalizeSafeLinkUrl\(\(row as Record<string, unknown>\)\.link_url\)/, 'the public Worker boundary must normalize legacy stored links before returning them')

const banner = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'PortalPromotionsBanner.tsx'), 'utf8')
assert.match(banner, /safeLinkUrl\(promo\.link_url\)/, 'the storefront must re-check a stored link before following it')
assert.doesNotMatch(banner, /window\.location\.assign\(promo\.link_url\)/, 'the raw stored value must never be navigated to')
assert.doesNotMatch(banner, /window\.open\(promo\.link_url/, 'the raw stored value must never be opened')

const modal = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'ManagePromotionsModal.tsx'), 'utf8')
assert.match(modal, /isSafeLinkUrl\(form\.link_url\)/, 'the editor must tell the author what is wrong before the Worker 400s')

console.log(`PASS promotion link_url: ${CASES.length + 3} cases agree across the storefront guard, the Worker guard and both call sites`)
