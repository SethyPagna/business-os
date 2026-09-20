# Stock-in invoice scope checkpoint

- Source `cbbebe5841f8`; GitHub main and working branch pushed.
- Worker `49b64606-d25a-4894-b630-6baa371005d1`, Paid; deploy exit0.
- Worker stamp `c221d1e1a71c65fa`, built2026-09-20T10:01:13.541Z.
- Frontend hash `feb51db784ec0032`, built2026-09-20T09:58:04.944Z.
- Prior rollback version `3b7e2af5-1b4e-4cd7-a122-ad63e9b90b18`.

Report/detail state is masked immediately when account/authority/permissions or
filters/pages change. Old requests cannot restore stale reports, detail pages,
errors or pagination corrections; current results/cache reopening remain usable.
Recorded date and money semantics are unchanged. No Worker-source change relative
to e85a45e8, no schema migration, no production business test write.

Verification: independent review4fd541e3 with failing baseline/removed-guard
negative controls; root34 executed loader/state cases, cost/invoice/date/pagination
tests and frontend typecheck pass. Full chain504/504,zero skipped,470232ms,exit0.
EN/KM5892keys/647sources; build269chunks/zero cycles and public preload guard pass.
Both Paid/Free dryruns pass with Wrangler4.116.0; no real Free-capacity claim.

Browser6/6 across desktop Chromium, Android Chromium and iOS WebKit on immutable
ac010474 artifact0d9d8251b11689ec. Subsequent changes are docs/E2E test only, not
runtime. Delayed detail after branch or same-user permission change stays hidden;
new detail survives late completion; synthetic staff response prices stay hidden.
These are intercepted GET/permission-event UI tests, not backend authorization,
actual account-login transition, or physical-device certification.

Postdeploy live signed-in Suppliers/Invoices/Stock-In Invoices rendered records;
invoice detail opened. No captured console errors. DOM entryindex-B5_KJvqR.js
matches rebuilt dist index. Worker identity from stamped deployment, not a claimed
independent runtime endpoint read. Broad historical issues remain in active ledger.

Owner additionally approved verified export/transfer lifecycle tracking during
this release. None of those proposed migrations is included here. Large transfers,
snapshot-safe complete one-year exports, shift count/page concurrency fix, remaining
date semantics, public/private isolation, hardware checks and safe folder cleanup
remain open; full goal is active, not achieved.
