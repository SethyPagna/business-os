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

No deployment, remote migration, production customer read or data write performed in this follow-up. Gender repair requires current-record evidence and separate exact match/ambiguity report before writes. Physical receipt remains unresolved pending printer details. Prior stock-lot migration approval still outstanding.
