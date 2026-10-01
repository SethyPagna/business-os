import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Owner, 30 Sep 2026: "make each part compact and 1 row as much as possible
// ... labels inside the input". The Branches/Inventory transfer form (the half
// of InventoryStockModals that stays) is three rows: From -> To, Received
// date + Qty, Reason + manage. No caption above any control, one Transfer
// button. Each check also runs against the pre-lane block and must refuse it.

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

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

function transferBlock(source: string): string {
  const start = source.indexOf('{transferModal ? (')
  const end = source.indexOf('<UnsavedChangesPrompt guard={transferGuard} />', start)
  return start >= 0 && end > start ? source.slice(start, end) : ''
}

// The children of the first element that contains `marker`, up to its close.
function rowContaining(block: string, marker: string): string {
  const at = block.indexOf(marker)
  if (at < 0) return ''
  const open = block.lastIndexOf('<div className="', at)
  const close = block.indexOf('\n              </div>', at)
  return open >= 0 && close > at ? block.slice(open, close) : ''
}

function branchesShareOneRow(block: string): boolean {
  const row = rowContaining(block, "ariaLabel={tr('source_branch'")
  return row.includes("ariaLabel={tr('destination_branch'") && /grid-cols-/.test(row)
}

function receivedDateIsOneSelectBesideQty(block: string): boolean {
  const row = rowContaining(block, "ariaLabel={tr('transfer_pick_batch_optional'")
  return /<AppSelect[\s\S]*ariaLabel=\{tr\('transfer_pick_batch_optional'/.test(row)
    && /type="number"/.test(row)
    && /tr\('transfer_auto_fifo', 'Automatic \(FIFO\)'\)/.test(row)
    && !/rounded-full border px-2\.5/.test(block)
}

function reasonAndManageShareOneRow(block: string): boolean {
  const row = rowContaining(block, 'id="inventory-transfer-reason"')
  return /<SuggestionTextInput/.test(row)
    && /onClick=\{\(\) => (setReasonsManagerOpen\(true\)|setReasonManager\(\{ open: true, type: 'transfer' \}\))\}/.test(row)
    && /aria-label=\{tr\('manage_reasons', 'Manage reasons'\)\}/.test(row)
    && !/<textarea/.test(block)
}

function noCaptionsOneButton(block: string): boolean {
  return !/<span className="mb-1 block/.test(block)
    && !/<label className="block">/.test(block)
    && (block.match(/className=\{`btn-/g) || []).length === 1
    && !/t\('cancel'\)/.test(block)
}

const OLD_BLOCK = `{transferModal ? (
            <fieldset disabled={transferSaving || transferPending} className={\`modal-scroll min-w-0 space-y-3 p-4\`}>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('source_branch', 'Source branch')}</span>
                <AppSelect
                  ariaLabel={tr('source_branch', 'Source branch')}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('destination_branch', 'Destination branch')}</span>
                <AppSelect
                  ariaLabel={tr('destination_branch', 'Destination branch')}
                />
              </label>
              <div>
                <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('transfer_pick_batch_optional', 'Received date (optional)')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button className={\`rounded-full border px-2.5 py-1 text-[11px] font-medium\`}>{tr('transfer_auto_fifo', 'Automatic (FIFO)')}</button>
                  </div>
              </div>
              <label className="block">
                <input className="input text-sm" type="number" min="0" step="any" />
              </label>
              <label className="block">
                  <button type="button" onClick={() => setReasonManager({ open: true, type: 'transfer' })}>
                    {tr('manage_reasons', 'Manage reasons')}
                  </button>
                <textarea className="input min-h-[84px] text-sm" />
              </label>
            </fieldset>
              <button type="button" onClick={onTransfer} className={\`btn-primary \${TOOLBAR_BUTTON_BASE} min-w-0 flex-1\`}>{tr('transfer', 'Transfer')}</button>
              <button type="button" onClick={requestCloseTransfer} className={\`btn-secondary \${TOOLBAR_BUTTON_BASE}\`}>{t('cancel') || 'Cancel'}</button>
          <UnsavedChangesPrompt guard={transferGuard} />`

const block = transferBlock(read('../src/components/inventory/InventoryStockModals.tsx'))

runTest('the checks refuse the pre-lane transfer form', () => {
  const old = transferBlock(OLD_BLOCK)
  assert.ok(old.length > 0)
  assert.equal(branchesShareOneRow(old), false)
  assert.equal(receivedDateIsOneSelectBesideQty(old), false)
  assert.equal(reasonAndManageShareOneRow(old), false)
  assert.equal(noCaptionsOneButton(old), false)
})

runTest('From and To share one row', () => {
  assert.ok(block.length > 0, 'transfer block located')
  assert.ok(branchesShareOneRow(block))
})

runTest('the received date is one select beside the quantity, Automatic (FIFO) first', () => {
  assert.ok(receivedDateIsOneSelectBesideQty(block))
})

runTest('Reason and its manage button share one row; no textarea', () => {
  assert.ok(reasonAndManageShareOneRow(block))
})

runTest('no caption above a control, and one Transfer button', () => {
  assert.ok(noCaptionsOneButton(block))
})

runTest('the source branch gets the wider column so "Branch (stock)" is not clipped at 360 px', () => {
  assert.match(block, /grid-cols-\[minmax\(0,1\.4fr\)_auto_minmax\(0,1fr\)\]/)
})

if (failed > 0) process.exitCode = 1
