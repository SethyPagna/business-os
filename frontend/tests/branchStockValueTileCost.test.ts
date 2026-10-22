import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Stock value is quantity x acquisition cost. The Worker strips it for a viewer without product_cost_view
// (routes/branches.ts, test-branch-stock-value-cost-gate-pure.cjs); the page must not render a tile that would
// show "$0.00" in its place, nor keep one that, before the strip, let one searched product's cost be divided out.
const source = readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const overviewTile = [...source.matchAll(/^.*<BranchStatTile label=\{tr\('stock_value', 'Stock Value'\)\}.*$/gm)]
assert.equal(overviewTile.length, 1, 'one overview stock value tile')
assert.match(overviewTile[0][0], /\{canViewCosts \? <BranchStatTile label=\{tr\('stock_value'.*\/> : null\}/, 'overview value tile is cost-gated')

const valueTiles = [...source.matchAll(/^.*key: 'value', label: tr\('stock_value_short'.*$/gm)]
assert.equal(valueTiles.length, 1, 'one per-branch value tile')
assert.match(valueTiles[0][0], /\.\.\.\(canViewCosts \? \[\{ key: 'value'.*\}\] : \[\]\),\s*$/, 'per-branch value tile is cost-gated')

assert.match(source, /\$\{canViewCosts \? 'lg:grid-cols-6' : 'lg:grid-cols-5'\}/, 'the per-branch grid closes the gap the hidden tile leaves')
assert.match(source, /showBranchCountTile && canViewCosts \? 'sm:grid-cols-3'/, 'the overview grid closes the gap the hidden tile leaves')

console.log('PASS branch stock value tiles are cost-gated')
