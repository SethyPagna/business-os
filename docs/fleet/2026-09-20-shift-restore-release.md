# Shift and restore-safety checkpoint — September 20

## Deployment provenance

- Source: `5b81a2c344bd`, clean tracked worktree; GitHub main and working branch pushed.
- Worker: `f2539627-98f6-45b8-a908-7910ae2f0dce`, Paid.
- Worker hash: `be6b7506eebe419b`, built `2026-09-20T11:41:22.535Z`.
- Frontend: `6f608476ed25`, hash `d73469dc0c9c67d5`, built `2026-09-20T11:30:29.890Z`.
- Entry: `index-NibItPYk.js`. Only documentation differs between frontend source and deployment source.
- Deployment handle94398 exited0. No database migration or secret synchronization.
- Previous Worker rollback reference: `49b64606-d25a-4894-b630-6baa371005d1`, source `cbbebe5841f8`.

## Included changes

Shift selection/history pagination, single-query count/page consistency, stale-scope
mutation completion fencing, History Next stability and real Refresh freshness.
Plain compact pager shows full range and page totals in EN/KM; oversized numeric
drafts stay bounded, valid large values and Back/Next labels remain usable.
Other pager branches are unchanged.

Restore/reset custom-table metadata is validated before destructive operations.
Both database restore passes use the same R2 upload identity before deletion and
consume the already-held source stream. This does not make the entire restore
transactional; failures after deletion still retain maintenance for recovery.

Only proven-unused LoadingScreen was removed; active root error recovery remains
tested. Report test now requires an actual sort commit rather than permitting a
false pass with sorting inactive. No approved financial rules were changed.

## Verification

- Frontend full57621: **507/507**, zero skipped, exit0; 452169ms test execution.
- Exact built app browser90516: **15/15 in one uninterrupted run**, desktop/Android/iOS.
- Actual320px Khmer screenshot reviewed: `241-245 / 245` and `13 / 13` fully visible in one row.
- Pager four handler/ten browser tests include hydrated oversized input and old-layout negative controls.
- Root backup source20 cases plus old-source substitution negative control; six native R2 cases.
- Backup18, custom-table33, stock-session guards, seven legacy/scoped restore cases,
  replay coverage, streaming13 and multipart11 checks pass.
- Affected Shift frontend/Worker tests, both typechecks, i18n5892 keys/647 files, build pass.
- Built graph269 chunks/zero cycles; public preload excludes admin/file/import code.
- Free/Paid dry-run19765 exits0; config validity only, not Free capacity certification.
- Broader safe Worker sweep is still running separately; it is not claimed green here.

## Live smoke: cache defect blocks a clean release verdict

Normal signed-in browser loaded Dashboard and expected entry script. An older cached
build recovered through the app's own update mechanism to the expected frontend
hash. Reports, Shift report/history/Refresh, Returns and public About rendered.
Both origins loaded the expected entry. However, after ordinary navigation to
build metadata, a subsequent Returns URL reload rendered raw build JSON instead
of the app. Evidence c970f084; failing browser tab retained for verification.

Source diagnosis confirms the service worker accepts any successful basic response
as a document, then stores the original navigation response under /index.html.
Thus a metadata navigation can replace the cached HTML shell with JSON. This is
an existing defect also present in the rollback source; rolling back this checkpoint
would not fix it. An isolated correction and service-worker-enabled browser
negative control are underway. Do not call the release fully smoke-green. Do not
clear account storage or unsent work to hide the failure.

Raw unauthenticated HTTP was challenged by Cloudflare. Browser metadata navigation
returned an application shell for build JSON and ERR_BLOCKED_BY_CLIENT for runtime
version, so it does not independently verify Worker metadata. The eventual raw JSON
did confirm the exact frontend build metadata. No protection bypass
was attempted. Deployment provenance above is from Wrangler's successful deployment.
Browser-extension connection errors are not represented as an app-console-clean pass.

## Not completed by this checkpoint

Transfer tracking/admission migrations and complete Returns exports remain isolated;
historical replay, restore lifecycle integration and native proofs continue. Earlier
restore UI confirmation identity, late asset identity, and full Free backup/restore/
reset capacity are unresolved. Schema-discovery consolidation is isolated and under
review. Public/privacy, physical-device/receipt validation, data ambiguities and safe
directory consolidation retain their ledger status. The full goal remains active.
