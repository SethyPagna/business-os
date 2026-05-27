import assert from 'node:assert/strict'
import {
  normalizeBrandLookup,
  parseBrandColorMap,
  waitForNextFrame,
} from '../src/components/products/helpers/productPageHelpers.mjs'

assert.deepEqual(parseBrandColorMap(''), {}, 'empty brand color map should be safe')
assert.deepEqual(parseBrandColorMap('not json'), {}, 'invalid brand color map should be safe')
assert.deepEqual(parseBrandColorMap('[]'), {}, 'array brand color map should be ignored')
assert.deepEqual(
  parseBrandColorMap('{"leang":"#123456"}'),
  { leang: '#123456' },
  'object brand color map should be parsed',
)

assert.equal(normalizeBrandLookup('  Leang   Cosmetics  '), 'leang cosmetics')
assert.equal(normalizeBrandLookup(null), '')

await waitForNextFrame()

console.log('productPageHelpers tests passed')
