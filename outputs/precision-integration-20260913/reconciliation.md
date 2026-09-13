# Precision integration reconciliation — 2026-09-13

## Candidate pin

- Root candidate: `373be9a9e68b7392cc9b11339237d6d661d00063`
- Integration branch: `codex/precision-integrated-20260913`
- Isolated worktree: `C:/Users/mrkl6/Downloads/bos-precision-integrated-20260913`
- Integrated content head before this evidence-only commit: `f7b67994`
- No production action, remote migration, secret sync, deployment, or remote D1 command was run.

## Ordered source provenance

- Reports: `d8d83535`, `3fa88242`, `5be298a5`, `0ef4adcd`, `ae0fd752`, `10492f3f`, `dabfc8fc`, `0392b92d`, `002e4b7c`. Excluded temporary composition `0eeefdb5`.
- Backend core: `24b9904c`, `ae3a63b7`, `bd5d1efc`, `8987e97c`, `8b3a607f`, `6478a444`, `cee3455e`, `4109cc12`, `fc05e269`, `5f834441`, `5fd6221a`, `ccf2fe8a`, `165042b5`, `b21ba19f`, `08b4c008`, `6a9abce5`, `9eace6e6`, `9abb31f6`, `8b61a349`, `e2dbe612`, `d83b129d`, `cd2b9b99`. Patch-equivalent helper commits `3cf4ee85`, `cd1e909b`, `5b465cbd`, and `9a1d526f` were not duplicated. Report dependency copies `a2132148`, `7fce0adc`, `d001eda5`, `b4d502b1`, `c1d8895e`, and `7d2f599b` were replaced by the authoritative report chain above.
- Returns: `f56abdda`, `e1d8d1e`, `2f35b343`, `4e9ec926`, `86cf2970`, `798808f7`, `5942356b`, `4d0ab860`, `8201532b`, `15d9f454`, `ff337f8d`, `6f298850`, `3f1836ba`, `2a5f10fb`. Excluded local merge `3266e3ee`, verification-only dependency `5942f42b`, core dependency copy `1a15a4a7`, and the `b21` parent chain.
- Frontend: `3cc67741`, `4277a8d1`, `76dacaa4`, `417b7974`, `dd6fb773`, `31631e18`, `48598fa4`, `8b45234c`, `47788542`, `00cdff36`, `134cdbae`, `c458a2e3`. Earlier patch-equivalent commits `e4e1adb2`, `3d38a7da`, `21356698`, `cde5b55c`, `558ec077`, `69da019b`, `a5472d0b`, `7d51ef2c`, `cdb50801`, `38be192e`, `807024c2`, `b14e8ac3`, `cdefd7ae`, and `a924c46b` were not duplicated. Locale copy `eda008f8`, return frontend `19197d2e`, generated public JavaScript, locale files, fees, and Records files were excluded.

## Exact owned-path manifest

### Reports

`cloudflare/src/index.ts`; `cloudflare/src/lib/reportMoneyPrecision.ts`; `cloudflare/src/lib/salesAnalytics.ts`; `cloudflare/src/routes/reports.ts`; `cloudflare/scripts/test-report-money-global-errors-native.cjs`; `cloudflare/scripts/test-report-money-reader-native.cjs`; `cloudflare/scripts/test-reports-cost-visibility-pure.cjs`; `cloudflare/scripts/test-reports-list-route-contract-pure.cjs`; `cloudflare/scripts/test-reports-waterfall-pure.cjs`; `cloudflare/scripts/test-sales-analytics-pure.cjs`; `cloudflare/scripts/test-sales-day-report-pure.cjs`.

### Backend core

`cloudflare/migrations/0159_sale_item_pricing_snapshot.sql`; `cloudflare/src/routes/sales.ts`; `cloudflare/src/routes/products.ts` (only the approved `ccf2fe8a` search/bootstrap hunks); `cloudflare/src/lib/paymentSettlement.ts`; `cloudflare/src/lib/promotionRules.ts` (only the approved `4109cc12` percentage hunks); `cloudflare/src/lib/productMergeLineage.ts`; `cloudflare/src/lib/saleAmendments.ts`; `cloudflare/src/lib/saleCreationSnapshot.ts`; `cloudflare/src/lib/saleItemPricing.ts`; `cloudflare/src/lib/saleLineAddition.ts`; `cloudflare/src/lib/saleLineEdit.ts`; `cloudflare/src/lib/saleMutationHeaderQuote.ts`; `cloudflare/src/lib/saleRecords.ts`; `cloudflare/src/lib/saleSettlementAction.ts`; `cloudflare/src/lib/saleTotals.ts`; `cloudflare/src/lib/undoAppliers.ts`; `cloudflare/scripts/test-product-merge-lineage-native.cjs`; `cloudflare/scripts/test-product-search-money-policy-pure.cjs`; `cloudflare/scripts/test-promotion-policy-v1-pure.cjs`; `cloudflare/scripts/test-sale-item-pricing-native.cjs`; `cloudflare/scripts/test-sale-money-writers-native.cjs`; `cloudflare/scripts/test-sale-mutation-header-quote-native.cjs`; `cloudflare/scripts/test-sales-report-consumers-native.cjs`.

The root versions of `cloudflare/src/lib/deliveryAmounts.ts`, the shared money kernels, and released `test-sale-add-items-pure.cjs`, `test-sale-amendments-pure.cjs`, `test-sale-records-pure.cjs`, and `test-undo-appliers-pure.cjs` were preserved.

### Returns

`cloudflare/migrations/0160_customer_return_refund_snapshot.sql`; `cloudflare/src/routes/returns.ts`; `cloudflare/src/lib/customerReturnEntitlement.ts`; `cloudflare/src/lib/returnCreateAction.ts`; `cloudflare/src/lib/returnBulkAction.ts`; `cloudflare/scripts/test-customer-return-entitlement-native.cjs`; `cloudflare/scripts/test-return-create-action-pure.cjs`; `cloudflare/scripts/test-returns-batch-restock-pure.cjs`; `cloudflare/scripts/test-returns-bulk-pure.cjs`; `cloudflare/scripts/test-customer-return-create-d1-native.cjs`.

### Frontend

`frontend/src/api/salesTransport.ts`; `frontend/src/components/pos/CartItem.tsx`; `frontend/src/components/pos/POS.tsx`; `frontend/src/components/pos/posCore.ts`; `frontend/src/components/receipt/Receipt.tsx`; `frontend/src/components/sales/saleAddLines.ts`; `frontend/src/components/sales/SaleDetailModal.tsx`; `frontend/src/components/sales/Sales.tsx`; `frontend/src/platform/runtime/clientRuntime.ts`; `frontend/src/utils/directMutationRequest.ts`; `frontend/src/utils/promotionRules.ts`; `frontend/src/utils/receiptLineMath.ts`; `frontend/src/utils/receiptTotals.ts`; `frontend/src/utils/saleItemPricing.ts`; `frontend/src/utils/saleLineEditor.ts`; `frontend/src/utils/saleMoneyV1.ts`; `frontend/src/utils/saleMutationHeaderQuote.ts`; `frontend/tests/directMutationRequest.test.ts`; `frontend/tests/posMoneyV1.test.ts`; `frontend/tests/promotionMoneyV1.test.ts`; `frontend/tests/receiptLineMath.test.ts`; `frontend/tests/saleDetailPosParity.test.ts`; `frontend/tests/saleItemPricingParity.test.ts`; `frontend/tests/saleMoneyV1.test.ts`; `frontend/tests/saleMutationHeaderQuoteParity.test.ts`.

## Integration-only resolutions

- `frontend/tests/directMutationRequest.test.ts`: preserved the root `sourceUrl` / `sourceRequire` loader form with explicit frontend-owner approval; all financial test changes from the source chain remain.
- Three report harnesses received report-owner-approved test-only dependency composition updates after the combined core/report/return tree exposed missing local TypeScript dependencies. No runtime source or assertions were changed.

## Verification and unresolved scope

- Passed: frontend and Worker typechecks; eight affected frontend test files; the nineteen selected backend report/core/return scripts after the report harness composition correction, including the 40-check return route suite and native workerd/D1 return test.
- This is an integrated local candidate, not a full-repository certification. Independent final verification of the combined tree is still required.
- Core `d83b129d`/`cd2b9b99` merge/undo authority repairs were not independently re-certified as a whole by this reconciler; the focused product-merge lineage script passed.
- A reviewer recorded a pre-existing, source-inferred return-cancellation sequence-gap risk; it was not reproduced or changed here.
- No browser/device, production data, deployment, or remote migration claim is made.
