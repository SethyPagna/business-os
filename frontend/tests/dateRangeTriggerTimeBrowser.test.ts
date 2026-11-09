import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchResolveFixture } from './resolveBrowserFixture.ts'

// TIME-1 (owner, 4 Nov 2026): "i still see dashboard and other not showing
// time only showing date." Every page that passes `showTime` filters by hour,
// so the closed trigger must print each endpoint as date AND time on ONE line
// (owner, 15 Sep: "i want them same compact one row"), at every host and width
// the app uses, in English and Khmer. This mounts the real StatsStrip /
// StatsRangeRow / DateTimeRangePicker with the page-level props each caller
// passes, under the real main.css and reports-surface.css, in a real browser.
//
// Per host and width: both times are on the button, the date and time of one
// endpoint share a line, Start and End share a line, no endpoint paints past
// its own box (scrollWidth <= clientWidth: the trigger clips with
// overflow-hidden, so a clipped time shows up here and nowhere else), and the
// page does not scroll sideways. The no-showTime host proves the date-only
// trigger is unchanged.

const fixture = String.raw`
  import React, { useState } from 'react'
  import { createRoot } from 'react-dom/client'
  import DateTimeRangePicker from '/src/components/shared/DateTimeRangePicker.tsx'
  import StatsRangeRow from '/src/components/shared/StatsRangeRow.tsx'
  import StatsStrip from '/src/components/shared/StatsStrip.tsx'
  import { statsPresetRange } from '/src/components/shared/statsStripPresets.ts'
  import en from '/src/lang/en.json'
  import km from '/src/lang/km.json'
  import '/src/styles/main.css'
  import '/src/components/sales/reports/reports-surface.css'

  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') || 'en'
  const t = key => (lang === 'km' ? km : en)[key] || key
  document.body.className = lang === 'km' ? 'lang-km' : ''
  // A wider face than the app's own stack (iOS system fonts run wider than Segoe UI): the trigger
  // must size itself from the real text, never from a guessed number.
  if (lang === 'wide') document.body.style.fontFamily = 'Verdana, "DejaVu Sans", sans-serif'

  const icon = (w = 40) => <button type="button" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border" style={{ width: w }}>i</button>
  const statsChip = <button type="button" className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold">S {t('stats')}</button>

  function Host({ id, children }) {
    return <section data-host={id} style={{ marginBottom: 14 }}>{children}</section>
  }

  function Harness() {
    const [range, setRange] = useState(() => ({ ...statsPresetRange('today'), startDate: '2026-11-04', endDate: '2026-11-04' }))
    const [blank, setBlank] = useState({ startDate: '', endDate: '', startTime: '', endTime: '' })
    const [datesOnly, setDatesOnly] = useState({ startDate: '2026-10-01', endDate: '2026-10-19', startTime: '', endTime: '' })
    const [custom, setCustom] = useState({ startDate: '2026-10-01', endDate: '2026-10-19', startTime: '09:30', endTime: '17:45' })
    const noop = () => {}
    return <main style={{ width: '100%', padding: 12, overflowX: 'clip' }}>
      <Host id="dashboard"><StatsStrip t={t} cards={[]} range={range} onRangeChange={setRange} showTime continuous rangeActions={icon()} /></Host>
      <Host id="sales"><StatsStrip t={t} cards={[]} range={range} onRangeChange={setRange} showTime iconOnly compactRange rangeActions={<>{icon()}{icon()}</>} /></Host>
      <Host id="returns"><StatsStrip t={t} cards={[]} range={range} onRangeChange={setRange} showTime continuous showPresets iconOnly compactRange rangeActions={<>{icon(32)}{icon()}</>} /></Host>
      <Host id="returns-export"><StatsStrip t={t} cards={[]} range={range} onRangeChange={setRange} showTime continuous showPresets iconOnly compactRange rangeActions={<>{icon()}{icon(32)}{icon()}</>} /></Host>
      <Host id="fees"><StatsStrip t={t} cards={[]} range={range} onRangeChange={setRange} showTime continuous iconOnly compactRange rangeActions={icon()} actions={icon()} /></Host>
      <Host id="branches"><StatsRangeRow t={t} range={range} onRangeChange={setRange} showTime continuous leading={statsChip} /></Host>
      <Host id="plain"><StatsRangeRow t={t} range={range} onRangeChange={setRange} showTime continuous showPresets className="w-full min-w-0" /></Host>
      <Host id="scroll"><StatsRangeRow t={t} layout="scroll" compactRange range={range} onRangeChange={setRange} showTime leading={icon()} actions={icon()} /></Host>
      <Host id="custom"><StatsRangeRow t={t} range={custom} onRangeChange={setCustom} showTime continuous leading={icon()} actions={icon()} /></Host>
      <Host id="dates-only-range"><StatsRangeRow t={t} range={datesOnly} onRangeChange={setDatesOnly} showTime continuous leading={icon()} actions={icon()} /></Host>
      <Host id="blank"><StatsRangeRow t={t} range={blank} onRangeChange={setBlank} showTime leading={icon()} actions={icon()} /></Host>
      <Host id="reports-compact"><div className="reports-mobile-primary"><DateTimeRangePicker value={range} onChange={setRange} t={t} showTime continuous showQuickRanges={false} triggerClassName="reports-mobile-range flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-2" /></div></Host>
      <Host id="reports-desktop"><div style={{ display: 'flex', gap: 8 }}><div style={{ flex: '1 1 0', minWidth: 0 }}><input aria-label="Search" /></div><DateTimeRangePicker value={range} onChange={setRange} t={t} showTime continuous showQuickRanges={false} /></div></Host>
      <Host id="export-modal"><div className="flex min-w-0 flex-wrap items-center gap-2"><button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border">?</button><fieldset className="min-w-[10.5rem] flex-1"><DateTimeRangePicker value={range} onChange={setRange} t={t} showTime continuous={false} className="w-full" triggerClassName="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm" /></fieldset>{icon()}<button type="button" className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border px-3">Export</button></div></Host>
      <Host id="no-time"><StatsRangeRow t={t} range={range} onRangeChange={setRange} leading={icon()} actions={icon()} /></Host>
      <Host id="no-time-picker"><DateTimeRangePicker value={range} onChange={setRange} t={t} showTime={false} triggerClassName="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2" /></Host>
    </main>
  }
  createRoot(document.getElementById('root')).render(<Harness />)
`

type Endpoint = { text: string; date: string; time: string; clipped: boolean; oneLine: boolean; top: number; right: number; width: number; need: number; font: number }
type HostReport = { found: boolean; start: Endpoint; end: Endpoint; button: { right: number; left: number; width: number; clipped: boolean; height: number }; page: { scroll: number; client: number }; trackGap: number; rowTops: number[] }

const readHost = (host: string) => `(() => {
  const track = document.querySelector('[data-host="${host}"] [data-date-range-trigger-values]')
  if (!track) return { found: false }
  const button = track.closest('button')
  const endpoint = (node) => {
    const [date, time] = node.children
    const size = parseFloat(getComputedStyle(node).fontSize)
    const box = node.getBoundingClientRect()
    return { text: node.textContent, date: date ? date.textContent : '', time: time ? time.textContent : '', clipped: node.scrollWidth > node.clientWidth + 1,
      oneLine: box.height <= size * 1.5 && (!time || Math.abs(date.getBoundingClientRect().top - time.getBoundingClientRect().top) < 1),
      top: box.top, right: box.right, left: box.left, width: box.width, need: node.scrollWidth, font: size }
  }
  const b = button.getBoundingClientRect()
  return { found: true, start: endpoint(track.children[0]), end: endpoint(track.children[2]),
    button: { right: b.right, left: b.left, width: b.width, clipped: button.scrollWidth > button.clientWidth + 1, height: b.height },
    page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
    trackGap: parseFloat(getComputedStyle(track).columnGap) || 0,
    rowTops: [...document.querySelectorAll('[data-host="${host}"] [data-stats-range-controls] > *')].map((n) => Math.round(n.getBoundingClientRect().top)) }
})()`

// Hosts whose controls fit one row from 360px up; the rest may drop their action buttons under the dates.
const ONE_ROW_HOSTS = ['dashboard', 'sales', 'returns', 'fees', 'branches', 'plain', 'custom']
const TIMED_HOSTS = ['dashboard', 'sales', 'returns', 'returns-export', 'fees', 'branches', 'plain', 'scroll', 'custom', 'reports-compact', 'reports-desktop', 'export-modal']
const EXPECTED: Record<string, [string, string, string, string]> = {
  dashboard: ['04/11/2026', '00:00', '04/11/2026', '23:59'],
  custom: ['01/10/2026', '09:30', '19/10/2026', '17:45'],
  'dates-only-range': ['01/10/2026', '00:00', '19/10/2026', '23:59'],
}

// Collected, not thrown, so one run lists every host and width that fails.
const problems: string[] = []
const check = (ok: boolean, message: string): void => { if (!ok) problems.push(message) }

const browser = await launchResolveFixture('date-range-trigger-time', fixture)
await browser.run('PASS the closed range trigger shows date and time on one line at every host, width and language', async () => {
  const measured: Record<string, string> = {}
  const rowTops: Record<string, string> = {}
  for (const width of [320, 360, 390, 768, 1280]) for (const lang of ['en', 'km', 'wide']) {
    await browser.open(width, 'lang=' + lang, `document.querySelector('[data-host="dashboard"] [data-date-range-trigger-values]')`, 900)
    for (const host of [...TIMED_HOSTS, 'dates-only-range']) {
      const report = await browser.evaluate<HostReport>(readHost(host))
      const label = `${width}px ${lang} ${host}`
      assert.ok(report.found, `${label}: trigger rendered`)
      for (const side of [report.start, report.end]) {
        check(/^\d{2}\/\d{2}\/\d{4}$/.test(side.date), `${label}: date reads "${side.date}"`)
        check(/^\d{2}:\d{2}$/.test(side.time), `${label}: time on the button reads "${side.time}"`)
        check(!side.clipped, `${label}: the endpoint ${side.text} is clipped by its own box`)
        check(side.oneLine, `${label}: date and time of ${side.text} do not share one line`)
      }
      check(Math.round(report.start.top) === Math.round(report.end.top), `${label}: Start and End are on different rows`)
      check(!report.button.clipped, `${label}: the button clips its content`)
      // main.css gives every .grid a 12px gap below 768px; the timed track must stay tight (it is [display:grid] on purpose).
      check(report.trackGap <= 4, `${label}: the arrow track gap is ${report.trackGap}px, not the tight 2px`)
      if (host !== 'scroll') check(report.button.right <= width + 0.5 && report.button.left >= -0.5, `${label}: the button leaves the screen`)
      check(report.page.scroll === report.page.client, `${label}: the page scrolls sideways`)
      const expected = EXPECTED[host]
      if (expected) check(JSON.stringify([report.start.date, report.start.time, report.end.date, report.end.time]) === JSON.stringify(expected), `${label}: values read ${report.start.text} / ${report.end.text}`)
      if (width >= 360 && lang !== 'wide' && ONE_ROW_HOSTS.includes(host)) check(new Set(report.rowTops).size === 1, `${label}: the controls share one row (tops ${report.rowTops})`)
      measured[`${host}@${width}${lang}`] = `${Math.round(report.button.width)} ep=${Math.round(report.start.width)} need=${report.start.need} font=${report.start.font}`
      rowTops[`${host}@${width}${lang}`] = report.rowTops.join(',')
    }
    // Times are for timed surfaces only; a date-only host keeps the plain trigger.
    for (const host of ['no-time', 'no-time-picker']) {
      const report = await browser.evaluate<HostReport>(readHost(host))
      assert.ok(report.found)
      check(report.start.time === '' && report.end.time === '', `${width}px ${lang} ${host}: shows a time without showTime`)
      check(report.start.date === '04/11/2026', `${width}px ${lang} ${host}: date`)
    }
    // An empty range prints the literal format for both date and time.
    const blank = await browser.evaluate<HostReport>(readHost('blank'))
    check(JSON.stringify([blank.start.date, blank.start.time, blank.end.date, blank.end.time]) === JSON.stringify(['DD/MM/YYYY', 'HH:MM', 'DD/MM/YYYY', 'HH:MM']), `${width}px ${lang}: empty range placeholders`)
    check(!(blank.start.clipped || blank.end.clipped), `${width}px ${lang} blank range is clipped`)
    // Khmer needs its own line height wherever Khmer text is drawn on the row.
    if (lang === 'km') await browser.khmerRoom(`${width}px km Dashboard range row`, '[data-host="dashboard"]', 1)
  }
  if (process.env.TRIGGER_WIDTHS) { console.log(JSON.stringify(measured)); console.log(JSON.stringify(rowTops)) }
  assert.deepEqual(problems, [], 'every host keeps date and time on one line, unclipped')

  const shots = process.env.BUSINESS_OS_SCREENSHOTS_DIR
  if (shots) {
    fs.mkdirSync(shots, { recursive: true })
    for (const [width, height] of [[360, 740], [1280, 800]]) for (const lang of ['en', 'km']) {
      await browser.open(width, 'lang=' + lang, `document.querySelector('[data-host="dashboard"] [data-date-range-trigger-values]')`, height)
      const shot = await browser.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(shots, `fixture-hosts-${lang}-${width}x${height}.png`), Buffer.from(shot.data, 'base64'))
    }
  }
})
