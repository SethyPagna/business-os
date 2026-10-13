// X1 (security audit, 13 Oct 2026): the editor's map-embed check must name Google hosts exactly, the
// same way the Worker does. The old pattern accepted google.evil.com, maps.google.attacker.net and
// google.com.evil.io. The Worker twin is pinned against this one by
// cloudflare/scripts/test-portal-maps-embed-host-pure.cjs, which loads both real functions.
//
// Run: node tests/portalMapsEmbedHost.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeGoogleMapsEmbed } from '../src/components/catalog/portalEditorUtils.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const suffixListIn = (file: string): string => {
  const match = /const GOOGLE_MAPS_DOMAIN_SUFFIXES = \[([^\]]*)\]/.exec(fs.readFileSync(file, 'utf8'))
  assert.ok(match, `${path.basename(file)} must declare GOOGLE_MAPS_DOMAIN_SUFFIXES`)
  return match[1].replace(/\s+/g, '')
}

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

runTest('a /maps/embed URL on a named Google host is accepted unchanged', () => {
  for (const url of [
    'https://www.google.com/maps/embed?pb=abc123',
    'https://google.com/maps/embed?pb=abc123',
    'https://maps.google.com/maps/embed?pb=abc123',
    'https://www.google.com.kh/maps/embed?pb=abc123',
    'https://maps.google.co.th/maps/embed?pb=abc123',
  ]) {
    assert.equal(normalizeGoogleMapsEmbed(url), url)
  }
})

runTest('attacker hosts built around a Google name are refused', () => {
  for (const url of [
    'https://www.google.com/maps/embed?pb=1'.replace('www.google.com', 'google.evil.com'),
    'https://maps.google.attacker.net/maps/embed?pb=1',
    'https://google.com.evil.io/maps/embed?pb=1',
    'https://notgoogle.com/maps/embed?pb=1',
    'https://www.google.in/maps/embed?pb=1',
    'https://user:pass@www.google.com/maps/embed?pb=1',
  ]) {
    assert.equal(normalizeGoogleMapsEmbed(url), '', url)
  }
})

runTest('share links are rewritten to the fixed embed URL, whatever their path', () => {
  for (const url of ['https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/embed?pb=1', 'https://share.google/AbC123']) {
    assert.ok(normalizeGoogleMapsEmbed(url).startsWith('https://www.google.com/maps?q='), url)
  }
})

runTest('the editor and the Worker carry the same explicit suffix list', () => {
  const editor = path.join(here, '..', 'src', 'components', 'catalog', 'portalEditorUtils.ts')
  const worker = path.join(here, '..', '..', 'cloudflare', 'src', 'routes', 'portal.ts')
  assert.equal(suffixListIn(editor), suffixListIn(worker))
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nportalMapsEmbedHost: all green')
