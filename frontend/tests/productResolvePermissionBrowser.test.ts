import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import ResolveModal from '/src/components/shared/ResolveModal.tsx'
  import { createProductResolveAdapter } from '/src/components/products/productResolveAdapter.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'
  const params = new URLSearchParams(location.search)
  const language = params.get('lang') || 'en'
  const t = (key) => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  const editable = params.get('edit') === 'true'
  const products = [1,2].map(id => ({ id, name: 'Toner ' + id, brand: 'Brand ' + id, category: 'Skin ' + id, unit: 'unit ' + id, barcode: String(id), selling_price_usd: id, wholesale_price_usd: id, cost_price_usd: id, stock_quantity: 0, image_path: null }))
  const cluster = { type: 'name', severity: 'same_name', value: 'Toner', products }
  const adapter = createProductResolveAdapter({ cluster, t, canEditProducts: editable, canViewCosts: false, canEditCosts: false, canMerge: () => true, api: {
    preview: async () => ({ choicesSupported: true, groupProducts: products, reviewedDigest: 'a'.repeat(64), stockImpact: { totalQuantity: 0, branches: [] }, keeperStock: { totalQuantity: 0, branches: [] } }),
    merge: async () => ({ keeper: products[0] }),
  } })
  const value = { ...FALLBACK_APP_CONTEXT, t, language }
  createRoot(document.getElementById('root')).render(React.createElement(AppContext.Provider, { value }, React.createElement(ResolveModal, { title: t('resolve'), adapter, onClose() {} })))
`
const browser = await launchResolveFixture('resolve-permission-browser', fixture)
await browser.run('PASS Resolve product-edit UI permission at 360/1280 EN/KM', async () => {
  for (const width of [360, 1280]) {
    for (const language of ['en', 'km']) {
      for (const editable of [false, true]) {
        await browser.open(width, 'lang=' + language + '&edit=' + editable, `document.querySelector('[data-rg-key="name|#final"]')`, 800)
        const flags = await browser.evaluate(`['name','brand','category','unit','selling','wholesale'].map(key => document.querySelector('[data-rg-key="' + key + '|#final"]').getAttribute('data-clickable'))`)
        assert.deepEqual(flags, Array(6).fill(editable ? 'true' : null))
        await browser.mouseClick('[data-rg-key="name|#final"]')
        if (editable) await browser.waitFor('custom editor opens', async () => await browser.evaluate(`Boolean(document.querySelector('[data-rg-editor]'))`) ? true : null)
        else await browser.pause(350)
        assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-rg-editor]'))`), editable)
        if (editable) await browser.press('Escape')
        await browser.mouseClick('[data-rg-key="name|2"]')
        await browser.waitFor('source choice changes Final', async () => await browser.evaluate(`document.querySelector('[data-rg-key="name|#final"]').textContent.includes('Toner 2')`) ? true : null)
        assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth > innerWidth + 1'), false)
      }
    }
  }
})
