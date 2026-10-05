import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createHarness, propsOf } from './mountedComponentHarness.ts'

// E4 (G39 5.1): three small per-page leaks.
//  1. Products image-only view searched on every keystroke (no debounce).
//  2. Branches re-read /api/branches/summary on a sync event of ANY channel.
//  3. Settings re-rendered its whole 2.3k-line component every second.

const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const harness = await createHarness()
const realSetTimeout = setTimeout
const pause = (ms: number) => new Promise<void>((done) => realSetTimeout(done, ms))

try {
  // 1. Image-only search: a fast typist sends one request for the final term.
  {
    const searches: string[] = []
    const app = {
      t: (key: string) => key,
      notify: () => {},
      hasPermission: () => true,
      fmtUSD: (value: unknown) => String(value),
      fmtKHR: (value: unknown) => String(value),
      lowStockConfig: { enabled: true, threshold: 5 },
      page: 'products',
    }
    const surface = await harness.mount({
      component: 'components/products/ProductsImageOnlyView.tsx',
      app,
      doubles: {
        'api/productReadTransport.ts': {
          searchProducts: async (params: { q?: string; page?: number }) => { searches.push(`${params.q ?? ''}@${params.page ?? 1}`); return { items: [], total: 0 } },
          getProductFilters: async () => ({ categories: [], brands: [] }),
        },
      },
    })
    // The view imports its read transport lazily; the first run may still be transforming it.
    await surface.waitFor(() => searches.length > 0, 'the initial image-only load')
    await surface.settle()
    assert.deepEqual(searches, ['@1'], 'one initial load')
    const input = surface.find((node) => node.getAttribute('id') === 'products-image-only-search', 'image-only search box')
    const onChange = propsOf(input).onChange as (event: unknown) => void
    for (const value of ['l', 'li', 'lip', 'lips', 'lipst', 'lipstick']) {
      // One render per keystroke, 40 ms apart -- faster than the 180 ms pause.
      await act(async () => { onChange({ target: { value } }) })
      await act(async () => { await pause(40) })
    }
    await surface.settle()
    await act(async () => { await pause(250) })
    await surface.settle()
    assert.deepEqual(searches, ['@1', 'lipstick@1'], 'six keystrokes, one search for the final term')
    await surface.unmount()
  }

  // 2. Branches summary listens to the channels its numbers come from.
  {
    const branches = read('components/branches/Branches.tsx')
    const channels = branches.match(/const BRANCH_SUMMARY_SYNC_CHANNELS = new Set\(\[([^\]]*)\]\)/)
    assert.ok(channels, 'the summary has an explicit channel list')
    const list = channels![1].split(',').map((name) => name.trim().replace(/'/g, ''))
    for (const needed of ['branches', 'products', 'inventory', 'sales', 'returns', 'settings']) assert.ok(list.includes(needed), needed)
    for (const unrelated of ['customers', 'suppliers', 'fees', 'users', 'roles', 'notifications', 'files', 'promotions']) assert.ok(!list.includes(unrelated), unrelated)
    const summaryEffect = branches.slice(branches.indexOf('void withLoaderTimeout(() => getBranchSummary()'), branches.indexOf('const [internalTab, setInternalTab]'))
    assert.match(summaryEffect, /\}, \[statsOpen, isActive, statsRefresh, tr\]\)/, 'the summary read no longer depends on every sync tick')
    assert.match(branches, /if \(syncChannel\?\.channel && BRANCH_SUMMARY_SYNC_CHANNELS\.has\(syncChannel\.channel\)\) setStatsRefresh/)
  }

  // 3. The Settings preview clock is its own component, gated on page and tab visibility.
  {
    const settings = read('components/utils-settings/Settings.tsx')
    assert.doesNotMatch(settings, /setInterval\(/, 'no raw interval in Settings')
    assert.doesNotMatch(settings, /setPreviewNow/, 'the page component no longer owns a 1 s state tick')
    assert.match(settings, /function DevicePreviewClock[\s\S]*useIsPageActive\('settings'\)[\s\S]*if \(!pageActive\) return undefined[\s\S]*startVisibleInterval\(\(\) => setNow\(new Date\(\)\), 1000\)/)
    assert.match(settings, /<DevicePreviewClock format=\{formatPreviewDateTime\} \/>/)
  }
  console.log('PASS image-only search debounced; Branches summary filtered; Settings clock contained')
} finally {
  await harness.close()
}
