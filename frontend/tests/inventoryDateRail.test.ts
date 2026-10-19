import assert from 'node:assert/strict'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

const fixture = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import StatsRangeRow from '/src/components/shared/StatsRangeRow.tsx'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  const lang = new URLSearchParams(location.search).get('lang') || 'en'
  const t = key => (lang === 'km' ? km : en)[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  function Harness() {
    const [range, setRange] = useState({ startDate: '2026-10-01', endDate: '2026-10-19', startTime: '', endTime: '' })
    const [source, setSource] = useState('custom')
    return <main style={{ padding: 12, width: '100%', overflow: 'hidden' }}>
      <section data-inventory><StatsRangeRow layout="scroll" compactRange range={range} onRangeChange={(next, source) => { setRange(next); setSource(source) }} t={t} /></section>
      <input aria-label="Search" style={{ marginTop: 8 }} />
      <section data-default style={{ marginTop: 16 }}><StatsRangeRow range={range} onRangeChange={setRange} t={t} /></section>
      <output hidden>{JSON.stringify({ range, source })}</output>
    </main>
  }
  createRoot(document.getElementById('root')).render(<Harness />)
`

const browser = await launchResolveFixture('inventory-date-rail', fixture)
await browser.run('PASS Inventory date/preset rail EN/KM at 320/390/1280, selection and portaled calendar', async () => {
  for (const width of [320, 390, 1280]) for (const language of ['en', 'km']) {
    await browser.open(width, 'lang=' + language, `document.querySelector('[data-inventory] [data-date-range-trigger-values]')`, 480)
    const geometry = await browser.evaluate<any>(`(() => {
      const rail = document.querySelector('[data-inventory] [data-stats-range-controls]')
      const buttons = Array.from(document.querySelectorAll('[data-inventory] button'))
      const rects = buttons.map(button => button.getBoundingClientRect())
      return { overflow: document.documentElement.scrollWidth > innerWidth, tops: rects.map(r => r.top), heights: rects.map(r => r.height), dates: buttons[0].textContent, defaultSeparate: !document.querySelector('[data-default] [data-stats-range-controls]').contains(document.querySelector('[data-default] [data-date-presets]')) }
    })()`)
    assert.equal(geometry.overflow, false)
    assert.equal(new Set(geometry.tops).size, 1, `${width}/${language}: dates and every preset occupy one row`)
    assert.ok(geometry.heights.every((height: number) => height >= 40), 'controls retain touch height')
    assert.match(geometry.dates, /01\/10\/2026/)
    assert.match(geometry.dates, /19\/10\/2026/)
    assert.equal(geometry.defaultSeparate, true, 'existing callers retain their separate preset rail')
    await browser.evaluate(`(() => { const rail = document.querySelector('[data-inventory] [data-stats-range-controls]'); rail.scrollLeft = rail.scrollWidth })()`)
    await browser.mouseClick('[data-inventory] [data-date-presets] button:last-child')
    await browser.waitFor('last preset applies', async () => await browser.evaluate(`JSON.parse(document.querySelector('output').textContent).source === 'last_year'`) ? true : null)
    await browser.evaluate(`document.querySelector('[data-inventory] [data-stats-range-controls]').scrollLeft = 0`)
    await browser.mouseClick('[data-inventory] [data-stats-range-controls] > div > button')
    const panel = await browser.waitFor<any>('calendar escapes scrolling rail', async () => await browser.evaluate(`(() => { const panel = document.querySelector('[data-date-time-range-panel]'); if (!panel) return null; const r = panel.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, outsideRail: !document.querySelector('[data-inventory]').contains(panel) } })()`))
    assert.ok(panel.outsideRail)
    assert.ok(panel.left >= 0 && panel.right <= width && panel.top >= 0 && panel.bottom <= 480)
    await browser.press('Escape')
  }
})
