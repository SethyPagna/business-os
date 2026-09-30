// Owner, 30 Sep 2026: where the policies are shown, a short line says they were updated on
// 30 Sep 2026, in English and Khmer. Rendered from the real footer + reader, one page at a time.
//
// Run: node tests/portalLegalUpdatedNotice.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'
import { LEGAL_PAGE_ORDER, PORTAL_LEGAL_EN, PORTAL_LEGAL_KM } from '../src/components/catalog/legal/legalContent.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '..', 'src')
const EXPECTED = {
  en: 'We updated our privacy policy and terms on 30/09/2026.',
  km: 'យើងបានធ្វើបច្ចុប្បន្នភាពគោលការណ៍ឯកជនភាព និងលក្ខខណ្ឌប្រើប្រាស់ នៅ 30/09/2026។',
}
const KEY = 'portal_legal_updated_notice'

const packs = Object.fromEntries(['en', 'km'].map((name) => [name, JSON.parse(fs.readFileSync(path.join(SRC, 'lang', `${name}.json`), 'utf8')) as Record<string, unknown>]))
assert.ok(PORTAL_LEGAL_EN[KEY] && PORTAL_LEGAL_KM[KEY], `${KEY} is declared in both languages`)
for (const name of ['en', 'km'] as const) {
  const keys = Object.keys(packs[name])
  assert.equal(keys[keys.indexOf('portal_legal_last_updated') + 1], KEY, `${name}.json keeps ${KEY} right after its sibling portal_legal_last_updated`)
}

const bundle = buildSync({
  entryPoints: [path.join(SRC, 'components/catalog/legal/LegalPages.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
const moduleObj = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), moduleObj, moduleObj.exports)
const PortalFooter = moduleObj.exports.default as React.ComponentType<Record<string, unknown>>

const visible = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const globals = globalThis as unknown as { window?: unknown }
for (const language of ['en', 'km'] as const) {
  const copy = (key: string, fallback = '', fallbackKm = fallback) => resolveStorefrontCopy(language, (k: string) => k, key, fallback, fallbackKm)
  const footerOnly = renderToStaticMarkup(React.createElement(PortalFooter, { copy, businessName: 'Leang Beauty' }))
  assert.ok(!visible(footerOnly).includes(EXPECTED[language]), `the ${language} footer alone does not repeat the notice`)
  for (const page of LEGAL_PAGE_ORDER) {
    globals.window = { location: { search: `?legal=${page}`, pathname: '/' } }
    try {
      const html = renderToStaticMarkup(React.createElement(PortalFooter, { copy, businessName: 'Leang Beauty' }))
      const notices = [...html.matchAll(/<p\b[^>]*data-portal-legal-updated="true"[^>]*>([\s\S]*?)<\/p>/g)]
      assert.equal(notices.length, 1, `the ${language} ${page} page shows the update line once`)
      assert.equal(visible(notices[0][1]), EXPECTED[language], `the ${language} ${page} update line reads exactly "${EXPECTED[language]}"`)
      assert.match(notices[0][0], /leading-6/, `the ${language} ${page} update line has room for Khmer glyphs`)
      assert.match(html, /<p\b[^>]*data-portal-legal-last-updated="true"[^>]*leading-6/, `the ${language} ${page} "Last updated" line has room for Khmer glyphs`)
      const text = visible(html)
      const lastUpdated = text.indexOf(language === 'en' ? 'Last updated 30/09/2026' : 'ធ្វើបច្ចុប្បន្នភាពចុងក្រោយ 30/09/2026')
      assert.ok(lastUpdated >= 0 && text.indexOf(EXPECTED[language]) > lastUpdated, `the ${language} ${page} update line sits under "Last updated"`)
    } finally {
      delete globals.window
    }
  }
}

console.log(`PASS portalLegalUpdatedNotice: "${EXPECTED.en}" / "${EXPECTED.km}" on all ${LEGAL_PAGE_ORDER.length} policy pages in both languages`)
