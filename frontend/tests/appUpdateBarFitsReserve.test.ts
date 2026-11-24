import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APP_UPDATE_BAR_HEIGHT_REM } from '../src/utils/mobileNavChrome.ts'

// Owner, 24 Nov 2026: the update bar was 8 + 36 + 8 = 52 px tall in a 48 px reserve (#app-root padding, APP_UPDATE_BAR_HEIGHT_REM),
// so its last 4 px lay over the header, the sidebar and the page's first row. Its own padding plus its tallest child
// (the dismiss button) must equal the reserve exactly.

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const REM_PER_UNIT = 0.25
function barRem(source: string): { padding: number; button: number; minHeight: number } {
  const start = source.indexOf('function AppUpdateBanner(')
  const fn = source.slice(start, source.indexOf('\n}\n', start))
  const root = fn.match(/role="alert"[\s\S]*?className="([^"]*)"/)
  assert.ok(root, 'the bar root class')
  const cls = root[1].split(/\s+/)
  const pb = cls.find((c) => /^pb-[\d.]+$/.test(c))
  const pt = cls.find((c) => /^pt-\[calc\([\d.]+rem\+env\(safe-area-inset-top\)\)\]$/.test(c))
  const min = cls.find((c) => /^min-h-\[calc\([\d.]+rem\+env\(safe-area-inset-top\)\)\]$/.test(c))
  assert.ok(pb && pt && min, 'pb, pt and min-h are literal')
  const button = fn.match(/aria-label=\{t\('dismiss_notification'\)[\s\S]*?className="[^"]*\bh-(\d+)\b/)
  assert.ok(button, 'the dismiss button height')
  return {
    padding: Number(pb.slice(3)) * REM_PER_UNIT + Number((pt.match(/calc\(([\d.]+)rem/) as RegExpMatchArray)[1]),
    button: Number(button[1]) * REM_PER_UNIT,
    minHeight: Number((min.match(/calc\(([\d.]+)rem/) as RegExpMatchArray)[1]),
  }
}

runTest('padding + dismiss button equals the 3rem the shell reserves, so the bar is exactly as tall as its reserve', () => {
  const { padding, button, minHeight } = barRem(app)
  assert.equal(APP_UPDATE_BAR_HEIGHT_REM, 3)
  assert.equal(minHeight, APP_UPDATE_BAR_HEIGHT_REM, 'min-h is the reserve')
  assert.equal(padding + button, APP_UPDATE_BAR_HEIGHT_REM, `${padding}rem padding + ${button}rem button`)
})

const restartButtonClass = (source: string): string[] => {
  const match = source.match(/className="([^"]*)"\n\s*>\n\s*\{restarting/)
  assert.ok(match, 'the restart button class')
  return match[1].split(/\s+/)
}

runTest('the restart button has a fixed height no taller than the dismiss button (Khmer line height cannot stretch the bar)', () => {
  const cls = restartButtonClass(app)
  assert.ok(cls.includes('h-9'), 'h-9')
  assert.equal(cls.some((c) => /^py-/.test(c)), false, 'no vertical padding that adds to a line height')
})

runTest('mutant: the restart button sized by padding and line height again is caught', () => {
  const mutated = app.replace('className="h-9 rounded-lg bg-white px-3 text-sm', 'className="rounded-lg bg-white px-3 py-1.5 text-sm')
  assert.equal(restartButtonClass(mutated).includes('h-9'), false)
})

runTest('the shell still reserves the same 3rem', () => {
  assert.match(app, /appUpdate \? 'pt-\[calc\(3rem\+env\(safe-area-inset-top\)\)\]'/)
})

runTest('mutant: the old 0.5rem padding is caught', () => {
  const mutated = app.replace('pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))]', 'pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]')
  const { padding, button } = barRem(mutated)
  assert.notEqual(padding + button, APP_UPDATE_BAR_HEIGHT_REM)
})

runTest('mutant: a taller dismiss button is caught', () => {
  const mutated = app.replace('flex h-9 w-9 items-center justify-center rounded-full text-xl', 'flex h-12 w-12 items-center justify-center rounded-full text-xl')
  const { padding, button } = barRem(mutated)
  assert.notEqual(padding + button, APP_UPDATE_BAR_HEIGHT_REM)
})

if (failed > 0) { console.error(`${failed} failed`); process.exit(1) }
console.log('appUpdateBarFitsReserve: all passed')
