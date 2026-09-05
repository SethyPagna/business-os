# Payment and exchange-rate follow-up verification

Coordinator: Update bulk actions and exports, working with Read Codex goal objective.
Candidate: `codex/payment-fx-20260905`, initially based on `f4b71084067f960dabef13903028316d63294878`.
This is a local verification ledger, not deployment provenance.

## Scope and ownership

The original conditional Sales/Returns bulk actions and export placement were already handed off. Main then delegated configured split settlement, case-only payment-method rename, current-server FX for monetary sale updates, and subsequently native POS change accounting.

Sol high owns sales backend; Sol medium owns payment UI and transport; a second Sol high implemented and reviewed canonical method routes; an additional bounded Sol high implemented native-change validation/schema and shift cash consumption. Parent integrates and verifies. Herschel exclusively owns central history and backup integration. Main owns deployment and combined release certification.

Existing unpaid delivery/COD status semantics remain in force. Explicit settlement validates full tender. No new blanket payment requirement was added to ordinary fulfillment status changes.

## Verified local behavior

- Configured case-only rename updates split tender labels and summary-only historical labels without changing native amounts or stock. Unicode variants, more than 250 matches, malformed relevant records, and concurrent settings/sale edits have focused atomicity tests.
- Explicit settlement preserves recorded USD/KHR four-decimal components; new USD uses cents and new KHR uses whole riel. The server derives totals and applies the reviewed current rate. Unsupported aggregates, invalid methods, reduced historical tender, and underpayment reject before writes.
- Live Worker settlement retry returns its original response after the server rate changes. Central undo/redo restores status, rate, tender, and monetary snapshots without stock changes.
- Live delivery-fee amendment rebases header and line KHR at one current rate, preserves stock, and returns the original outcome on retry.
- Live add-items applies stock once, freezes the first rate on retry, and passes central undo/redo. After a concurrent sale edit, live undo returns409 with no money, stock, allocation, receipt, or history writes. Central tests also cover a between-read race, redo allocation failure rollback, and acknowledged-generation retries.
- Live POS creation preserves validated USD-only, KHR-only, and mixed native change, and the real shift summarizer subtracts those currencies without review. Retry preserves stock and the record. Excessive change rejects before stock writes.
- Actual mobile browser submission at 375px stored Cash USD5 plus FCB KHR23000 at reviewed rate4600. Record payment opens directly; unused notes are hidden; errors stay in the form.
- Dirty payment draft survives 375px to 1440px to 375px and Close raises the discard guard after main's keyed-navigation fix.
- Khmer 320px review visibly retains recorded USD2.1234 and KHR4100.1234, with scrollable input rows and no horizontal modal overflow.
- A separate live decimal-oracle case converts USD1.2345 at rate4600.5678 to internal KHR5679.4009 and restores nullable header/line KHR on undo.

## Reproducible evidence

Synthetic local Worker uses port8800 and isolated state under `tmp/payment-local/state`; no remote database or production data is involved.

Parent evidence scripts: `tmp/payment-local/verify-payment-central.cjs`, `verify-amendment.cjs`, `verify-add-items.cjs`, `verify-add-items-stale.cjs`, `verify-native-create.cjs`, `verify-decimal-derived.cjs`, and `check-browser.cjs`. These deliberately seed/mutate disposable local fixtures and are not production scripts.

Browser evidence: `tmp/payment-local/settlement-mobile-final.png`, `settlement-resize-guard.png`, and `settlement-km-320.png`.

Committed focused backend tests include `test-payment-fx-pure.cjs` (real route/SQLite plus authoritative settlement replay), `test-payment-settlement-pure.cjs`, `test-payment-method-route-sqlite.cjs`, `test-sale-bulk-update-pure.cjs`, `test-native-sale-change-pure.cjs`, and central history/backup suites. There is no `test-sale-settlement-action-pure.cjs`; do not cite that filename.

Frontend typecheck, i18n, build, and affected settlement/amendment/POS/close-guard tests passed. All210 test files are registered. The final full wrapper stopped at one stale mutation-success source assertion; its corrected test passed, and all41 subsequent commands passed independently. This is aggregate chain coverage, not a claim that the wrapper was rerun to completion. Main owns its final combined wrapper run.

Cloudflare typecheck and affected payment, totals, amendment, add-items, native-change, canonical-method, history, and backup tests passed. Central undo-applier suite passes19 checks; the FK-on backup roundtrip passes all66 tables on this payment-only candidate, including native provenance/defaults and incomplete-bundle refusal. Main's larger stock-integrated backup has additional tables.

## Final local status

All identified implementation blockers are resolved: central add-items replay is atomic and revision-guarded; backup fixtures tolerate migration0127; raw tender precision rejects tiny negatives and extra fractional digits before quantization; derived internal KHR retains four decimals. Main retains responsibility for final combined verification and any production release. This task has not deployed or run remote migrations.

Main already owns keyed navigation and baseline test commits. Use original central commits on main; this candidate's payment-only central backport deliberately excludes unrelated stock-hook ancestry and must not replace main's stock work.
