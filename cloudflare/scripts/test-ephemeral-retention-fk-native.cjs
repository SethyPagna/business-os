// action_history retention against a REAL foreign-key-enforcing D1 (local
// workerd via Miniflare, every migration applied). No remote access.
//
// Evidence that this harness enforces foreign keys the way production D1
// does: the test first asserts `PRAGMA foreign_keys` reads 1 and that a
// direct DELETE of a referenced action_history row is refused with
// SQLITE_CONSTRAINT_FOREIGNKEY -- and that the refusal rolls back the whole
// statement, taking the unreferenced rows in the same slice down with it.
// That rollback is the stall: before the fix, one referenced id inside the
// bounded slice meant the slice never deleted anything, the error was
// swallowed, and every later sweep retried the same slice.
//
// Fails before the fix (deleted.action_history is undefined, all old rows
// remain); passes after it.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..')

const OLD = '2000-01-01 00:00:00'

// Every column in the migrated schema that REFERENCES action_history(id).
// Written out by hand so a new reference forces a conscious update here.
const EXPECTED_REFERENCES = [
  ['product_conflict_action_group_members', 'action_history_id'],
  ['product_conflict_action_groups', 'action_history_id'],
  ['product_conflict_merge_run_cases', 'action_history_id'],
  ['product_remove_operations', 'action_history_id'],
  ['return_bulk_operations', 'history_id'],
  ['sale_bulk_operations', 'history_id'],
  ['sale_incident_recovery_members', 'history_id'],
  ['sale_mutation_receipts', 'history_id'],
  ['sale_not_paid_stock_recovery_members', 'history_id'],
  ['stock_lot_adjustment_operations', 'history_id'],
  ['stock_session_operations', 'history_id'],
].map(([t, c]) => `${t}.${c}`)

async function main() {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import { maybeRunScheduledEphemeralRetention, discoverActionHistoryReferences } from './src/lib/ephemeralRetention.ts';
    import { getDb } from './src/lib/db.ts';
    export default { async fetch(request, bindings) {
      const input = await request.json();
      const points = [], errors = [];
      const env = { ...bindings, Business_OS_Analytics: { writeDataPoint(p) { points.push(p) } } };
      if (input.mode === 'discover') return Response.json({ refs: await discoverActionHistoryReferences(getDb(env)) });
      const original = console.error;
      console.error = (...args) => { errors.push(args.map(String).join(' ')) };
      try {
        const result = await maybeRunScheduledEphemeralRetention(env);
        return Response.json({ result, points, errors });
      } finally { console.error = original }
    }}
  ` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01',
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    const migrationDir = path.join(root, 'migrations')
    for (const name of fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort()) {
      for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8'))) {
        // Same fixture exception as test-backup-schema-discovery-native.cjs.
        if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
        try { await db.prepare(sql).run() } catch (error) { throw new Error(name + ': ' + error.message) }
      }
    }
    const run = async (input) => {
      const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify(input) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const ids = async () => (await db.prepare('SELECT id FROM action_history ORDER BY id').all()).results.map((r) => r.id)

    // --- harness evidence: FKs are enforced and a violation is statement-atomic
    assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1, 'workerd D1 enforces foreign keys')

    // --- discovery covers every referencing column in the migrated schema
    const { refs } = await run({ mode: 'discover' })
    assert.deepEqual(refs.map((r) => `${r.table_name}.${r.column_name}`).sort(), [...EXPECTED_REFERENCES].sort(),
      'every REFERENCES action_history(id) column is discovered')
    console.log(`PASS discovery finds all ${EXPECTED_REFERENCES.length} referencing columns`)

    // --- fixture: 15 old history rows, 1 recent (20); old 1..11 referenced
    for (let id = 1; id <= 15; id++) {
      await db.prepare("INSERT INTO action_history (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(id, 'old ' + id, OLD, OLD).run()
    }
    await db.prepare("INSERT INTO action_history (id, label) VALUES (20, 'recent')").run()
    await db.prepare("INSERT INTO products (id, name) VALUES (901, 'keeper'), (902, 'merged')").run()
    const inserts = [
      // NO ACTION references
      ["INSERT INTO sale_bulk_operations (id, actor_id, request_id, request_json, history_id, receipt_json) VALUES ('sb1', 1, 'r1', '{}', 1, '{}')"],
      // A NULL link must not poison the NOT IN set (would stop ALL pruning).
      ["INSERT INTO sale_bulk_operations (id, actor_id, request_id, request_json, history_id, receipt_json) VALUES ('sb2', 1, 'r2', '{}', NULL, '{}')"],
      ["INSERT INTO return_bulk_operations (id, actor_id, request_id, request_json, history_id, receipt_json) VALUES ('rb1', 1, 'r1', '{}', 2, '{}')"],
      ["INSERT INTO stock_session_operations (id, actor_id, request_id, mode, request_json, history_id) VALUES ('ss1', 1, 'r1', 'stock_in', '{}', 3)"],
      ["INSERT INTO sale_mutation_receipts (id, actor_id, sale_id, mutation_kind, request_id, request_digest, request_json, before_json, after_json, response_json, history_id, sale_revision) VALUES ('sm1', 1, 1, 'settlement', 'r1', 'd', '{}', '{}', '{}', '{}', 4, 0)"],
      ["INSERT INTO stock_lot_adjustment_operations (id, actor_id, request_id, request_json, request_digest, response_json, before_json, after_json, revision_json, history_id) VALUES ('la1', 1, 'r1', '{}', 'd', '{}', '{}', '{}', '{}', 5)"],
      ["INSERT INTO sale_incident_recovery_receipts (id, incident_key, actor_id, actor_name, request_digest, request_json, before_json, after_json, response_json, backup_created) VALUES ('ir1', 'sale-zero-items-20260909-v1', 1, 'a', 'd', '{}', '{}', '{}', '{}', 1)"],
      ["INSERT INTO sale_incident_recovery_members (operation_id, sale_id, history_id, before_json, after_json) VALUES ('ir1', 16951, 6, '{}', '{}')"],
      // ON DELETE SET NULL reference: kept too, so the link survives.
      ["INSERT INTO product_remove_operations (operation_id, actor_id, requester_id, source, request_id, product_id, reason, state_digest, plan_digest, plan_json, status, action_history_id) VALUES ('pr1', 1, 1, 'direct', 'r1', 1, 'x', 'd', 'd', '{}', 'undo_ready', 7)"],
      // 0136 merge-run undo link (SET NULL)
      ["INSERT INTO product_conflict_merge_runs (id, actor_id, request_id, request_digest, manifest_version, manifest_digest, request_json) VALUES ('run1', 1, 'r1', 'd', 1, 'd', '{}')"],
      ["INSERT INTO product_conflict_merge_run_cases (run_id, ordinal, case_key, keeper_product_id, merged_product_id, expected_state_digest, operation_id, status, action_history_id) VALUES ('run1', 0, 'k', 901, 902, 'd', 'op-run1', 'undo_ready', 8)"],
      // 0138 conflict group + member undo links (SET NULL)
      ["INSERT INTO product_conflict_action_reviews (id, actor_id, request_id, request_digest, manifest_version, resolution_version, draft_digest, requested_action_count, requested_group_count, requested_removal_count, actionable_group_count, blocked_group_count, total_member_count, expires_at) VALUES ('rev1', 1, 'r1', 'd', 1, 2, 'd', 1, 1, 0, 1, 0, 1, '2999-01-01')"],
      ["INSERT INTO product_conflict_action_groups (review_id, ordinal, group_key, source_group_keys_json, member_ids_json, status, state_digest, detail_json, action_history_id) VALUES ('rev1', 0, 'g', '[]', '[]', 'completed', 'd', '{}', 9)"],
      ["INSERT INTO product_conflict_action_group_members (review_id, group_ordinal, member_ordinal, product_id, state_digest, snapshot_json, action_history_id) VALUES ('rev1', 0, 0, 901, 'd', '{}', 10)"],
      // A history row named only inside a snapshot payload (customer gender
      // restoration's join), plus a malformed legacy payload that must not
      // error the statement, plus one naming no history row.
      [`INSERT INTO undo_snapshots (kind, payload_json) VALUES ('customer.gender.restore', '{"history_id":11}')`],
      [`INSERT INTO undo_snapshots (kind, payload_json) VALUES ('product.merge', '{"history_id": broken')`],
      [`INSERT INTO undo_snapshots (kind, payload_json) VALUES ('product.merge', '{"note":"no history"}')`],
    ]
    for (const [sql] of inserts) await db.prepare(sql).run()

    let refused = null
    try { await db.prepare('DELETE FROM action_history WHERE id IN (1, 8)').run() } catch (error) { refused = error.message }
    assert.match(String(refused), /FOREIGN KEY constraint failed/, 'a referenced delete is refused')
    assert.equal((await ids()).length, 16, 'the refusal rolled back the unreferenced row in the same statement')
    console.log('PASS harness evidence: foreign_keys=1, referenced delete refused, whole statement rolled back')

    // --- the sweep
    const first = await run({})
    assert.equal(first.result.skipped, false)
    assert.equal(first.result.failed?.action_history, undefined, 'action_history step did not fail: ' + JSON.stringify(first.result.failed))
    assert.equal(first.result.deleted.action_history, 4, 'the four unreferenced old rows are pruned')
    assert.deepEqual(await ids(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20], 'referenced and recent rows are kept')
    assert.equal(first.result.retained.action_history, 11, 'pinned rows are reported')
    assert.deepEqual(first.result.failed, {}, 'no step failed on a fully migrated schema')
    const link = async (sql) => (await db.prepare(sql).first()).action_history_id
    assert.equal(await link("SELECT action_history_id FROM product_remove_operations WHERE operation_id='pr1'"), 7, '0138 remove-operation link survives')
    assert.equal(await link("SELECT action_history_id FROM product_conflict_merge_run_cases WHERE run_id='run1'"), 8, '0136 merge-run link survives')
    assert.equal(await link("SELECT action_history_id FROM product_conflict_action_groups WHERE review_id='rev1'"), 9, '0138 group link survives')
    assert.equal(await link("SELECT action_history_id FROM product_conflict_action_group_members WHERE review_id='rev1'"), 10, '0138 member link survives')
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM undo_snapshots').first()).n, 3, 'no snapshot is touched')
    const stored = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='ephemeral_retention_last_result'").first()).value)
    assert.deepEqual(stored.failed, {})
    assert.equal(stored.deleted.action_history, 4)
    assert.equal(stored.retained.action_history, 11)
    assert.equal(first.points.length, 1)
    assert.equal(first.points[0].indexes[0], 'ephemeral_retention')
    assert.deepEqual(first.points[0].blobs, ['ok'])
    assert.deepEqual(first.points[0].doubles, [0, 4, 11])
    console.log('PASS sweep prunes unreferenced old history; FK, SET NULL (0136/0138) and snapshot-payload links survive; NULL link and malformed payload harmless')

    // --- a failing step is visible and does not stop the others
    await db.prepare("DELETE FROM settings WHERE key = 'ephemeral_retention_last_run'").run()
    await db.prepare('DROP TABLE rate_limit_events').run()
    await db.prepare("INSERT INTO action_history (id, label, created_at, updated_at) VALUES (16, 'old 16', ?, ?)").bind(OLD, OLD).run()
    const second = await run({})
    assert.ok(second.result.failed.rate_limit_events, 'the failed step is returned with its message')
    assert.equal(second.result.deleted.rate_limit_events, undefined)
    assert.equal(second.result.deleted.action_history, 1, 'later steps still ran')
    assert.deepEqual(await ids(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20])
    const storedFailure = JSON.parse((await db.prepare("SELECT value FROM settings WHERE key='ephemeral_retention_last_result'").first()).value)
    assert.match(storedFailure.failed.rate_limit_events, /rate_limit_events/, 'the failure is persisted in D1')
    assert.ok(second.errors.some((line) => /1 step\(s\) failed: rate_limit_events/.test(line)), 'failure count is logged: ' + JSON.stringify(second.errors))
    assert.deepEqual(second.points[0].blobs, ['rate_limit_events'])
    assert.deepEqual(second.points[0].doubles, [1, 1, 11])
    console.log('PASS a failing step is returned, logged with a count and recorded; other steps still run')

    // --- throttle unchanged
    assert.deepEqual((await run({})).result, { skipped: true, reason: 'ran-recently' })
    console.log('PASS throttle unchanged')
  } finally {
    await mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
