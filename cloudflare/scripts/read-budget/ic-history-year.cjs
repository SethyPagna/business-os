'use strict'
// The one-year Inventory Check world of the count marks spike (docs/contracts/inventory-check-marks-20261121.md; measured in test-inventory-check-marks-cost-native.cjs).
// Written on top of a booted read-budget world (bootWorld), through its D1 binding. Per day (HIST_DAYS days, 365 for the year; 30 for world B):
//   20 closed submissions of 20 done/issue items (every 10th an issue), the branch alternating 1 / 2 (branch 2 is the inactive Old Store), the items' updated_at spread over the day;
//   3 closed count tasks of 100 UNSTARTED items each (updated_at NULL), with a closed pickup session each;
//   ONE EVENT PER COUNTED ITEM ('observe', product named) as the real writers record it, and one 'create' event (no product) per session.
// Plus the waiting backlog: 100 closed submissions of 20 lines each at branch 1, newest of all, each with a pending approval whose line set names its 20 products (2,000 waiting lines).
// Event ids follow the order the counts happened (oldest first), so the log is a real log: id order = count order.
const DAYS = (n) => Number(n || process.env.HIST_DAYS || 365)
const BACKLOG_SUBMISSIONS = 100
const BACKLOG_LINES = 20
const EV = 'INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at)'
const ISO = (anchor, k, days, extra) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${anchor}, '-'||(${days})||' days'${extra ? ', ' + extra : ''})`

async function injectYear(run, org, anchorIso, { days, backlog = true } = {}) {
  const D = DAYS(days)
  // Submissions: session k is day 1 + k/20 before the anchor.
  await run(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${D * 20 - 1})
    INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
    SELECT 'hs-'||k, ?, 1 + k%2, 1, 'Hist '||k, 'closed', 0, '{"membership":"submission"}', ${ISO('?', 'k', '1 + k/20')}, ${ISO('?', 'k', '1 + k/20')}, ${ISO('?', 'k', '1 + k/20')} FROM s`, org, anchorIso, anchorIso, anchorIso)
  await run(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < ${D * 400 - 1}), m AS (SELECT x/20 AS k, x%20 AS j FROM n)
    INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
    SELECT 'hs-'||k, 1000 + ((k*211 + j*37) % 8650), 1 + k%2, '{}', 5, '{}', CASE WHEN j%10=0 THEN 'issue' ELSE 'done' END, CASE WHEN j%10=0 THEN 4 ELSE 5 END, CASE WHEN j%10=0 THEN 'short' END, 1, 1,
      ${ISO('?', 'k', '1 + k/20', "'+'||j||' seconds'")} FROM m`, anchorIso)
  // Tasks.
  await run(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${D * 3 - 1})
    INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
    SELECT 'ht-'||k, ?, 1 + k%2, 1, 'Task '||k, 'closed', 1, '{"membership":"task","products":100,"selection":{"kind":"ids"}}', ${ISO('?', 'k', '1 + k/3', "'-6 hours'")}, ${ISO('?', 'k', '1 + k/3')}, ${ISO('?', 'k', '1 + k/3')} FROM s`, org, anchorIso, anchorIso, anchorIso)
  await run(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < ${D * 300 - 1}), m AS (SELECT x/100 AS k, x%100 AS j FROM n)
    INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,revision)
    SELECT 'ht-'||k, 1000 + ((k*97 + j*13) % 8650), 1 + k%2, '{}', NULL, '{}', 'unstarted', 0 FROM m`)
  await run(`INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
    SELECT 'hp-'||substr(id,4), organization_id, branch_id, 1, title, 'closed', 1, json_object('membership','pickup','task',id), started_at, updated_at, closed_at FROM inventory_check_sessions WHERE id LIKE 'ht-%'`)
  if (backlog) {
    await run(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${BACKLOG_SUBMISSIONS - 1})
      INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at)
      SELECT 'hw-'||k, ?, 1, 1, 'Waiting '||k, 'closed', 0, '{"membership":"submission"}', strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(${BACKLOG_SUBMISSIONS} - k)||' minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(${BACKLOG_SUBMISSIONS} - k)||' minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(${BACKLOG_SUBMISSIONS} - k)||' minutes') FROM s`, org, anchorIso, anchorIso, anchorIso)
    await run(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < ${BACKLOG_SUBMISSIONS * BACKLOG_LINES - 1}), m AS (SELECT x/${BACKLOG_LINES} AS k, x%${BACKLOG_LINES} AS j, x AS x FROM n)
      INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at)
      SELECT 'hw-'||k, 1000 + (x * 4), 1, '{}', 5, '{}', 'done', 4, NULL, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(${BACKLOG_SUBMISSIONS} - k)||' minutes', '+'||j||' seconds') FROM m`, anchorIso)
    await run(`INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json,line_set_json)
      SELECT s.id, s.organization_id, 1, 'pending', ${BACKLOG_LINES}, 1, s.started_at, '{}', (SELECT json_group_object(CAST(i.product_id AS TEXT), 1) FROM inventory_check_items i WHERE i.session_id = s.id) FROM inventory_check_sessions s WHERE s.id LIKE 'hw-%'`)
  }
  // The log, oldest count first: a session's 'create' event (no product), then one 'observe' per counted item. request_id is unique per actor (UNIQUE(actor_id, request_id)).
  await run(`${EV} SELECT s.id, NULL, 1, 'hist', 'create', 'hc-'||s.id, 'h', '{}', '{}', '{}', s.started_at FROM inventory_check_sessions s WHERE s.id LIKE 'hs-%' OR s.id LIKE 'ht-%' OR s.id LIKE 'hw-%' ORDER BY s.started_at, s.id`)
  await run(`${EV} SELECT i.session_id, i.product_id, 1, 'hist', 'observe', 'ho-'||i.session_id||'-'||i.product_id, 'h', '{}', '{}', '{}', i.updated_at FROM inventory_check_items i WHERE i.updated_at IS NOT NULL AND (i.session_id LIKE 'hs-%' OR i.session_id LIKE 'hw-%') ORDER BY i.updated_at, i.session_id, i.product_id`)
}

module.exports = { injectYear, BACKLOG_SUBMISSIONS, BACKLOG_LINES }
