import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 1: NewReturnModal used to `await Promise.resolve(onSuccess?.(result))`
// before calling `onClose()` on both success paths (the normal create flow
// in handleSubmit and the V1 net-refund flow in submitNetReturn). onSuccess
// is Returns.tsx's handleReturnMutationSuccess, which fetches a snapshot of
// the created/edited return AND refetches the whole returns list before it
// resolves -- so the modal sat open, spinner-less, for a second network
// round trip after the write it cares about had already succeeded. That is
// another concrete instance of the owner's "takes a while to load okay,
// completed" PWA lag.
//
// The write already succeeded by the time onSuccess is called (it is inside
// the try block, after the create request resolved), so closing first and
// letting Returns.tsx's snapshot fetch + list refetch run in the background
// changes nothing about correctness or error handling: a failed create
// still throws before reaching onClose/onSuccess and the modal stays open
// (see the untouched catch block below each path).
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the project's existing style (see
// tests/productStockAdjustPatchNotRefetch.test.ts).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

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

const modal = readFrontend('src/components/returns/NewReturnModal.tsx')

runTest('handleSubmit closes before firing onSuccess, not after awaiting it', () => {
  assert.match(
    modal,
    /window\.dispatchEvent\(new CustomEvent\('sync:update', \{ detail: \{ channel: 'sales' \} \}\)\)\s*\n\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*onClose\(\)\s*\n\s*void Promise\.resolve\(onSuccess\?\.\(result\)\)/,
    'handleSubmit must call onClose() synchronously right after the create succeeds, then fire onSuccess without awaiting it',
  )
})

runTest('submitNetReturn closes before firing onSuccess, not after awaiting it', () => {
  assert.match(
    modal,
    /for \(const channel of \['returns', 'inventory', 'sales'\]\) window\.dispatchEvent\(new CustomEvent\('sync:update', \{ detail: \{ channel \} \}\)\)\s*\n(\s*\/\/[^\n]*\n)*\s*if \(current\(\)\) onClose\(\)\s*\n\s*void Promise\.resolve\(onSuccess\?\.\(result\)\)/,
    'submitNetReturn must call onClose() (guarded by the existing current() lifecycle check) right after the create succeeds, then fire onSuccess without awaiting it',
  )
})

runTest('neither success path still awaits onSuccess before closing', () => {
  assert.doesNotMatch(
    modal,
    /await Promise\.resolve\(onSuccess\?\.\(result\)\)\s*\n\s*onClose\(\)/,
    'no path may block onClose() on the onSuccess promise any more',
  )
  assert.doesNotMatch(
    modal,
    /await Promise\.resolve\(onSuccess\?\.\(result\)\)\s*\n\s*if \(current\(\)\) onClose\(\)/,
    'the V1 net-refund path may not block onClose() on the onSuccess promise any more',
  )
})

process.exit(failed ? 1 : 0)
