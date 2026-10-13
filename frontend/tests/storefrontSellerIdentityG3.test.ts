// Compliance review, 13 Oct 2026: G3 (seller identity on the website).
//
//   - the footer's content-concerns line falls back to Telegram, then phone, when no e-mail is set
//   - the Website Editor warns (without blocking) while legal name, address or e-mail is empty
//
// Run: node tests/storefrontSellerIdentityG3.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(FRONTEND, 'src')
const requireActual = createRequire(import.meta.url)
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n')
const readPack = (name: string) => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', name), 'utf8')) as Record<string, string>

function loadModule(relative: string) {
  const bundle = buildSync({
    entryPoints: [path.join(SRC, relative)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom'],
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
  })
  const module = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(requireActual, module, module.exports)
  return module.exports
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

// Footer: content-concerns line when no e-mail is set

const PortalFooter = loadModule('components/catalog/legal/LegalPages.tsx').default as React.ComponentType<Record<string, unknown>>
const footer = (props: Record<string, unknown>, language: 'en' | 'km' = 'en') => renderToStaticMarkup(React.createElement(PortalFooter, {
  copy: (_key: string, fallback = '', fallbackKm = fallback) => (language === 'km' ? fallbackKm : fallback),
  businessName: 'Leang Cosmetics',
  ...props,
}))
const TELEGRAM = { key: 'telegram', label: 'Telegram', value: 'https://t.me/leangcosmetics' }
const CONCERNS_EN = /If something on this site is about you, or you are concerned about an image/
const CONCERNS_KM = /បើមានខ្លឹមសារអំពីអ្នក ឬអ្នកបារម្ភអំពីរូបភាពណាមួយ/

runTest('with an e-mail the concerns line names the e-mail, as before', () => {
  const html = footer({ email: 'hello@example.com', phone: '012 345 678', socialLinks: [TELEGRAM] })
  assert.match(html, CONCERNS_EN)
  assert.match(html, /contact hello@example\.com\./)
  assert.doesNotMatch(html, /contact us on/, 'the fallback wording is not used while an e-mail exists')
})

runTest('without an e-mail the concerns line points to the Telegram link, then the phone', () => {
  const viaTelegram = footer({ phone: '012 345 678', socialLinks: [TELEGRAM] })
  assert.match(viaTelegram, CONCERNS_EN)
  assert.match(viaTelegram, /contact us on <a [^>]*href="https:\/\/t\.me\/leangcosmetics"[^>]*><span[^>]*>Telegram<\/span><\/a>\./)
  assert.doesNotMatch(viaTelegram, /\{contact\}/)

  const viaPhone = footer({ phone: '012 345 678', socialLinks: [] })
  assert.match(viaPhone, CONCERNS_EN)
  assert.match(viaPhone, /contact us on <a [^>]*href="tel:012345678"[^>]*>012 345 678<\/a>\./)

  const phoneNotDialable = footer({ phone: 'ask at the till', socialLinks: [] })
  assert.match(phoneNotDialable, /contact us on ask at the till\./, 'a phone value that cannot make a tel: link is still printed')
})

runTest('the Khmer storefront gets the Khmer sentence', () => {
  const html = footer({ phone: '012 345 678', socialLinks: [TELEGRAM] }, 'km')
  assert.match(html, CONCERNS_KM)
  assert.match(html, /សូមទាក់ទងយើងតាម <a [^>]*href="https:\/\/t\.me\/leangcosmetics"/)
})

runTest('with no e-mail, no Telegram and no phone the line stays hidden', () => {
  const html = footer({ address: '136 St 215, Phnom Penh', socialLinks: [{ key: 'facebook', label: 'Facebook', value: 'https://facebook.com/leang' }] })
  assert.doesNotMatch(html, CONCERNS_EN)
  assert.doesNotMatch(html, /contact us on/)
})

runTest('the fallback sentence is in both packs with the same placeholder as the call site', () => {
  const en = readPack('en.json')
  const km = readPack('km.json')
  assert.match(en.portalFooterConcernsContact, /\{contact\}/)
  assert.match(km.portalFooterConcernsContact, /\{contact\}/)
  assert.match(km.portalFooterConcernsContact, /[ក-៿]/)
  const legal = read('components', 'catalog', 'legal', 'LegalPages.tsx')
  assert.equal(en.portalFooterConcernsContact, /const CONCERNS_CONTACT_EN = '([^']+)'/.exec(legal)?.[1])
  assert.equal(km.portalFooterConcernsContact, /const CONCERNS_CONTACT_KM = '([^']+)'/.exec(legal)?.[1])
})

// ---------------------------------------------------------------------------
// G3: Website Editor warning
// ---------------------------------------------------------------------------

runTest('the editor warns when legal name, address or e-mail is empty, and never blocks', () => {
  const source = read('components', 'catalog', 'CatalogEditorSurface.tsx')
  const expression = /const sellerIdentityGap = (.+)$/m.exec(source)?.[1] ?? ''
  assert.ok(expression, 'sellerIdentityGap must exist')
  const gap = (draft: Record<string, unknown>) => new Function('editorDraft', `return ${expression}`)(draft) as boolean
  const full = { business_legal_name: 'Leang Cosmetics Co., Ltd.', business_address: '136 St 215, Phnom Penh', business_email: 'shop@example.com' }
  assert.equal(gap(full), false, 'nothing to warn about once all three are filled')
  assert.equal(gap({ ...full, business_legal_name: '' }), true)
  assert.equal(gap({ ...full, business_address: '   ' }), true)
  assert.equal(gap({ ...full, business_email: undefined }), true)
  assert.equal(gap({ ...full, business_registration_number: '', business_phone: '' }), false, 'registration number and phone are not part of the identity line')

  assert.match(source, /\{sellerIdentityGap \? \(\s*<span data-testid="portal-seller-identity-warning"[\s\S]*?copy\(\s*'portalSellerIdentityWarning'/, 'the warning renders inline in the existing status box')
  assert.equal((source.match(/sellerIdentityGap/g) || []).length, 2, 'sellerIdentityGap feeds the message only: no disabled state, no save guard')
  const en = readPack('en.json')
  const km = readPack('km.json')
  assert.ok(en.portalSellerIdentityWarning && km.portalSellerIdentityWarning)
  assert.match(km.portalSellerIdentityWarning, /[ក-៿]/)
  assert.match(source, new RegExp(en.portalSellerIdentityWarning.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the call-site fallback matches the pack')
})

runTest('the Website Editor preview footer gets the same social links as the live storefront, so the preview shows what visitors see', () => {
  for (const file of ['CatalogPage.tsx', 'PublicCatalogPage.tsx']) {
    const source = read('components', 'catalog', file)
    const footers = source.match(/<PortalFooter\b[^\n]*\/>/g) || []
    assert.equal(footers.length, 1, `${file} renders exactly one PortalFooter`)
    assert.match(footers[0], /\bsocialLinks=\{socialLinks\}/, `${file}: the footer must receive socialLinks (the Telegram fallback of the concerns line depends on it)`)
    assert.match(footers[0], /email={displayConfig.businessEmail}/)
  }
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nstorefrontSellerIdentityG3: all green')
