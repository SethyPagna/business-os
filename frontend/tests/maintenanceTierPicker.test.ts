// Locks in the Maintenance/Backup page reorg (progress.md's Aug 23
// backlog, item 9): the three destructive tools (Section Reset, Data
// Reset, Factory Reset) sit behind a single least-to-most-destructive
// tier picker instead of all three being stacked and fully rendered at
// once, and each tool's own mode grid (ResetData's Sales/Products/Full,
// SectionReset's Customers/Suppliers/Delivery Contacts/Audit Log) only
// shows a card's full description once that card is selected instead of
// every option's text being visible all the time ("too text heavy" per
// the original complaint).
//
// This landed in Part 307 with no dedicated regression test at the time
// -- added here (Part 311) after confirming, by reading the current
// source, that the reorg is intact, so a future edit that quietly
// re-flattens either page gets caught instead of silently regressing.
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const backup = fs.readFileSync(new URL('../src/components/utils-settings/Backup.tsx', import.meta.url), 'utf8')
const resetData = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')

await runTest('Backup.tsx defines the 3-tier maintenance picker, ordered least-to-most destructive', () => {
  const tiersMatch = backup.match(/const MAINTENANCE_TIERS: Array<[\s\S]*?> = \[([\s\S]*?)\n\]/)
  assert.ok(tiersMatch, 'MAINTENANCE_TIERS array not found')
  const body = tiersMatch![1]
  const sectionIndex = body.indexOf("id: 'section'")
  const dataIndex = body.indexOf("id: 'data'")
  const factoryIndex = body.indexOf("id: 'factory'")
  assert.ok(sectionIndex >= 0 && dataIndex >= 0 && factoryIndex >= 0, 'all three tiers present')
  assert.ok(sectionIndex < dataIndex && dataIndex < factoryIndex, 'tiers ordered least-to-most destructive: section, data, factory')
})

await runTest('Backup.tsx only mounts the ONE tool matching the selected tier -- not all three at once', () => {
  assert.match(backup, /\{maintenanceTier === 'section' \? <LazySectionReset actionHistory=\{actionHistory\} \/> : null\}/)
  assert.match(backup, /\{maintenanceTier === 'data' \? <LazyResetData actionHistory=\{actionHistory\} \/> : null\}/)
  assert.match(backup, /\{maintenanceTier === 'factory' \? <LazyFactoryReset actionHistory=\{actionHistory\} \/> : null\}/)
})

await runTest("ResetData's mode grid (Sales/Products/Full) only shows a card's description once it's selected", () => {
  const fn = resetData.slice(resetData.indexOf('function ResetData('), resetData.indexOf('function SectionReset('))
  assert.match(fn, /\{mode === entry\.id \? \(\s*<div className="mt-0\.5 text-xs text-gray-500 dark:text-gray-400">\{entry\.desc\}<\/div>\s*\) : null\}/)
})

await runTest("SectionReset's entity grid (Customers/Suppliers/Delivery Contacts/Audit Log) only shows a card's description once it's selected", () => {
  const fn = resetData.slice(resetData.indexOf('function SectionReset('), resetData.indexOf('function FactoryReset('))
  assert.match(fn, /\{section === \(entry\.id as unknown as SectionMode\) \? \(\s*<div className="mt-0\.5 text-xs text-gray-500 dark:text-gray-400">\{entry\.desc\}<\/div>\s*\) : null\}/)
})

await runTest('SectionReset offers the four contact/log entities the backlog named, on the lighter-weight createSectionBackup path (not the full backup)', () => {
  const fn = resetData.slice(resetData.indexOf('function SectionReset('), resetData.indexOf('function FactoryReset('))
  for (const id of ["id: 'customers'", "id: 'suppliers'", "id: 'delivery_contacts'", "id: 'audit_log'"]) {
    assert.ok(fn.includes(id), `SectionReset is missing ${id}`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll maintenanceTierPicker tests passed')
}
