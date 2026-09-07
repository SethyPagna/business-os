// N34 / lane "linkover", items 1 and 4 -- the client half of the link-over
// decision, and its PARITY with the Worker door it talks to.
//
// The owner's ruling: "make sure when change they linkover ... prompt user if
// they should link over, and keep it changeable in conflict."
//
// Three things can go wrong here, and each of them is silent:
//
//   1. The client and the Worker disagree about what "the same product" means.
//      Then the pre-check prompts on a save that moved nothing (every ordinary
//      save of a leading-zero twin becomes a dialog), or stays quiet on a save
//      the Worker is about to refuse.
//   2. The wire words drift. The Worker reads the decision with an EXACT-value
//      compare -- '__identity_decision' === 'keep_separate' -- so a client
//      spelling either differently gets the plain refusal forever, with no
//      error anywhere to say why.
//   3. The transport drops the structured refusal. createApiError copies a
//      fixed allowlist of fields onto the thrown Error; a field not named there
//      is gone. Without `matches` the prompt can name only the first of three
//      colliding rows; without `resolutions` it can never learn that "keep them
//      separate" is on offer.
//
// A fourth is not a failure but a fence. The BULK edit path has no prompt, and
// that is correct only while its payload cannot carry `name` or `barcode`;
// section 5 pins that, beside the surfaces that do prompt, where the next
// person adding a bulk field will meet it.
//
// Every check below is DISCRIMINATING. On 6e3abfea this file cannot even
// import -- helpers/identityLinkOver.ts does not exist -- and each individual
// assertion names an implementation that is wrong in a specific way: one that
// compares raw barcodes, one that asks "is this identity shared?" instead of
// "did this edit move it?", one that reads only `duplicate`, one that treats a
// missing `resolutions` as "everything is available".
//
// Run: node tests/identityLinkOver.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDENTITY_DECISION_FIELD,
  IDENTITY_KEEP_SEPARATE,
  identityCollisionFrom,
  identityEditMovesOnto,
  withKeepSeparateDecision,
} from '../src/components/products/helpers/identityLinkOver.ts'
// The bulk edit path composes its payload through these two builders and
// nothing else; section 5 pins that they can never carry an identity field.
import { classifyCreateMatches } from '../src/components/products/helpers/productCreateMatch.ts'
import {
  buildProductBulkInfoUpdates,
  buildProductBulkPricingUpdates,
  buildProductBulkUpdatePayload,
} from '../src/components/products/helpers/productWriteHelpers.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')
const workerRoutePath = path.join(repoRoot, 'cloudflare', 'src', 'routes', 'products.ts')
const httpPath = path.join(repoRoot, 'frontend', 'src', 'api', 'http.ts')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${label}`)
}

// --- 1. WIRE PARITY: the two words the Worker compares exactly ------------
check('the decision field and value match the Worker\'s literals', () => {
  const worker = fs.readFileSync(workerRoutePath, 'utf8')
  const fieldMatch = worker.match(/const IDENTITY_DECISION_FIELD = '([^']+)'/)
  const valueMatch = worker.match(/const IDENTITY_KEEP_SEPARATE = '([^']+)'/)
  assert.ok(fieldMatch, 'the Worker must declare IDENTITY_DECISION_FIELD')
  assert.ok(valueMatch, 'the Worker must declare IDENTITY_KEEP_SEPARATE')
  assert.equal(
    IDENTITY_DECISION_FIELD, fieldMatch![1],
    'the client sends a decision field the Worker does not read -- the save would be refused forever with no error saying why',
  )
  assert.equal(
    IDENTITY_KEEP_SEPARATE, valueMatch![1],
    'the client sends a decision VALUE the Worker does not accept -- same silent dead end',
  )
  // ...and the Worker really does compare it exactly, so this parity matters.
  assert.match(
    worker, /=== IDENTITY_KEEP_SEPARATE/,
    'the guard must compare the decision by value; a truthiness test would make this parity irrelevant and the field dangerous',
  )
})

check('withKeepSeparateDecision carries exactly that field, and touches nothing else', () => {
  const payload = { name: 'MAC Lipstick', barcode: '0601', selling_price_usd: 12 }
  const out = withKeepSeparateDecision(payload)
  assert.equal(out[IDENTITY_DECISION_FIELD], IDENTITY_KEEP_SEPARATE)
  assert.equal(out.name, 'MAC Lipstick')
  assert.equal(out.barcode, '0601')
  assert.equal(out.selling_price_usd, 12)
  // The original is not mutated -- the caller re-sends the same payload on the
  // 409 retry path, and a mutated one would carry the decision into a save the
  // operator never approved.
  assert.equal((payload as Record<string, unknown>)[IDENTITY_DECISION_FIELD], undefined)
})

// --- 2. THE TRANSPORT actually carries the structured refusal -------------
check('createApiError carries matches and resolutions onto the thrown Error', () => {
  const http = fs.readFileSync(httpPath, 'utf8')
  const start = http.indexOf('function createApiError')
  assert.ok(start > 0, 'createApiError must exist')
  const body = http.slice(start, http.indexOf('\n}', start))
  assert.match(
    body, /error\.matches\s*=/,
    'without this the prompt can name only the FIRST colliding row -- the operator settles one collision and meets the same refusal on the next save',
  )
  assert.match(
    body, /error\.resolutions\s*=/,
    'without this the client can never learn that keep-separate is on offer, and the second answer is unreachable',
  )
  assert.match(
    body, /error\.renameScope\s*=/,
    'without this a group-rename refusal is indistinguishable from a single-row one, and the client offers a merge of the wrong pair',
  )
  assert.match(
    body, /error\.collidingSiblingIds\s*=/,
    'without this the prompt cannot say WHICH sibling the rename collides on',
  )
})

// --- 3. THE REFUSAL, unpacked --------------------------------------------
check('a non-identity error is never mistaken for an invitation to merge', () => {
  for (const notACollision of [
    null,
    undefined,
    new Error('boom'),
    { code: 'write_conflict', duplicate: { id: 7, name: 'X' } },
    // The right code but no usable row: nothing to link over, so no prompt.
    { code: 'duplicate_product' },
    { code: 'duplicate_product', matches: [] , duplicate: null },
    { code: 'duplicate_product', duplicate: { id: 0, name: 'X' } },
    { code: 'duplicate_product', duplicate: { id: 'abc', name: 'X' } },
  ]) {
    assert.equal(identityCollisionFrom(notACollision), null, `should not be read as a collision: ${JSON.stringify(notACollision)}`)
  }
})

check('the structured refusal is read whole -- every match, and the door\'s answers', () => {
  const edit = identityCollisionFrom({
    code: 'duplicate_product',
    error: 'x already exists',
    duplicate: { id: 11, name: 'MAC Lipstick', barcode: '0601' },
    matches: [
      { id: 11, name: 'MAC Lipstick', barcode: '0601' },
      { id: 12, name: 'MAC Lipstick', barcode: '00601' },
    ],
    candidateIds: [11, 12],
    resolutions: ['link_over', 'keep_separate'],
  })
  assert.ok(edit)
  assert.deepEqual(edit!.matches.map((m) => m.id), [11, 12], 'BOTH colliding rows, not just `duplicate`')
  assert.equal(edit!.canLinkOver, true)
  assert.equal(edit!.canKeepSeparate, true)

  // The CREATE door offers no link-over: there is no saved row yet whose
  // records could move anywhere. A client that offered one would be offering
  // to fold a row that does not exist.
  const create = identityCollisionFrom({
    code: 'duplicate_product',
    duplicate: { id: 11, name: 'MAC Lipstick', barcode: '0601' },
    matches: [{ id: 11, name: 'MAC Lipstick', barcode: '0601' }],
    resolutions: ['open_existing', 'keep_separate'],
  })
  assert.ok(create)
  assert.equal(create!.canLinkOver, false, 'create must not offer to link over a row that does not exist yet')
  assert.equal(create!.canKeepSeparate, true)
})

check('a GROUP-rename refusal offers keep-separate but never link-over', () => {
  // The fourth door. A group rename carries every sibling to the destination
  // name, so the row that collides is a SIBLING, not the row being saved --
  // the Worker says so explicitly, with renameScope 'group' and the
  // collidingSiblingIds it names. The generic edit-door handling would offer
  // "link over" and merge THIS product into matches[0]: the wrong pair,
  // folding two rows that never collided and leaving the pair that did.
  // Keep-separate is still a real answer (the Worker extends it to the
  // siblings), and so is going back and merging that sibling from Conflicts.
  const groupRename = identityCollisionFrom({
    code: 'duplicate_product',
    error: '"Bar" already exists with this barcode',
    duplicate: { id: 22, name: 'Bar', barcode: '2' },
    matches: [{ id: 22, name: 'Bar', barcode: '2' }],
    candidateIds: [22],
    collidingSiblingIds: [21],
    renameScope: 'group',
    resolutions: ['link_over', 'keep_separate'],
  })
  assert.ok(groupRename)
  assert.equal(groupRename!.canLinkOver, false,
    'the colliding row is a sibling, so merging THIS row into it would fold the wrong pair')
  assert.equal(groupRename!.canKeepSeparate, true, 'keep-separate covers the siblings, so it stays on offer')
  assert.deepEqual(groupRename!.collidingSiblingIds, [21], 'the prompt can say WHICH sibling collides')
  // DISCRIMINATING against the same body without the scope: that one is an
  // ordinary edit collision on the row itself, and link-over is correct there.
  const ordinary = identityCollisionFrom({
    code: 'duplicate_product',
    duplicate: { id: 22, name: 'Bar', barcode: '2' },
    matches: [{ id: 22, name: 'Bar', barcode: '2' }],
    resolutions: ['link_over', 'keep_separate'],
  })
  assert.equal(ordinary!.canLinkOver, true, 'a single-row edit collision still offers the merge')
  assert.deepEqual(ordinary!.collidingSiblingIds, [], 'and names no sibling, because none is carried')
})

check('an older Worker (no resolutions, only `duplicate`) degrades to link-over only', () => {
  // The shape that shipped before N34. Keep-separate must NOT be offered: that
  // Worker would reject the decision field it does not know about, so the
  // button would be a promise the server cannot keep.
  const old = identityCollisionFrom({
    code: 'duplicate_product',
    error: '"MAC Lipstick" already exists with this barcode',
    duplicate: { id: 11, name: 'MAC Lipstick', barcode: '0601' },
  })
  assert.ok(old)
  assert.deepEqual(old!.matches.map((m) => m.id), [11])
  assert.equal(old!.canLinkOver, true)
  assert.equal(old!.canKeepSeparate, false)
})

// --- 4. THE PRE-CHECK: does this edit move the row, and onto what? --------
const CANDIDATES = [
  { id: 11, name: 'MAC Lipstick', barcode: '0601' },
  { id: 12, name: 'MAC Lipstick', barcode: '617' },
  { id: 13, name: 'MAC Lipglass', barcode: '601' },
  { id: 14, name: 'mac  lipstick', barcode: '00601' },
]

check('a save that moves nothing asks nothing -- the false positive the guard exists to avoid', () => {
  const row = { id: 99, name: 'MAC Lipstick', barcode: '0601' }
  // The form posts the WHOLE row on every save, so name and barcode are
  // present even when only the price moved.
  assert.deepEqual(identityEditMovesOnto(row, { name: 'MAC Lipstick', barcode: '0601' }, CANDIDATES), [])
  // ...and a leading-zero RESPELLING of the row's own barcode is still the same
  // identity. An implementation comparing raw barcodes prompts here, on a save
  // that moved nothing, and rows 11 and 14 are sitting right there to prompt
  // about.
  assert.deepEqual(identityEditMovesOnto(row, { name: 'MAC Lipstick', barcode: '601' }, CANDIDATES), [])
  // A body that omits the identity fields keeps the row's current values.
  assert.deepEqual(identityEditMovesOnto(row, {}, CANDIDATES), [])
  assert.deepEqual(identityEditMovesOnto(row, { name: '  mac lipstick ' }, CANDIDATES), [])
})

check('a genuine move names EVERY row it lands on, folded, and never itself', () => {
  // Row 99 is renamed onto the "MAC Lipstick" + 601 identity. Both 11 ('0601')
  // and 14 ('00601', name differing only in case and spacing) fold to it; 12
  // (different barcode) and 13 (different name) do not.
  const hits = identityEditMovesOnto(
    { id: 99, name: 'MAC Lipglass', barcode: '601' },
    { name: 'MAC Lipstick', barcode: '601' },
    CANDIDATES,
  )
  assert.deepEqual(hits.map((h) => h.id), [11, 14],
    'a fold that stopped at the first hit would return [11] and let the operator settle one collision only to meet the next')

  // A re-barcode onto a sibling in the same name group.
  assert.deepEqual(
    identityEditMovesOnto({ id: 99, name: 'MAC Lipstick', barcode: '999' }, { barcode: '617' }, CANDIDATES).map((h) => h.id),
    [12],
  )
  // A row can never collide with itself, however the candidate list arrived.
  assert.deepEqual(
    identityEditMovesOnto({ id: 11, name: 'MAC Lipstick', barcode: '999' }, { barcode: '0601' }, CANDIDATES).map((h) => h.id),
    [14],
    'the row being edited must be excluded -- otherwise every re-barcode collides with itself',
  )
})

check('a move onto nothing prompts nothing, and a blank name never collides', () => {
  assert.deepEqual(identityEditMovesOnto({ id: 99, name: 'MAC Lipstick', barcode: '0601' }, { barcode: '777' }, CANDIDATES), [])
  // Every unnamed row folds to the same empty name group; prompting there would
  // offer to merge two unrelated blanks.
  assert.deepEqual(identityEditMovesOnto({ id: 99, name: 'X', barcode: '601' }, { name: '   ' }, [
    { id: 21, name: '', barcode: '601' },
    { id: 22, name: null, barcode: '601' },
  ]), [])
})

check('duplicate candidate rows are reported once', () => {
  // The form searches by name AND by barcode and concatenates the results, so
  // the same row arrives twice on exactly the edits that matter most.
  const doubled = [...CANDIDATES, ...CANDIDATES]
  assert.deepEqual(
    identityEditMovesOnto({ id: 99, name: 'X', barcode: '601' }, { name: 'MAC Lipstick', barcode: '0601' }, doubled).map((h) => h.id),
    [11, 14],
  )
})

// --- 5. THE OTHER WRITERS: bulk edit must stay OUT of identity -----------
// The link-over prompt is wired into the two surfaces that can move a row's
// identity (the product form's save path and the in-place Resolve editor in
// Products -> Conflicts). The BULK edit path -- runBulkProductUpdates, which
// PUTs one product at a time -- has no prompt, and that is correct only for as
// long as it cannot carry `name` or `barcode`: a bulk field added later would
// silently become an unguarded identity writer, refused by the Worker with a
// 409 per row and no way forward, on a path that updates hundreds of rows at
// once. So the two builders that compose every bulk payload are pinned here.
//
// Not a fix -- a fence around one. It is checked in this file precisely so it
// sits beside the surfaces that DO prompt, where the next person adding a bulk
// field will meet it.
check('the bulk edit builders never emit an identity field', () => {
  // Every key either builder can produce, asked for at once.
  const everything = {
    category: 'lips', unit: 'box', supplier: 'kaka', brand: 'MAC', low_stock_threshold: '3',
    selling_price_usd: '9', selling_price_khr: '36000', wholesale_price_usd: '7',
    wholesale_price_khr: '28000', purchase_price_usd: '4', purchase_price_khr: '16000',
    // ...and the two that must be ignored however they are passed in.
    name: 'MAC Lipstick', barcode: '0601',
  }
  const emitted = [
    ...Object.keys(buildProductBulkInfoUpdates(everything)),
    ...Object.keys(buildProductBulkPricingUpdates(everything)),
  ]
  assert.ok(emitted.length >= 10, 'the builders must still emit the fields bulk edit is for')
  for (const identityField of ['name', 'barcode']) {
    assert.ok(
      !emitted.includes(identityField),
      `bulk edit emitted ${identityField}: it can now move a row's identity with no prompt and no link-over, and the Worker will refuse every affected row`,
    )
  }
  // And the payload builder passes through only what the builders defined, so
  // it cannot re-admit an identity field the builders dropped.
  const payload = buildProductBulkUpdatePayload(
    buildProductBulkInfoUpdates(everything), { updated_at: 't' }, { id: 1, name: 'u' },
  ) as unknown as Record<string, unknown>
  // Read as a bag on purpose: the point is what the payload CARRIES at runtime,
  // and the builder's declared return type does not list the pass-through keys
  // at all -- so a typed read here would be checking the annotation, not the
  // object that goes on the wire.
  assert.equal(payload.name, undefined)
  assert.equal(payload.barcode, undefined)
  assert.equal(payload.userName, 'u', 'the bookkeeping fields it IS meant to add must still be there')
})

// The kernel agrees, from the other direction: a payload with neither field
// moves nothing, so no prompt would fire even if one were wired in.
check('a bulk payload moves no identity, whatever the row is', () => {
  assert.deepEqual(
    identityEditMovesOnto(
      { id: 99, name: 'MAC Lipstick', barcode: '0601' },
      buildProductBulkInfoUpdates({ category: 'lips', supplier: 'kaka' }) as { name?: unknown; barcode?: unknown },
      CANDIDATES,
    ),
    [],
  )
})


// --- 6. THE CREATE DOOR's answer, which nothing could give ----------------
// The Worker's create-door refusal advertises two resolutions, 'open_existing'
// and 'keep_separate'. Only the second is expressible on the save, and until
// this round NOTHING sent it: withKeepSeparateDecision was called from the edit
// path only, the exact-twin dialog offered a single button (Go back), and the
// 409 fallback that could have offered the answer was gated on product?.id --
// i.e. edit mode. So the operator with a genuinely different article that
// happens to share a name and a folded barcode with an existing row could not
// enter it at all, on any screen, while the server sat there accepting an
// answer no client could give.
//
// Both halves are pinned: the verdict that offers the answer, and the two
// places the answer is actually sent from.
check('DISCRIMINATING: only the EXACT TWIN offers keep-separate, because only it is refused', () => {
  const catalog = [
    { id: 11, name: 'MAC Lipstick', barcode: '0601', selling_price_usd: 12 },
    { id: 12, name: 'Other Thing', barcode: '77777777', selling_price_usd: 5 },
  ]
  // Same name + folded-equal barcode: the Worker 409s this, and keep-separate
  // is the one answer it takes.
  const twin = classifyCreateMatches({ name: 'mac  lipstick', barcode: '601' }, catalog)
  assert.equal(twin.kind, 'exact_twin')
  assert.equal(
    twin.allowKeepSeparate, true,
    'the one refused verdict must offer the one answer the refusal accepts, or the create door is a dead end',
  )
  assert.equal(twin.allowProceedAsNew, false, 'and it is NOT the same answer as "keep your different name"')
  // The other two verdicts are not refused at all, so there is nothing to
  // decide; offering the decision there would send a wire field the guard would
  // never have asked for.
  assert.equal(classifyCreateMatches({ name: 'MAC Lipstick', barcode: '999' }, catalog).kind, 'name_match')
  assert.equal(classifyCreateMatches({ name: 'MAC Lipstick', barcode: '999' }, catalog).allowKeepSeparate, false)
  assert.equal(classifyCreateMatches({ name: 'Something New', barcode: '0601' }, catalog).kind, 'barcode_match')
  assert.equal(classifyCreateMatches({ name: 'Something New', barcode: '0601' }, catalog).allowKeepSeparate, false)
  assert.equal(classifyCreateMatches({ name: 'Brand New', barcode: '123123123' }, catalog).allowKeepSeparate, false)
})

check('DISCRIMINATING: the create door can actually SEND it -- dialog answer and 409 fallback', () => {
  const form = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'products', 'forms', 'ProductForm.tsx'), 'utf8')
  // (a) the dialog offers the answer...
  assert.match(
    form, /resolveCreateVerdict\('keep_separate'\)/,
    'the exact-twin dialog must offer the answer; with only "Go back" the Worker advertises a resolution no client can give',
  )
  // ...and the save carries it. The create gate must set keepSeparate from a
  // remembered decision, not from the edit branch's variable: the dialog is
  // skipped on a second Save of the same typed identity (createMatchAckRef), and
  // a decision that did not survive that skip would 409 the retry.
  assert.match(form, /createKeepSeparateAckRef\.current = ackKey/, 'the create-mode answer must be remembered against the typed identity')
  assert.match(form, /keepSeparate = createKeepSeparateAckRef\.current === ackKey/, 'and read back on the save that follows')
  // (b) the 409 fallback is no longer edit-only.
  assert.ok(
    !/if \(collision && product\?\.id\) \{/.test(form),
    'gating the whole link-over prompt on product?.id makes it edit-only, and the create door dead-ends on the raw refusal text',
  )
  assert.match(form, /if \(collision\) \{/, 'the fallback runs on both doors')
  // ...but the MERGE half of it still requires a saved row: there is nothing to
  // fold on create, and offering it would try to merge a row that does not exist.
  assert.match(
    form, /choice === 'link_over' && collision\.canLinkOver && product\?\.id/,
    'link-over must still require a saved row',
  )
  // POSITIVE CONTROL: the pre-fix shape fails both probes, so they discriminate.
  const PRE_FIX = "      if (collision && product?.id) {\n        const choice = await askIdentityLinkOver({"
  assert.equal(/resolveCreateVerdict\('keep_separate'\)/.test(PRE_FIX), false)
  assert.equal(/if \(collision\) \{/.test(PRE_FIX), false)
})

check('the variant door -- the third create door -- answers through the same helper', () => {
  const variant = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'components', 'products', 'forms', 'VariantFormModal.tsx'), 'utf8',
  )
  assert.match(variant, /identityCollisionFrom\(error\)/, 'the variant door must read the structured refusal, not just print it')
  assert.match(variant, /withKeepSeparateDecision\(payload\)/, 'and be able to send the one answer its guard accepts')
  assert.match(
    variant, /choice !== 'keep_separate' \|\| !collision\.canKeepSeparate/,
    'nothing is retried without an explicit answer -- a re-send on any other outcome would write over an identity nobody approved',
  )
})

check('the group-rename refusal reaches the dialog, which says what it is', () => {
  const form = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'components', 'products', 'forms', 'ProductForm.tsx'), 'utf8',
  )
  assert.match(
    form, /collidingSiblingIds: collision\.collidingSiblingIds/,
    'the edit door must hand the sibling ids to the prompt, or the dialog cannot tell a rename collision from a create one',
  )
  const hook = fs.readFileSync(
    path.join(repoRoot, 'frontend', 'src', 'components', 'products', 'useIdentityLinkOver.tsx'), 'utf8',
  )
  // Without its own wording the dialog fell through to the create-door note --
  // "There is no saved row yet to link over" -- in front of an operator who is
  // renaming a saved group. A sentence that is simply false is worse than a
  // bare refusal, because it sends him looking for a row that is right there.
  assert.match(hook, /identity_group_rename_message/, 'the rename case has its own message')
  assert.match(hook, /identity_group_rename_note/, 'and its own note, instead of the create door\'s')
  const en = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
  const km = JSON.parse(fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>
  for (const key of ['identity_group_rename_message', 'identity_group_rename_note']) {
    assert.ok(en[key], `${key} must exist in the English pack`)
    assert.ok(km[key], `${key} must exist in the Khmer pack`)
    assert.notEqual(km[key], en[key], `${key} must be really translated, not the English string copied`)
  }
})

console.log(`PASS identityLinkOver (${passed} checks)`)
