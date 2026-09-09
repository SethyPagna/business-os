# Transfer, UI and public-site review — 2026-09-09

This review records the change that is live and the work that remains. It is deliberately separated from the deployed data-correctness changes so a later visual pass cannot change stock or sales behavior by accident.

## Transfer

### Observed before

- The transfer modal used a 12-second mutation timeout. A real lot move could still be committing when the client declared failure, which made Shop → Warehouse appear unusable and encouraged a retry.
- The picker had to preserve the canonical pair (Shop sells; Warehouse never sells), the source branch, destination branch, product identity and optional received-date/lot identity. A selected lot could not exceed either its own available quantity or the source aggregate.
- A retry receipt/idempotency contract was not present at the server boundary, and transfer audit entries are written after the stock statements. Those are durability risks even after the timeout fix.

### Live behavior after `b312c331`

- Both Shop → Warehouse and Warehouse → Shop are accepted through the same canonical branch guards. Warehouse remains disabled in sale-side pickers.
- Single transfer waits up to 45 seconds; bulk transfer waits up to 90 seconds and sends bounded chunks of 200. The client reports an uncertain outcome instead of claiming a failed write when the wait expires.
- Lot-aware caps use the minimum of selected-lot availability and source-branch aggregate availability. Non-finite availability is rejected. The response carries destination lot identity when available.
- Focused tests passed: canonical branch route (10), lot transfer (6), inventory lot transfer (7), canonical identity (7), plus Worker typecheck.

### Still required

F73 remains open: add a server idempotency/receipt key, make a replay return the original result without a second stock movement, and record an intent/audit before stock mutation. Verify timeout, retry, rollback and audit ordering with an uncertain network test. This is the next transfer reliability checkpoint.

## Mobile/admin UI

### Observed before

- iOS could apply browser pinch zoom to the whole app. The resulting second scale pushed stock-change dialogs, report controls and compact Sales rows beyond the viewport; this is the defect shown in the supplied video/screenshot.
- Page roots had separate public shells that explicitly opted into `pan-y pinch-zoom`, while the viewport tag had no `maximum-scale` or `user-scalable` guard.

### Live behavior after `e093b5c5`

- `index.html` caps browser scale at 1 and disables page pinch zoom. Admin and public roots use vertical page pan; the image gallery/lightbox still has explicit zoom controls for inspecting a product image.
- The focused `mobileViewportGuard.test.ts` asserts the viewport contract and both public/admin root touch-action contracts. Frontend typecheck, i18n parity and production build passed.

### Remaining UI work

- Physical iOS PWA verification is still needed at 320/375/390 px, including safe-area margins, keyboard focus, modal close/back/discard/minimize behavior and the desktop device-toolbar emulator. The browser tool itself must be distinguished from an app defect.
- The broader compact pass remains queued: mobile Sales metadata and actions, report filters/breakdown tabs, date/stat rows, branch/transfer headers, subpage icons, and consistent button heights. Each should be implemented as a small surface-specific commit with an EN/KM source test and a 320/375/390/1280 layout check.
- Do not remove explicit lightbox/image zoom or the 16 px mobile input floor; those are separate from browser/page scaling.

## Public storefront and customer portal

### Current implementation found

- The public route uses document-owned vertical scrolling with horizontal clipping containment and safe-area top/bottom handling.
- `PortalFooter` and `legal/LegalPages.tsx` expose Privacy Policy, Terms & Conditions and Cookie Policy links at the bottom of the public page. The policy content names the business details, necessary storage, optional third-party translation/map/assistant behavior, retention, rights, image concerns and Cambodian governing law.
- Account creation/sign-in requires an explicit policy consent checkbox. Screenshot submissions require both privacy and image-rights consent. No advertising or analytics cookies are claimed by the current storefront copy.
- Product detail, gallery, FAQ, account, shortlist/wishlist, translation and map features are wired through the public route. External translation/map/AI are opt-in surfaces and are documented in the cookie/privacy copy.

### Before/after target for the next visual pass

| Surface | Current risk | Target after the queued pass | Acceptance evidence |
| --- | --- | --- | --- |
| Header + section nav | Long Khmer/business names can compete with controls | `min-width:0`, truncation with accessible full labels, icons and a one-line compact mobile nav | 320/375/390 screenshots; keyboard tab order |
| Search/filter | Controls can consume the first screen on phones | One compact filter trigger, horizontally scrollable chips, no page overflow | narrow viewport scroll-width assertion |
| Product cards/detail | Image and description lengths vary | Stable card grid, readable price/stock, detail flyout inside safe viewport | EN/KM render and image fallback test |
| Legal footer | Long policy labels can wrap into a tall row | Compact policy button row with visible focus and safe-area bottom padding | footer link and focus test |
| Consent/forms | A missing label or unclear optional field is easy to regress | Explicit `for`/`id`, clear action text, error next to field, keyboard-only completion | accessibility source test + browser keyboard smoke |
| Third-party features | Loading an embed can change layout and storage | Keep map/translation/assistant opt-in and lazy; reserve space before load | no third-party request before opt-in test |

The current legal copy is a template and explicitly tells the owner to obtain qualified legal review. Local legal applicability, business registration details, retention periods and image licences must be confirmed by the business owner before treating the text as legal advice. The code does not claim ownership of third-party product images; owner-taken images remain the preferred source.

## Release evidence

- Release branch: `codex/sale-create-trigger-release-20260909` (clean and pushed).
- Commits are fix-scoped: `b059237a` (shift additional cash/expected drawer), `b312c331` (transfer timeout/cap), `e093b5c5` (mobile viewport guard), and `7b72cd7c` (test-contract alignment only; no runtime change).
- Live Worker: `718a3d15-8d64-4b5c-88de-2f486b5b48e7`, deployed from `e093b5c5` at approximately 2026-09-09T10:31Z; migration `0147_shift_additional_cash.sql` is remote D1 migration row 143.
- Full frontend utility gate: 346/346 passed, including typecheck, public-runtime verification and source syntax preflight. Cloudflare Worker typecheck and focused shift/transfer suites also passed.
- Logs: `shift-additional-cash-migration.log`, `shift-transfer-deploy.log`, and `mobile-viewport-deploy.log` in this directory. Cloudflare’s unauthenticated HTTP challenge prevented a direct runtime endpoint read; the deployment CLI completed successfully and reported the full Worker version.
