// S-uploads3 fix 6 (2026-09-27): the owner-run purge
// (ops/scripts/purge-non-media-uploads.mjs) kept crafted TEXT as media, so it
// was never moved and never shown for review (refuter R-uploads2):
//   - a CSV with 'G' at bytes 0, 188 and 376 was kept as an MPEG transport
//     stream;
//   - `ID3\x03\x00` followed by notes was kept as MP3;
//   - `\0\0\0\x08free` followed by notes was kept as QuickTime;
//   - a vertical tab and 'w' followed by notes was kept as AC-3 audio.
// Owner rule: storage holds only images and videos, nothing may be lost. A
// file that is text but starts like media is neither kept as media nor
// purged as text: it goes to REVIEW (never moved). Real media of the same
// formats is still kept -- an MP3 with a real ID3 tag, a transport stream, a
// QuickTime movie whose first atom is larger than the bytes read, an AC-3
// frame.
//
// Fails on 0d7493589a (every crafted case is 'keep'); to run against an older
// script: PURGE_SCRIPT=/tmp/purge.mjs node test-purge-crafted-text-review-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PURGE_SOURCE = process.env.PURGE_SCRIPT || path.resolve(__dirname, '../../ops/scripts/purge-non-media-uploads.mjs')

const latin1 = (text) => Uint8Array.from(Buffer.from(text, 'latin1'))
const bytes = (...parts) => {
  const arrays = parts.map((part) => (typeof part === 'string' ? latin1(part) : part instanceof Uint8Array ? part : Uint8Array.from(part)))
  const out = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0))
  let offset = 0
  for (const array of arrays) { out.set(array, offset); offset += array.length }
  return out
}
const u32be = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
function noise(length, seed) {
  const out = new Uint8Array(length)
  let state = seed >>> 0
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    out[index] = state >>> 24
  }
  return out
}

// Text that meets a loose media signature.
const CRAFTED = [
  ['CSV with G every 188 bytes (MPEG-TS sync)', 'uploads/stock.csv', latin1('G' + 'x'.repeat(187) + 'G' + 'y'.repeat(187) + 'G' + 'z'.repeat(187) + '\n')],
  ['same CSV without an extension', 'uploads/stock', latin1('G' + 'x'.repeat(187) + 'G' + 'y'.repeat(187) + 'G' + 'z'.repeat(187) + '\n')],
  ['notes after ID3\\x03\\x00', 'uploads/notes.txt', bytes('ID3', [3, 0], 'hello this is text notes about product')],
  ['notes after ID3\\x04\\x00 with a space flag byte', 'uploads/notes2.txt', bytes('ID3', [4, 0], ' notes that go on and on about the product')],
  ['notes after a tiny free atom header', 'uploads/free.txt', bytes([0, 0, 0, 8], 'free', 'hello text after a tiny header')],
  ['notes after a tiny free atom header, named .bin', 'uploads/free.bin', bytes([0, 0, 0, 8], 'free', 'hello text after a tiny header')],
  ['notes starting with a vertical tab and w (AC-3 sync)', 'uploads/ac3.txt', latin1('\x0bwhat a nice product description, in plain text\n')],
]

// Real media of the same families.
const id3Mp3 = () => {
  const frames = bytes(...Array.from({ length: 6 }, (_, index) => bytes([0xff, 0xfb, 0x90, 0x64], noise(413, index + 1))))
  return bytes('ID3', [3, 0, 0], [0, 0, 0, 20], new Uint8Array(20), frames)
}
const transportStream = () => bytes(...Array.from({ length: 4 }, (_, index) => bytes([0x47, 0x40, 0x11, 0x10 | index], noise(184, index + 7))))
const bigFreeQuickTime = () => bytes(u32be(8192), 'free', new Uint8Array(8184), u32be(1000), 'mdat', noise(992, 3), u32be(16), 'moov', u32be(8), 'mvhd')
const ac3 = () => bytes([0x0b, 0x77, 0x3c, 0x5e, 0x14, 0x40], noise(1000, 9))
const REAL = [
  ['MP3 with a real ID3v2.3 tag', 'uploads/song.mp3', id3Mp3(), 'other-video-audio'],
  ['MP3 with a real ID3 tag, named .bin', 'uploads/song.bin', id3Mp3(), 'other-video-audio'],
  ['MPEG transport stream', 'uploads/clip.m2ts', transportStream(), 'other-video-audio'],
  ['QuickTime whose first atom is a large free atom', 'uploads/movie.mov', bigFreeQuickTime(), null],
  ['AC-3 audio frame', 'uploads/sound.ac3', ac3(), 'other-video-audio'],
]

const failures = []
let checks = 0
function check(label, fn) {
  checks += 1
  try { fn() } catch (error) { failures.push(`${label}: ${String(error && error.message).split('\n')[0]}`) }
}

async function main() {
  const script = await import(pathToFileURL(PURGE_SOURCE).href)
  const classify = (key, data, complete = true, size = data.length) => script.classifyObject({ key, size, bytes: data, complete })

  for (const [label, key, data] of CRAFTED) {
    check(`crafted: ${label} goes to review, never kept as media nor purged`, () => {
      const verdict = classify(key, data)
      assert.equal(verdict.action, 'review', JSON.stringify(verdict))
    })
    // The purge reads the first 4 KB of a large file: the same bytes as the
    // head of a larger object must not flip to keep either.
    check(`crafted: ${label}, read as the head of a larger file, is not kept`, () => {
      const verdict = classify(key, data, false, data.length + 100000)
      assert.notEqual(verdict.action, 'keep', JSON.stringify(verdict))
    })
  }

  for (const [label, key, data, group] of REAL) {
    check(`real: ${label} is kept`, () => {
      const verdict = classify(key, data)
      assert.equal(verdict.action, 'keep', JSON.stringify(verdict))
      if (group) assert.equal(verdict.group, group, JSON.stringify(verdict))
    })
    check(`real: ${label}, first 4 KB of the file, is kept`, () => {
      const head = data.subarray(0, 4096)
      const verdict = classify(key, head, head.length >= data.length, data.length)
      assert.equal(verdict.action, 'keep', JSON.stringify(verdict))
    })
  }

  // A QuickTime movie whose free atom runs past the bytes read: judged by
  // detectOtherMedia from the first 4 KB of a larger file.
  check('real: a QuickTime head whose first atom runs past the bytes read is kept', () => {
    const head = bytes(u32be(1 << 20), 'free', new Uint8Array(4088))
    const verdict = classify('uploads/big.mov', head, false, 5 << 20)
    assert.equal(verdict.action, 'keep', JSON.stringify(verdict))
  })
  // ...but not when that atom is larger than the whole file.
  check('crafted: a free atom larger than the whole file is not kept', () => {
    const data = bytes(u32be(1 << 20), 'free', new Uint8Array(100))
    assert.notEqual(classify('uploads/x.bin', data).action, 'keep')
  })

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    console.error(`${failures.length} of ${checks} checks failed`)
    process.exitCode = 1
    return
  }
  console.log(`PASS ${checks} checks: crafted text that starts like media goes to review; real MP3/TS/QuickTime/AC-3 is kept`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
