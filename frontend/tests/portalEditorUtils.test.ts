import assert from 'node:assert/strict'
import {
  moveListItem,
  normalizeAboutBlocks,
  normalizeGoogleMapsEmbed,
  normalizePromoItems,
  serializeAboutBlocks,
} from '../src/components/catalog/portalEditorUtils.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('normalizeGoogleMapsEmbed keeps full Google iframe src design', () => {
  const iframe = '<iframe src="https://www.google.com/maps/embed?pb=abc123" width="600" height="450"></iframe>'
  assert.equal(normalizeGoogleMapsEmbed(iframe), 'https://www.google.com/maps/embed?pb=abc123')
})

runTest('normalizeGoogleMapsEmbed converts plain Google links into embed URLs', () => {
  const value = normalizeGoogleMapsEmbed('https://maps.google.com/?q=Leang+Cosmetics')
  assert.equal(value.startsWith('https://www.google.com/maps?q='), true)
  assert.equal(value.includes('output=embed'), true)
})

runTest('normalizeAboutBlocks filters empty blocks and preserves order', () => {
  const blocks = normalizeAboutBlocks([
    { id: '1', type: 'text', title: 'Story', body: 'Hello' },
    { id: '2', type: 'image', mediaUrl: '' },
    { id: '3', type: 'video', mediaUrl: 'https://example.com/video.mp4' },
  ])

  assert.deepEqual(blocks.map((item) => item.id), ['1', '3'])
  assert.equal(blocks[1].type, 'video')
})

runTest('moveListItem reorders blocks safely', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(moveListItem(list, 2, 0).map((item) => item.id), ['c', 'a', 'b'])
})

runTest('serializeAboutBlocks returns normalized json', () => {
  const payload = serializeAboutBlocks([{ id: '1', type: 'text', body: 'Hello' }])
  assert.equal(payload, '[{"id":"1","type":"text","title":"","body":"Hello","mediaUrl":""}]')
})

runTest('normalizePromoItems keeps a product link and its denormalized name', () => {
  const items = normalizePromoItems([
    { id: 'promo-1', title: 'Sale', linkProductId: '42', linkProductName: 'Vitamin C Serum' },
  ])
  assert.equal(items[0].linkProductId, '42')
  assert.equal(items[0].linkProductName, 'Vitamin C Serum')
  assert.equal(items[0].linkUrl, '', 'a product-linked item should not also carry a URL')
})

runTest('normalizePromoItems clears the product link name when linkUrl is used instead', () => {
  const items = normalizePromoItems([
    { id: 'promo-2', title: 'Custom link', linkUrl: 'https://example.com', linkProductId: '', linkProductName: 'stale name' },
  ])
  assert.equal(items[0].linkUrl, 'https://example.com')
  assert.equal(items[0].linkProductId, '')
  assert.equal(items[0].linkProductName, '', 'linkProductName must not survive without a linkProductId')
})

runTest('normalizePromoItems drops items with no title, link, media, or body', () => {
  const items = normalizePromoItems([{ id: 'promo-3' }, { id: 'promo-4', linkProductId: '7', linkProductName: 'Kept' }])
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'promo-4')
})

if (failed > 0) {
  process.exitCode = 1
}
