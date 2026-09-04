import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// S4-21: the close guard, DRIVEN rather than pattern-matched. Every
// assertion below runs the same functions the React hook runs
// (utils/closeGuard.ts is framework-free precisely so this is possible),
// so a passing run means the sequence really behaves this way -- not that
// a JSX attribute is spelled a certain way.

const {
  applyCloseGuardEvent,
  applySaveAndClose,
  declaredWorkLabel,
  isDeclarationDirty,
  unsavedCloseOptions,
  UNSAVED_CLOSE_OPTION_SET,
} = await import('../src/utils/closeGuard.ts')
const { registerDirtyWork, getDirtyWork, isWorkDirty } = await import('../src/utils/dirtyWork.ts')
const { stableSnapshot, isDirtySince } = await import('../src/utils/formDirty.ts')

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

/** A modal stand-in: records whether it closed and whether it is prompting. */
function makeModal(declaration: unknown) {
  const state = { closed: 0, promptOpen: false }
  const dismiss = (event: 'close-requested' | 'discard-confirmed' | 'back') => applyCloseGuardEvent({
    event,
    declaration: declaration as never,
    setPromptOpen: (open: boolean) => { state.promptOpen = open },
    onClose: () => { state.closed += 1 },
  })
  return { state, dismiss }
}

await runTest('a read-only modal closes on the first dismissal, with no prompt', () => {
  const modal = makeModal('read-only')
  assert.equal(modal.dismiss('close-requested'), 'closed')
  assert.equal(modal.state.closed, 1)
  assert.equal(modal.state.promptOpen, false)
})

await runTest('a clean form closes; a dirty one prompts INSTEAD of closing', () => {
  const clean = makeModal({ dirty: false })
  assert.equal(clean.dismiss('close-requested'), 'closed')
  assert.equal(clean.state.closed, 1)

  const dirty = makeModal({ dirty: true })
  assert.equal(dirty.dismiss('close-requested'), 'prompted')
  assert.equal(dirty.state.closed, 0, 'a dirty modal must not close behind the prompt')
  assert.equal(dirty.state.promptOpen, true)
})

await runTest('Back returns to the form with nothing closed; Discard then closes', () => {
  const modal = makeModal({ dirty: true })
  modal.dismiss('close-requested')
  assert.equal(modal.dismiss('back'), 'dismissed')
  assert.equal(modal.state.promptOpen, false)
  assert.equal(modal.state.closed, 0, 'Back must keep the modal open')

  // Dismissing again re-prompts -- Back is not a one-shot suppression.
  assert.equal(modal.dismiss('close-requested'), 'prompted')
  assert.equal(modal.dismiss('discard-confirmed'), 'closed')
  assert.equal(modal.state.closed, 1)
  assert.equal(modal.state.promptOpen, false)
})

await runTest('a registry-backed modal asks utils/dirtyWork.ts, and Discard runs ITS discard hook', () => {
  let dirty = true
  let discarded = 0
  const unregister = registerDirtyWork({
    key: 'test-product-form',
    pageId: 'products',
    label: 'Product form — Dior 999',
    isDirty: () => dirty,
    discard: () => { discarded += 1 },
  })
  try {
    const declaration = { workKey: 'test-product-form' }
    assert.equal(isDeclarationDirty(declaration), true)
    assert.equal(declaredWorkLabel(declaration), 'Product form — Dior 999', 'the prompt names the work at risk')

    const modal = makeModal(declaration)
    assert.equal(modal.dismiss('close-requested'), 'prompted')
    assert.equal(discarded, 0, 'prompting must not discard anything yet')
    assert.equal(modal.dismiss('discard-confirmed'), 'closed')
    assert.equal(discarded, 1, 'Discard must run the SAME cleanup "Discard & Leave" runs')
    assert.equal(modal.state.closed, 1)

    // The registry is the single source: clearing it there clears it here.
    dirty = false
    assert.equal(isDeclarationDirty(declaration), false)
    assert.equal(makeModal(declaration).dismiss('close-requested'), 'closed')
  } finally {
    unregister()
  }
})

await runTest('a saved form does not prompt -- the classic save-then-prompt bug', () => {
  let saved = false
  const unregister = registerDirtyWork({
    key: 'test-saved-form',
    pageId: 'products',
    label: 'Saved form',
    isDirty: () => !saved,
  })
  try {
    const declaration = { workKey: 'test-saved-form' }
    assert.equal(makeModal(declaration).dismiss('close-requested'), 'prompted')
    saved = true // what a real save path latches before it calls onClose
    const afterSave = makeModal(declaration)
    assert.equal(afterSave.dismiss('close-requested'), 'closed')
    assert.equal(afterSave.state.closed, 1)
  } finally {
    unregister()
  }
})

await runTest('a NESTED modal closing never raises the PARENT form prompt', () => {
  // The real instance: the barcode camera opened from inside a product form.
  const unregister = registerDirtyWork({
    key: 'parent-product-form',
    pageId: 'products',
    label: 'Product form',
    isDirty: () => true,
    discard: () => { throw new Error('the child must never discard the parent') },
  })
  try {
    // The child declares its own 'read-only' -- it holds nothing losable.
    const child = makeModal('read-only')
    assert.equal(child.dismiss('close-requested'), 'closed', 'the camera must just close')
    assert.equal(child.state.promptOpen, false)
    // ... and the parent's work is untouched and still registered dirty.
    assert.equal(isWorkDirty('parent-product-form'), true)
    assert.equal(getDirtyWork().some((entry) => entry.key === 'parent-product-form'), true)
  } finally {
    unregister()
  }
})

await runTest('an unregistered key is not dirty -- a stale key fails open, never blocks a close', () => {
  const modal = makeModal({ workKey: 'nothing-registered-under-this' })
  assert.equal(modal.dismiss('close-requested'), 'closed')
  assert.equal(modal.state.closed, 1)
})

await runTest('the option set is TWO options, and it is one constant, not per call site', () => {
  assert.equal(UNSAVED_CLOSE_OPTION_SET, 'discard-or-back', 'the owner ruled: dismissal offers Discard/Back')
  assert.deepEqual(unsavedCloseOptions(false), ['discard', 'back'])
  assert.deepEqual(unsavedCloseOptions(true), ['discard', 'back'], 'Save is NOT offered on the dismissal path')
  // Reversing the ruling is that one constant, and the Save arm already works.
  assert.deepEqual(unsavedCloseOptions(true, 'save-discard-or-back'), ['save', 'discard', 'back'])
  assert.deepEqual(unsavedCloseOptions(false, 'save-discard-or-back'), ['discard', 'back'])
})

await runTest('the Save arm closes only on a save that really succeeded', async () => {
  let outcome: boolean | 'throw' = false
  const unregister = registerDirtyWork({
    key: 'test-savable-form',
    pageId: 'products',
    label: 'Savable form',
    isDirty: () => true,
    save: async () => { if (outcome === 'throw') throw new Error('validation'); return outcome },
  })
  try {
    const declaration = { workKey: 'test-savable-form' }
    let closed = 0
    const run = () => applySaveAndClose({
      declaration,
      setPromptOpen: () => {},
      onClose: () => { closed += 1 },
    })
    assert.equal(await run(), 'prompted', 'a refused save keeps the prompt up')
    assert.equal(closed, 0)
    outcome = 'throw'
    assert.equal(await run(), 'prompted', 'a throwing save keeps the prompt up')
    assert.equal(closed, 0)
    outcome = true
    assert.equal(await run(), 'closed')
    assert.equal(closed, 1)
  } finally {
    unregister()
  }
})

await runTest('form dirtiness ignores key order and re-typed identical values', () => {
  const baseline = stableSnapshot({ name: 'Dior', price: 12, qty: null })
  assert.equal(isDirtySince(baseline, { qty: null, price: 12, name: 'Dior' }), false, 'key order is not a change')
  assert.equal(isDirtySince(baseline, { name: 'Dior', price: 12, qty: undefined }), false, 'undefined and null agree')
  assert.equal(isDirtySince(baseline, { name: 'Dio', price: 12, qty: null }), true)
  assert.equal(isDirtySince(baseline, { name: 'Dior', price: '12', qty: null }), true, '12 and "12" are different values')
  // Restoring a field by hand reports clean again.
  assert.equal(isDirtySince(baseline, { name: 'Dior', price: 12, qty: null }), false)
})

await runTest('both language packs carry every string the prompt renders', () => {
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  const keys = ['unsaved_changes_title', 'unsaved_changes_body', 'discard_changes', 'back', 'saving', 'save_and_close']
  for (const key of keys) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    // A pack value with {braces} renders the braces literally -- tr()/t()
    // do not interpolate (progress.md, commit 3ad506ce).
    assert.doesNotMatch(en[key], /[{}]/, `${key} must not carry an un-substituted placeholder`)
    assert.doesNotMatch(km[key], /[{}]/, `${key} must not carry an un-substituted placeholder`)
    // Khmer must be Khmer, not an English placeholder.
    assert.match(km[key], /[ក-៿]/, `km.json's ${key} is not written in Khmer`)
  }
})

await runTest('every shared-Modal call site declares unsavedChanges -- no silent opt-out', () => {
  // The compiler already enforces this (the prop is required), so this
  // pins the ENFORCEMENT rather than the call sites: if the prop is ever
  // made optional, every modal silently stops guarding and nothing else
  // in the suite would notice.
  const modal = readFileSync(new URL('../src/components/shared/Modal.tsx', import.meta.url), 'utf8')
  // \r tolerated: this repo checks out CRLF (see progress.md's 1755bd6b note).
  assert.match(modal, /\n[ \t]*unsavedChanges: UnsavedChangesDeclaration\r?\n/, 'Modal.unsavedChanges must stay REQUIRED (no `?`)')
  assert.match(modal, /onClick=\{closeGuard\.requestClose\}/, 'the ✕ must go through the guard, not straight to onClose')
})

process.exit(failed ? 1 : 0)
