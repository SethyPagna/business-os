// Byte-ranged CSV materialization must produce EXACTLY the rows a whole-file
// parse produces.
//
// Background: ensureSourceRowsMaterialized used to fetch the entire CSV and
// call .text() on it once per WINDOW -- a full UTF-8 decode of the whole file,
// ~87 times for the real 2.5 MB / 8,727-row export, on a Worker whose entire
// budget is 10ms per invocation. It now reads one byte range per window.
//
// That change is only safe because of one guard, and this file exists to hold
// that guard down: parseDelimitedRowsWindow flushes a trailing half-parsed row
// at end of text. Correct for a file whose last line has no newline;
// catastrophic for a slice that merely got cut mid-row, because the truncated
// row would be persisted as though complete -- every field after the cut lost,
// no error raised. That is the worst failure an importer can have, because it
// looks exactly like success.
//
// So these tests slice at EVERY possible boundary and assert the reassembled
// result is byte-for-byte what a single whole-file parse gives.
//
// Run: node scripts/test-csv-range-window-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-range-'))
const tsPath = path.join(tmpDir, 'importCsv.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importCsv.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { parseDelimitedRowsWindow } = require(path.join(tmpDir, 'importCsv.js'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')
const byteLen = (text) => encoder.encode(text).length

/** Parses the whole text in one pass -- the reference answer. */
function parseWhole(text, delimiter = ',') {
  const out = []
  let offset = 0
  let inQuotes = false
  for (;;) {
    const w = parseDelimitedRowsWindow(text, delimiter, offset, inQuotes, 50, true)
    out.push(...w.rows)
    if (w.done) break
    offset = w.nextIndex
    inQuotes = w.nextInQuotes
  }
  return out
}

/**
 * Reproduces what ensureSourceRowsMaterialized now does: repeatedly read a
 * fixed-size BYTE range, decode only that slice, parse it with
 * sourceIsComplete=false unless the slice reaches EOF, and advance a byte
 * cursor by the byte length of what was actually consumed.
 */
function parseByRanges(text, windowBytes, delimiter = ',', maxRows = 3) {
  const all = encoder.encode(text)
  const total = all.byteLength
  const out = []
  let byteOffset = 0
  let inQuotes = false
  let guard = 0
  while (byteOffset < total) {
    if (guard++ > 100000) throw new Error('no forward progress -- would spin forever in production')
    let size = windowBytes
    let slice = decoder.decode(all.slice(byteOffset, byteOffset + size))
    let reachedEof = byteOffset + Math.min(size, total - byteOffset) >= total
    let w = parseDelimitedRowsWindow(slice, delimiter, 0, inQuotes, maxRows, reachedEof)
    // Same widen-and-retry the engine does for a row longer than the window.
    while (!w.rows.length && !reachedEof) {
      size *= 4
      slice = decoder.decode(all.slice(byteOffset, byteOffset + size))
      reachedEof = byteOffset + Math.min(size, total - byteOffset) >= total
      w = parseDelimitedRowsWindow(slice, delimiter, 0, inQuotes, maxRows, reachedEof)
    }
    out.push(...w.rows)
    const consumed = byteLen(slice.slice(0, w.nextIndex))
    if (consumed <= 0 && !w.done) throw new Error('zero-byte advance')
    byteOffset += consumed
    inQuotes = w.nextInQuotes
    if (w.done) break
  }
  return out
}

// A file that exercises everything that makes this hard at once: Khmer (3
// bytes per character, so char offsets and byte offsets diverge), a quoted
// field containing commas AND newlines (so a naive "split on newline" is
// wrong), escaped double quotes, an empty field, and a final line with no
// trailing newline.
const TRICKY = [
  'name,barcode,description',
  'Abercrombie Authantic 10ml,085715166012,"""Official Product Name"": Abercrombie',
  'multi-line, with a comma',
  'and a third line"',
  'ហឹង ណារឺ វ៉ា ថន,012221112,ផ្សារដុយមិច',
  'Empty Desc,,',
  'Last row no newline,999,tail',
].join('\n')

check('a whole-file parse and a byte-ranged parse agree, at every window size', () => {
  const reference = parseWhole(TRICKY)
  assert.ok(reference.length >= 4, 'the fixture should produce several rows')
  // Every size from "smaller than one row" up to "larger than the file".
  for (let windowBytes = 1; windowBytes <= byteLen(TRICKY) + 8; windowBytes += 1) {
    const ranged = parseByRanges(TRICKY, windowBytes)
    assert.deepEqual(ranged, reference, `window of ${windowBytes} bytes disagreed with the whole-file parse`)
  }
})

check('a multi-byte character split across a range boundary is never corrupted', () => {
  // Khmer is 3 bytes per character, so most window sizes land mid-character.
  const khmer = 'name,note\nA,ផ្សារដុយមិច\nB,បុរីអរគីដេរព្រែកលាប\nC,ក្រឡាញ់\n'
  const reference = parseWhole(khmer)
  for (let windowBytes = 1; windowBytes <= byteLen(khmer) + 4; windowBytes += 1) {
    const ranged = parseByRanges(khmer, windowBytes)
    assert.deepEqual(ranged, reference, `window of ${windowBytes} bytes corrupted multi-byte text`)
    const flat = JSON.stringify(ranged)
    assert.ok(!flat.includes('�'), `window of ${windowBytes} bytes leaked a replacement character into a stored row`)
  }
})

check('a row cut mid-field is NOT emitted as a complete row', () => {
  // This is the whole point. "alpha,beta" is a complete row; "gam" is the
  // start of the next one. With sourceIsComplete=false the parser must
  // report only the complete row and rewind to the start of "gam".
  const slice = 'alpha,beta\ngam'
  const cut = parseDelimitedRowsWindow(slice, ',', 0, false, 10, false)
  assert.deepEqual(cut.rows, [['alpha', 'beta']], 'only the complete row may come out')
  assert.equal(cut.done, false, 'a cut slice is never done')
  assert.equal(slice.slice(cut.nextIndex), 'gam', 'the cursor rewinds to the start of the incomplete row')

  // The SAME text at true EOF legitimately flushes the trailing row --
  // a real file may end without a newline.
  const eof = parseDelimitedRowsWindow(slice, ',', 0, false, 10, true)
  assert.deepEqual(eof.rows, [['alpha', 'beta'], ['gam']], 'at real EOF the trailing row IS flushed')
  assert.equal(eof.done, true)
})

check('a slice cut INSIDE a quoted field rewinds to before the quote opened', () => {
  const slice = 'a,b\nc,"open quote and then'
  const cut = parseDelimitedRowsWindow(slice, ',', 0, false, 10, false)
  assert.deepEqual(cut.rows, [['a', 'b']])
  assert.equal(cut.nextInQuotes, false, 'quote state must be the state at the boundary, not mid-abandoned-row')
  assert.equal(slice.slice(cut.nextIndex), 'c,"open quote and then', 'the whole incomplete row is re-read next time')
})

check('the default keeps every pre-existing caller behaving exactly as before', () => {
  const text = 'a,b\nc,d'
  const withDefault = parseDelimitedRowsWindow(text, ',', 0, false, 10)
  const explicitly = parseDelimitedRowsWindow(text, ',', 0, false, 10, true)
  assert.deepEqual(withDefault, explicitly, 'omitting sourceIsComplete must mean "complete"')
  assert.deepEqual(withDefault.rows, [['a', 'b'], ['c', 'd']])
})

check('a row longer than the window still makes progress instead of spinning', () => {
  const huge = `name,desc\nA,"${'x'.repeat(5000)}"\nB,short\n`
  const reference = parseWhole(huge)
  // 64 bytes cannot hold the long row; the widen-and-retry path must kick in.
  const ranged = parseByRanges(huge, 64)
  assert.deepEqual(ranged, reference, 'a row larger than the window must still be parsed correctly')
})

check('CRLF line endings survive ranged reads, including a split \\r\\n pair', () => {
  const crlf = 'a,b\r\nc,d\r\ne,f\r\n'
  const reference = parseWhole(crlf)
  for (let windowBytes = 1; windowBytes <= byteLen(crlf) + 2; windowBytes += 1) {
    assert.deepEqual(parseByRanges(crlf, windowBytes), reference, `window of ${windowBytes} bytes mishandled CRLF`)
  }
})

check('a BOM-prefixed upload cannot spawn a phantom row at a window boundary', () => {
  // Production bug (Aug 28): every upload carries a UTF-8 BOM
  // (uploadImportJobCsv prepends one), and TextDecoder WITHOUT
  // { ignoreBOM: true } silently consumes it -- so the engine's stripBom
  // measured bomBytes = 0 while the raw file still held 3 BOM bytes. The
  // persisted byte cursor came up 3 bytes short and the SECOND window
  // re-read the previous row's last 3 bytes, emitting them as a phantom
  // one-field row (the "48" product; total_rows 12,094 for a 12,093-row
  // file). This harness mirrors ensureSourceRowsMaterialized's decode + bom
  // accounting exactly and must agree with the whole-file parse at every
  // window size.
  const bomAware = new TextDecoder('utf-8', { ignoreBOM: true })
  const parseByRangesEngineStyle = (bytes, windowBytes, maxRows = 3) => {
    const total = bytes.byteLength
    const out = []
    let byteOffset = 0
    let inQuotes = false
    let guard = 0
    while (byteOffset < total) {
      if (guard++ > 100000) throw new Error('no forward progress -- would spin forever in production')
      let size = windowBytes
      // The regex below strips a LITERAL U+FEFF (invisible in most editors)
      // -- same contract as importCsv.ts's stripBom.
      const stripLeadingBom = (text) => text.replace(/^﻿/, '')
      let slice = bomAware.decode(bytes.slice(byteOffset, byteOffset + size))
      let bomBytes = 0
      if (byteOffset === 0) {
        const stripped = stripLeadingBom(slice)
        bomBytes = byteLen(slice) - byteLen(stripped)
        slice = stripped
      }
      let reachedEof = byteOffset + Math.min(size, total - byteOffset) >= total
      let w = parseDelimitedRowsWindow(slice, ',', 0, inQuotes, maxRows, reachedEof)
      while (!w.rows.length && !reachedEof) {
        size *= 4
        slice = bomAware.decode(bytes.slice(byteOffset, byteOffset + size))
        if (byteOffset === 0) {
          const stripped = stripLeadingBom(slice)
          bomBytes = byteLen(slice) - byteLen(stripped)
          slice = stripped
        }
        reachedEof = byteOffset + Math.min(size, total - byteOffset) >= total
        w = parseDelimitedRowsWindow(slice, ',', 0, inQuotes, maxRows, reachedEof)
      }
      out.push(...w.rows)
      const consumed = byteLen(slice.slice(0, w.nextIndex))
      if (consumed <= 0 && !w.done) throw new Error('zero-byte advance')
      byteOffset += bomBytes + consumed
      inQuotes = w.nextInQuotes
      if (w.done) break
    }
    return out
  }
  const reference = parseWhole(TRICKY)
  // The prepended quoted string is a LITERAL U+FEFF BOM (invisible).
  const withBom = encoder.encode('﻿' + TRICKY)
  // 4 = the smallest window that can hold the whole 3-byte BOM plus one
  // real byte; the engine's real window is 256 KB, always far larger.
  for (let windowBytes = 4; windowBytes <= byteLen(TRICKY) + 8; windowBytes += 1) {
    const ranged = parseByRangesEngineStyle(withBom, windowBytes)
    assert.deepEqual(ranged, reference, `window of ${windowBytes} bytes over a BOM-prefixed file disagreed with the whole-file parse`)
  }
  // The engine's ranged decode must keep the BOM visible so its stripBom can
  // MEASURE it -- this is the line whose absence caused the phantom row.
  const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
  assert.match(engine, /new TextDecoder\('utf-8', \{ ignoreBOM: true \}\)\.decode\(buffer\)/, 'fetchCsvRange must decode with ignoreBOM so bomBytes can be measured')
})

// ---- the engine must actually use the ranged path ----
check('ensureSourceRowsMaterialized reads a range, not the whole object', () => {
  const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
  assert.match(engine, /await fetchCsvRange\(env, jobId, state\.byteOffset/, 'the materialize loop must read by byte range')
  assert.match(engine, /range: \{ offset, length \}/, 'the R2 get must pass a range')
  assert.match(engine, /MATERIALIZE_ROWS_PER_CHUNK, reachedEof\)/, 'the parser must be told whether the slice reaches EOF')
  assert.match(engine, /state\.byteOffset = nextByteOffset/, 'the byte cursor must be persisted between windows')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
