# Codex resume — September 18, 2026

Base: `integrate/p10` / `80034a0843490f922d383df96128ef3864ad3dc3`.
Live runtime independently read: `354f12d5957e`, hash `a7014753496a30aa`.
The older `bos-precision-final-candidate-20260914` tree is stale. Do not redo its
pending list: barcode folding, amendment allocation and cost-record branches are
ancestors of the current release.

## Owner-authorized supplier settlement

Owner: “Four supplier invoices totaling $489 ... can do paid.”
Scope is a legacy balance correction, not a new cash expense/payment.

| Invoice ID | Supplier | Total | Previously paid | Outstanding |
| --- | --- | ---: | ---: | ---: |
| 315 | ចែ USA | 203 | 174 | 29 |
| 531 | ចែ USA | 177 | 165 | 12 |
| 612 | Dane japan | 1373 | 935 | 438 |
| 813 | naomi | 260 | 250 | 10 |

Fresh remote preflight: 1,596 supplier invoices; total $1,314,703.4626;
paid $1,314,214.4626; outstanding $489; zero audit rows for migration 0183.
Migration tail 0182. Pre-write Time Travel bookmark:
`0000172a-00000000-000050ea-ad7f6adfb92e888db097da3f075faeb4`.

Prepared migration 0183 checks exact IDs, supplier identity, source file/row,
invoice date, original total and previous paid/outstanding/status. Four audit
before/after records provide scoped recovery; no stock/cash records are created.
Local full-chain fixture passes: empty install, five stale-target refusals,
unrelated table counts and invoice preservation, exact $489 reduction, four
audits, idempotency and recovery. Migration registration guard passes.
Independent reviewer approved and reran the test at exit 0. Production migration
0183 **APPLIED** from checkpoint `ae75fbad`; 10 commands / 25.01 ms.
Fresh postflight: all four IDs Paid with zero outstanding; 1,596 invoices and
total $1,314,703.4626 unchanged; paid now $1,314,703.4626; outstanding $0.
Exactly four settlement audit rows; migration tail 0183; both helper tables absent.
No Worker deployment needed or performed: live code remains `354f12d5957e`.

Archival import caveat: `import-aug30-legacy-reports.mjs` upserts the original
source balances. Do not rerun that historical import without preserving this
owner-approved correction.

## Remaining runtime triage

Independent review and focused local tests found the original sales-list lineage
failure is handled (list 200, affected write 409). The generic “three Sentry
issues open” note conflicts with that deployed fix; fresh events are needed.
CPU-limit event has no recorded route/query attribution: no speculative fix.
Payment-method rename search normalization was tested in SQLite and native
Miniflare/workerd D1 with exact source SQL (6,634 characters, 18 bindings,
77 normalization replacements). Both fixtures passed identically, including
accent handling and monetary strings. A 110-level positive control correctly
failed at depth 100. This hypothesis is refuted; no speculative settings change.
Reproduction: `C:/Users/mrkl6/AppData/Local/Temp/bos-payment-depth-triage-20260918.cjs`.
Fresh event route/query/release is still needed for SQL-depth and CPU errors.

Other open scope remains: 872 blank-gender customers (no guessing), lot-ledger
backfill requiring a separately reviewed plan, parked supplier-payment patch,
responsive/performance and physical-printer verification. No blanket completion.
