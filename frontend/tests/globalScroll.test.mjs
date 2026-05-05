import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/shared/globalScroll.js', import.meta.url), 'utf8')

assert.match(
  source,
  /querySelectorAll\('\.page-scroll'\)/,
  'Global scroll controls should inspect every page-scroll container, not just the first one in the DOM',
)

assert.match(
  source,
  /style\?\.display === 'none' \|\| style\?\.visibility === 'hidden'/,
  'Global scroll controls should skip hidden page containers when multiple pages stay mounted',
)

assert.match(
  source,
  /node\.getClientRects\?\.\(\)\.length > 0/,
  'Global scroll controls should target the visible mounted page',
)

console.log('PASS global scroll controls target the visible page container')
