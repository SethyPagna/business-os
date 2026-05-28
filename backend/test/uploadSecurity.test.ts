'use strict'

const assert = require('node:assert/strict')
const {
  detectBufferKind,
  getExpectedUploadedKind,
  validateUploadedBuffer,
} = require('../src/uploadSecurity')
const { sanitizeOriginalFileName } = require('../src/fileAssets')

let failed = 0
const pendingTests = new Set()

function runTest(name, fn) {
  pendingTests.add(name)
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    })
    .finally(() => {
      pendingTests.delete(name)
      if (pendingTests.size === 0 && failed > 0) {
        process.exitCode = 1
      }
    })
}

runTest('detectBufferKind identifies basic file signatures', () => {
  assert.equal(detectBufferKind(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])), 'image')
  assert.equal(detectBufferKind(Buffer.from('%PDF-1.7', 'ascii')), 'document')
  assert.equal(detectBufferKind(Buffer.from('col1,col2\n1,2', 'utf8')), 'document')
})

runTest('getExpectedUploadedKind maps file metadata to supported classes', () => {
  assert.equal(getExpectedUploadedKind({ mimetype: 'image/png', originalname: 'photo.png' }), 'image')
  assert.equal(getExpectedUploadedKind({ mimetype: 'video/mp4', originalname: 'clip.mp4' }), 'video')
  assert.equal(getExpectedUploadedKind({ mimetype: 'application/pdf', originalname: 'paper.pdf' }), 'document')
})

runTest('validateUploadedBuffer rejects file-type mismatches', async () => {
  await assert.rejects(
    validateUploadedBuffer(Buffer.from('%PDF-1.7', 'ascii'), { mimetype: 'image/png', originalname: 'photo.png' }),
    /do not match the selected file type/i,
  )
})

runTest('sanitizeOriginalFileName removes traversal noise and caps length', () => {
  const result = sanitizeOriginalFileName('..\\..\\very-long-name-'.repeat(20) + '.png')
  assert.equal(result.includes('..'), false)
  assert.equal(result.endsWith('.png'), true)
  assert.equal(result.length <= 184, true)
})
