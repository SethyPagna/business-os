// Public-site redesign of the FAQ, AI assistant and About parts (owner review, 20 Oct 2026):
// one readable FAQ column with search and a contact card, an AI page that leads with the question,
// and an About card that shows the shop name once.
//
// The components are bundled and rendered for real; interactions that need a browser are exercised
// through the pure helpers (portalFaqLayout.ts) or by calling the hook-free FaqList and walking the
// element tree it returns.
//
// Run: node tests/portalFaqAiAbout.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FAQ_STARTER_TEXT, AI_FAQ_STARTER_TEXT } from '../src/components/catalog/faqStarterText.ts'
import { faqEntries, filterFaqEntries, faqSearchVisible, nextOpenFaqKey } from '../src/components/catalog/portalFaqLayout.ts'

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
const Tabs = tabsModule.default as React.ComponentType<Record<string, unknown>>
const FaqList = tabsModule.FaqList as (props: Record<string, unknown>) => React.ReactElement

const copyFor = (language: 'en' | 'km') => (_key: string, fallback = '', fallbackKm = fallback) => (language === 'km' ? fallbackKm : fallback)
const html = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(Tabs, props))

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

const makeItems = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `faq-${i + 1}`, question: `Question number ${i + 1}?`, answer: `Answer ${i + 1}` }))
const faqProps = (over: Record<string, unknown> = {}) => ({
  tab: 'faq',
  copy: copyFor('en'),
  previewConfig: { faqTitle: 'Questions' },
  publicFaqItems: makeItems(3),
  expandedFaqId: null,
  setExpandedFaqId: () => {},
  ...over,
})
const listProps = (over: Record<string, unknown> = {}) => ({
  copy: copyFor('en'),
  items: makeItems(3),
  expandedFaqId: null,
  setExpandedFaqId: () => {},
  query: '',
  setQuery: () => {},
  ...over,
})

// ---- FAQ ----------------------------------------------------------------

runTest('FAQ: answers keep their line breaks (pre-line, leading-7)', () => {
  const items = [{ id: 'a', question: 'Delivery?', answer: 'First line.\nSecond line.' }]
  const out = html(faqProps({ publicFaqItems: items, expandedFaqId: '0:a' }))
  assert.match(out, /First line\.\nSecond line\./, 'the newline survives into the markup')
  assert.match(out, /class="[^"]*whitespace-pre-line[^"]*leading-7|class="[^"]*leading-7[^"]*whitespace-pre-line/, 'the answer box renders newlines')
})

runTest('FAQ: one column, hairline rows, brass chevron, no gradient tiles or repeated FAQ label', () => {
  const out = html(faqProps({ expandedFaqId: '0:faq-1' }))
  assert.match(out, /max-w-3xl/)
  assert.match(out, /border-t border-stone-200/, 'hairline rows inside the one list surface')
  assert.match(out, /text-\[#9c7a3c\]/, 'brass chevron')
  assert.match(out, /text-\[15px\] font-semibold/, 'question is 15px semibold')
  assert.doesNotMatch(out, /data-portal-faq-columns|from-cyan|from-amber|bg-gradient-to-br|cyan-|tracking-\[0\.16em\]/)
  assert.equal((out.match(/>FAQ</g) || []).length, 0, 'no per-card FAQ label')
})

runTest('FAQ: only the clicked row is open and aria-expanded/aria-controls follow it', () => {
  const out = html(faqProps({ expandedFaqId: '1:faq-2' }))
  assert.equal((out.match(/aria-expanded="true"/g) || []).length, 1)
  assert.equal((out.match(/aria-expanded="false"/g) || []).length, 2)
  assert.equal((out.match(/aria-controls=/g) || []).length, 1, 'only the open row points at its answer')
  assert.equal((out.match(/id="portal-faq-answer-/g) || []).length, 1)
  assert.match(out, /id="portal-faq-answer-1"/)
  const entries = faqEntries(makeItems(3))
  let open: string | null = nextOpenFaqKey(null, entries[0].key)
  open = nextOpenFaqKey(open, entries[1].key)
  assert.equal(open, entries[1].key, 'opening another row closes the first')
  assert.equal(nextOpenFaqKey(open, entries[1].key), null, 'clicking the open row closes it')
})

runTest('FAQ: Khmer questions get the Khmer line box (1.8) and the Khmer font hook', () => {
  const out = html(faqProps({ copy: copyFor('km'), publicFaqItems: [{ id: 'k', question: 'តើមានដឹកជញ្ជូនទេ?', answer: 'មាន។' }] }))
  assert.match(out, /lang="km"[^>]*style="line-height:1\.8"|style="line-height:1\.8"[^>]*lang="km"/)
  assert.match(out, /khmer-text/)
})

runTest('FAQ: search appears only above 6 questions', () => {
  assert.equal(faqSearchVisible(6), false)
  assert.equal(faqSearchVisible(7), true)
  assert.doesNotMatch(html(faqProps({ publicFaqItems: makeItems(6) })), /type="search"/)
  assert.match(html(faqProps({ publicFaqItems: makeItems(7) })), /type="search"[^>]*name="portal_faq_search"|name="portal_faq_search"[^>]*type="search"/)
})

runTest('FAQ: search filters question and answer text, case-insensitively, Khmer included', () => {
  const entries = faqEntries([
    { id: 'a', question: 'Delivery to Siem Reap?', answer: 'Ask us.' },
    { id: 'b', question: 'Payment', answer: 'We take ABA and cash.' },
    { id: 'c', question: 'តើមានដឹកជញ្ជូនទេ?', answer: 'មាន។' },
  ])
  assert.deepEqual(filterFaqEntries(entries, 'SIEM').map((e) => e.item.id), ['a'])
  assert.deepEqual(filterFaqEntries(entries, 'aba').map((e) => e.item.id), ['b'])
  assert.deepEqual(filterFaqEntries(entries, 'ដឹកជញ្ជូន').map((e) => e.item.id), ['c'])
  assert.equal(filterFaqEntries(entries, '   ').length, 3, 'a blank query keeps everything')
  assert.equal(filterFaqEntries(entries, 'zzz').length, 0)
})

runTest('FAQ: no match shows the query with an icon-only Clear button; a matching query keeps the rows', () => {
  const none = renderToStaticMarkup(React.createElement(FaqList, listProps({ items: makeItems(8), query: 'zzz' }) as never) as never)
  assert.match(none, /No question matches &quot;<span translate="no" class="notranslate">zzz<\/span>&quot;/)
  assert.match(none, /aria-label="Reset search"[^>]*title="Reset search"/)
  assert.doesNotMatch(none, /Question number 1\?/)
  const some = renderToStaticMarkup(React.createElement(FaqList, listProps({ items: makeItems(8), query: 'number 3' }) as never) as never)
  assert.match(some, /Question number 3\?/)
  assert.doesNotMatch(some, /Question number 4\?/)
  assert.doesNotMatch(some, /No question matches/)
})

runTest('FAQ: loading is a 4-row skeleton; empty is a contact card', () => {
  const loading = html(faqProps({ faqLoading: true, publicFaqItems: [] }))
  assert.match(loading, /data-portal-faq-skeleton/)
  assert.equal((loading.match(/min-h-\[3\.75rem\]/g) || []).length, 4)
  const empty = html(faqProps({ publicFaqItems: [], onOpenContact: () => {} }))
  assert.match(empty, /No questions yet\./)
  assert.match(empty, />Contact</)
  assert.doesNotMatch(empty, /any time/, 'the retired promise is gone')
})

runTest('FAQ: the closing card calls the open-contact callback and is absent without one', () => {
  const withCallback = html(faqProps({ onOpenContact: () => {} }))
  assert.match(withCallback, /Still have a question\?/)
  assert.doesNotMatch(html(faqProps()), /Still have a question\?/)
  let calls = 0
  const tree = FaqList(listProps({ onOpenContact: () => { calls += 1 } }))
  const buttons: Array<{ onClick?: () => void }> = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const element = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
    if (element.type === 'button' || (typeof element.type === 'function' && element.props?.onClick)) buttons.push(element.props as { onClick?: () => void })
    if (typeof element.type === 'function' && element.type.name === 'PortalContactButton') {
      const rendered = (element.type as (p: unknown) => unknown)(element.props)
      walk(rendered)
    }
    const children = element.props?.children
    for (const child of Array.isArray(children) ? children : [children]) walk(child)
  }
  walk(tree)
  const contact = buttons.filter((button) => button.onClick).pop()
  assert.ok(contact?.onClick, 'a contact button is rendered')
  contact.onClick()
  assert.equal(calls, 1, 'clicking it opens the contact sheet')
})

// ---- Starter FAQ ---------------------------------------------------------

runTest('starter FAQ: no product name, hard-coded channels or hedges; it has the 7-day returns question', () => {
  const all = [...FAQ_STARTER_TEXT, ...AI_FAQ_STARTER_TEXT]
  for (const [index, question, answer] of all) {
    const text = `${question} ${answer}`
    assert.doesNotMatch(text, /Business OS|Leang Beauty/, `starter ${index} names the app or an old shop name`)
    assert.doesNotMatch(text, /\b(Facebook|Instagram|Telegram|WhatsApp|Messenger)\b/, `starter ${index} hard-codes a channel`)
    assert.doesNotMatch(text, /\b(may|generally|usually|typically)\b|can vary/i, `starter ${index} hedges`)
  }
  const returns = FAQ_STARTER_TEXT.find(([, question]) => /return/i.test(question))
  assert.ok(returns, 'a returns question exists')
  assert.equal(returns[2], 'Returns are accepted within 7 days for unopened items with the receipt.')
})

// ---- AI assistant --------------------------------------------------------

const aiProps = (over: Record<string, unknown> = {}) => ({
  tab: 'ai',
  copy: copyFor('en'),
  previewConfig: { aiTitle: 'Assistant', aiDisclaimer: 'AI generated.' },
  brands: [],
  assistantProfile: { brand: '', skinType: '', shoppingFor: '', goal: '', concerns: '' },
  setAssistantProfile: () => {},
  assistantCategoryOptions: [],
  assistantQuestion: '',
  setAssistantQuestion: () => {},
  questionCharLimit: 500,
  askAssistant: () => {},
  assistantLoading: false,
  clearAssistantState: () => {},
  aiUsageSummary: { activeVisitors: 7, perUserPerMinute: 3 },
  assistantRequestPolicy: { perUserPerMinute: 3 },
  replaceVars: (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_m, key) => String(values[key] ?? '')),
  assistantError: '',
  assistantResponse: null,
  assistantDisclosure: null,
  assistantDataUseConsent: false,
  setAssistantDataUseConsent: () => {},
  ...over,
})

const AssistantConsentPanel = tabsModule.AssistantConsentPanel as (props: Record<string, unknown>) => React.ReactElement
const AssistantDisclosure = tabsModule.AssistantDisclosure as (props: Record<string, unknown>) => React.ReactElement
const consentHtml = (language: 'en' | 'km', aiState: unknown = { kind: 'unknown' }) => renderToStaticMarkup(React.createElement(AssistantConsentPanel as never, { copy: copyFor(language), aiState, language, onAgree: () => {} } as never))
const disclosureHtml = (language: 'en' | 'km', aiState: unknown = { kind: 'unknown' }, over: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(AssistantDisclosure as never, { copy: copyFor(language), aiState, language, ownerDisclaimer: '', ...over } as never))

runTest('AI: example chips lead, then the box; details start closed; no checkbox, no consent panel and no counter at first paint', () => {
  const out = html(aiProps())
  assert.ok(out.indexOf('data-portal-assistant-examples') > -1 && out.indexOf('data-portal-assistant-examples') < out.indexOf('id="portal-assistant-question"'), 'four example chips sit above the box')
  assert.equal((out.match(/data-portal-assistant-examples[\s\S]*?<\/div>/)?.[0].match(/<button/g) || []).length, 4)
  assert.doesNotMatch(out, /data-portal-assistant-details|portal-assistant-brand|<details/, 'details start closed behind one button')
  assert.match(out, />Add details</)
  assert.doesNotMatch(out, /type="checkbox"/, 'no always-visible checkbox')
  assert.doesNotMatch(out, /data-portal-assistant-consent/, 'consent is asked on the first Send, not at first paint')
  assert.doesNotMatch(out, /\b0\/500\b|are using this right now|user\(s\)|search\(es\) per minute/, 'no counter until 400 characters, and the live counter is gone')
  assert.match(out, /AI suggestions, not medical advice\./, 'one line under the heading')
  assert.match(out, />Send</)
  const long = html(aiProps({ assistantQuestion: 'x'.repeat(401) }))
  assert.match(long, />401\/500</, 'the counter appears after 400 characters')
  assert.doesNotMatch(long, /data-portal-assistant-examples/, 'the chips go once the box has text')
})

runTest('AI: the consent panel is one line and one button, and Agree and send calls back', () => {
  const out = consentHtml('en')
  assert.match(out, /data-portal-assistant-consent="ask"/)
  assert.match(out, /Agree and send/)
  assert.equal((out.match(/<p /g) || []).length, 1, 'one line of text')
  let agreed = 0
  const tree = AssistantConsentPanel({ copy: copyFor('en'), aiState: { kind: 'unknown' }, language: 'en', onAgree: () => { agreed += 1 } })
  const found: Array<() => void> = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const element = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
    if (element.type === 'button' && element.props?.onClick) found.push(element.props.onClick)
    const children = element.props?.children
    for (const child of Array.isArray(children) ? children : [children]) walk(child)
  }
  walk(tree)
  assert.equal(found.length, 1)
  found[0]()
  assert.equal(agreed, 1)
})

runTest('AI: Withdraw consent is in the disclosure only while consent is given, and the disclosure is said once there', () => {
  assert.doesNotMatch(disclosureHtml('en'), /Withdraw consent/)
  const given = disclosureHtml('en', { kind: 'unknown' }, { onWithdraw: () => {} })
  assert.match(given, />Withdraw consent</)
  assert.equal((given.match(/automated software/g) || []).length, 1)
  assert.doesNotMatch(html(aiProps({ assistantDataUseConsent: true })), /Withdraw consent|automated software/, 'nothing of the disclosure is printed on the page itself')
})

runTest('AI: copy says deleted after 30 days, never "may", never Leang Beauty or a hard-coded channel', () => {
  for (const language of ['en', 'km'] as const) {
    const all = html(aiProps({ copy: copyFor(language) })) + consentHtml(language) + disclosureHtml(language)
    assert.doesNotMatch(all, /Leang Beauty|\bmay\b|about 30 days/)
    assert.doesNotMatch(all, /Facebook|Instagram|Telegram/)
  }
  // The cross-border and 30-day facts are stated plainly in the consent line and in the full disclosure, in both languages.
  for (const language of ['en', 'km'] as const) {
    const consent = consentHtml(language)
    const note = disclosureHtml(language)
    const outside = language === 'en' ? /outside Cambodia/ : /ក្រៅប្រទេសកម្ពុជា/
    const days = language === 'en' ? /deleted after 30 days/ : /លុបចោលបន្ទាប់ពី ៣០ ?ថ្ងៃ/
    for (const [label, part] of [['consent line', consent], ['full disclosure', note]] as const) {
      assert.match(part, outside, `${label} states outside-Cambodia processing (${language})`)
      assert.match(part, days, `${label} states the 30-day deletion (${language})`)
    }
    assert.match(note, language === 'en' ? /automated software[\s\S]*not medical advice/ : /កម្មវិធីស្វ័យប្រវត្តិ[\s\S]*មិនមែនជាការណែនាំវេជ្ជសាស្ត្រ/)
  }
  // The per-provider wording is locked in portalAiProviderDisclosure.test.ts; here only that the placeholders are always filled.
  const acme = { kind: 'named', providers: [{ id: 'acme', displayName: 'Acme AI', policyUrl: 'https://example.test', retention: { en: 'Acme AI keeps nothing.', km: 'Acme AI' } }] }
  assert.doesNotMatch(consentHtml('en', acme) + disclosureHtml('en', acme), /\{provider/, 'the provider placeholders are filled')
  assert.match(consentHtml('en', acme), /third-party AI provider \(Acme AI\) outside Cambodia\./)
  assert.match(disclosureHtml('en', acme), /third-party AI provider \(Acme AI\) that processes it outside Cambodia\. Acme AI keeps nothing\./)
})

runTest('AI: the error box is solid, has a dark style and is announced', () => {
  const out = html(aiProps({ assistantError: 'Try again later.' }))
  assert.match(out, /role="alert"[^>]*dark:border-rose-500[^>]*dark:bg-neutral-900[^>]*dark:text-rose-300|dark:text-rose-300[^>]*role="alert"/)
})

runTest('AI: a recommendation is one compact row: image, name, stock badge, Add; the name and picture open the sheet when the page provides it', () => {
  const response = { summary: 'Match.', recommendations: [{ product_id: 7, name: 'Daily Sunscreen', brand: 'Acme', category: 'Sun care', reason: 'fits oily skin', fit_summary: 'light texture', stock_status: 'in_stock' }] }
  const linked = html(aiProps({ assistantResponse: response, openProductById: () => {} }))
  assert.match(linked, /<button[^>]*aria-label="View product: Daily Sunscreen"/)
  assert.match(linked, /<button[^>]*translate="no"[^>]*>Daily Sunscreen<\/button>/, 'the name is a button that opens the sheet')
  assert.match(linked, /light texture/, 'the reason is shown without expanding')
  assert.match(linked, /In Stock/, 'the stock badge')
  assert.doesNotMatch(linked, />Add</, 'without the wiring prop there is no Add button')
  const plain = html(aiProps({ assistantResponse: response }))
  assert.doesNotMatch(plain, /View product/, 'without the callback the card is plain text')
  assert.match(plain, /Daily Sunscreen/)
  let added: unknown = null
  const withAdd = html(aiProps({ assistantResponse: response, openProductById: () => {}, onAddRecommendation: (item: unknown) => { added = item } }))
  assert.match(withAdd, />Add</)
  assert.equal(added, null, 'nothing is added by rendering')
  const out = html(aiProps({ assistantResponse: { ...response, recommendations: [{ ...response.recommendations[0], stock_status: 'out_of_stock' }] }, onAddRecommendation: () => {} }))
  assert.match(out, /disabled=""[^>]*>[\s\S]*?Add</, 'an out-of-stock product cannot be added')
  assert.match(out, /Out of Stock/)
})

// ---- About ---------------------------------------------------------------

const aboutProps = (over: Record<string, unknown> = {}, config: Record<string, unknown> = {}) => ({
  tab: 'about',
  copy: copyFor('en'),
  previewConfig: { businessName: 'Leang Cosmetics', title: 'Leang Cosmetics', businessTagline: 'Beauty in Phnom Penh', showLogo: false, aboutTitle: 'About', aboutContent: 'Our story.', ...config },
  openPortalImage: () => {},
  businessFacts: [{ key: 'phone', label: 'Phone', value: '+855 12 345 678', href: 'tel:+855 12 345 678' }],
  socialLinks: [],
  ...over,
})

runTest('About: the shop name is printed once, with no About pill above it', () => {
  const out = html(aboutProps())
  const visible = out.replace(/<img[^>]*>/g, '')
  assert.equal((visible.match(/Leang Cosmetics/g) || []).length, 1, 'the name appears once in visible text')
  assert.doesNotMatch(out, /uppercase tracking-\[0\.2em\]/, 'the About pill is gone')
  const different = html(aboutProps({}, { businessName: 'Leang Cosmetics', title: 'Leang Beauty Hub' })).replace(/<img[^>]*>/g, '')
  assert.equal((different.match(/Leang/g) || []).length, 1, 'a different title never prints a second name')
})

runTest('About: the Leang icon replaces initials when no logo is shown', () => {
  const out = html(aboutProps())
  assert.match(out, /src="\/leang-cosmetics-icon-512-v2\.png"/)
  assert.doesNotMatch(out, />LE</, 'no initials')
})

runTest('About: the phone link is a clean tel: link', () => {
  const out = html(aboutProps())
  assert.match(out, /href="tel:\+85512345678"/)
  assert.doesNotMatch(out, /href="tel:\+855 12/)
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nportalFaqAiAbout: all green')
