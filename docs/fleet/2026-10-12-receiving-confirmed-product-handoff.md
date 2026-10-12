# Receiving session: confirmed product handoff

Local correction based on `bf7408b492937ddf18813441ea7f75d23ac0b10a`.
Runtime commit: `e1de711c1148a7a47275c5eabb63d3eb4d9da521`.
Code and regression checkpoint: `d49924d5eed678f332104362806585b47ac5f04d`.
This note does not establish deployment or physical-device acceptance.

## Problem and change

Creating a product inside a Stock-in / receiving session succeeded, but its
temporary unknown-outcome marker remained in memory. After the returned product
ID was assigned, the destination guard saw that marker and refused the stock
request. Existing-only sessions worked; new-only and mixed sessions failed.

The successful creation path now removes only that line's marker after durable
product confirmation succeeds. It retains the confirmed attempt record, original
stock request IDs, per-line stock commit contract and every other line's state.
Pending review, lost acknowledgments, invalid IDs, failed persistence, account
changes and malformed restored stock requests retain their existing refusals.
No Worker code, migration, permission, price, quantity or layout rule changes.

## Regression and affected surfaces

| Surface | Evidence and verdict |
| --- | --- |
| `FastStockInModal.tsx:838` creation-to-receiving transition | Fixed. Original source fails the expected stock-dispatch assertion; corrected source passes. |
| Inventory, Products, Stock Changes and session Add More callers | All mount the shared modal; entry-point and session tests pass. |
| `receivingProductAttempt.ts` durable confirmation and `receivingDestination.ts` refusal | Unchanged. Independent boundary controls cover unknown/pending outcomes, invalid IDs, storage failure, account/session changes and malformed restored requests. |
| Drafts, stable receipt IDs and retry | Ten complete-controller groups cover both mixed orders, multiple new products, repeat Complete, restored unknown/pending outcomes and preservation of another line's unknown state. |
| `stockLineRequestIdDurability.test.ts` | Repaired two stale assertions against existing source/key format. Actor isolation is now checked through stored-draft reads. Late assertion failures now exit nonzero; a deliberately shared actor key fails. |
| `/api/products` and `/api/inventory/fast-stock-in/commit` | Payload and backend unchanged. Stock commit, supplier-total and Free/Paid budget tests pass locally. |
| EN/KM messages, permissions, free goods, price editing and draft lifecycle | Existing focused tests and translation verification pass; message packs are unchanged. |
| Offline, audit, Undo/Redo, import, reports and Telegram | No write-path or payload change. Existing live-write and unknown-outcome fences are retained; no new certification of these broader families is claimed. |

The frontend regression runner automatically discovers the new
`fastStockInConfirmedProductHandoff.test.ts` file. Independent review passed the
exact code checkpoint and its two changed test files. The original failing
reproduction and the first test-typing failure were retained separately.

## Validation status

Both frontend TypeScript configurations and Worker TypeScript pass. The focused
frontend gate covers twenty related test files, translation verification and the
production build. This is a partial lane gate, not the full release sweep.
The final scoped verification command reports 5/5 green. Four built-browser
flows pass: English and Khmer at 1440px desktop and 375px mobile widths. Each
uses the actual existing-product picker and nested new-product form, then
Payment, Review and Complete. Each sends one product-create request and one
stock request containing the existing and returned new product IDs, quantities
3 and 2, unit costs 4 and 3, and supplier total 18. All four dialogs close.
The narrow Khmer review has visible completion controls and no page overflow.
Browser HTTP responses are synthetic local fixtures, not live stock mutations.
Fixture-only background 404 responses for unrelated inventory panels were
recorded; no clean full-page network certificate or physical-phone result is
claimed.
Production release still follows the existing release procedure.
