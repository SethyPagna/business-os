import assert from 'node:assert/strict'
import { logicalAssetDisplayName, logicalAssetDownloadPath, logicalAssetKey } from '../src/components/files/libraryLogicalRows.ts'

const shared = { id: 7, logical_id: '7:product:22', logical_name: 'Soft Rose_1.webp', original_name: 'upload.webp', referenceProduct: { id: 22, name: 'Soft Rose' } }
assert.equal(logicalAssetKey(shared), '7:product:22')
assert.equal(logicalAssetDisplayName(shared), 'Soft Rose_1.webp')
assert.equal(logicalAssetDownloadPath(shared), '/api/files/7/download?name=Soft%20Rose_1.webp')

const physical = { id: 7, original_name: 'upload.webp' }
assert.equal(logicalAssetKey(physical), '7:asset')
assert.equal(logicalAssetDisplayName(physical), 'upload.webp')
assert.equal(logicalAssetDownloadPath(physical), '/api/files/7/download?name=upload.webp')

console.log('PASS Library logical rows keep independent selection keys and download one physical object under the chosen product name')
