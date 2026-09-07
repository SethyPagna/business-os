import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The transport owns the shared amendment request shape. The modal still has
// a compatible local construction shape, while Sales imports the transport
// contract for the callback it passes down. Pin both arrangements so a new
// amendment kind cannot leave either caller behind.
//
// 4e58891f added 'delivery_actual_cost_changed' to the transport and the modal
// and left the page behind, and the whole package stopped typechecking. Only
// tsc catches that -- and tsc says it about Sales.tsx line 2105, nowhere near
// the union that is actually short. This pin says it where the fix belongs.
//
// Discriminating: it compares the three unions as SETS. Any one of the three
// gaining or losing a kind on its own fails; adding the same kind to all three
// passes. On the pre-fix tree it is red on Sales.tsx.

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const sources: Record<string, string> = {
  'api/salesTransport.ts': readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8'),
  'components/sales/SaleDetailModal.tsx': readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8'),
  'components/sales/Sales.tsx': readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8'),
}

function amendmentKinds(source: string, where: string): string[] {
  const match = /interface SaleAmendmentRequest \{\r?\n\s*kind: ([^\r\n]+)/.exec(source)
  assert.ok(match, `${where} should declare interface SaleAmendmentRequest with a kind union`)
  return (match as RegExpExecArray)[1]
    .split('|')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort()
}

runTest('every SaleAmendmentRequest declaration knows the same amendment kinds', () => {
  const declarationSources = Object.entries(sources).filter(([where]) => where !== 'components/sales/Sales.tsx')
  const entries = declarationSources.map(([where, source]) => [where, amendmentKinds(source, where)] as const)
  const [baseWhere, baseKinds] = entries[0]
  assert.ok(baseKinds.includes('delivery_actual_cost_changed'), 'the actual-delivery-cost amendment should be declared')
  assert.ok(baseKinds.includes('delivery_added'), 'the counter-to-delivery amendment should be declared')
  for (const [where, kinds] of entries.slice(1)) {
    assert.deepEqual(kinds, baseKinds, `${where} should declare the same kinds as ${baseWhere}`)
  }
})

runTest('delivery addition carries the selected driver and uses the sales-scoped picker', () => {
  const modal = sources['components/sales/SaleDetailModal.tsx']
  const transport = sources['api/salesTransport.ts']
  assert.match(transport, /delivery_contact_id\?: number/, 'the reviewed request must carry the selected driver id')
  assert.match(transport, /getSaleDeliveryOptions[\s\S]*?\/api\/sales\/delivery-options/, 'the picker must use the sales-scoped read')
  assert.match(modal, /kind: 'delivery_added'[\s\S]*?delivery_contact_id: deliveryContact\.id/, 'the one confirm submits the selected driver')
  assert.match(modal, /onChange=\{\(event\) => \{ setDeliverySearch\(event\.target\.value\); setDeliveryContact\(null\) \}\}/,
    'changing search must clear a now-hidden driver selection')
  assert.match(modal, /!toNumber\(sale\.is_delivery\) && canAmendThisSale/,
    'the add control must follow the authoritative delivery flag even if a legacy contact snapshot exists')
})

runTest('Sales imports and uses the canonical transport request type', () => {
  const sales = sources['components/sales/Sales.tsx']
  assert.match(sales, /type SaleAmendmentRequest \} from '\.\.\/\.\.\/api\/salesTransport\.ts'/)
  assert.doesNotMatch(sales, /interface SaleAmendmentRequest/)
  assert.match(sales, /request: SaleAmendmentRequest/)
})

runTest('the pages that pass a delivery cost also declare the field it travels in', () => {
  for (const [where, source] of Object.entries(sources).filter(([where]) => where !== 'components/sales/Sales.tsx')) {
    const body = /interface SaleAmendmentRequest \{[\s\S]*?\n\}/.exec(source)
    assert.ok(body, `${where} should declare interface SaleAmendmentRequest`)
    assert.match((body as RegExpExecArray)[0], /delivery_actual_cost_usd\?:/, `${where} should carry delivery_actual_cost_usd`)
  }
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll sale amendment kind parity tests passed')
