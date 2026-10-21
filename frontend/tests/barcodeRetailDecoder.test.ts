// Scanner S1a (6.0.922): the ZXing fallback decodes with the retail readers
// only, and still reads every retail format.
//
// Before: loadLumaDecoder imported the package root and decoded through
// MultiFormatReader, which statically pulls in the QR, DataMatrix, PDF417,
// Aztec and RSS decoders: a 448 KB chunk for a scanner that reads seven 1D
// formats. Now it imports MultiFormatUPCEANReader, Code39Reader, Code128Reader
// and ITFReader by deep path and runs them the way ZXing's own
// MultiFormatOneDReader does (every row to each reader in turn).
//
// This runs the REAL library through Vite's SSR loader on bar patterns drawn
// here from ZXing's own tables. What the old MultiFormatReader returned for each
// fixture is what is expected below (the file was run against the old decoder to
// pin these), so it also proves the new composition reads the same things.
// UPC-E has no fixture: ZXing 0.22's UPC-E reader decodes none of the patterns
// drawn here under the old MultiFormatReader either (UPC-E relies on the native
// detector), so there is nothing to compare.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(`${frontendRoot}/`)
const table = (name: string) => require(`@zxing/library/cjs/core/oned/${name}`).default

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  cacheDir: join(tmpdir(), 'business-os-scanner-retail-decoder-vite'),
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  ssr: { noExternal: ['@zxing/library'] },
})

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// --- fixtures: modules ("1" = bar) -> a grayscale frame ---------------------

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = L.map((code) => code.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0')))
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
const digitsOf = (code: string) => [...code].map(Number)
const runs = (widths: ArrayLike<number>) => Array.from(widths, (width, index) => (index % 2 === 0 ? '1' : '0').repeat(width)).join('')

const ean13 = (code: string) => {
  const d = digitsOf(code)
  const left = d.slice(1, 7).map((digit, i) => (PARITY[d[0]][i] === 'L' ? L : G)[digit]).join('')
  return `101${left}01010${d.slice(7).map((digit) => R[digit]).join('')}101`
}
const ean8 = (code: string) => {
  const d = digitsOf(code)
  return `101${d.slice(0, 4).map((digit) => L[digit]).join('')}01010${d.slice(4).map((digit) => R[digit]).join('')}101`
}
const upcA = (code: string) => ean13(`0${code}`)
const code39 = (text: string) => {
  const Code39 = table('Code39Reader')
  const encodings = [...`*${text}*`].map((char) => (char === '*' ? Code39.ASTERISK_ENCODING : Code39.CHARACTER_ENCODINGS[Code39.ALPHABET_STRING.indexOf(char)]) as number)
  return encodings.map((encoding) => runs(Array.from({ length: 9 }, (_, i) => ((encoding >> (8 - i)) & 1 ? 3 : 1)))).join('0')
}
const code128 = (text: string) => {
  const patterns = table('Code128Reader').CODE_PATTERNS as Int32Array[]
  const values = [...text].map((char) => char.charCodeAt(0) - 32)
  const checksum = (104 + values.reduce((sum, value, i) => sum + value * (i + 1), 0)) % 103
  return [104, ...values, checksum, 106].map((index) => runs(patterns[index])).join('')
}
const itf = (digits: string) => {
  const patterns = table('ITFReader').PATTERNS as Int32Array[]
  const d = digitsOf(digits)
  let modules = runs([1, 1, 1, 1])
  for (let i = 0; i < d.length; i += 2) {
    const widths: number[] = []
    for (let k = 0; k < 5; k += 1) widths.push(patterns[d[i] + 10][k], patterns[d[i + 1] + 10][k])
    modules += runs(widths)
  }
  return modules + runs([3, 1, 1])
}

interface LumaFrame { data: Uint8ClampedArray; width: number; height: number }
function frameOf(modules: string, { scale = 3, height = 60, quiet = 12 } = {}): LumaFrame {
  const columns = `${'0'.repeat(quiet)}${modules}${'0'.repeat(quiet)}`
  const width = columns.length * scale
  const data = new Uint8ClampedArray(width * height).fill(255)
  for (let y = 0; y < height; y += 1) {
    for (let c = 0; c < columns.length; c += 1) {
      if (columns[c] === '1') data.fill(0, y * width + c * scale, y * width + (c + 1) * scale)
    }
  }
  return { data, width, height }
}

const FIXTURES: Array<{ name: string; modules: string; text: string; format: string }> = [
  { name: 'EAN-13', modules: ean13('5901234123457'), text: '5901234123457', format: 'ean_13' },
  { name: 'EAN-8', modules: ean8('96385074'), text: '96385074', format: 'ean_8' },
  { name: 'UPC-A', modules: upcA('036000291452'), text: '036000291452', format: 'upc_a' },
  { name: 'Code 128', modules: code128('SKU-12345'), text: 'SKU-12345', format: 'code_128' },
  { name: 'Code 39', modules: code39('BOX-4821'), text: 'BOX-4821', format: 'code_39' },
  { name: 'ITF', modules: itf('123456789012'), text: '123456789012', format: 'itf' },
]

// --- the module under test, through Vite SSR --------------------------------

type Decoder = typeof import('../src/components/products/scanning/barcodeFrameDecoder.ts')

try {
  const decoder = await vite.ssrLoadModule('/src/components/products/scanning/barcodeFrameDecoder.ts') as Decoder
  const decode = await decoder.loadLumaDecoder()

  for (const fixture of FIXTURES) {
    await runTest(`reads ${fixture.name} (fast and TRY_HARDER readers)`, () => {
      const frame = frameOf(fixture.modules)
      assert.deepEqual(decode(frame, false), { text: fixture.text, format: fixture.format })
      assert.deepEqual(decode(frame, true), { text: fixture.text, format: fixture.format })
    })
  }

  await runTest('a code turned on its end is read through the ladder, and a frame with nothing in it is a plain miss', () => {
    const turned = decoder.rotateQuarter(frameOf(FIXTURES[0].modules))
    const { read } = decoder.runDecodeLadder({ centre: () => turned, full: () => turned }, decode)
    assert.deepEqual(read, { text: '5901234123457', format: 'ean_13' })
    const blank = { data: new Uint8ClampedArray(200 * 60).fill(255), width: 200, height: 60 }
    assert.equal(decode(blank, false), null)
    assert.equal(decode(blank, true), null)
  })

  await runTest('a 2-character Code 128 pattern ZXing happily decodes is not a read', () => {
    const frame = frameOf(code128('AB'))
    assert.deepEqual(decode(frame, false), { text: 'AB', format: 'code_128' }, 'the fixture is a real, decodable Code 128')
    const { read } = decoder.runDecodeLadder({ centre: () => frame, full: () => frame }, decode)
    assert.equal(read, null, 'the ladder must refuse a read shorter than 4 characters')
    const long = frameOf(code128('AB12'))
    assert.deepEqual(decoder.runDecodeLadder({ centre: () => long, full: () => long }, decode).read, { text: 'AB12', format: 'code_128' })
  })

  await runTest('only the retail readers were loaded: no QR, DataMatrix, PDF417, Aztec, RSS, Code 93 or Codabar module, and not the package root', () => {
    const loaded = [...vite.moduleGraph.idToModuleMap.values()]
      .filter((node) => node.ssrModule)
      .map((node) => (node.id || '').replace(/\\/g, '/'))
      .filter((id) => id.includes('/@zxing/library/'))
    assert.ok(loaded.some((id) => /\/oned\/Code128Reader/.test(id)), `the retail readers should be in the graph, got ${loaded.length} zxing modules`)
    const forbidden = loaded.filter((id) => /\/(qrcode|microqr|datamatrix|pdf417|aztec|multi)\/|\/oned\/rss\/|\/Code93Reader|\/CodaBarReader|\/MultiFormatReader|\/MultiFormatOneDReader|\/esm\/index\.js$/.test(id))
    assert.deepEqual(forbidden, [], 'these modules are dead weight in the scanner chunk')
  })
} finally {
  await vite.close()
}

if (failed > 0) process.exitCode = 1
