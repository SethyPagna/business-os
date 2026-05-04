import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const returnsSource = readFileSync(new URL('../src/components/returns/Returns.jsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')
const km = readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')

const statsIndex = returnsSource.indexOf("tr('total_refunded'")
const searchIndex = returnsSource.indexOf('id="returns-search"')

assert.ok(statsIndex >= 0, 'Returns page should render stats cards')
assert.ok(searchIndex >= 0, 'Returns page should render search input')
assert.ok(statsIndex < searchIndex, 'Returns page should show stats before search and filters')
assert.match(returnsSource, /<Search className=/, 'Returns search should use the lucide Search icon')
assert.doesNotMatch(en, /"search_returns_placeholder":\s*"[^"]*🔍/)
assert.doesNotMatch(km, /"search_returns_placeholder":\s*"[^"]*🔍/)

console.log('PASS returns layout shows stats first and uses icon-only search')
