'use strict'

const assert = require('node:assert/strict')
const {
  detectBufferKind,
  getExpectedUploadedKind,
} = require('../src/uploadSecurity')

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

if (failed > 0) {
  process.exitCode = 1
}
