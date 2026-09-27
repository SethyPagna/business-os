export const meta = {
  name: 'deep-scan',
  description: 'Deep full-codebase scan of business-os: known-issue index, 8 dimension finders, adversarial verification, synthesis into lanes',
  whenToUse: 'After each checkpoint deploy, or when the owner asks for a bug/improvement/dead-code sweep. Pass args {tree, sha, outDir, scanId, knownSources}.',
  phases: [
    { title: 'Index', detail: 'compact index of already-known issues for dedup' },
    { title: 'Find', detail: 'one finder per dimension, report saved as it goes' },
    { title: 'Verify', detail: 'per-dimension adversarial verifier, second refuter for high/critical' },
    { title: 'Synthesize', detail: 'completeness critic + lane proposals + skill updates' },
  ],
}

const A = args || {}
const TREE = A.tree
const SHA = A.sha
const OUT = A.outDir
const SCAN = A.scanId || 'SCAN'
const KNOWN_SOURCES = (A.knownSources || []).join('\n- ')

const RULES = `
Hard rules (read-only scan):
- Never edit, stage, commit, reset, stash, checkout or push in any repository or worktree. No deploys, no gh workflow run, no wrangler --remote, no remote D1, no Telegram sends, no network writes.
- The tree under review is ${TREE} (commit ${SHA}); read files there. For history use git -C ${TREE} log/show/blame.
- You may run local read-only commands and tests. Do not install packages. If a command changes a tracked file, report it; do not revert.
- Every finding cites path:line (relative to the repo root) with the quoted line text, plus a concrete failure scenario (inputs/state -> wrong result). No vague code smells.
- Save as you go: writing files under ${OUT} is explicitly authorized. Create your file first with "STATUS: IN PROGRESS", append one finding per write (small appends; never one giant heredoc), finish with "STATUS: DONE".
- The repo is PUBLIC: never paste secret values, tokens, topic ids or production numbers into findings; describe them.`

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'security', 'perf', 'dead-code', 'improvement', 'test-gap', 'i18n', 'data-integrity'] },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    title: { type: 'string' },
    where: { type: 'string', description: 'path:line — quoted line text' },
    scenario: { type: 'string', description: 'concrete inputs/state -> wrong result' },
    fix: { type: 'string' },
    known: { type: 'string', description: 'KNOWN-<id> if it duplicates the known index, else "new"' },
  },
  required: ['id', 'kind', 'severity', 'title', 'where', 'scenario', 'fix', 'known'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    overflow: { type: 'string', description: 'findings noted in the report file but not returned here, or "none"' },
    coverage: { type: 'string', description: 'which directories/files were read and which were NOT' },
    report_path: { type: 'string' },
  },
  required: ['dimension', 'findings', 'overflow', 'coverage', 'report_path'],
}
const JUDGED = {
  type: 'object',
  properties: {
    judgements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity', 'evidence'],
      },
    },
  },
  required: ['judgements'],
}
const REFUTE = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reproduced: { type: 'boolean' }, evidence: { type: 'string' } },
  required: ['refuted', 'reproduced', 'evidence'],
}

const DIMENSIONS = [
  { key: 'money', prompt: 'MONEY & SALES correctness: sales create/edit/status transitions, returns and refunds, receivables and customer balances, revenue definition, rounding, currency (USD/KHR, exchange rates, per-item currency), discounts/promotions, delivery fees, shift cash, reports and dashboards, Telegram report numbers, exports. Backend cloudflare/src/routes + lib, and the frontend surfaces that compute or display money (pos, sales, returns, dashboard, reports). Look for two computations of the same number that disagree, missing backend enforcement of frontend validation, float/rounding drift, timezone business-day errors, status transitions that double-count or skip.' },
  { key: 'stock', prompt: 'STOCK correctness: branch_stock vs the batch/lot ledger, sale holds/deductions per status, returns restock, transfers, adjustments, dated counts, stock-in sessions/receive batch, imports, product merges (child-row identity: only the barcode distinguishes a row), undo appliers and reverts. Enumerate every writer of branch_stock and of lot quantities and check each keeps both ledgers equal; look for paths that can make an on-hand number wrong or negative, race windows between read and write, and batch() atomicity gaps.' },
  { key: 'security', prompt: 'SECURITY & tenancy: authentication and session handling, every route\'s permission check (enumerate routes mounted in cloudflare/src/index.ts and flag any mutating route without an explicit permission check), admin rules, password reset/2FA flows, rate limits, input validation and SQL construction (any string-built SQL), uploads and served content types, public website/portal/catalog endpoints leaking admin or private data, Telegram webhook authentication, CORS/CSRF, secrets or credentials committed in the PUBLIC repo (tests, docs, migrations, workflows), GitHub workflow injection (untrusted inputs in run: steps). Organisation/tenant isolation where settings or data are keyed.' },
  { key: 'frontend', prompt: 'FRONTEND runtime correctness (frontend/src): React effects with missing/incorrect deps, stale closures in handlers and intervals, race conditions between concurrent fetches (older response overwriting newer), unhandled promise rejections, error states that leave spinners forever, forms that lose input, unsaved-changes guards, modals/floats that render stubs, memory leaks (listeners/intervals not cleaned), the app-update "Restart now" bar in long-lived tabs, POS till flows (scan, add, pay, print) edge cases, double-submit of mutating buttons.' },
  { key: 'i18n-ui', prompt: 'I18N & UI CONVENTIONS: hard-coded English user-visible strings in frontend/src (JSX text, toasts, alerts, titles, aria-labels, placeholders) and Worker error messages shown to users without a code the frontend translates; keys present in en but missing/identical in km and vice versa; native window.confirm/alert/prompt usage (policy: one shared confirm dialog); button policy (main action icon + one word, others icon-only with translated tooltip); date formatting and business-day timezone consistency; Khmer text safety in CSV/Excel import/export, receipts and barcodes (encoding, BOM).' },
  { key: 'perf', prompt: 'PERFORMANCE: D1 query patterns in cloudflare/src (N+1 loops issuing a query per row, unbounded SELECTs without LIMIT on growing tables, missing indexes — compare WHERE/ORDER BY columns against CREATE INDEX statements in cloudflare/migrations, correlated subqueries over large tables), Worker CPU/memory (building huge arrays/JSON in memory, the Worker memory limit), cache usage, KV read storms; frontend bundle and rendering (eager imports of heavy libs, missing code splitting, large lists without virtualization, re-render hotspots, polling intervals, hidden-tab work). Quantify where possible (row counts from migrations/tests, file sizes).' },
  { key: 'deadcode', prompt: 'DEAD CODE & DEBLOAT: exported functions/constants never imported anywhere (check both packages and tests; beware dynamic imports and string-keyed lookups), files never imported, unused npm dependencies in both package.json files, i18n keys never referenced (beware dynamic key construction like `perm_section_${x}_desc` — search for the prefix), leftover offline-mode code (owner cancelled offline mode on 26 Sep 2026: queued sales drain once, then offline = banner + blocked saving), duplicated helpers that should be one, stale feature flags, obsolete scripts in ops/scripts and cloudflare/scripts not referenced by any workflow/package script, commented-out blocks. Classify each as SAFE-DELETE / VERIFY / KEEP with the reason.' },
  { key: 'integrity-tests', prompt: 'DATA INTEGRITY, OPS & TEST HEALTH: migrations in cloudflare/migrations (append-only, trigger SQL LF-only, constraints that the app violates, data migrations without pre/post assertions), audit and undo coverage — every mutating route writes action_history/audit with enough to undo, and every undo applier handles every action type it can receive; backup/restore and import/export parity; GitHub workflows (.github/workflows gate.yml, deploy.yml, ops.yml) correctness; tests that cannot fail (assert nothing, source-shape regexes that match anything, harness stubs that replace the very module under test), test files not run by any gate (compare frontend package.json test:utils chain and gate.yml against the files on disk).' },
]

phase('Index')
const indexPath = `${OUT}/KNOWN-INDEX.md`
const idx = await agent(
  `${RULES}\n\nBuild a COMPACT index of issues that are ALREADY KNOWN, so scan finders can mark duplicates. Read these sources:\n- ${KNOWN_SOURCES}\nWrite ${indexPath}: one line per known issue: "KNOWN-<n> | <area> | <path:line or symbol> | <one-line summary> | <status: fixed in lane X / open / owner question / wontfix>". Merge duplicates across sources. Keep it under ~250 lines. Return only the path and the line count.`,
  { label: 'known-index', phase: 'Index', effort: 'medium' },
)
log(`known index: ${String(idx).slice(0, 200)}`)

const results = await pipeline(
  DIMENSIONS,
  (d) => agent(
    `${RULES}\n\nYou are the ${d.key.toUpperCase()} finder in a deep full-codebase scan. ${d.prompt}\nBefore reporting a finding, check ${indexPath} and mark known:"KNOWN-<n>" when it duplicates one (still report it only if you have NEW evidence it is worse than recorded; otherwise skip it). Prefer depth: read the actual code paths end to end; enumerate, do not sample. Return at most 15 findings, highest severity first; list any further findings in your report file and summarise them in "overflow". Report file: ${OUT}/${SCAN}-${d.key}.md`,
    { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS },
  ),
  (found, d) => {
    const fresh = (found && found.findings || []).filter((f) => f.known === 'new' || !/^KNOWN/.test(f.known))
    if (!fresh.length) return { d: d.key, found, judged: [] }
    return agent(
      `${RULES}\n\nAdversarially verify these ${fresh.length} ${d.key} findings from a scan. For EACH, try to REFUTE it: read the cited code and its callers, look for guards elsewhere (middleware, DB constraints, triggers, frontend+backend pairs), check whether the scenario is actually reachable in production usage. verdict=confirmed only with direct code evidence the scenario happens; refuted if a guard exists or the claim misreads the code; uncertain otherwise. Re-grade severity honestly. Append your judgements to ${OUT}/${SCAN}-${d.key}.md under a "## Verification" heading (one append per judgement).\n\nFINDINGS:\n${JSON.stringify(fresh, null, 1)}`,
      { label: `verify:${d.key}`, phase: 'Verify', schema: JUDGED },
    ).then((j) => ({ d: d.key, found, judged: (j && j.judgements) || [] }))
  },
  (r) => {
    const byId = new Map(((r.found && r.found.findings) || []).map((f) => [f.id, f]))
    const serious = r.judged.filter((j) => j.verdict === 'confirmed' && (j.severity === 'critical' || j.severity === 'high'))
    if (!serious.length) return r
    return parallel(serious.map((j) => () => agent(
      `${RULES}\n\nSecond, independent refutation of a HIGH/CRITICAL finding (a first verifier confirmed it). Try hard to show it is NOT real or NOT reachable: find the guard, the constraint, the caller that never passes that input, or the test that already proves the opposite. If you can, reproduce it concretely (a pure node script in your scratchpad against the real module, or a precise request sequence traced through the code). Default refuted=true if you cannot establish the scenario.\n\nFINDING:\n${JSON.stringify(byId.get(j.id) || j, null, 1)}\nFIRST VERIFIER: ${j.evidence}`,
      { label: `refute:${r.d}:${j.id}`, phase: 'Verify', schema: REFUTE },
    ).then((v) => ({ id: j.id, second: v })))).then((seconds) => ({ ...r, seconds: seconds.filter(Boolean) }))
  },
)

const table = results.filter(Boolean).map((r) => {
  const byId = new Map(((r.found && r.found.findings) || []).map((f) => [f.id, f]))
  const sec = new Map((r.seconds || []).map((s) => [s.id, s.second]))
  return {
    dimension: r.d,
    coverage: r.found && r.found.coverage,
    overflow: r.found && r.found.overflow,
    known_dupes: ((r.found && r.found.findings) || []).filter((f) => /^KNOWN/.test(f.known)).map((f) => `${f.id}=${f.known}`),
    items: r.judged.map((j) => {
      const f = byId.get(j.id) || {}
      const s = sec.get(j.id)
      const survives = j.verdict === 'confirmed' && (!s || !s.refuted)
      return { id: j.id, dimension: r.d, kind: f.kind, severity: j.severity, title: f.title, where: f.where, scenario: f.scenario, fix: f.fix, verdict: j.verdict, second: s ? (s.refuted ? 'refuted' : 'upheld') : 'n/a', survives, evidence: j.evidence, second_evidence: s && s.evidence }
    }),
  }
})
const dropped = results.length - results.filter(Boolean).length
if (dropped) log(`${dropped} dimension(s) returned nothing (agent died or skipped)`)

phase('Synthesize')
const synth = await agent(
  `${RULES}\n\nYou are the synthesis + completeness critic for deep scan ${SCAN} of ${SHA}. Per-dimension results (verified) follow. Write ${OUT}/${SCAN}-SUMMARY.md containing: (1) a table of SURVIVING findings (survives=true) grouped into proposed fix LANES — each lane a disjoint file set with one owner, a one-line brief, severity, and whether it can ship in the next checkpoint (small, low-risk) or needs design/owner input; (2) uncertain findings worth a targeted re-check; (3) dead-code items classified SAFE-DELETE/VERIFY/KEEP for a DEBLOAT lane; (4) a COMPLETENESS critique: which directories, surfaces or modalities no finder covered (use the coverage fields) — these become the next scan's targets; (5) proposed SKILL updates: repeated patterns in these findings that a repo skill (agent-team/skills: fleet-coordination, review-change, repo-patterns, blast-radius, work-mode, debug-with-evidence) should teach, each as "skill -> one-sentence rule". Return a short plain-text digest (<= 40 lines) of the same.\n\nRESULTS:\n${JSON.stringify(table, null, 1)}`,
  { label: 'synthesize', phase: 'Synthesize' },
)
return { table, synth }
