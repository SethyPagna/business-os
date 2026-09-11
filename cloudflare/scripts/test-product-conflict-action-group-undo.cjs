const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const undo = fs.readFileSync(path.join(root, 'src', 'lib', 'undoAppliers.ts'), 'utf8')
const history = fs.readFileSync(path.join(root, 'src', 'routes', 'actionHistory.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('one server-managed visible group action uses child snapshots without child history rows', () => {
  assert.match(undo, /PRODUCT_MERGE_GROUP_ACTION_KIND = 'product\.merge\.group'/)
  assert.match(undo, /PRODUCT_MERGE_GROUP_CHILD_KIND = 'product\.merge\.group\.child'/)
  const groupBlock = undo.slice(undo.indexOf('[PRODUCT_MERGE_GROUP_ACTION_KIND]'))
  assert.doesNotMatch(groupBlock.slice(0, groupBlock.indexOf('// Payload shape:', 1)), /INSERT INTO action_history/)
  assert.match(history, /kind === PRODUCT_MERGE_GROUP_ACTION_KIND/)
})

check('group and pointer payloads are strict, bounded, ordered, and reject duplicate children', () => {
  assert.match(undo, /const expected = \['child_snapshot_ids', 'generation', 'group_key', 'prefix_fingerprint', 'review_id', 'version'\]/)
  assert.match(undo, /ids\.length > 3999/)
  assert.match(undo, /new Set\(ids\)\.size !== ids\.length/)
  assert.match(undo, /const expected = \['applier', 'generation', 'group_key', 'review_id', 'snapshot_id'\]/)
  assert.match(undo, /memberIds\.some\(\(id, index\) => id !== groupSnapshot!\.child_snapshot_ids\[index\]\)/)
  assert.match(undo, /productMergeGroupPrefixFingerprint[\s\S]*version: 1,[\s\S]*review_id: reviewId,[\s\S]*group_key: groupKey,[\s\S]*generation,[\s\S]*child_snapshot_ids: childSnapshotIds/)
  assert.match(undo, /groupSnapshot\.prefix_fingerprint !== expectedPrefixFingerprint/)
  assert.match(undo, /'\$\.prefix_fingerprint',@nextPrefixFingerprint/)
})

check('foreign actor, child kind, and member identity fail closed', () => {
  assert.match(undo, /history_actor_id[\s\S]*snapshot_actor_id/)
  assert.match(undo, /Number\(association\.history_actor_id\) !== Number\(association\.actor_id\)/)
  assert.match(undo, /WHERE kind=\? AND id IN/)
  assert.match(undo, /Number\(row\.created_by_id\) !== Number\(association\.actor_id\)/)
  assert.match(undo, /Number\(reversal\.dupId\) !== Number\(member\.product_id\)/)
})

check('undo peels children in reverse and redo advances them forward through one atomic CAS contract', () => {
  assert.match(undo, /targetIndex = ctx\.direction === 'undo' \? appliedCount - 1 : appliedCount/)
  assert.match(undo, /const completion = productMergeGroupCompletionStatements[\s\S]*statements\.unshift\(completion\[0\], \.\.\.currentGraphGuards, \.\.\.timestamps.before\)/)
  assert.match(undo, /completionStatements: \(freshReversal\) => productMergeGroupCompletionStatements/)
  assert.match(undo, /product_merge_group_guard/)
  assert.match(undo, /undo_snapshot_id=@child AND status=@fromMember/)
  assert.match(undo, /UPDATE undo_snapshots SET status=@status,payload_json=@payload/)
  assert.match(undo, /UPDATE product_conflict_action_groups SET status=CASE WHEN @redoFinal=1[\s\S]*reversal_generation=@nextGeneration/)
})

check('partial replay leaves history in its current direction and final replay advances status and generation', () => {
  assert.match(undo, /\.\.\.\(final \? \[\{/)
  assert.match(undo, /UPDATE action_history SET status=@status,last_error=NULL/)
  assert.match(undo, /final \? generation \+ 1 : generation/)
  assert.match(undo, /complete: final,[\s\S]*continuation_required: !final,[\s\S]*processed_children: 1/)
  assert.match(history, /complete[\s\S]*continuation_required[\s\S]*processed_children[\s\S]*pending_children[\s\S]*generation/)
  assert.match(undo, /@redoFinal=1 AND EXISTS\([\s\S]*pending\.role='merged' AND pending\.status='planned'\)[\s\S]*THEN 'partial'/)
})

check('same-generation terminal retry reconciles while stale generations conflict', () => {
  assert.match(undo, /generation === expectedGeneration \+ 1 && terminal/)
  assert.match(undo, /processed_children: 0, pending_children: 0, generation/)
  assert.match(undo, /generation !== expectedGeneration[\s\S]*group reversal generation is stale/)
  assert.match(history, /currentStatus !== expected && !stockReplay && !groupReplay/)
})

check('group replay requires current merge and image authority and image lookup spans every child', () => {
  assert.match(undo, /\[PRODUCT_MERGE_GROUP_ACTION_KIND\]: \{[\s\S]*action: 'merge_duplicates'/)
  assert.match(undo, /child_snapshot_ids[\s\S]*FROM json_each\(\?\)[\s\S]*PRODUCT_MERGE_GROUP_CHILD_KIND/)
  assert.match(undo, /if \(!snap\) return kind === PRODUCT_MERGE_GROUP_ACTION_KIND/)
  assert.match(history, /replayChangesProductImages && getActionTier\(user, 'products', 'image'\) !== 'full'/)
})

check('POST and PATCH cannot forge group history and details stay bounded', () => {
  assert.match(history, /if \(\[body\.undo_payload, body\.redo_payload\]\.some\(isServerManagedPayload\)\) return false/)
  assert.match(history, /some\(isServerManagedPayload\)[\s\S]*Grouped history is server-managed/)
  assert.match(history, /applierKind === PRODUCT_MERGE_GROUP_ACTION_KIND/)
  assert.match(history, /Math\.min\(10,/)
  assert.match(history, /SELECT member_ordinal,product_id,role,status/)
  assert.doesNotMatch(history.slice(history.indexOf("app.get('/:id/details'"), history.indexOf("app.post('/',")), /snapshot_json/)
})

check('group replay avoids sale operation tables and sale notification dispatch', () => {
  assert.match(history, /applier\.name !== SALE_ADD_ITEMS_ACTION_KIND && applier\.name !== PRODUCT_MERGE_GROUP_ACTION_KIND/)
  assert.ok(history.indexOf('if (applierKind === PRODUCT_MERGE_GROUP_ACTION_KIND)') < history.indexOf('const operationTable'))
})

check('reviewed merge reversals restore all selected keeper catalog fields compatibly', () => {
  assert.match(undo, /keeperCatalogBefore\?:/)
  for (const field of ['category', 'categories', 'brand', 'brands', 'unit', 'unit_normalized', 'brand_compact']) {
    assert.match(undo, new RegExp(`${field.replace('_', '')}|${field}`))
  }
  assert.match(undo, /const catalog = r\.keeperCatalogBefore/)
  assert.match(undo, /\.\.\.\(catalog \? \{/)
})

console.log(`\n${passed} check(s) passed.`)
