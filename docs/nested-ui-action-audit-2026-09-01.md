# Nested UI and action audit — 2026-09-01

Scope: all 14 registered admin pages, visible sections, folded/overflow actions, nested dialogs/sheets, pagination, filter layers, and mobile viewport boundaries. This lane does not certify backend rename cascades, migration semantics, or stock-in report data.

| Main page | Nested sections and drill layers audited | Action/layout contract |
|---|---|---|
| Dashboard | KPI drill, recent sales, sale/product/customer details | Scroll root; five nested detail states remain reachable |
| Notes | Note list/editor and edge widget entry | Scroll root; compact single-page flow |
| Products | Products, stock changes, stock-in sessions, duplicates; detail/form/batches/import/lookup managers | Dense desktop stock/session ledgers, mobile cards, section row, folded actions, pagination, safe dialogs |
| POS | Product search/filter, product detail, quick add, cart/checkout overlays | Floating filters, pagination, compact modal/sheet paths |
| Sales | Sales, returns, expenses, reports; receipt details/cancel/import/export | Dense desktop receipt table/detail, compact references/actions, mobile cards, four equal narrow-screen tabs |
| Branches | Overview (stats + branch cards), Transfer History, RFID; transfer/stock dialogs | One bounded navigation layer; one shared date scope; permission-gated Transfer in both branch views; compact responsive history |
| Contacts | Customers, suppliers, delivery, conflicts; imports/invoices/purchase reports | Dense desktop rows, compact member references/actions, mobile cards, bounded tabs and nested reports |
| Customer portal editor | Display, about, FAQ, AI, publish, business, media and submissions; preview/product flyout/account/contact layers | Permission-gated editor sections use compact responsive control grids; dirty-save/preview remain intact; portalled drawers and floating catalog filters remain distinct |
| Promotions | Rules, discounts, loyalty; rule and discount editors | Dense desktop rule/discount rows with restrained state/type colors, mobile cards, scanner picker and safe dialogs |
| Review & logs | Queue, audit, deleted legacy sales; row details | Bounded no-wrap section row; paginated audit surfaces |
| Receipt settings | Fields, order, delivery, appearance, language, footer, QR, print; mobile preview | Eight-section horizontal row and mobile sheet clearance |
| Settings | Settings, users, backup; internal preference/security/backup sections | Bounded no-wrap hub row; nested pages retain own scroll roots |
| Library | Assets, AI providers, AI responses; preview/details/provider editor | Compact header action row and three nested tabs |
| Server | Status/configuration/recovery sections | Scroll root and section-card containment |

Shared implementation changes:

- `PageHeader` actions remain one bounded, horizontally scrollable row instead of overflowing or forcing another row.
- `SectionSwitcher` has explicit max-width/min-width and touch horizontal-pan containment.
- Review, Settings, and Promotions hub tabs match the bounded no-wrap behavior already used by Branches and Contacts.
- Branches removes the duplicate generic Movement and inner Branches/Transfer History tab rows: Overview, Transfer History and RFID are the only hub sections. Legacy movement handoffs route to Transfer History, which uses the same top-level date range.
- Transfer History desktop rows use a compact `TRF-<id>` reference and consolidated route column with restrained semantic highlighting; the mobile card retains reference, time, route, quantity, note and user without relying on the desktop table width.
- The shared `dense-data-table` contract supplies compact fixed columns, truncation, semantic header tones and keyboard-openable rows on desktop; purpose-built cards replace it below 768 px rather than squeezing columns.
- Sales receipts, Contacts, Promotions, Stock Changes and Stock-in Sessions use the same density contract. Receipt/session identifiers use a compact monospace treatment and clicked details keep aligned product/quantity/cost columns.
- Action permissions are independently enforced in the UI and API for Branch transfer, Sales export/import/status/customer, Promotions manage and Contact conflict resolution; tier-aware history reads do not grant write actions.
- Compact pager keeps accessible Back/Next names but hides their text on narrow screens, preserving one row.
- Shared/admin filter menus, the compact catalog Filters layer, and catalog Category/Brand/Branch comboboxes render through the same body-level floating portal. Opening them never inserts a page row or depends on a scroll container's overflow; positioning is viewport-clamped, observes nested scrolling/resize, closes on outside interaction/Escape, and restores the trigger focus for keyboard users.
- Shared modal headings truncate safely, controls cannot be squeezed away, and padding is denser.
- The profile modal keeps photo/name/role/2FA on one bounded header row, one horizontally scrollable section rail, and a single view-first avatar workflow. Password, OTP and session controls use aligned compact grids/rails while current-password requirements remain unchanged.
- Login recovery pairs related account/code and new/confirm fields on wider screens and collapses them on mobile. Explanations use the shared tap/hover InfoHint instead of increasing form height.
- OTP setup validates QR image data, generates the QR locally from the `otpauth:` URI, and falls back to a selectable manual secret on encoder or image failure. Its portalled dialog uses shared viewport/safe-area classes.
- The customer-portal editor groups compatible visibility, layout, highlight, FAQ, publish, identity, social/contact, media and stock controls into breakpoint-aware rows with `min-w-0` containment. Guidance moves to the shared tap/hover InfoHint, switch rows retain 44px touch height, and the editor reserves mobile bottom-nav plus safe-area clearance without changing draft keys, permission gates, validation or preview behavior.
- Bulk stock and both promotion editors use dynamic-viewport/safe-area bounds with reachable vertical scrolling.

Static certification is enforced by `frontend/tests/nestedUiIntegrity.test.ts` (14 pages / 61 nested contracts), `frontend/tests/denseTableSurfaces.test.ts`, and `frontend/tests/floatingFilterMenus.test.ts`, all wired into the 158-file frontend suite. A local production-build check measured zero document-level horizontal overflow at 1440×900 and 320×568 on the reachable login shell. Runtime browser certification still requires an authenticated local/live session for every permission tier, nested catalog filter path, and destructive-action confirmation path.
