import assert from 'node:assert/strict'
import {
  buildExactDuplicateIndex,
  extractDuplicateClusters,
  findRowDuplicateInfo,
  type PossiblySameCluster,
} from '../src/utils/exactDuplicateProducts.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const entry = (id: number, name: string | null, barcode: string | null) => ({
  id, name, barcode,
  cost_price_usd: 1, selling_price_usd: 2, stock_quantity: 0, image_path: null,
})

await runTest('extractDuplicateClusters tolerates both {clusters:[...]} and bare-array payloads', () => {
  const cluster: PossiblySameCluster = { type: 'barcode', value: '8850007', severity: 'same_barcode', products: [entry(1, 'x', '8850007')] }
  assert.equal(extractDuplicateClusters({ clusters: [cluster] }).length, 1)
  assert.equal(extractDuplicateClusters([cluster]).length, 1)
  // Junk shapes never throw and never leak a non-cluster through.
  assert.deepEqual(extractDuplicateClusters(null), [])
  assert.deepEqual(extractDuplicateClusters({}), [])
  assert.deepEqual(extractDuplicateClusters([{ type: 'barcode' }]), [], 'a cluster with no products array is dropped')
})

await runTest('a same_barcode cluster whose members share a name is flagged as exact', () => {
  // Two Coca-Cola rows share one real barcode + one name -> exact duplicate.
  const clusters: PossiblySameCluster[] = [
    { type: 'barcode', value: '8850007', severity: 'same_barcode', products: [entry(5, 'Coca-Cola 330ml', '8850007'), entry(9, 'coca-cola 330ML', '8850007')] },
  ]
  const index = buildExactDuplicateIndex(clusters)
  assert.equal(index.size, 2, 'both ids are indexed')
  const info = index.get(5)
  assert.ok(info)
  assert.equal(info!.barcode, '8850007')
  assert.equal(info!.members.length, 2)
  // Name normalization is case-insensitive, so the two rows land in one group.
  assert.equal(index.get(5)!.key, index.get(9)!.key)
})

await runTest('a same_barcode cluster with DIFFERENT names is NOT exact (EDP/EDT case)', () => {
  const clusters: PossiblySameCluster[] = [
    { type: 'barcode', value: '3600520', severity: 'same_barcode', products: [entry(1, 'Brand X EDP', '3600520'), entry(2, 'Brand X EDT', '3600520')] },
  ]
  const index = buildExactDuplicateIndex(clusters)
  assert.equal(index.size, 0, 'differing names never form an exact-duplicate group')
})

await runTest('a same_name cluster (differing barcodes) is never exact', () => {
  const clusters: PossiblySameCluster[] = [
    { type: 'name', value: 'Lipstick Red', severity: 'same_name', products: [entry(1, 'Lipstick Red', 'AAAA1'), entry(2, 'Lipstick Red', 'BBBB2')] },
  ]
  assert.equal(buildExactDuplicateIndex(clusters).size, 0)
})

await runTest('a partial cluster flags only the same-name subgroup', () => {
  // One barcode, three rows: two share a name, one differs. Only the pair flags.
  const clusters: PossiblySameCluster[] = [
    { type: 'barcode', value: '999888', severity: 'same_barcode', products: [entry(1, 'Widget', '999888'), entry(2, 'widget', '999888'), entry(3, 'Gadget', '999888')] },
  ]
  const index = buildExactDuplicateIndex(clusters)
  assert.equal(index.size, 2)
  assert.ok(index.has(1) && index.has(2))
  assert.ok(!index.has(3), 'the odd-name-out is not part of any exact group')
})

await runTest('findRowDuplicateInfo matches on the direct id or any merged id', () => {
  const clusters: PossiblySameCluster[] = [
    { type: 'barcode', value: '8850007', severity: 'same_barcode', products: [entry(5, 'Coke', '8850007'), entry(9, 'coke', '8850007')] },
  ]
  const index = buildExactDuplicateIndex(clusters)
  assert.ok(findRowDuplicateInfo(index, 5), 'direct id')
  // A branch-only-merged display row standing in for id 9 flags via mergedIds.
  assert.ok(findRowDuplicateInfo(index, 999, [9]), 'via merged id')
  assert.equal(findRowDuplicateInfo(index, 12345, [67890]), null, 'unrelated ids return null')
  assert.equal(findRowDuplicateInfo(new Map(), 5), null, 'an empty index short-circuits')
})

if (failed) {
  console.error(`\n${failed} exactDuplicateProducts test(s) failed`)
  process.exit(1)
}
console.log('\nAll exactDuplicateProducts tests passed')
