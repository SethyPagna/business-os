import assert from 'node:assert/strict'
import {
  barcodeKeysMatch,
  barcodeSearchKeys,
  buildHaystackIndex,
  compressUpcA,
  expandUpcE,
  matchesSearchTermGroups,
  searchRelevanceTier,
} from '../src/utils/searchMatch.ts'

assert.equal(barcodeKeysMatch('03614274226546', '3614274226546'), true)
assert.equal(barcodeKeysMatch('1234', '12345'), false)
assert.equal(barcodeKeysMatch('0', ''), false)
assert.equal(expandUpcE('01234565'), '012345000065')
assert.equal(compressUpcA('012345000065'), '01234565')
assert.equal(barcodeKeysMatch('01234565', '012345000065'), true)
assert.equal(barcodeKeysMatch('01234565', '1234565'), false, 'derived UPC keys never leak into padding keys')
assert.ok(barcodeSearchKeys('01234565').includes('upca:012345000065'))
assert.equal(searchRelevanceTier({ name: 'Small package', barcode: '012345000065' }, '01234565'), 0)
assert.equal(matchesSearchTermGroups(['Small package', '012345000065'], ['01234565']), true)
assert.equal(matchesSearchTermGroups(['01234565'], ['1234565']), false, 'fuzzy fallback must preserve the seven-digit collision guard')
assert.equal(matchesSearchTermGroups(['1234565'], ['01234565']), false, 'collision guard is symmetric')
assert.ok(buildHaystackIndex(['Small package', '012345000065']).barcodeKeys.includes('upce:01234565'))

console.log('barcodeLeadingZeroScan: all checks passed')
