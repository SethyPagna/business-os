# Receipt, POS and contacts follow-up

Base live02febdc976c5/documentation2219114e. Separate from stock-lot candidate99ecf7d9, whose migration0157 remains unapproved and undeployed. This follow-up has no migration and is not deployed.

## New requests and evidence

- Physical long receipt still narrow: image codex-clipboard-469e1d95-aa76-4fe3-ba41-58a82566b7af.png. Actual output tests at1/20/40 items with CSS paper honored produce72mm ink width on80mm continuous one-page output for all lengths. Forced98x148 fixed media instead produces64.53/25/15.2mm ink widths. PDFs preserve80mm width. Photo is consistent with fit scaling, not proof of a specific printer setting. Do not claim physical fix or change continuous output to split pages. Await model/print-dialog screenshot requested from owner.
- POS: item count plus totalquantity on same row. Saved Province/ខេត្ត, District/ខណ្ឌ, Subdistrict/សង្កាត់ choices; manageable lists and explicit composed-address Apply preserving house/street prefix. Shared authenticated server persistence, not unscoped browser-only settings.
- Customer gender: original Downloads/customers-template-final.csv found (SHA256a2061f6685bb56f4e00076f7a89030ad5919bb5d80caeee472e8563182e1a63c),5549 rows: Female5389/Male44/blank116. Original workbook correlates but export Id is unsafe:5543 names differ across5547 shared IDs in compared exports. CSV448 duplicatephone groups/978rows, five groups conflict in gender;558 emptydigitphones. Never infer from names or join ordinal IDs. Current production snapshot not read; owner read-only comparison approval requested. No customer records changed. Independent compact-POS/full-contact cache-key test found no projection overwrite.
- Suppliers: one compact card per persisted ID at all widths; full contact options/purchases inside details. Remove directory-style display group rows, not actual supplier records. Preserve pagination totals, invoices, exact-ID relations, export, bulk permissions and longpress.

## Implemented candidate

Supplier UI440c7494; print diagnostic09bb1416 with root translation injection (screen-only dimensions, scale/margins, fixed-media warning; output geometry unchanged); POS/address e14cf2f5 plus security fixesbeca8d8e/5ebe15e3. Address reads require POS access, management full POS; existing settings row pos_address_presets_v1 uses UUID CAS with atomic count-only audit. Dedicated row excluded from broad settings/bootstrap; generic settings mutations reject it before conflict reads/writes, including case/space aliases. No schema migration.

Independent security review caught generic Settings bypass and stale PUT UI publication. Both fixed; final15 actual extracted caller/persist timing cases pass for stale success/error, between-continuation actor switch, sameactor new request and normal writes. Preserve actual dispatched outcomes, suppress only stale UI writes. Native dedicated and sibling route permission/CAS/rollback tests pass.

## Verification and remaining work

Supplier actual EN/KM light/dark320/360/390/1280 geometry has zero overflow and distinctIDs retained. Receipt Chromium320px1/20/40 diagnostics visible only on screen; print toolbar hidden, MediaBoxes/rootwidth unchanged. Final integrated utility/build/cycle and POS browser checks pending. Earlier utility pass383/384 identified naming-only address_prefix collision with sentencefragment guard; renamed address_house_street without weakening the test.

## Final local verification and new incident

Integrated runtime78f74a79 includes request self-invalidation fix1ac0f929, supplier detail translation/wrapping2089f014, and quick-add picker9419947. Real built-browser testing initially caught address GET invalidating its own scope and remaining Loading, plus supplier detail labels/overflow; both were repaired and independently retested. Final384/384 frontend test files, frontend typecheck/i18n, build and20 affected backend scripts/backend typecheck passed. Emitted253 chunks/3013 static edges have zero cycles. Actual fixture browser verifies GET settlement, add/rename/remove, repeated Apply without duplicate suffix, readonly management, order/quick-add isolation, and Khmer supplier details at320px. Evidence: output/playwright/final-78f74a79-browser-review.md. No physical-printer certification.

Owner then explicitly approved read-only production customer comparison. Three SELECTs reported changed_db=false and rows_written=0. All5023 current customers store unspecified gender. Conservative cross-source comparison identifies3869 candidates (3839Female/30Male);1154 excluded/quarantined, including General. Private exact-ID/source evidence and report are in the ignored bos-account-cache-sale-flash-20260912/output/customer-gender-review-20260912 directory. Cause remains unproven. No restoration authorized or performed; any later writes need fresh identity/before-value/uniqueness guards and explicit approval.

Owner next reported blank page, which takes priority. Current candidate remains undeployed. Read-only live cold startup and service-worker-controlled /pos rendered login; assets returned200 and no module/chunk exception occurred. Entry index-R00cExZw.js. Unauthenticated401/bootstrap error did not block rendering. This does NOT certify the owner's signed-in/device cache state. Asked whether before/after login or a particular page, URL and screenshot; explicitly advised against clearing storage because of unsent work. Evidence: output/playwright/live-blank-unauthenticated-review.md. No cause or repair claimed.

No deployment, remote migration or production data write performed in this follow-up. Physical receipt remains unresolved pending printer details. Prior stock-lot migration approval still outstanding.
