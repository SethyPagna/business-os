'use strict'

const assert = require('node:assert/strict')
const { normalizeAboutBlocks, normalizeGoogleMapsEmbed } = require('../src/portalUtils')

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

runTest('normalizeGoogleMapsEmbed keeps iframe embed URLs intact', () => {
  const iframe = '<iframe src="https://www.google.com/maps/embed?pb=abc123" width="600"></iframe>'
  assert.equal(normalizeGoogleMapsEmbed(iframe), 'https://www.google.com/maps/embed?pb=abc123')
})

runTest('normalizeGoogleMapsEmbed converts plain Google URLs to embed URLs', () => {
  const value = normalizeGoogleMapsEmbed('https://maps.google.com/?q=Leang+Cosmetics')
  assert.equal(value.startsWith('https://www.google.com/maps?q='), true)
  assert.equal(value.includes('output=embed'), true)
})

runTest('normalizeAboutBlocks keeps only meaningful blocks', () => {
  const blocks = normalizeAboutBlocks('[{"id":"1","type":"text","body":"Hello"},{"id":"2","type":"image","mediaUrl":""}]')
  assert.deepEqual(blocks, [
    { id: '1', type: 'text', title: '', body: 'Hello', mediaUrl: '' },
  ])
})

if (failed > 0) {
  process.exitCode = 1
}
