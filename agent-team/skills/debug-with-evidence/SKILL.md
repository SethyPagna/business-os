---
name: debug-with-evidence
description: Diagnose a bug from observed evidence before changing production code. Use whenever something is broken, a number is wrong, a fix "didn't work", a bug came back, or you are about to explain a cause you have not observed. Prevents confidently diagnosing without reading the code that actually runs.
---

# Debug with evidence

1. **Capture the exact symptom**: the user's words, the screen, the request and response, ids, time, role, branch, language.
2. **Reproduce it** — test, API call against local Worker (`worker-dev` 8787), or the browser (`browser-verify`). No reproduction → say so and gather more evidence; do not fix blind.
3. **Narrow** to the smallest failing case (one product, one lot, one role, one request).
4. **Read the code that actually executes** for that case: route → lib → SQL → trigger; component → hook → transport. Follow the real call path, not the name that looks right. Check committed HEAD vs the deployed build (`/api/runtime/version`).
5. **Form hypotheses only now**, at least two when the cause is not certain.
6. **Run the experiment that distinguishes them** (a log line, a query, a crafted input). Keep the one the evidence supports.
7. **Regression test** that fails for the reported reason (and would fail for the plausible wrong fix).
8. **Smallest justified fix** at the root cause, then every sibling writer with the same defect (`blast-radius`).
9. **Rerun the reproduction**, then `node agent-team/scripts/verify.mjs`.

Report: observed failure · root cause · evidence (file:line, query output, screenshot) · files changed · verification actually run · what remains unproven.

Repository traps worth checking first: self-rewriting defaults, CRLF-only diffs, the two stock ledgers (branch_stock vs lots), sales vs receivables ledgers, business-day timezone (UTC+7), stale service worker serving an old build, a D1 query that hit a memory limit and returned nothing.
