import assert from 'node:assert/strict'
import {
  moveListItem,
  normalizeAboutBlocks,
  normalizeGoogleMapsEmbed,
  serializeAboutBlocks,
} from '../src/components/catalog/portalEditorUtils.mjs'

let failed = 0

function runTest(name, fn) {
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

if (failed > 0) {
  process.exitCode = 1
}
