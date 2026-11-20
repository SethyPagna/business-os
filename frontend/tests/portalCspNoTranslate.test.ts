// Owner decision, 27 Sep 2026: English and Khmer only, the Google Translate
// menu dropped and the storefront CSP tightened. Nothing may load Google
// Translate again, allow its origins, or keep disclosing it to customers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  // The policies (legalContent.ts) name the googtrans cookie for the four Google-translated languages; no other file may.
  const hits = sourceFiles.filter((file) => !file.endsWith('legalContent.ts') && LOADER_MARKERS.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(frontend, file).replace(/\\/g, '/'))
  assert.deepEqual(hits, [])
})

check('the translate controller module is gone', () => {
  assert.equal(fs.existsSync(path.join(frontend, 'src/components/catalog/portalTranslateController.ts')), false)
})

// Policies (LANG-B, 20 Nov 2026): Google Translate returns for four languages, so the policies must say so. portalLegalTranslateDisclosure.test.ts pins it.

assert.deepEqual(failures, [], `Google Translate route still present:\n  ${failures.join('\n  ')}`)
console.log('PASS no Google Translate loader or CSP origin remains; the map frame is still allowed')
