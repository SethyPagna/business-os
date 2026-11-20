// Owner decision, 27 Sep 2026: English and Khmer only, the Google Translate
// menu dropped and the storefront CSP tightened. Nothing may load Google
// Translate again, allow its origins, or keep disclosing it to customers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGAL_STORAGE_ROWS, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const frontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(frontend, relative), 'utf8')
const failures: string[] = []
const check = (name: string, run: () => void) => {
  try {
    run()
  } catch (error) {
    failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  }
}

const TRANSLATE_ORIGIN = /translate\.google\.com|translate\.googleapis\.com|translate-pa\.googleapis\.com|www\.gstatic\.com/

const cspLine = read('public/_headers').split(/\r?\n/).find((line) => /^\s+Content-Security-Policy(-Report-Only)?:/.test(line))
assert.ok(cspLine, '_headers declares a storefront CSP')
const directives = new Map(cspLine.replace(/^\s+Content-Security-Policy(-Report-Only)?:\s*/, '').split(';').map((part) => {
  const [name, ...values] = part.trim().split(/\s+/)
  return [name, values] as const
}))

check('no CSP directive allows a Google Translate origin', () => {
  const allowed = [...directives].flatMap(([name, values]) => values.filter((value) => TRANSLATE_ORIGIN.test(value)).map((value) => `${name} ${value}`))
  assert.deepEqual(allowed, [])
})

check('the two-click store map frame is still allowed', () => {
  const frames = directives.get('frame-src') || []
  assert.ok(frames.includes('https://www.google.com') && frames.includes('https://maps.google.com'), frames.join(' '))
})

const LOADER_MARKERS = /translate_a\/element\.js|TranslateElement|goog-te-combo|googtrans|businessOsPortalTranslateInit|translate\.google\.com|translate\.googleapis\.com|portalTranslateController/
const sourceFiles: string[] = []
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx|js|css|html)$/.test(entry.name)) sourceFiles.push(full)
  }
}
walk(path.join(frontend, 'src'))
walk(path.join(frontend, 'public'))
sourceFiles.push(path.join(frontend, 'index.html'), path.join(frontend, 'vite.config.ts'))

check('no source file loads, styles or names the Google Translate widget', () => {
  const hits = sourceFiles.filter((file) => LOADER_MARKERS.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(frontend, file).replace(/\\/g, '/'))
  assert.deepEqual(hits, [])
})

check('the translate controller module is gone', () => {
  assert.equal(fs.existsSync(path.join(frontend, 'src/components/catalog/portalTranslateController.ts')), false)
})

check('the policies no longer disclose Google Translate or its cookie', () => {
  const mentions = [...Object.entries(PORTAL_LEGAL_EN), ...Object.entries(PORTAL_LEGAL_KM)]
    .filter(([, text]) => /Google Translate|googtrans/i.test(text))
    .map(([key]) => key)
  assert.deepEqual([...new Set(mentions)], [])
  assert.deepEqual(LEGAL_STORAGE_ROWS.filter((row) => /googtrans/.test(row.name)).map((row) => row.name), [])
})

check('neither language pack tells anyone about Google Translate', () => {
  for (const pack of ['src/lang/en.json', 'src/lang/km.json']) {
    assert.doesNotMatch(read(pack), /Google Translate|googtrans|\bGoogle\b[^"]*fallback|Google ជាជម្រើស|Google តែជាជម្រើស/, pack)
  }
})

assert.deepEqual(failures, [], `Google Translate route still present:\n  ${failures.join('\n  ')}`)
console.log('PASS no Google Translate loader, CSP origin, policy disclosure or pack text remains; the map frame is still allowed')
