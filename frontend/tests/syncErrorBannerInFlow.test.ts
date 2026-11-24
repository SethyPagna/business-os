import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Owner, 24 Nov 2026: "the page is being blocked by top bar etc". The red write-error bar was `fixed` at top-16 (md:top-14)
// over the first row of every page until dismissed. It now sits in the flow of <main> beside D1LimitBanner and
// ReadBudgetBanner, so the page starts below it. Dismiss, "View details" (permission-gated) and presentWriteError stay.

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const bannerFn = (source: string): string => {
  const start = source.indexOf('function SyncErrorBanner(')
  assert.ok(start > 0, 'SyncErrorBanner is defined')
  return source.slice(start, source.indexOf('\n}\n', start))
}
const rootClass = (fn: string): string => {
  const match = fn.match(/return \(\s*<div className="([^"]*)"/)
  assert.ok(match, 'the banner has a root div with a literal class')
  return match[1]
}
const mainBlock = (source: string): string => {
  const start = source.indexOf('<main\n')
  assert.ok(start > 0, '<main> found')
  return source.slice(start, source.indexOf('</main>', start))
}

runTest('the bar is not positioned over the page: no fixed, no top offset', () => {
  const cls = rootClass(bannerFn(app)).split(/\s+/)
  assert.equal(cls.includes('fixed'), false, 'not fixed')
  assert.equal(cls.some((c) => /^(md:)?top-/.test(c)), false, 'no top offset')
  assert.ok(cls.includes('relative'), 'relative so its z-index still holds')
  assert.ok(cls.includes('shrink-0'), 'a flex child that is never squeezed')
  assert.ok(cls.includes('z-[200]'))
})

runTest('the bar is rendered inside <main>, right after the two other in-flow banners, and nowhere else', () => {
  const main = mainBlock(app)
  assert.match(main, /<ReadBudgetBanner \/>\s*<SyncErrorBanner\b/, 'after ReadBudgetBanner')
  assert.equal((app.match(/<SyncErrorBanner\b/g) ?? []).length, 1, 'one render site')
  assert.equal((main.match(/<SyncErrorBanner\b/g) ?? []).length, 1, 'inside <main>')
})

runTest('what the bar offered is intact: dismiss, permission-gated details, the shared wording', () => {
  const fn = bannerFn(app)
  assert.match(fn, /presentWriteError\(error, t\)/)
  assert.match(fn, /const canViewDetails = canAccessPage\('server'\)/)
  assert.match(fn, /canViewDetails \? \(\s*<button onClick=\{onGoToServer\}/)
  assert.match(fn, /onClick=\{onDismiss\}/)
  assert.match(fn, /aria-label=\{t\('close'\)/)
  assert.match(app, /onDismiss=\{clearSyncError\}/)
  assert.match(app, /clearSyncError\(\)\s*navigateTo\('server'\)/)
})

runTest('the phone <main> keeps its padding under the fixed header', () => {
  const main = mainBlock(app)
  assert.match(main, /mobileHeaderVisible \? \(appUpdate \? 'pt-16' : 'pt-\[calc\(4rem\+env\(safe-area-inset-top\)\)\]'\)/)
})

runTest('mutant: the old fixed class is caught', () => {
  const mutated = app.replace(/(function SyncErrorBanner[\s\S]*?return \(\s*<div className=")[^"]*"/, '$1fixed left-0 right-0 top-16 z-[200] bg-red-600 text-white px-4 py-2.5 flex items-start gap-3 shadow-lg md:top-14"')
  assert.ok(rootClass(bannerFn(mutated)).split(/\s+/).includes('fixed'), 'the mutant is the old class, which the first test rejects')
})

runTest('mutant: moving the render back outside <main> is caught', () => {
  const mutated = app.replace(/<ReadBudgetBanner \/>\s*<SyncErrorBanner\b/, '<ReadBudgetBanner />\n<SyncErrorBannerX')
  assert.doesNotMatch(mainBlock(mutated), /<ReadBudgetBanner \/>\s*<SyncErrorBanner\b/)
})

if (failed > 0) { console.error(`${failed} failed`); process.exit(1) }
console.log('syncErrorBannerInFlow: all passed')
