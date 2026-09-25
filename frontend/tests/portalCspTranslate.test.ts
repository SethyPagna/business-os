// P-public-1 follow-up (2026-09-25): the storefront CSP (report-only today)
// must already allow everything the Google Translate widget loads, so turning
// it into an enforced policy later cannot silently break translation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const headers = fs.readFileSync(path.join(here, '..', 'public', '_headers'), 'utf8')
const cspLine = headers.split(/\r?\n/).find((line) => /^\s+Content-Security-Policy(-Report-Only)?:/.test(line))
assert.ok(cspLine, '_headers declares a storefront CSP')
const directives = new Map(cspLine!.replace(/^\s+Content-Security-Policy(-Report-Only)?:\s*/, '').split(';').map((part) => {
  const [name, ...values] = part.trim().split(/\s+/)
  return [name, values] as const
}))
const has = (directive: string, origin: string) => (directives.get(directive) || []).includes(origin)

for (const origin of ['https://translate.google.com', 'https://translate.googleapis.com']) {
  assert.ok(has('frame-src', origin), `frame-src must allow ${origin} (the widget's iframes)`)
  assert.ok(has('script-src', origin), `script-src must allow ${origin} (element.js)`)
}
assert.ok(has('connect-src', 'https://translate.googleapis.com'))
assert.ok(has('style-src', 'https://www.gstatic.com'))
// The map frame is still allowed alongside.
assert.ok(has('frame-src', 'https://www.google.com') && has('frame-src', 'https://maps.google.com'))

console.log('PASS storefront CSP allows the Google Translate widget in every directive it needs')
