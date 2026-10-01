import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const packs = Object.fromEntries(['en','km'].map(language => [language, JSON.parse(readFileSync(new URL('../src/lang/' + language + '.json', import.meta.url), 'utf8'))]))
const fixture = String.raw`
  import React from 'react'
  import { createRoot } from 'react-dom/client'
  import { AppContext, FALLBACK_APP_CONTEXT } from '/src/app/AppContextCore.tsx'
  import ExportModal from '/src/components/sales/ExportModal.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '@fontsource/noto-sans-khmer/400.css'
  import '/src/styles/main.css'
  const language = new URLSearchParams(location.search).get('lang') || 'en'
  const t = key => (language === 'km' ? km : en)[key] || key
  document.body.className = language === 'km' ? 'lang-km' : ''
  window.__calls = []
  window.api = { getSalesExport: async (query) => {
    window.__calls.push(query)
    if (query.detailsOnly) return { sales: [{ receipt_number: query.afterId ? 'SALE-2' : 'SALE-1', name:'Toner' }], snapshot_max_id:91, has_more: !query.afterId, next_cursor: {created_at:'2026-09-08 00:00:00',id:1} }
    return { period: {start:query.startDate,end:query.endDate}, summary: {net_revenue_usd:12} }
  } }
  HTMLAnchorElement.prototype.click = function () { window.__download = this.download }
  const value = { ...FALLBACK_APP_CONTEXT, t, language }
  createRoot(document.getElementById('root')).render(React.createElement(AppContext.Provider, { value }, React.createElement(ExportModal, {t,fmtUSD:value => '$' + value,onClose() {}})))
`
const browser = await launchResolveFixture('sales-export-hours', fixture)
const screenshotDir = process.env.SALES_EXPORT_SCREENSHOT_DIR
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true })
const screenshot = async (name: string): Promise<void> => {
  if (!screenshotDir) return
  const result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(screenshotDir, name + '.png'), Buffer.from(result.data, 'base64'))
}
await browser.run('PASS Sales export shared picker, recurring hours and every request at360/1280 EN/KM', async () => {
  for (const width of [360,1280]) {
    for (const language of ['en','km']) {
      const pack = packs[language]
      await browser.open(width,'lang=' + language, `document.querySelector('button[aria-label=${JSON.stringify(pack.date_time_range)}]')`,800)
      const trigger = 'button[aria-label=' + JSON.stringify(pack.date_time_range) + ']'
      assert.match(await browser.evaluate(`document.querySelector('[data-date-range-trigger-values]').textContent`),/\d{2}\/\d{2}\/\d{4}/)
      await browser.mouseClick(trigger)
      await browser.waitFor('shared panel opens',async () => await browser.evaluate(`Boolean(document.querySelector('[data-date-time-range-panel]'))`) ? true : null)
      for (const [label,time] of [[pack.start_time,'22:00'],[pack.end_time,'02:00']]) {
        await browser.evaluate(`(() => { const input=document.querySelector('input[aria-label='+${JSON.stringify(JSON.stringify(label))}+']'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(time)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
        await browser.press('Tab')
        await browser.pause(40)
      }
      await screenshot(`sales-export-picker-${width}-${language}`)
      await browser.mouseClick('[data-date-time-range-panel] button[aria-label=' + JSON.stringify(pack.close) + ']')
      await screenshot(`sales-export-range-${width}-${language}`)
      await browser.evaluate(`(() => { for (const [label,marker] of [[${JSON.stringify(pack.preview_summary)},'data-export-preview'],[${JSON.stringify(pack.export_csv_btn)},'data-export-csv']]) { [...document.querySelectorAll('button')].find(button => button.textContent.trim()===label).setAttribute(marker,'true') } })()`)
      await browser.mouseClick('[data-export-preview]')
      await browser.waitFor('preview request resolves',async () => await browser.evaluate('window.__calls.length===1') ? true : null)
      await browser.waitFor('preview loading clears',async () => await browser.evaluate(`!document.querySelector('[data-export-csv]').disabled`) ? true : null)
      await browser.mouseClick('[data-export-csv]')
      await browser.waitFor('all CSV pages downloaded',async () => await browser.evaluate('Boolean(window.__download)') ? true : null)
      const calls = await browser.evaluate<Array<Record<string,string>>>('window.__calls')
      assert.equal(calls.length,3)
      for (const call of calls) assert.deepEqual([call.startTime,call.endTime],['22:00','02:00'])
      assert.equal(calls[2].snapshotMaxId,'91')
      assert.equal(calls[2].afterId,'1')
      assert.equal(await browser.evaluate('document.scrollingElement.scrollWidth>innerWidth+1'),false)
    }
  }
})
