# HTML shell cache hotfix — September 20

## Scope and invariants

Only HTML responses may become the shared application document. Metadata, media
and other resources retain their own network responses. Warm revalidation fetches
the canonical document; already-poisoned caches recover without clearing user
storage. Static manifests/icons remain cacheable. No layout, financial, permission,
database or business-write changes. Existing compact UI rules remain mandatory.

## Evidence

- Prior live source5b81a2c3 rendered build JSON at the Sales URL after metadata
  navigation, confirmed by browser evidencec970f084 and native exact-old proof15b51095.
- Runtime candidate92e17a06 integrated as7688a20a; probe test7ecd502c as1fb7c7f1;
  async cache-write test correctiona5c59ef3 as1629f1ef.
- Earlier integrated40873 failed11/12. The async wait predicate accepted a Promise
  before the cache write. This is preserved failure evidence, not waived success.
- Corrected root `node tests/runTestChain.ts sw cache account`:12/12, zero skipped.
  Real Chromium/SW includes natural network poisoning, upgrade, recovery, resource
  bypass, private-cache exclusions and offline shell. Delayed network and dropped
  message replies exercise the two test synchronization defects.
- Frontend40826 typecheck/i18n/build exited0;5892 keys,647 source files,
  269 chunks/zero cycles; public preload excludes admin/file/import code.
- Built artifactcf805522d2fd/hash76b9ca111ec0b69f,2026-09-20T12:09:46.906Z,
  entryindex-DIiWCqvT.js. Only test code differs at1629f1ef.
- Clean Paid/Free dry runs exited0 at1629f1ef. An earlier dirty dry run followed
  a wrong-cwd claim command and is not release provenance. No deployment from it.
- Earlier fullfrontend507/507 and15 browser cases predate this hotfix and blocked
  service workers; do not claim those alone cover this regression.

## Council release decision

One model simulating five perspectives, not five independent experts:

1. Skeptic: passing a mocked navigation test can hide poisoned real caches;
   require incumbent recovery without user-data erasure.
2. Engineer: document MIME and resource routing are different invariants; keep
   static transport validation separate and revalidate only the canonical shell.
3. Expansionist: future coverage should exercise upgrades across every retained
   app version and device lifecycle; that is aspirational, not this release claim.
4. Outsider: a JSON screen is an application failure regardless of prior green
   counts; report the live recovery result explicitly.
5. Executor: reproduce metadata-to-Sales navigation with a real worker, then
   test the same preserved browser tab after the bounded hotfix deployment.

Anonymous cross-critique: A protects recovery but cannot prove update timing;
B minimizes runtime change but needs native browser evidence; C expands useful
coverage but would delay a bounded repair; D demands clear outcomes but supplies
no mechanism; E is observable but one device does not certify every device.

Chairman: ship only after corrected native gates and independent review, then
observe the retained affected tab. Biggest risk is incorrectly assuming automatic
worker replacement has occurred. First action is inspect actual recovery through
normal navigation, without clearing storage or disabling security. Rollback source
also has the old defect, so it is not a claimed remedy for cache poisoning.

## Deployment / live result

Deployed source590a62399d22, Workerfe1e59bf-2c86-4b10-a687-2f08241310e6,
Paid, hashb985da3b86bde911, built2026-09-20T12:15:38.468Z. Deployment55076
exited0;13ms Worker startup. Main and working branch pushed. Independent final
test reviewef0adba6 passes5/5 focused plus3/3 native. The built frontend above
differs from deployment source only in test/documentation files.

Initial retained-tab smoke failed again after metadata navigation (0db22f18).
Independent two-tab native reproductionbaf03c4a proves the missing order: install
fixed replacement while incumbent cache is healthy, leave it waiting, then let
incumbent poison its cache. New HTML is not proof of a new controlling worker.

On the user's subsequent retry, preserved Returns tab460569392 recovered and
another warm reload passed exact new entry (b59050a5). No storage clearing,
logout or worker manipulation. This does not close the metadata/late-upgrade gap.
Follow-up runtime correction is not implemented. No migration or secret sync.
Full application goal remains active. Broad Worker suite now has484 files with
passing evidence after five isolated reruns, not one uninterrupted green sweep.
