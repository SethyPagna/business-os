// Owner, 20 Nov 2026: Chinese, French and Spanish come from Google Translate again. The Google
// loader lives in one lazy module, and the origins it needs are allowed by the storefront's
// report-only CSP. Nothing else may load, style or name the widget.
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

const LOADER_MARKERS = /translate_a\/element\.js|TranslateElement|goog-te-combo|businessOsPortalTranslateInit|translate\.google\.com|translate\.googleapis\.com/
const sourceFiles: string[] = []
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'lang' && entry.name !== 'legal') walk(full)
    } else if (/\.(ts|tsx|js|html)$/.test(entry.name)) sourceFiles.push(full)
  }
}
walk(path.join(frontend, 'src'))
walk(path.join(frontend, 'public'))
sourceFiles.push(path.join(frontend, 'index.html'), path.join(frontend, 'vite.config.ts'))

check('only the translate controller loads or names the Google widget', () => {
  const hits = sourceFiles
    .filter((file) => LOADER_MARKERS.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(frontend, file).replace(/\\/g, '/'))
  assert.deepEqual(hits, ['src/components/catalog/portalTranslateController.ts'])
})

check('the controller exists and is cut down to the four targets from English', () => {
  const controller = read('src/components/catalog/portalTranslateController.ts')
  assert.match(controller, /PORTAL_TRANSLATE_TARGETS = \['zh-CN', 'zh-TW', 'fr', 'es'\] as const/)
  assert.match(controller, /PORTAL_TRANSLATE_SOURCE_LANGUAGE = 'en'/)
})

check('the controller is not part of the storefront entry or the Worker-facing code', () => {
  assert.doesNotMatch(read('src/PublicCatalogRoot.tsx'), /portalTranslateController/)
  assert.doesNotMatch(read('index.html'), /translate\.google|googtrans/)
})

const cspLine = read('public/_headers').split(/\r?\n/).find((line) => /^\s+Content-Security-Policy(-Report-Only)?:/.test(line)) || ''
assert.ok(cspLine, '_headers declares a storefront CSP')
const directives = new Map(cspLine.replace(/^\s+Content-Security-Policy(-Report-Only)?:\s*/, '').split(';').map((part) => {
  const [name, ...values] = part.trim().split(/\s+/)
  return [name, values] as const
}))
const allowedBy = (directive: string) => directives.get(directive) || []

check('the policy stays report-only', () => {
  assert.match(read('public/_headers'), /^\s+Content-Security-Policy-Report-Only:/m)
  assert.doesNotMatch(read('public/_headers'), /^\s+Content-Security-Policy:/m)
})

check('the Google Translate hosts are allowed exactly where the widget needs them', () => {
  assert.deepEqual(allowedBy('connect-src'), ["'self'", 'https://translate.googleapis.com', 'https://translate-pa.googleapis.com'])
  assert.deepEqual(allowedBy('script-src'), ["'self'", "'unsafe-inline'", 'https://translate.google.com', 'https://translate.googleapis.com', 'https://www.gstatic.com'])
  assert.deepEqual(allowedBy('style-src'), ["'self'", "'unsafe-inline'", 'https://www.gstatic.com'])
  const frames = allowedBy('frame-src')
  assert.ok(frames.includes('https://translate.google.com') && frames.includes('https://translate.googleapis.com'), frames.join(' '))
})

check('the two-click store map frame and every Maps host are still allowed', () => {
  const frames = allowedBy('frame-src')
  for (const host of ['https://www.google.com', 'https://maps.google.com', 'https://google.com', 'https://www.google.co.jp', 'https://maps.google.fr']) assert.ok(frames.includes(host), host)
})

check('nothing else is opened up: images, media, default and ancestors are unchanged', () => {
  assert.deepEqual(allowedBy('default-src'), ["'self'"])
  assert.deepEqual(allowedBy('img-src'), ["'self'", 'data:', 'blob:', 'https:'])
  assert.deepEqual(allowedBy('media-src'), ["'self'", 'blob:'])
  assert.deepEqual(allowedBy('frame-ancestors'), ["'self'"])
})

assert.deepEqual(failures, [], `Google Translate wiring:\n  ${failures.join('\n  ')}`)
console.log('PASS the Google Translate loader is one lazy module; the map frame is still allowed')
