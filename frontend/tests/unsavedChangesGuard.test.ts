import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

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

// ---------------------------------------------------------------------------
// The parity sweep. Everything above drives the guard's behaviour; this last
// pair enumerates the app MECHANICALLY, so "we fixed the ones we thought of"
// cannot pass. A modal built on shared/Modal.tsx is forced to declare by the
// compiler (the prop is required). A modal that builds its own `fixed
// inset-0` chrome has no such forcing function -- this is it.
//
// Adding a hand-rolled overlay now costs one of two things: wire the guard,
// or write down here why this one holds nothing a person could lose. Both are
// fine. Silence is not.
// ---------------------------------------------------------------------------

/**
 * Hand-rolled overlays that deliberately do NOT take the guard, each with the
 * reason it holds nothing losable. Read as a sentence: "dismissing this
 * cannot cost anyone work, because ...".
 */
const DELIBERATELY_UNGUARDED: Record<string, string> = {
  // Its entire session is written to a localStorage draft on every keystroke
  // and restored on reopen -- the file says so itself at the closeIfIdle
  // comment ("X/backdrop keep the draft (reopen later, shipment intact)").
  // A "Discard changes?" prompt would be asking about a loss that cannot
  // happen, and answering Discard would not discard anything.
  'components/inventory/FastStockInModal.tsx': 'the whole session persists as a work draft and is restored on reopen',
  // Confirmations and choosers: what they hold is the question itself, not
  // authored content. Reopening costs one tap.
  'components/sales/SaleStatusConfirmModal.tsx': 'a confirmation -- its two toggles are gates on the action, not typed work',
  'components/shared/RenameCascadeModal.tsx': 'a three-way choice dialog with nothing typed into it',
  'components/pos/QuickAddModal.tsx': 'a chooser -- no fields at all',
  'components/pos/POS.tsx': 'both overlays are a status chooser and a receipt viewer; the cart lives on the page, not in them',
  // Credential entry. Nothing authored is at risk and a retyped six-digit
  // code costs seconds; prompting mid-authentication is noise, not safety.
  'components/utils-settings/OtpModal.tsx': 'transient credential entry -- a retyped code, never authored content',
  // Read-only viewers and page chrome.
  'components/catalog/ProductDetailFlyout.tsx': 'read-only viewer',
  'components/catalog/PublicCatalogPage.tsx': 'storefront drawers -- the cart and wishlist persist, the drawers only show them',
  'components/inventory/ProductDetailModal.tsx': 'read-only viewer',
  'components/navigation/Sidebar.tsx': 'navigation chrome, not a modal',
  'components/products/surfaces/ProductDescriptionDetailModal.tsx': 'read-only viewer',
  'components/products/surfaces/ProductDetailModal.tsx': 'read-only viewer',
  'components/products/surfaces/ProductDetailReport.tsx': 'read-only report',
  'components/receipt-settings/ReceiptSettings.tsx': 'the overlay is the phone-sized PREVIEW of the settings; the settings form itself is the page',
  'components/returns/ReturnDetailModal.tsx': 'read-only viewer',
  'components/shared/ImageGalleryLightbox.tsx': 'an image lightbox',
  'components/shared/kit/Fold.tsx': 'a layout primitive',
  'components/users/UserDetailSheet.tsx': 'read-only viewer',
  'components/utils-settings/AuditLog.tsx': 'the overlay is a read-only detail of one log line',
  // NOT a judgement that these are safe -- they were out of this lane's
  // reach. Each was held dirty by another session in the shared checkout
  // when this pass ran, and SaleDetailModal in particular DOES carry losable
  // work (its "Update status" notes and "Record payment" fields, around
  // line 1476). Whoever lands those files should wire the guard there.
  'components/sales/SaleDetailModal.tsx': 'NOT REACHED -- held by another lane; it has an Update-status/Record-payment form that still needs the guard',
  'components/pos/ProductDetailSheet.tsx': 'NOT REACHED -- held by another lane; a viewer, so read-only in all likelihood',
  'components/dashboard/Dashboard.tsx': 'NOT REACHED -- another lane owns this file this cycle',
}

function handRolledOverlays(): string[] {
  const root = new URL('../src/components/', import.meta.url)
  const found: string[] = []
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`); continue }
      if (!entry.name.endsWith('.tsx')) continue
      const source = readFileSync(new URL(entry.name, dir), 'utf8')
      // The signature of an overlay someone built by hand rather than
      // through shared/Modal.tsx.
      if (source.includes('fixed inset-0')) found.push(`components/${prefix}${entry.name}`)
    }
  }
  walk(root, '')
  return found.sort()
}

await runTest('EVERY hand-rolled overlay is either guarded or written down as not needing it', () => {
  const overlays = handRolledOverlays()
  assert.ok(overlays.length > 20, 'the sweep must actually find the overlays')
  const undeclared: string[] = []
  for (const file of overlays) {
    // These two ARE the mechanism, not consumers of it.
    if (file === 'components/shared/Modal.tsx' || file === 'components/shared/UnsavedChangesPrompt.tsx') continue
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    if (source.includes('useCloseGuard')) continue
    if (DELIBERATELY_UNGUARDED[file]) continue
    undeclared.push(file)
  }
  assert.deepEqual(undeclared, [], 'a hand-rolled overlay must take the guard or say in DELIBERATELY_UNGUARDED why it does not')

  // The exclusion list has to rot loudly, not quietly: an entry that no
  // longer names a hand-rolled overlay, or names one that has since been
  // guarded, is a stale excuse and fails here.
  const stale = Object.keys(DELIBERATELY_UNGUARDED).filter((file) => {
    if (!overlays.includes(file)) return true
    return readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').includes('useCloseGuard')
  })
  assert.deepEqual(stale, [], 'DELIBERATELY_UNGUARDED lists a file that is no longer an unguarded overlay')
  for (const [file, reason] of Object.entries(DELIBERATELY_UNGUARDED)) {
    assert.ok(reason.trim().length > 15, `${file} needs a real reason, not a placeholder`)
  }
})

await runTest('a guarded overlay always RENDERS the prompt it raises', () => {
  // The failure this catches is worse than no guard at all: requestClose
  // sets promptOpen and returns WITHOUT closing, so a modal that never
  // renders <UnsavedChangesPrompt> becomes impossible to dismiss once it is
  // dirty. Nothing in the type system says the two go together.
  const missing = handRolledOverlays().filter((file) => {
    // Modal.tsx renders the prompt for all its children; the prompt is itself.
    if (file === 'components/shared/Modal.tsx') return false
    if (file === 'components/shared/UnsavedChangesPrompt.tsx') return false
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    return source.includes('useCloseGuard') && !source.includes('<UnsavedChangesPrompt')
  })
  assert.deepEqual(missing, [], 'these call useCloseGuard but never render the prompt -- they would trap the operator')
})

function everyComponentFile(): string[] {
  const root = new URL('../src/components/', import.meta.url)
  const found: string[] = []
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`); continue }
      if (entry.name.endsWith('.tsx')) found.push(`components/${prefix}${entry.name}`)
    }
  }
  walk(root, '')
  return found.sort()
}

await runTest('minimize is never routed through the close guard', () => {
  // S4-20 keeps the minimize control, and S4-21 must not quietly break it.
  // Minimizing PRESERVES the work -- utils/minimizedWork.ts parks it as a
  // chip and utils/workDrafts.ts keeps its content -- so raising "Discard
  // changes?" on minimize would be asking the operator to throw away
  // exactly what they just asked to keep. The two controls sit side by side
  // in the header, which is precisely why a later edit could wire them
  // together "for consistency". This is the tripwire for that edit.
  const offenders: string[] = []
  for (const file of everyComponentFile()) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    for (const match of source.matchAll(/onMinimize=\{/g)) {
      const window = source.slice(match.index ?? 0, (match.index ?? 0) + 400)
      if (/requestClose\s*\(/.test(window) || /closeGuard\./.test(window)) offenders.push(file)
    }
  }
  assert.deepEqual([...new Set(offenders)], [], 'minimize must call its own handler, never the close guard')

  const button = readFileSync(new URL('../src/components/shared/MinimizeButton.tsx', import.meta.url), 'utf8')
  // Prose about the guard is fine (and is there on purpose); a CALL is not.
  assert.ok(!/requestClose\s*\(/.test(button) && !/closeGuard\./.test(button), 'the shared minimize button must stay independent of the close guard')
  assert.match(button, /aria-label=\{tr\('minimize', 'Minimize', '/, 'the shared minimize button must carry a Khmer fallback label')
})

process.exit(failed ? 1 : 0)
