// The privacy policy, the assistant's consent line and its automated note name the AI provider that
// is actually behind the assistant and state that provider's own data handling (owner, 20 Oct 2026).
// Which provider is runtime data, so the storefront reads it from GET /ai/status and every sentence
// comes from one map (legal/aiProviderDisclosure.ts).
//
// Run: node tests/portalAiProviderDisclosure.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AI_PROVIDER_DISCLOSURE,
  aiProviderNames,
  aiProviderRetention,
  aiProviderState,
  fillAiProviderTemplate,
  type AiProviderState,
} from '../src/components/catalog/legal/aiProviderDisclosure.ts'
import { legalText } from '../src/components/catalog/legal/legalContent.ts'

const SRC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src')
const requireActual = createRequire(import.meta.url)

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

const tabsModule = loadModule('components/catalog/CatalogSecondaryTabs.tsx')
const Consent = tabsModule.AssistantConsentPanel as React.ComponentType<Record<string, unknown>>
const Disclosure = tabsModule.AssistantDisclosure as React.ComponentType<Record<string, unknown>>
const Paragraphs = loadModule('components/catalog/legal/LegalPages.tsx').AiProviderParagraphs as React.ComponentType<Record<string, unknown>>

type Lang = 'en' | 'km'
const copyFor = (language: Lang) => (_key: string, fallback = '', fallbackKm = fallback) => (language === 'km' ? fallbackKm : fallback)
const KHMER = /[ក-៿]/
const ids = ['groq', 'mistral', 'cerebras', 'google']

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

const stateOf = (status: AiProviderState | null): AiProviderState => status || { kind: 'unknown' }
const consentOf = (language: Lang, status: AiProviderState | null) => renderToStaticMarkup(React.createElement(Consent, { copy: copyFor(language), aiState: stateOf(status), language, onAgree: () => {} }))
const noteOf = (language: Lang, status: AiProviderState | null) => renderToStaticMarkup(React.createElement(Disclosure, { copy: copyFor(language), aiState: stateOf(status), language, ownerDisclaimer: '' }))

// The protected facts sit in translate="no" spans; the visible text is what these checks compare.
const plain = (html: string) => html.replace(/<\/?span\b[^>]*>/g, '')
const policyHtml = (language: Lang, status: unknown) => {
  const text = (key: string) => legalText(language, key)
  return renderToStaticMarkup(React.createElement(Paragraphs, {
    body: 'portal_legal_privacy_ai_b',
    state: aiProviderState(status),
    text,
    fill: text,
    pick: (en: string, km: string) => (language === 'km' ? km : en),
  }))
}

runTest('the map covers every callable chat provider, in both languages, with plain copy and an https policy URL', () => {
  assert.deepEqual(Object.keys(AI_PROVIDER_DISCLOSURE).sort(), [...ids].sort())
  for (const [id, entry] of Object.entries(AI_PROVIDER_DISCLOSURE)) {
    assert.match(entry.policyUrl, /^https:\/\//, `${id} policy URL`)
    assert.ok(entry.displayName.length > 0)
    assert.doesNotMatch(entry.retention.en, /\b(?:may|about|generally|all)\b/i, `${id} EN copy is hedged`)
    assert.ok(entry.retention.en.includes(entry.displayName.split(' ')[0]), `${id} EN sentence names the provider`)
    assert.ok(KHMER.test(entry.retention.km), `${id} KM sentence is Khmer`)
    assert.notEqual(entry.retention.km, entry.retention.en)
  }
  assert.match(AI_PROVIDER_DISCLOSURE.mistral.retention.en, /30 rolling days/)
  assert.match(AI_PROVIDER_DISCLOSURE.mistral.retention.km, /៣០ ថ្ងៃ/)
  assert.match(AI_PROVIDER_DISCLOSURE.cerebras.retention.en, /does not retain[^.]*does not use them to train/)
  assert.match(AI_PROVIDER_DISCLOSURE.google.retention.en, /paid tier[^.]*does not use them[^.]*free tier it does/)
  assert.match(AI_PROVIDER_DISCLOSURE.groq.retention.en, /Services Agreement and Data Processing Addendum/)
})

runTest('the status answer decides what the page may say', () => {
  assert.deepEqual(aiProviderState(null), { kind: 'unknown' })
  assert.deepEqual(aiProviderState({}), { kind: 'unknown' }, 'an answer without a list says nothing')
  assert.deepEqual(aiProviderState({ providers: 'groq' }), { kind: 'unknown' })
  assert.deepEqual(aiProviderState({ providers: [] }), { kind: 'off' })
  assert.deepEqual(aiProviderState({ providers: [{ id: 'other', name: '' }] }), { kind: 'unknown' })
  assert.deepEqual(aiProviderState({ providers: [{ id: 'groq' }, { id: 'someone-new' }] }), { kind: 'unknown' }, 'naming part of the list would understate it')
  assert.deepEqual(aiProviderState({ providers: [{ id: 'constructor' }] }), { kind: 'unknown' }, 'prototype keys are not providers')
  const named = aiProviderState({ providers: [{ id: 'groq' }, { id: 'groq' }, { id: 'google' }] })
  assert.equal(named.kind, 'named')
  assert.equal(aiProviderNames(named, 'en'), 'Groq and Google AI')
  assert.equal(aiProviderNames(named, 'km'), 'Groq និង Google AI')
  assert.equal(aiProviderNames(aiProviderState({ providers: ids.map((id) => ({ id })) }), 'en'), 'Groq, Mistral AI, Cerebras and Google AI')
})

for (const language of ['en', 'km'] as const) {
  for (const id of ids) {
    runTest(`consent line names ${id}; the full disclosure names ${id} and its retention (${language})`, () => {
      const state = aiProviderState({ providers: [{ id, name: 'x' }] })
      const entry = AI_PROVIDER_DISCLOSURE[id]
      const consent = consentOf(language, state)
      const note = noteOf(language, state)
      assert.ok(consent && note, 'both render')
      // The one-line consent names the provider; the provider's own retention sentence is in the full disclosure behind the info icon.
      assert.ok(consent.includes(`(${entry.displayName})`), `${id} is named in the consent line`)
      assert.ok(note.includes(`(${entry.displayName})`), `${id} is named in the disclosure`)
      assert.ok(note.includes(entry.retention[language].replace(/&/g, '&amp;')), `${id} retention sentence is in the disclosure`)
      for (const part of [consent, note]) {
        assert.doesNotMatch(part, /\{provider|\{retention/, 'no placeholder is left')
        assert.doesNotMatch(part, /\bmay\b/i)
      }
      // The outside-Cambodia statement and our own 30-day statement stay in both.
      for (const part of [consent, note]) {
        assert.match(part, language === 'en' ? /outside Cambodia/ : /ក្រៅប្រទេសកម្ពុជា/)
        assert.match(part, language === 'en' ? /deleted after 30 days/ : /លុបចោលបន្ទាប់ពី ៣០ ?ថ្ងៃ/)
      }
    })
  }

  runTest(`unknown or missing provider gives the neutral consent and disclosure (${language})`, () => {
    for (const status of [null, {}, { providers: [{ id: 'someone-new' }] }, { providers: [] }]) {
      const state = status === null ? null : aiProviderState(status)
      const joined = consentOf(language, state) + noteOf(language, state)
      assert.match(joined, language === 'en' ? /third-party AI provider outside Cambodia|third-party AI provider that processes it outside Cambodia/ : /អ្នកផ្តល់សេវា AI ភាគីទីបី/)
      for (const entry of Object.values(AI_PROVIDER_DISCLOSURE)) assert.ok(!joined.includes(entry.displayName), 'no provider is named')
      assert.doesNotMatch(joined, /\(\)|\{provider/)
    }
  })

  for (const id of ids) {
    runTest(`privacy policy names ${id}, its retention and its terms link (${language})`, () => {
      const html = policyHtml(language, { providers: [{ id }] })
      const entry = AI_PROVIDER_DISCLOSURE[id]
      // The protected facts (provider names, numbers with their unit) sit in translate="no" spans; the visible text is unchanged.
      const visible = html.replace(/<\/?span\b[^>]*>/g, '')
      assert.ok(visible.includes(entry.displayName))
      assert.ok(html.includes(`<span translate="no" class="notranslate">${entry.displayName}</span>`), 'the provider name is not translated')
      assert.ok(visible.includes(entry.retention[language].replace(/&/g, '&amp;')))
      assert.ok(html.includes(`href="${entry.policyUrl}"`))
      assert.match(html, /rel="noopener noreferrer"/)
      assert.match(visible, language === 'en' ? /processed outside Cambodia/ : /ដំណើរការក្រៅប្រទេសកម្ពុជា/)
      assert.match(visible, language === 'en' ? /We delete our own copy after 30 days/ : /យើងលុបច្បាប់ចម្លងរបស់យើងផ្ទាល់បន្ទាប់ពី ៣០ ថ្ងៃ/)
    })
  }

  runTest(`privacy policy: neutral when unknown, "no AI provider" when the assistant is off (${language})`, () => {
    const neutral = policyHtml(language, null)
    assert.equal(neutral, policyHtml(language, { providers: [{ id: 'someone-new' }] }))
    assert.ok(plain(neutral).includes(legalText(language, 'portal_legal_privacy_ai_b')))
    for (const entry of Object.values(AI_PROVIDER_DISCLOSURE)) assert.ok(!neutral.includes(entry.displayName))
    const off = policyHtml(language, { providers: [] })
    assert.ok(plain(off).includes(legalText(language, 'portal_legal_privacy_ai_off')))
    assert.doesNotMatch(off, /outside Cambodia|ក្រៅប្រទេសកម្ពុជា/, 'nothing is processed when no provider is in use')
  })
}

runTest('several providers are all named and all described, since the chat fails over between them', () => {
  const html = policyHtml('en', { providers: ids.map((id) => ({ id })) })
  for (const id of ids) assert.ok(html.includes(`data-portal-ai-provider="${id}"`), `${id} paragraph`)
  assert.ok(plain(html).includes('Groq, Mistral AI, Cerebras and Google AI'))
  for (const name of ['Groq', 'Mistral AI', 'Cerebras', 'Google AI']) assert.ok(html.includes(`<span translate="no" class="notranslate">${name}</span>`), `${name} is not translated`)
})

runTest('template fill leaves neither a placeholder nor stray spacing in the neutral case', () => {
  const tpl = 'sent to a third-party AI provider{providerNames} and processed.{providerRetention} Done.'
  assert.equal(fillAiProviderTemplate(tpl, { kind: 'unknown' }, 'en'), 'sent to a third-party AI provider and processed. Done.')
  const named = aiProviderState({ providers: [{ id: 'cerebras' }] })
  assert.equal(aiProviderRetention(named, 'en'), AI_PROVIDER_DISCLOSURE.cerebras.retention.en)
  assert.ok(fillAiProviderTemplate(tpl, named, 'en').includes('(Cerebras) and processed. Cerebras does not retain'))
})

runTest('the real privacy page renders the assistant section (neutral until the status answers), in both languages', () => {
  const Footer = loadModule('components/catalog/legal/LegalPages.tsx').default as React.ComponentType<Record<string, unknown>>
  const globals = globalThis as unknown as { window?: unknown }
  for (const language of ['en', 'km'] as const) {
    globals.window = { location: { search: '?legal=privacy', pathname: '/' } }
    try {
      const html = renderToStaticMarkup(React.createElement(Footer, { copy: copyFor(language), businessName: 'Leang Cosmetics' }))
      assert.ok(html.includes(legalText(language, 'portal_legal_privacy_ai_h')), 'the assistant heading renders')
      assert.ok(plain(html).includes(legalText(language, 'portal_legal_privacy_ai_b')), 'the neutral assistant sentence renders first')
      assert.ok(!html.includes('data-portal-ai-provider'))
    } finally {
      delete globals.window
    }
  }
})

runTest('sources: both surfaces read the one map, and the stale fixed wording is gone', () => {
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')
  const secondary = read('components/catalog/CatalogSecondaryTabs.tsx')
  const pages = read('components/catalog/legal/LegalPages.tsx')
  assert.match(secondary, /from '\.\/legal\/aiProviderDisclosure\.ts'/)
  assert.match(pages, /from '\.\/aiProviderDisclosure\.ts'/)
  assert.match(pages, /if \(activePage !== 'privacy'[^\n]*\n[\s\S]{0,260}getPortalAiStatus/, 'the policy reads the provider only when the privacy page is open')
  assert.match(pages, /aiState=\{aiState\} pick=\{pick\}/, 'the reader is handed the provider state')
  assert.doesNotMatch(secondary, /assistantDisclosure\?\.provider/)
  assert.match(read('components/catalog/PublicCatalogPage.tsx'), /setAssistantDisclosure\(aiProviderState\(result\)\)/)
})

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nPASS portalAiProviderDisclosure')
