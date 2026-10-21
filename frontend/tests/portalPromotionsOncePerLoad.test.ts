// Storefront promotions are read once per page load and again only after a
// minute (AUDIT-FRONTEND-ROUND-TRIPS finding 9: the banner re-read them on every
// Products-tab activation). A failed read is retried on the next mount, and the
// banner reads through this shared loader rather than its own fetch.
//
// Run: node tests/portalPromotionsOncePerLoad.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let fetches = 0
let failNext = false
;(globalThis as Record<string, unknown>).window = { location: { origin: 'https://shop.test' } }
;(globalThis as Record<string, unknown>).fetch = async (url: string) => {
  fetches += 1
  assert.equal(url, 'https://shop.test/api/portal/promotions')
  if (failNext) {
    failNext = false
    return new Response('{}', { status: 503 })
  }
  return new Response(JSON.stringify({ items: [{ id: fetches, title: 'Deal' }] }), { status: 200 })
}

const { getPortalPromotions } = await import('../src/api/portalPublicTransport.ts')

const t0 = 1_000_000
const first = await getPortalPromotions(t0)
assert.equal(fetches, 1)
assert.deepEqual(first, { items: [{ id: 1, title: 'Deal' }] })

// Tab switches inside the minute reuse the same read.
await getPortalPromotions(t0 + 1)
await getPortalPromotions(t0 + 59_999)
assert.equal(fetches, 1, 'promotions are read once per page load within a minute')

// After a minute the next mount reads again.
const later = await getPortalPromotions(t0 + 60_000)
assert.equal(fetches, 2, 'a mount after 60 s reads fresh promotions')
assert.deepEqual(later, { items: [{ id: 2, title: 'Deal' }] })

// A failed read is not kept: the next mount retries instead of showing nothing for a minute.
failNext = true
await assert.rejects(getPortalPromotions(t0 + 200_000))
assert.equal(fetches, 3)
await getPortalPromotions(t0 + 200_001)
assert.equal(fetches, 4, 'a failed read is retried on the next mount')

const banner = readFileSync(new URL('../src/components/catalog/PortalPromotionsBanner.tsx', import.meta.url), 'utf8')
assert.match(banner, /import \{ getPortalPromotions \} from '\.\.\/\.\.\/api\/portalPublicTransport\.ts'/)
assert.doesNotMatch(banner, /fetch\(/, 'the banner reads through the shared loader')

console.log('PASS storefront promotions: one read per load, refreshed after 60 s, failures retried')
