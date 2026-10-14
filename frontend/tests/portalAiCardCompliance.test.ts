// G7 / G21 (compliance review, 13 Oct 2026): the storefront AI card must not present model-written
// "How to use", "Caution" or "Ingredients focus" as product facts, and must follow the portal
// showPrices setting exactly like the catalog cards do.
//
// The card is rendered for real, fed a response shaped like the OLD Worker's (label-fact fields and
// a price on every recommendation): the screen has to stay clean even when the payload is not.
//
// Run: node tests/portalAiCardCompliance.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

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

const CatalogSecondaryTabs = loadModule('components/catalog/CatalogSecondaryTabs.tsx').default as React.ComponentType<Record<string, unknown>>

const LABEL_FACTS = {
  how_to_use: 'Apply twice daily to the whole face.',
  cautions: 'Safe for pregnancy and children.',
  ingredients_focus: ['niacinamide', 'zinc oxide'],
}

function renderCard(previewConfig: Record<string, unknown>, recommendation: Record<string, unknown>, language: 'en' | 'km' = 'en'): string {
  return renderToStaticMarkup(React.createElement(CatalogSecondaryTabs, {
    tab: 'ai',
    copy: (_key: string, fallback = '', fallbackKm = fallback) => (language === 'km' ? fallbackKm : fallback),
    previewConfig: { aiTitle: 'Assistant', aiDisclaimer: 'AI generated.', ...previewConfig },
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
    aiUsageSummary: null,
    assistantRequestPolicy: null,
    replaceVars: (template: string) => template,
    assistantError: '',
    assistantResponse: {
      summary: 'Here is a match.',
      recommendations: [{ product_id: 7, name: 'Daily Sunscreen', brand: 'Acme', category: 'Sun care', ...recommendation }],
    },
    assistantExpandedProductId: 7,
    setAssistantExpandedProductId: () => {},
    assistantDisclosure: null,
    assistantDataUseConsent: false,
    setAssistantDataUseConsent: () => {},
  }))
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

const recommendation = { reason: 'fits oily skin', fit_summary: 'light texture', selling_price_usd: 1234.56, selling_price_khr: 5061696, ...LABEL_FACTS }

runTest('positive control: the expanded card shows why the product matches', () => {
  const html = renderCard({ showPrices: true, priceDisplay: 'USD' }, recommendation)
  assert.match(html, /Daily Sunscreen/)
  assert.match(html, /light texture/, 'the expanded body renders fit_summary')
})

runTest('model-written how-to-use, caution and ingredients text is never rendered, even when the payload carries it', () => {
  for (const language of ['en', 'km'] as const) {
    const html = renderCard({ showPrices: true, priceDisplay: 'USD' }, recommendation, language)
    assert.ok(!html.includes(LABEL_FACTS.how_to_use), 'how_to_use text must not render')
    assert.ok(!html.includes(LABEL_FACTS.cautions), 'cautions text must not render')
    assert.ok(!html.includes('niacinamide') && !html.includes('zinc oxide'), 'ingredients_focus text must not render')
    assert.ok(!/How to use|Ingredients focus|>Caution</.test(html), 'no label-fact heading renders')
  }
})

runTest('prices hidden: no price anywhere in the card, in USD or KHR mode', () => {
  for (const priceDisplay of ['USD', 'KHR', 'BOTH']) {
    for (const showPrices of [false, undefined]) {
      const html = renderCard({ showPrices, priceDisplay }, recommendation)
      assert.ok(!html.includes('1234.56') && !html.includes('1,234.56'), `no USD figure (priceDisplay=${priceDisplay}, showPrices=${String(showPrices)})`)
      assert.ok(!html.includes('5,061,696') && !html.includes('5061696'), `no KHR figure (priceDisplay=${priceDisplay}, showPrices=${String(showPrices)})`)
      assert.ok(!html.includes('$1234') && !html.includes('៛'), 'no currency marker either')
    }
  }
})

runTest('prices shown: the card prices follow the display currency', () => {
  assert.match(renderCard({ showPrices: true, priceDisplay: 'USD' }, recommendation), /\$1234\.56/)
  assert.match(renderCard({ showPrices: true, priceDisplay: 'KHR' }, recommendation), /5,061,696៛/)
})

runTest('prices on but the payload carries none (flag flipped mid-visit, or an old bundle against the new Worker): no price, never $0.00 or 0៛', () => {
  const unpriced = { reason: 'fits oily skin', fit_summary: 'light texture' }
  for (const priceDisplay of ['USD', 'KHR', 'BOTH']) {
    const html = renderCard({ showPrices: true, priceDisplay }, unpriced)
    assert.match(html, /Daily Sunscreen/)
    assert.ok(!html.includes('$0') && !html.includes('0៛') && !html.includes('NaN'), `no invented price (priceDisplay=${priceDisplay})`)
    assert.ok(!html.includes(' | '), 'no empty price separator')
  }
  const wrongCurrency = renderCard({ showPrices: true, priceDisplay: 'KHR' }, { reason: 'x', selling_price_usd: 12.5 })
  assert.ok(!wrongCurrency.includes('0៛') && !wrongCurrency.includes('12.50'), 'KHR mode with only a USD figure shows nothing')
  const garbage = renderCard({ showPrices: true, priceDisplay: 'USD' }, { reason: 'x', selling_price_usd: 'abc' })
  assert.ok(!garbage.includes('NaN') && !garbage.includes('$0'), 'a non-numeric price shows nothing')
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nportalAiCardCompliance: all green')
