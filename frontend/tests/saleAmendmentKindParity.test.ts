import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The amendment request shape is declared THREE times -- the transport that
// sends it, the modal that builds it, and the page that passes the callback
// down. They are structurally coupled: the page's declaration is the parameter
// type of the handler it hands to the modal, so a kind the modal can raise but
// the page has never heard of is a compile error, not a runtime one.
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
  const entries = Object.entries(sources).map(([where, source]) => [where, amendmentKinds(source, where)] as const)
  const [baseWhere, baseKinds] = entries[0]
  assert.ok(baseKinds.includes('delivery_actual_cost_changed'), 'the actual-delivery-cost amendment should be declared')
  for (const [where, kinds] of entries.slice(1)) {
    assert.deepEqual(kinds, baseKinds, `${where} should declare the same kinds as ${baseWhere}`)
  }
})

runTest('the pages that pass a delivery cost also declare the field it travels in', () => {
  for (const [where, source] of Object.entries(sources)) {
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
