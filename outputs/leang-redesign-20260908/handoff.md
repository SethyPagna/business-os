# LeangBeauty redesign — verified candidate, not deployed

Base: 6dbb8a8e3029e220cbec650051a4d7c37a6da2c9 (recorded live release).
Implementation head: c707d53050ef4ab1e2cd62a2a687367085277eef.
Branch: codex/leang-redesign-20260908.
Worktree: C:/Users/mrkl6/Downloads/bos-leang-redesign-20260908.

Apply ordered commits: 62152812 (public galleries), 102f2268 (compact sticky discovery/social/footer/FAQ), f377d2da (product contrast), 6b165ac5 (translation/detail refresh), c707d530 (admin scroll lifecycle).

The search and Filter controls share the section navigation sticky container using a portal mount. Removed the desktop filter sidebar and duplicate About social row. Header/footer socials stay in one horizontal row. Policies are direct links, retaining modal history, keyboard focus and social-row inert behavior. Seller-readiness banner removed from presentation only; server publication checks are untouched. FAQ states points earning/redemption are not enabled in English and Khmer. Product sections have stronger headings, boundaries, body contrast and opaque light/dark sheet backgrounds. Both storefront/admin scroll buttons use small translucent rounded boxes; admin controls hide at top and show after220px, tracking page swaps and cleaning listeners/observer.

Gallery: bootstrap, catalogue and search attach ordered saved gallery images by exact product ID, with sanitizer, deduplication, fallback and existing5-image limit. No sibling-variant image mixing. No data migration or image assignment changes.

Refresh: stalled external translation now shows failure in place rather than repeatedly navigating. Product detail open disables page pull-to-refresh. Existing stale-code/module recovery can still reload intentionally; this candidate does not claim all reload paths removed, or reproduction of the owner's specific live event.

Verification at implementation head:
- Frontend typecheck, verify:i18n (5392 keys/570 sources), production build1107 modules passed. Final build log has no circular chunk warning; PortalSocialLinks has explicit catalog-public placement. Existing large-chunk warning remains.
- Worker typecheck passed; actual Hono/SQLite gallery tests6/6 and stock-redaction pins6/6 passed.
- Nine focused frontend files passed: leangRedesign, portalCatalogDisplay, portalLegalFocus, portalLegalContent, portalAccessibility, portalFaqVocabulary, portalProductGrouping, portalTranslateController, globalScroll.
- Independent verifier found no blocking defects at exactc707d530. Its report's final-build pending note is superseded by this final passing build log. Browser evidence was supplied by lead, not independently re-executed.
- CUA local synthetic fixture:375px sticky nav top4/bottom125 after scrolling, search inside same nav;320px document width320, filter dialog left9/right311;1280 desktop contained, compact Filter visible, no sidebar. Social links share top coordinates at320. FAQ has exact disabled status and no misleading empty state. Direct Privacy link opens; Escape removes query and restores Privacy Policy focus; both social rows inert while reader open. Next image marks Image2 of2 current. Dark product sheet computed background rgb(23,23,23), no underlying text bleed.
- Browser fixture validates layout/gallery navigation controls; product-image decoding against live saved files was not certified. Backend runtime fixture verifies returned gallery paths and identity. No physical iOS device test or full broad certification sweep.

No production mutation/deployment. Original dirty shared worktree untouched. The other active task retains release coordination and progress.md ownership. No shared EN/KM pack writes: public FAQ uses inline bilingual fallbacks; optional mirrored keys are in locale-additions.json.
