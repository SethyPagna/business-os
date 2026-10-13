import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const NOTICES_HREF = '/THIRD_PARTY_NOTICES.txt'

function compile(rel: string, resolve: (id: string) => unknown, loader: 'ts' | 'tsx'): Record<string, any> {
  const code = transformSync(read(rel), { loader, format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports)
  return mod.exports
}

const legalContent = await import('../src/components/catalog/legal/legalContent.ts') as Record<string, any>
const Icon = () => null
const legalPages = compile('../src/components/catalog/legal/LegalPages.tsx', (id) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.startsWith('lucide-react/')) return { __esModule: true, default: Icon }
  if (id.endsWith('/legalContent.ts')) return legalContent
  if (id.endsWith('/documentScrollLock.ts')) return { lockDocumentScroll: () => () => {} }
  throw new Error(`LegalPages.tsx imports ${id}, which this harness does not provide`)
}, 'tsx')

function renderFooter(language: 'en' | 'km'): string {
  const pack = language === 'km' ? km : en
  const copy = (key: string, fallbackEn?: string, fallbackKm?: string) => pack[key] ?? (language === 'km' ? fallbackKm : fallbackEn) ?? key
  return renderToStaticMarkup(React.createElement(legalPages.default, { copy, businessName: 'Leang Cosmetics' }))
}

const failures: string[] = []
function runCase(name: string, body: () => void): void {
  try {
    body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const noticesLink = (markup: string): string => markup.match(/<a\b[^>]*data-portal-footer-notices="true"[^>]*>[^<]*<\/a>/)?.[0] ?? ''

runCase('the storefront footer renders a small text link to the notices file, in English', () => {
  const link = noticesLink(renderFooter('en'))
  assert.ok(link, 'no notices link in the footer')
  assert.match(link, new RegExp(`href="${NOTICES_HREF}"`))
  assert.match(link, /target="_blank"/)
  assert.match(link, /rel="noreferrer"/)
  assert.match(link, />Open-source notices<\/a>$/)
})

runCase('the same link renders in Khmer with the Khmer label, never the English one', () => {
  const markup = renderFooter('km')
  const link = noticesLink(markup)
  assert.ok(link, 'no notices link in the Khmer footer')
  assert.match(link, new RegExp(`href="${NOTICES_HREF}"`))
  assert.ok(link.includes(km.portal_legal_footer_notices))
  assert.match(km.portal_legal_footer_notices, /[ក-៿]/)
  assert.ok(!link.includes('Open-source'))
})

runCase('the footer row that holds the link has Khmer-safe line height and keeps the rights line and a 40px target', () => {
  const markup = renderFooter('km')
  const row = markup.match(/<div class="[^"]*border-t[^"]*"><span>[^<]*<\/span><a\b[^>]*data-portal-footer-notices[\s\S]*?<\/a><\/div>/)?.[0] ?? ''
  assert.ok(row, 'the notices link is not in the same row as the rights line')
  assert.match(row, /leading-relaxed/)
  assert.doesNotMatch(row, /leading-5/)
  assert.match(row, /<span>គេហទំព័រនេះដំណើរការដោយ/)
  assert.match(noticesLink(markup), /min-h-10/)
})

runCase('Settings links the same file with its own translated label', () => {
  const settings = read('../src/components/utils-settings/Settings.tsx')
  const link = settings.match(/<a\s[^>]*data-settings-notices="true"[\s\S]*?<\/a>/)?.[0] ?? ''
  assert.ok(link, 'Settings has no notices link')
  assert.ok(link.includes(`href="${NOTICES_HREF}"`))
  assert.ok(link.includes('target="_blank"') && link.includes('rel="noreferrer"'))
  assert.ok(link.includes("t('open_source_notices')"))
  assert.match(link, /leading-relaxed|className="underline/)
  assert.match(settings, /<p className="text-xs leading-relaxed [^"]*">\s*<a\s[^>]*data-settings-notices/, 'the Settings link sits in a Khmer-safe line box')
})

runCase('both labels exist in both packs, the storefront key is mirrored by legalContent, Khmer is Khmer and the two surfaces agree', () => {
  for (const key of ['portal_legal_footer_notices', 'open_source_notices']) {
    assert.equal(typeof en[key], 'string', `en.json lacks ${key}`)
    assert.equal(typeof km[key], 'string', `km.json lacks ${key}`)
    assert.match(km[key], /[ក-៿]/, `km ${key} is not Khmer`)
    assert.notEqual(km[key], en[key])
  }
  assert.equal(en.portal_legal_footer_notices, 'Open-source notices')
  assert.equal(en.open_source_notices, en.portal_legal_footer_notices)
  assert.equal(km.open_source_notices, km.portal_legal_footer_notices)
  assert.equal(legalContent.PORTAL_LEGAL_EN.portal_legal_footer_notices, en.portal_legal_footer_notices)
  assert.equal(legalContent.PORTAL_LEGAL_KM.portal_legal_footer_notices, km.portal_legal_footer_notices)
})

runCase('the link target is a real shipped file, named by the generator, and the service worker leaves it to the network', () => {
  assert.ok(fs.existsSync(new URL('../public/THIRD_PARTY_NOTICES.txt', import.meta.url)), 'the link would 404 or fall into the SPA shell')
  const generator = fs.readFileSync(new URL('../../ops/scripts/licenses/generate-third-party-notices.mjs', import.meta.url), 'utf8')
  assert.match(generator, /OUTPUT_PATH = \['frontend', 'public', 'THIRD_PARTY_NOTICES\.txt'\]/)
  const worker = read('../src/public-runtime/service-worker.ts')
  assert.match(worker, /!\/\\\.\[a-z0-9\]\+\$\/i\.test\(path\)/, 'a path with a file extension is not treated as an app document')
})

if (failures.length) {
  console.log(`\n${failures.length} case(s) failed`)
  process.exit(1)
}
console.log('PASS open-source notices links: storefront footer and Settings, both languages')
