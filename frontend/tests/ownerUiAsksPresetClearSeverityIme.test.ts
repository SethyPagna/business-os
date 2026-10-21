// Owner 7 Oct asks #8 and #15 plus the IME Enter rule for suggestion fields.
// Run: node tests/ownerUiAsksPresetClearSeverityIme.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { activeStatsPreset, statsPresetRange, STATS_PRESETS } from '../src/components/shared/statsStripPresets.ts'
import { isImeComposingKey } from '../src/utils/imeComposition.ts'

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}
const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pack = (name: string) => JSON.parse(src(`lang/${name}.json`)) as Record<string, string>

test('#8 every preset range is recognised as a preset, a typed range is not', () => {
  for (const { id } of STATS_PRESETS) assert.equal(activeStatsPreset(statsPresetRange(id)) !== null, true, id)
  assert.equal(activeStatsPreset({ startDate: '2026-01-03', endDate: '2026-01-05', startTime: '', endTime: '' }), null)
  assert.equal(activeStatsPreset({ ...statsPresetRange('today'), startTime: '09:00' }), null)
})

test('#8 Clear is gated on "something set AND not a preset", and the close button follows the same flag', () => {
  const picker = src('components/shared/DateTimeRangePicker.tsx')
  assert.match(picker, /const showClear = hasSelection && activePreset === null/)
  assert.match(picker, /\{showClear \? \(\s*<button[^>]*\n[^]*?onClick=\{\(\) => onChange\(\{ \.\.\.EMPTY_DATE_TIME_RANGE \}, 'all'\)\}/)
  assert.doesNotMatch(picker, /\{hasSelection \? \(\s*<button/, 'Clear must not hang off hasSelection alone')
  assert.match(picker, /hover:bg-red-700 \$\{showClear \? '' : 'ml-auto'\}/)
})

test('#15 contacts severity labels exist in both packs and are real words', () => {
  const en = pack('en')
  const km = pack('km')
  const want = { duplicate_severity_phone_conflict: 'Phone conflict', duplicate_severity_exact_match: 'Exact match', duplicate_severity_name_only: 'Name only' }
  for (const [key, label] of Object.entries(want)) {
    assert.equal(en[key], label, key)
    assert.ok(km[key] && km[key] !== en[key] && /[\u1780-\u17FF]/.test(km[key]), `${key} needs Khmer`)
  }
})

test('#15 every key DuplicatesTab reads for severity resolves, and counts do not pluralise labels', () => {
  const tab = src('components/contacts/DuplicatesTab.tsx')
  const en = pack('en')
  for (const [, key] of tab.matchAll(/\['(duplicate_severity_[a-z_]+)', '/g)) assert.ok(en[key], key)
  assert.doesNotMatch(tab, /\.toLowerCase\(\)\}\{counts\.[a-z_]+ === 1/)
  assert.match(tab, /\['duplicate_severity_exact_match', 'Exact match'\]/)
  assert.match(tab, /\['duplicate_severity_name_only', 'Name only'\]/)
})

test('IME: composing Enter neither picks nor prevents default', () => {
  assert.equal(isImeComposingKey({ nativeEvent: { isComposing: true } }), true)
  assert.equal(isImeComposingKey({ nativeEvent: { keyCode: 229 } }), true)
  assert.equal(isImeComposingKey({ nativeEvent: { isComposing: false, keyCode: 13 } }), false)
  const input = src('components/shared/SuggestionTextInput.tsx')
  assert.match(input, /from '\.\.\/\.\.\/utils\/imeComposition\.ts'/)
  assert.match(input, /event\.key === 'Enter' && !isImeComposingKey\(event\) && open && cursor >= 0 && matches\[cursor\]\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*event\.preventDefault\(\)\s*pick\(matches\[cursor\]\)/)
})

if (failed) process.exit(1)
console.log('all passed')
