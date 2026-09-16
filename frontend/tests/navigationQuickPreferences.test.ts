import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sidebar = readFileSync(new URL('../src/components/navigation/Sidebar.tsx', import.meta.url), 'utf8')
const preferences = readFileSync(new URL('../src/components/shared/QuickPreferenceToggles.tsx', import.meta.url), 'utf8')

assert.match(
  sidebar,
  /lazyRetry\(\(\) => import\('\.\.\/shared\/QuickPreferenceToggles'\)/,
  'Sidebar delegates preference behavior and icon presentation to the shared control',
)
assert.equal(
  (sidebar.match(/<QuickPreferenceToggles \/>/g) || []).length,
  2,
  'the same shared preference control is used in desktop and mobile navigation',
)
assert.match(
  sidebar,
  /function QuickPreferenceTogglesFallback[\s\S]{0,320}h-10 w-10 rounded-full bg-transparent[\s\S]{0,120}h-10 w-10 rounded-full bg-transparent/,
  'the lazy fallback reserves the 40px circular borderless footprint without flashing old button chrome',
)

assert.match(preferences, /relative flex h-10 w-10 items-center justify-center rounded-full/, 'preference hit targets stay 40px')
assert.match(preferences, /<Sun className="h-6 w-6" \/> : <Moon className="h-6 w-6" \/>/, 'theme glyphs are enlarged inside the unchanged hit target')
assert.match(preferences, /<Globe className="h-6 w-6" \/>/, 'the globe glyph is enlarged inside the unchanged hit target')
assert.match(
  preferences,
  /<span className="relative inline-flex h-6 w-6 items-center justify-center">[\s\S]*absolute -bottom-1 left-1\/2 -translate-x-1\/2[\s\S]*\{khmerActive \? 'KM' : 'EN'\}/,
  'KM/EN is anchored to the globe itself and remains an explicit readable badge',
)
assert.doesNotMatch(
  preferences,
  /relative flex h-10 w-10[^'\n]*border/,
  'preference buttons remain borderless',
)

console.log('PASS navigation quick preference presentation')
