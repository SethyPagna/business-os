## Owner correction: Not Paid must deduct stock — September 9

The owner explicitly confirmed that awaiting_payment/Not Paid deducts stock. Earlier ledger claims treating released allocations and preserved stock as correct are withdrawn. Live 4aba954f has the recovered product lines, but three awaiting-payment sales 16952/16953/16954 still need stock correction: four quantity-one lines, fully released allocations, no sale movements. Exactly these three awaiting-payment sales exist in the fresh production census. Completed16951 already deducted36 once and must stay unchanged.

Backend canonical status behavior and guarded historical correction are under separate read-only investigations before implementation. Settings12s timeout/error translation remains active; root transport WIP is preserved in outputs/takeover-20260909/write-timeout-transport-root-wip.patch and not deployed. Edit Customer alignment added as F79; timeout/i18n F78. All earlier tasks retained; no new production writes yet.

## Sales recovery Records checkpoint live — September 9

Commit 4aba954f53d52cdff762b6a9b8413735139c547c is live at 100%; Worker 175c9438-c783-45d9-b92e-e9962ca61580, deployment 5bddcc0a-af46-40a8-b2dc-966f4114e769 at 08:07:58 UTC. Independent Records review passed, affected tests/types/i18n/build and clean dry-run/deploy passed. Fix-scoped commits pushed; no migration.

Normal Admin UI refreshed to the new version. Saved receipt 16954 shows its SK-II product. Records now displays the recovery event, product lines 0 to 1, and released allocation/no stock deduction in both English and Khmer. Variant confirmation input IDs are unique. All four incident receipts are repaired; all-history header-only product-snapshot census is zero. No subsequent real checkout was observed, so actual phone checkout remains unverified. All 108 owner tasks remain in the current register; full transfer durability, cleanup and later UI/public work remain open, offline paused.

## All four incident receipts recovered — September 9

Fourth recovery operation bfaebe1d-4435-4d5e-820d-b6ed439dc475 applied at 07:55:37 UTC after backup. Receipt 16954 now has its SK-II product, quantity 1, total 185 and proven cost 170; released allocation, no stock movement, product/Shop/batch stock remains 7/5/5. Normal Sales list and saved detail both show the product. Previous three repairs remain intact. Four recovery histories and audits exist; guard is empty. All-history census finds zero remaining header-only sales with nonempty product snapshots.

Live remains 92ddfc6d; Records display checkpoint is under independent review. No new real checkout since the hotfix was observed, so phone checkout is not claimed validated. All 108 tasks remain tracked; broader transfer durability and deferred UI/public work remain open; offline is paused.

## Fourth-receipt recovery checkpoint live — September 9

Commit 92ddfc6d0e39978f5410fa79fae1bace59ae8842 is live at 100%; Worker e0e58fc7-4035-4e08-a5b9-03976df1a4a2, deployment ffb756a5-802a-445c-a4c6-4422d1758375 at 07:34:33 UTC. Independent review and affected package gates passed. No additional migration.

Receipt 16954 fresh preview confirmed one missing line, total 185 unchanged, released allocation without stock deduction. Exact digest 3b5a3504bace192ba3d5968f89e860fced6e2f00e89a16c29e112ba7103990fe was submitted once through normal Admin UI; backup/apply is pending. First three repairs remain verified. Records recovery labels are under independent review. All 108 tasks retained; UI/public work deferred and offline paused.

## Three incident receipts recovered and verified — September 9

Normal AdminUI operationc2620a5d-84d8-4eca-a117-94a7368acef8 applied07:19:33UTC fromfreshdigestb828c09a8ef1ef0288a93e0ba9aade8676c635f21d49f6e74ce4c183bb550278 afterbackup. D1postread:16951oneitem36units342, product4208stock252/Shop60/batch60, exactlyone-36movement;16952oneitem299bothdeliveryfields2.7;16953twoitems40. Threehistories/threeaudits, guardempty. UIlistand16951detailsnowshowproductsandquantities.

16954stillunrepaired, v2candidate9c343f75underreview withpre-salecost170/0proved. NewrecoveryauditcurrentlyrendersgenericEarlier sale change/Historical details unavailable; underlyingauditcomplete, projectorfixqueued. Livefbdunchanged, all108tasksretained.

## V1 recovery checkpoint LIVE; reviewed operation submitted — September 9

Livefbd48c7c446deff6982d1244c38496602e31c87e at100%, Workera0a92169-f3d4-4507-91e9-165cb0f783f6, deploymentd1081b35-f183-4cb1-b2b1-96ed76c104f1 at2026-09-09T07:12:45.179367Z. Independentbackendreview, focusedbackend/UItests, types/i18n/build, clean dryrun/deploypassed; fix-scopedcommitspushed. Migration145appliedandrecorded07:11:24; all businesscounts/sumsunchanged,3newrecoverytablesempty. Pre-migrationbookmark00001463-00000062-000050e1-7f7e44292617d873a224be2d0df92cea retained.

Normal AdminUI freshpreview3receiptsreviewedand exactdigest b828c09a8ef1ef0288a93e0ba9aade8676c635f21d49f6e74ce4c183bb550278 submittedonce. Backup/applyinflight; do notclaimreceipt repair complete yet. Fourth16954cost170/0provenfromprivatelypreserved00:00backup, separatev2underimplementation. All108tasksretained; no offline/UI/publicscopeexpansion.

## Transfer stock-limit checkpoint LIVE — September 9

Commitc758ce821502efae48cbb3169ed865336e6614dc live100%; Worker2fc4d161-c58e-43a2-9ade-ad4e75f7df2e; deployment9d127f28-548f-42f9-88cb-b67110d87624 at2026-09-09T07:05:14.669227Z. Independent final review PASS, focused transfer/role/reason tests, frontend types/i18n/build, clean dry-run/deploy; pushedfix-scopedcommits. No migration. Cap respects selectedlot andaggregate; nonfinite inputfailsclosed. AdminUI sourceShop/destinationWarehouse selectable, inspectedwithoutstockmutation.

Fourreceipt recovery stillpending. V1three-proven-receipt helper/UI integrated for releasegates;145notapplied. Fourthcost nowproven170/0 frompreserved midnightbackup and image-update revisionevidence; v2separateimplementation. All108tasksretained; UI/public/iconslater,offlinepaused.

## Incident census widened to four pre-hotfix receipts — September 9

Fresh all-history query found exactly4 header-only sales with nonempty product snapshots:16951,16952,16953,16954. The fourth receipt20260909-130228 was created06:02:29UTC before the06:23 hotfix; awaiting payment185, product5370qty1. No new sales observed sincehotfix during this read. Fixed-target recovery expanded toall4, not yet applied. e408 remainslive.

## Atomic sale creation checkpoint LIVE — September 9

Commit e408f31f18744f2de578719de06e97adb1ccd032 is live at100%; Worker e84cc3f1-748e-4123-bca9-0ccf4f7c326a, deployment87599618-10b9-451e-9463-b568db574b5f at2026-09-09T06:36:04.593034Z. Exact tree matches independently reviewed4285586e. Native D1/atomic failure injection, customer, lot and damaged-stock suites, Worker typecheck, clean frontend build, dry-run/deploy and pushed fix-scoped commits all verified. No migration.

Header, items, allocations, stock, movements and creation audit now commit together; recovered saves also invalidate caches. Historical16951/16952/16953 remain unrepaired.16952 amendments prove fee edit caused itemless total299→0; preserve newer actual/fee2.7 during repair. Fixed-target receipt-backed recovery helper/migration0145 being prepared, not applied.

Transfer diagnosis: canonical branches healthy; Admin has30 successful Shop→Warehouse transfers. Employee inventory/branches absent, consistent with existing scope. Eight products show lot availability above aggregate; a bounded UI max fix is assigned. All108 owner requests retained. UI/public/portal/icons later; offline paused; duplicate execution held.

## Urgent checkout hotfix LIVE — September 9

Commit38d27e0371244888530c29568436d564cb81263e is live at100%. Worker2838266c-c0a2-43f8-83e0-441817ed121a; deployment17fabcb5-43fa-4f5d-ae5a-ea0511e7a294 at2026-09-09T06:23:43.4937Z. Independent review, native Miniflare D1 regression4/4, customer guard regression, Worker typecheck, final clean frontend build and clean dry-run/deploy passed. Branch pushed; no migration.

Confirmed cause: sale INSERT trigger makes D1 report2 changed rows; old exact-one check persisted header then rejected before items/stock. New saves accept successful trigger-inclusive metadata; incomplete idempotency replay now returns409 rather than false success. Printed receipt snapshot can contain products while saved preview lacks lines. Both General and named customers were affected.

Atomic header/items/stock/audit phase f5b2adc7 is under independent review. Existing affected sales16951/16952/16953 are not yet repaired; cost evidence and16952 subsequent edits require reconciliation. All108 owner tasks retained. Priority: urgent sales/POS and transfer. UI/mobile icons/public/customer portal deferred to later checkpoint; offline paused and duplicate execution held.

## Urgent zero-item sale incident; owner priorities updated — September 9

Live remains 882136b7. New F77: receipt 20260909-101913 (sale16951) has header342 but0 persisted items and no matching sale movements/audit; creation snapshot proves36 units of product4208 at9.50. Two more September9 headers16952/16953 also have0items; preserve subsequent edits (16952 total is now0). Atomic creation/idempotency prevention assigned; no recovery mutation performed. Product merges are held.

Video IMG_2870.MP4 and screenshots show iOS clipping and viewport/input zoom issues. Mobile fit review and transfer recovery run independently. Owner now prioritizes sale integrity, transfer, mobile UI/icons and compact public/customer portal. Offline F55 paused explicitly. All108 requests and9 review observations retained.

Ledger correction: production branch IDs are1 Warehouse and2 Shop. Earlier cleanup stock totals were conserved but their prose labels were reversed:11962 was Warehouse,12418 Shop. No stock or branch mapping was changed by this correction.

## Merge performance checkpoint LIVE — September 9

Live commit 882136b7d85177851b413e151a5baef6eefdff4f is independently verified at 100% traffic. Worker c222f571-ba39-4a18-bfd2-7204b9db229e; deployment 44843e46-db32-476d-849c-958d82e91799 at 2026-09-09T03:25:24.619084Z. Clean dry run and deployment exited 0; all triggers succeeded. Fix-scoped commits pushed. No migration.

The merge now uses IDs returned by its atomic database batch, removing two serial discovery reads while retaining the legacy fallback, fingerprint checks, audit and Undo. Backend certification: 319 unchanged suites passed in the full sweep, then both corrected test contracts passed at the final head; focused partial/Undo and Worker typecheck passed. Frontend runtime is unchanged from the 341-test checkpoint; final-head build and independent security review passed.

Three checkpoints deployed this continuation: General repair, interrupted-merge recovery and the database-read optimization. General 24969 is repaired; real customer 22305 is unchanged. 174 product merges are recorded in total, with 166 new merges verified this run. Last fresh preview: 1,774 eligible remaining and 19 quarantined groups. No new product merge is in flight. Physical phone/PWA validation and remaining cleanup are not complete.

All 107 owner requests plus 9 nonblocking review observations remain tracked in Current-status.md and task-status.json. Financial census is complete; cause analysis and guarded correction remain open. Next: cleanup, transfer, UI, public site, offline.

## Merge recovery checkpoint LIVE — September 9

LIVEf4a10cb2710586dbe1cd8ad2244752b17d335e73 at100%; Workerb9ce0c89-8f50-4d54-826b-e458b0d95922, deployment93fee51e-7b60-4b65-8e8f-213977d6372b at2026-09-09T02:35:40.241998Z. Clean dry-run/deploy exit0;341 frontend tests/types/i18n/build and independent finalhead review PASS. No migration; fix-scoped commits pushed.

Interrupted merges now retain bilingual recovery, invalidate stale previews and require a validated fresh scan before retry. Live preview verified1793groups/1812candidates,19quarantined,1774eligible; no further merge started.174total recorded merges includes166 verified thisrun. Batchmetadata speed fix is underimplementation; fullcatalogcursor optimization deferred.

General24969 repair remains applied; real22305 protected. Freshcontactcensus confirms2name-only supplierclusters (10/6members), customertriple withmembershipconflicts and2stalephonekeys; no blindmerge. Financialcensus found30negativeKHRdiscountcells needing paired-snapshot review; signedchange may bevalid,100productlossgroups needcauseevidence withoutclamping. All107requests retained. Cleanup continues, then transfer, UI, public site, offline.

## General cleanup checkpoint LIVE and repair applied — September 9

LIVE522a780d76b54917cc84db9949e67a49d42ee1da at100%; Worker ef096149-20c5-4de1-ab95-ea0c91828959, deployment38e8108a-3070-4576-93f6-fbbed48bcac9 at2026-09-09T01:29:57.100127Z. Clean build/dry-run/deploy exit0, independent review PASS, frontend340/340 and backend321/321 passing evidence. No migration. Fix-scoped commits pushed.

Normal Admin UI backed up and marked confirmed General24969 at2026-09-09 01:52:30. Its5 sales/1 return retained; real22305 remainsmarker0 with152 sales and unchanged version. History535 and audit4466; UI reports verified completion.

Product cleanup saved166 additional merges (174 including8 earlier). All166 new histories undoable,166 snapshots applied with0 pending fingerprints,166 audits; Shop11962/Warehouse12418 stock unchanged. The run stopped; exact network cause unknown. Stale preview/transient error bug confirmed and recovery fix under review; remaining cleanup not complete. All107 requests retained. Next: cleanup, transfer, UI, public site, offline. Employee phone smoke, wide Records0143 and transfer0139 remain open.

## Cleanup resumed after verified Employee checkpoint — September 9

Production remains1791eaf7 at100%; Employee role rollout is verified. Cleanup is now active. Recovered the clean General repair helper at124eb57a (commits21d98ffe and124eb57a), its eight prior SQLite groups and saved handoff. Independent helper review and the current protected admin route/UI plan are running before implementation. Stale helper claims released after preserving the checkpoint; no source discarded.

A separate read-only agent is mapping the remaining product/contact/supplier duplicate cleanup evidence. Only eight earlier production product merges are recorded as completed. General24969 remains unmarked,22305 remainsnormal; no cleanup mutation has occurred. All107 requests and the two review observations remain tracked. Transfer, UI, public-site and offline work follow cleanup.

## Employee/return checkpoint LIVE — September 9

LIVE 1791eaf701d767da7109012b3ecd7e89f514c2f1, Worker 936417e0-911a-472e-b666-f7bf6321d7e5, deployment fc7eae67-ecdb-4464-9b76-d25762a4434b, independently verified at 100% traffic on 2026-09-08T23:17:48.005495Z. CLI exit 0; all domains, cron and queue triggers succeeded. Frontend339/339 and backend319/319 have passing evidence; types, translations, build, clean dry-run and independent final-head review pass. Migration0142 applied; recorded business totals unchanged and new receipt/guard tables empty before rollout.

Existing Employee role3 saved through the Admin UI at 2026-09-08T23:45:07.129Z, audit4299: all11 original keys preserved and exactly five false Sales/Returns bulk/import/export keys added. Both user overrides unchanged. Production-role data and deployed permission-kernel checks pass; an already-open Employee phone session was not tested.

All107 owner requests plus two deferred P3 review observations remain tracked. Next priority is cleanup, including the confirmed General24969 repair; it is still unmarked. Transfers, UI, public-site and offline follow in that order.0139 and0143 are not deployed. Wide Records cascades and all preserved WIP remain open.

## Employee/return candidate independently verified — September 9

Clean candidate 9719e6b6 has independent review PASS, 339/339 frontend tests, both typechecks, translation check, production build and Worker dry-run PASS. The broad backend sweep is still running. Production remains 21d22fc; migration 0142 and the existing Employee role update have not been applied.

All 107 owner requests are retained. Two nonblocking P3 review observations are also tracked: unsafe-method request-origin enforcement and early return-body size admission. They do not replace or delay the owner’s priority order: employee/return, cleanup, transfer, UI, public site, offline.

## Employee role-save guard verified — September 9

Employee/return remains the first priority. Atomic role-save commit 99910afb passed independent review and all seven concurrency/audit tests. It awaits integration with the Returns/Contacts bulk-action repairs and final release gates. No production role permissions have been changed.

Production remains 21d22fc. All 107 tasks remain tracked. General customer repair is queued under cleanup; transfer, UI, public-site and offline work follow in the owner’s requested order. The next checkpoint includes only the verified employee/return scope and migration 0142.

## Employee rollout scope review — September 9

Priority1 remains Employee/return. Read-only production role preflight: exactEmployeeid3, codeemployee, is_system0, two assignedusers, existingSales/POS/Returnstrue andContactsreview. No role edit saved. Rootauthorizes exactexistingrole despitecustomflag, preservingunrelatedvalues/useroverrides.

Expanded review found Returns bulk/export inherited fromreturns:true and Contacts long-press/import controls stillvisible. F75 is therefore not release-complete: explicitReturnsbulk/export andContactsselection gates/defaults are underrepair. Existingfinancial-history gates remainverified. RolePUT atomicversion/auditfix assignedseparately. Live21d22fc unchanged; all107tasks retained andlaterpriorityworkpaused.

## Owner execution priority — September 9

Execute in this explicit order: 1. Employee/return changes. 2. Cleanup. 3. Transfer. 4. UI. 5. Public-site work. 6. Offline. Keep all107 tasks; later work must not delay priority1. Current live21d22fc unchanged. Next release owner preparing certified F75/F76 plus0142 fromc8d onto live21d; role rollout remains separately guarded.

Transfer F73 WIP and wide Records0143 are paused with durable handoffs and claims released. General24969 helper belongs cleanup and is paused at a safe checkpoint. No work is discarded and no paused candidate is deployable.

## Core Records and compact Sales checkpoint LIVE — September 9

LIVE21d22fcdefb5eb52c679dfbdec455f45b0fe1fb8, Worker429f6982-7c3a-4407-8b52-4e0ca192e3f0, deployment962caa59-4686-45c7-b466-e59ad1801a16, independently100% at2026-09-08T20:57:00.318305Z. CLIexit0 with all domain/cron/queue triggers.334 frontend tests; all315 backend scripts have passing evidence including bundled-Node reruns of two native process crashes. Independent exact-head review, types/i18n/build/dry-run pass.0140/0141 applied; sales/products/customers/stock/lot/history/audit counts unchanged. General24969 and22305 remain marker0; no production identity repair performed.

U21/U22/U23 and expanded core Records are live. Following foundationc8d combines verified F75/F76 and0142 return-create but remains undeployed; existing Employee role rollout pending. General repair helper, wide Records0143 and transfer reliability0139 are in progress. Remaining offline/cleanup/census/UI/portal tasks retained. Current-status.md and task-status.json cover all107 requests.

## All-task status and final frontend gates — September 9

All107 requests retained. Production4495bccf remains independently verified100%. Next candidate21d22fc contains core expanded Records, General marker code and U21/U22/U23. Independent runtime review passed; backend313/315 sweep plus both bundled-Node native reruns pass; two frontend stale assertions repaired after332/334 run, final full rerun/package gates active. No new deployment.

F75/F76e6a80e16 and return-createbc114757 are independently certified and in separate future integration. Employee role data rollout, General24969 cache-aware repair, wide reference cascades, offline recovery, transfer receipts, production cleanup, historical census and remaining UI/portal items remain open. Current-status.md and task-status.json now reflect these states, corrected stale browser blockers, old F46-pending text and deployment metadata.

## All-task status refresh — September 9

All107 requests retained. Production4495bccf remains independently verified100%. Next candidate21d22fc contains core expanded Records, General marker code and U21/U22/U23. Independent runtime review passed; backend313/315 sweep plus both bundled-Node native reruns pass; two frontend stale assertions repaired after332/334 run, final full rerun/package gates active. No new deployment.

F75/F76e6a80e16 and return-createbc114757 are independently certified and in separate future integration. Employee role data rollout, General24969 cache-aware repair, wide reference cascades, offline recovery, transfer receipts, production cleanup, historical census and remaining UI/portal items remain open. Current-status.md and task-status.json now reflect these states, corrected stale browser blockers, old F46-pending text and deployment metadata.

## Compact Sales metadata and Paid method labels — September 9

Added U22: compact mobile sale ID/time/branch/cashier metadata and inline customer phone/delivery without Driver label. U23: show methods beside Paid and remove redundant receipt payment-method row, retaining split-payment and numeric semantics. Implementation assigned with list/detail ownership coordination. U21 invoice presentation af735110 implemented and independently reviewing, not live. F74/F72 reconciled candidate ba66e521 is entering focused/package gates; return-create and wide cascades remain explicitly incomplete. Employee permissions/Contacts privacy implementation continues separately. Live4495bccf unchanged; all107 requests retained.

## Verified F65 merge/remove checkpoint — September 9

LIVE 4495bccfb097a55f034976795f2030bfc3628152 (runtime source a5702d49), Worker623d8cbe-6b8f-42b7-8205-b0769ff00aee, deploymentfad40d57-39b6-4291-8375-75725b288722, independently verified100% at2026-09-08T18:43:16.626919Z. CLIexit0, all domains/cron/queues succeeded.0138 applied; product/stock/lot/history/audit pre/post counts identical, new receipt tables empty. Recovery bookmark saved.330 frontend tests and all309 backend scripts have passing evidence; two accumulated Windows native process crashes passed isolated reruns. Independent exact-source review and real Worker/browser passed.

No production duplicate merge/removal was executed. F75 employee individual permissions and F76 Contacts privacy are under implementation, not live. U21 invoice design implementation active. F74 stable frontend932293ba independentlyPASS; detailed Records release and remaining return-create/cascade coverage still open. All105 tasks retained.

## Employee single-record access and invoice design — September 9

Added F75: employee individual Sales/POS actions including cancellation/status changes, paired with complete audit capture; multi-select/bulk/import/export disabled by default. F76: restrict employee Contacts invoice/purchase detail visibility, especially suppliers, while retaining Sales customer search. U21: align invoice layout with Sales report presentation without changing calculations. Read-only security and design traces assigned before permission edits; retain owner/admin access and explicit restrictions. All 105 tasks retained. Detailed Records is still under verification, so expanded permissions must not precede verified capture.

## Owner confirmed shared General identity — September 9

Owner confirmed customer 24969 is the shared walk-in/General customer. Mark only this identity through a guarded repair after paired anonymous-marker code is verified and deployed. Preserve its transaction history and historical membership value while disabling membership use. Customer 22305 remains unmarked. No production identity mutation has occurred. Unknown-phone inline creation remains a separate unanswered question.

Live remains 2767fbf4. F65 frontend 330/330 passes at ab08474f; backend harness repairs/full rerun and final-head review remain before deployment. All 102 tasks retained.

## Active release gates and identity clarification — September 9

Live2767fbf4 remains verified100%;102 tasks retained. F65 combined global merge/remove UI and backend are reconciled; delete-permission gate0318fbae passes, missing0138 durable backup/reset integration under repair before real-backend browser/finalrelease gates. F74 reader/typedENKM UI/settlement/bulk and directreturneditbd0ab24e independentlyPASS. Stablefrontend request lifecycle/history/revision repairs still active; return-create event race reverted, directcustomer and contacts/settings rewrite coverage notyetcomplete.0140unapplied.

F72 legacyGeneral uses explicitmarker0141 (schemaonly) rather than name guessing. Rootcurrentproduction read shows22305 hasphoneandaddress, so preserveitunmarked;24969 noPhone/address/noportalaccount awaitsuseridentityclarification before marking. No historicalcustomer data changed. General inlinecreation path alsoawaitsdecision. Current-status.md/task-status.json remainfullregister; previousheadingshistorical.

## Live General-customer follow-through — September 9

F72 is not fully complete: read-only live smoke after2767fbf4 found receipt20260908-162823 (sale16947) linked to legacy contact24969, namegeneral/emptyphone/membershipLC-04971. Edit treats it as a real customer because it has a positive ID. UI and rootD1 read agree; no writes performed. Canonical anonymous-identity trace and bounded repair assigned before claiming General rule satisfied. Existing-null-General and regular actualcontact tests passed but did not cover this legacyplaceholder. All102tasks retained; live remains2767fbf4.

## Latest verified customer Edit deployment — September 8,15:30 UTC

LIVE **2767fbf43559771b94ba00246c3381cd8c509196**, Worker c2fb44d7-2d69-472d-afca-c9bc756efead, deployment 12f8b894-e9e2-4b80-acfd-4c172e836a7a, independently verified100% at2026-09-08T15:30:57.912313Z. Eight fix-scoped F72 commits: single Edit action, anonymous General, phone-first existing contact assignment, exact sale+linked-return attribution, fresh server-version guarded profile edits. Unknown-phone inline creation remains pending; current fallback directs to Contacts. Frontend328/328, focusedF72/mobile/backendbulk, both typechecks/i18n/build/dry-run passed. CLIexit0 with all customdomains/cron/queues; no migration. PreviousF46/F57/F71 and0136/0137 retained.

All102 tasks retained. F74 typedfrontend/reader/schema and receipt-backed settlement/sale bulk/returnbulk writers independently verified; directstatus/returnedit stableID pairing, all-action coverage and final integration remain. NoF74 deployed. F65 backendgroupmerge/directremove conditionalPASS; globalv2 conflict UI/transport underimplementation,0138notdeployed. PeerstorefrontP08 remains separatelyverified/notintegrated. Signed-in browser loaded priorcheckpoint and LibraryKiko search returned two matching files; no production records were changed by this smoke check. Earlierstatuses arehistorical.

## Latest verified merge and Library deployment — September 8,14:31 UTC

LIVE **bfd16f0db4c51dbad2a3de483dd77bb3452842ac**, Worker c04650e8-5549-44fc-acf1-3891eec56158, deployment d7938cd4-00d4-4098-8b05-43cab5feba71, independently verified100% at2026-09-08T14:31:14.412835Z. F46 retry/finalizer/Undo availability and F57/F71 Library usage protection/indexed queries/debounced abortable search are live. Frontend327/327, backend299/299, both typechecks, i18n, production build and dry-run passed. Migrations0136/0137 applied; product/stock/lot/history/audit pre/post assertions identical. Recovery bookmark saved privately; full SQL export unsupported with FTS5.

Wrangler reported a malformed custom-domain trigger response after deployment. Independent API confirms both domains still enabled on business-os production and expected cron; version is100%. Do not report CLI exit0 or HTTP smoke pass: shellrequests403 and browser runtime endpoint blocked.

All102 tasks retained. F72 Edit-only1ee95554 independently verified, next release preparation. F74 full Records remains active: frontend Khmer/formatting and schema/backup review repairs precede writer rollout. F65 grouped phase2c86fa1a0 independently passes stock/lot/RFID races and UndoRedoResume; Direct Remove phase3 remains in progress. Coordinated storefront P08 is verified in peer task, not yet integrated. Earlier statuses are historical.

## Independent customer/Records review and merge-Library release gates — September 8

All102 tasks retained, including coordinated storefront P08. F72 Edit-only candidate1ee95554 independently passes fresh server-version concurrency protection and one-sale linking; unknown-phone creation decision remains pending. F74 detailed Records is active: independent review found missing creation caller inputs and unsafe time-based event deduplication; repairs and durable event lifecycle plan are required before release. F65 grouped apply review found keeper-stock and RFID race data loss; d111a124 repair awaits re-review, Direct Remove approval/persistence remains in progress.

F46/F57/F71 release candidate bfd16f0d passes327 frontend suites,299 backend scripts, both typechecks and i18n. Build/deployment preparation continues; only migrations0136/0137 pending remotely. Current verified production remains6dbb8a8e at100%; no new checkpoint has been deployed in this update. Peer storefront candidate is separately verified, not yet integrated. Earlier status sections are historical.

## Owner customer Edit scope and detailed Sales Records — September 8

F72 latest scope supersedes prior replacement menu: one Edit customer entry only; remove separate New/Replace/Remove actions. General remains anonymous with no phone/membership profile; assigning a real contact uses phone first, name secondary. Phone-not-found creation path clarification pending; dependent create work withheld. Existing617135b7 candidate must be revised before release. No production customer data changed.

F74 added: action-specific Records capture and complete English/Khmer labels for driver, actual delivery cost/fee, product add/remove/replace/quantity, General/customer/membership, status and payment changes. Show changed relevant information with expandable before/after. Avoid raw variable fallback and vague Not recorded; do not fabricate unavailable historical snapshots. All101 requests retained. F71 final mounted re-review passed atc4d8295e and remains undeployed. Live stays6dbb8a8e.

## Latest verified deployment — September 8, 12:18 UTC

LIVE **6dbb8a8e3029e220cbec650051a4d7c37a6da2c9**, Worker da46fd62-a109-463a-92bd-f23452502dda, deployment 584770c0-6b58-4e21-91e5-68339f7b81c0, independently verified100% at 2026-09-08T12:18:10.815529Z. Nine fix-scoped commits deploy U16–U19: compact Reports filters/view/default USD/tabs/summary removal and persistent Reset; plain Sales badges and compact print column; Branch product action menu replacing column; TRF-only references. Frontend325/325 at321542b7 plus focused Reset regression/types/final build at6dbb8a8e, i18n, dry-run and independent reviews passed. No backend source or migration changes; previous F69/F70 remain live. Browser-emulated Reports320/375/390/1280 and keyboard passed; no physical-iOS guarantee.

All100 tasks preserved. F71 final sync correction c4d8295e awaits independent mounted re-review. F72 is assigned to Sol repair after independent type/permission/i18n/retry findings; not live. F73 transfer receipt plan active. F46/F57 local gates/native reversal proof passed, migrations0136/0137 remain local. F65 apply/history work continues; direct Remove unfinished. Earlier dated status paragraphs below are historical.

## Latest verified deployment — September 8, 11:47 UTC

LIVE **2a6f1a40b4e9a34462f5a58d3582b68e5685d4c0**, Worker dc748caf-9828-44ac-af38-6b48143b3f22, deployment aa931baf-bd3d-461f-8fb3-ededfa677461, independently verified100% at 2026-09-08T11:47:13.995546Z. Four fix-scoped commits,21 paths; frontend325/325, both typechecks/i18n/build/dry-run and focused transfer/search tests passed. No migration. Shop↔Warehouse transfers now allowed under exact canonical identity, permissions, reason and stock/lot guards; reverse Undo/Redo passes; explicit-lot race rolls back. Warehouse sales remain prohibited. Indexed Products sibling lookup preserves tested semantics and improves local measured query work. No full production search latency claim.

All100 tasks retained. F73 discovered transfer receipt/audit retry gap is separate follow-up. F71 Library mounted review still requires sync-event consumption repair. F72 independent review blocked prior candidate on type, permissions, duplicate/retry and i18n; Sol repair owner assigned. U16 reports, U17 Sales status/column, U18 Branch product actions and U19 TRF suffix candidates prepared, not live. U20 broader device layout coverage remains open. F46 native independent11-case Apply/Undo/Redo passed; F57 combined package checks passed, both still awaiting separate release/migrations0136/0137. F65 phased apply/history implementation continues; direct Remove remains open. Earlier dated statuses below are history.

## New transfer, search and responsive requests — September 8

Production remains923bc28b at100%. All99 requests retained; new F69–F72 and U16–U20 added. Transfer Shop→Warehouse and Products/Library search speed take priority. Reports, Sales, Branch and transfer-reference layout changes are separately tracked. Customer replacement context is being clarified before changing identity/history. Screenshot is evidence of layout, not a separate instruction source.

| F69 | Shop to Warehouse transfer fails; both canonical transfer directions must work with branch/lot identity and permissions | Priority investigation | Architect tracing transfer UI/API/stock/lot authority before bounded fix. |
| F70 | Products name/barcode search is too slow | Priority investigation | Measure client request flow and backend query/count/index cost; preserve leading-zero and family semantics. |
| F71 | Library image search is too slow | Priority investigation | Measure search, usage joins, count and asset lookup; preserve permissions and deletion protection. |
| F72 | Customer title actions: replace wrong customer versus edit current customer | Clarification pending; code trace next | Confirm sale association versus Contacts profile before destructive identity changes; preserve unrelated transactions. |
| U16 | Reports compact filters and navigation per owner screenshot | Design trace active | Remove repeated summary prose; move report view into filters; white high-contrast filter/smaller Show; simplify Previous period/estimated profit/basis controls without financial changes; default USD without App Setting option; contain Excel filters; horizontal Payment methods/Couriers/By reason/Expenses by type buttons below filters. |
| U17 | Sales plain-text colored statuses and compact print/actions column | Queued | Remove icons from Not Paid/Awaiting Delivery/return statuses; use readable colored highlights; print near three-dot menu, release unused column width. |
| U18 | Branch product section has redundant actions column | Trace assigned | Remove unused actions column while retaining necessary reachable actions. |
| U19 | Transfer reference should show only TRF identifier | Trace assigned | Remove redundant Transfer suffix from reference column. |
| U20 | Responsive layout in iOS PWA and desktop device-toolbar emulation | Open; verify affected surfaces | Verify viewport containment, side margins, compact filters and horizontal tabs at phone and desktop widths; distinguish app defects from browser tooling problems. |

## Latest verified deployment — September 8, 10:03 UTC

LIVE **923bc28b498d3bdadadd225d756f606c4518a0a3**, Worker 2a28d01e-cb7a-49cf-bdcd-641cdc8aaf64, deployment 4a7bb7bb-439d-4b40-a920-7337a5f4ccd6, independently verified 100% at 2026-09-08T10:03:56.287246Z. Eight fix-scoped commits, 26 paths, frontend 325/325, both typechecks, i18n, affected lot/permission/atomic tests, build and dry run passed. No migration. F66 per-product close/minimize/draft lifecycle, F67 Add/Remove/Set quantity wording and signed review, F61 inactive-positive-lot coverage are deployed. Original branch-picker screenshot follow-through remains open.

All 90 requests retained. Integration a28868b0 includes current live patches plus independently reviewed F46 native finalizer and F57 query fixes; combined gates running, migrations 0136/0137 still local. F65 preview-only stage is not complete: initial security review disagreed with functional certification on expiry/retention and detail fanout. Owner repair 1f371c03 awaits exact re-review. Corrected phase2 design conditionally approved for implementation with atomic per-member receipts, original-group economics, bounded responses and reversible partial history. Direct Remove remains required. All other historical evidence, production merge, offline, camera, UI and external-fact tasks remain in the full register.

## Latest verified deployment — September 8, 09:02 UTC

LIVE **a5a4162ff8312114c6137fb354c759fde2b5b9d7**, Worker 67453e45-af2b-40f1-819f-737abe88e8e4, deployment eb5c2f2e-35af-4735-974d-81aa86a171a2, independently verified 100% at 2026-09-08T09:02:12.05078Z. Fifteen fix-scoped commits, 28 approved paths, frontend 323/323 and backend 293/293, types/i18n/build and 303-asset dry run passed. No migration. Includes explicit edited Khmer, F61 atomic Shop remainder guards, F62 clean save/close lifecycle, F63 atomic revoked-device reset and approval cap, F64 existing-product scanner, first F66 Fast Stock X/minus fix and F68 confirmation containment. This supersedes earlier candidate/live statements below.

All 90 requests remain tracked in outputs/khmer-review-20260908/Current-status.md and task-status.json. Next: verified per-product F66/F67 through caeaa314; F61 inactive-known-lot coverage 02d9e786 under review; F46 native finalizer 0410c7f5 now completes 11-case Resume but independent Undo/Redo remains; F57 native query repair verified, not deployed; migrations 0136/0137 remain local. F65 backend/frontend N-member review lanes active, apply/direct Remove still required. F55 runtime, remaining production duplicate merge beyond 8 cases, historical/contact evidence gaps, hardware camera validation, broader PWA/UI coverage, financial census and external business/image exceptions remain open. Telegram rotation is owner-reported; do not repeat it merely from an old pending note.

## Checkpoint candidate and stock follow-ups — September 8, 08:30 UTC

Live remains73fd7dc1 at100%. Candidate b21c2e7a in bos-release-owner-functional-20260908 includes only explicit owner Khmer edits, F61 guarded Shop remainder, F62 save-clean-before-close, F63 atomic device reset/cap, F64 existing-product scanner, first F66 FastStock X/minus separation and F68 shared confirmation containment. No migrations. Focused tests and independent security/browser reviews passed; full package gates/build running. F61 inactive-positive-lot display overstatement is safe-server-rejected and has a follow-up. F46 preview is repaired but actual apply remains history_pending after case0, so release is held. F57 native query fix independently verified; F65 multi-row merge/remove contract refinement and F55 offline implementation remain separate.

All90 tasks are retained in Current-status.md/task-status.json. New owner wording overrides prior X/minimize exceptions.

| ID | Request | Current state | Next step |
| --- | --- | --- | --- |
| F66 | Stock actions: X closes with Discard / Back / Minimize; minus preserves directly | Fast Stock fix in checkpoint; per-product candidate under review | First fix23bc009e replayed01f41313; second136c8464 under independent review. |
| F67 | Add/Remove/Set quantity labels, signed delta, before/after and reason | Implementation pending in stock UI lane | Add+n; Remove-n; Set target total with before/after and signed difference. |
| F68 | iOS PWA responsive containment with left/right margins across pages/dialogs | Shared confirmation repair in checkpoint; wider sweep open | 562d6608 verified actual browser320/375/390/1280 and nested dialogs. |

## Owner follow-ups — September 8, returned workbook and urgent functional fixes

Live remains 73fd7dc1 at 100%. Returned workbook compared by key: 15 edited review entries, 11 source updates and four already-equal no-ops; four whitespace-only fragment edits retain required separators. Source commit5832b05 integrated48acb624, not deployed. Full untouched Proposed Khmer column approval question remains pending; explicit edits proceed.

P07: owner reports Telegram bot token already rotated. Independent dated rotation evidence was not located; do not re-rotate solely because the old ledger says pending. P05: owner reports most images are first-party photography; remaining provenance review concerns exceptions, not a blanket claim that shop photographs lack rights.

F57 native D1 independently reproduced a compound-SELECT failure in the indexed candidate. Root owns bounded native-query repair. F55 corrected plan completed, runtime implementation remains pending. F46 native fingerprint repair continues separately.

| ID | Request | Current state | Next step |
| --- | --- | --- | --- |
| F61 | Stock-positive POS product blocked by received-date picker; branch choices missing | Candidate under independent review | Verify legitimate Shop unlotted remainder, recorded lot identity, atomic quantity guards and explicit branch choices. |
| F62 | Save still leads to Back/Discard prompt | Implementing | Clean-before-close lifecycle across product hosts and completed sessions; retain unsaved outer session after item queueing. |
| F63 | Reset revoked device history so it can request approval again | Candidate awaiting security review | Admin reset must return unknown; next sign-in requires normal approval and cannot restore sessions. |
| F64 | Existing-product add/create session needs barcode scanner | Candidate awaiting integrated checks | Reuse scanner, leading-zero search and same-session duplicate guard. |
| F65 | Conflict Merge/Remove actions and owner-defined field rules | Contract review; implementation pending | Direct Remove independent of barcode match; Merge transfers stock, distinct nonzero mean cost, max prices, explicit barcode/category/brand/unit choices, supplier/date history retained. |

## Khmer review workbook completed — September 8

F60 is complete as a review deliverable: outputs/khmer-review-20260908/Business-OS-Khmer-review.xlsx contains 259 effective-string proposals, all 6145 source entries (5573 effective keys; 572 overridden copies), and all 82 task statuses. Rendered Khmer was visually checked; exported XLSX ZIP/XML, row counts, tables, frozen headers, decision validation, placeholder parity and exactly two Owner approved decisions passed. The remaining 257 proposals are not applied. F59 exact terms are already live in 73fd7dc1 at 100%, with no migration. Current-status.md provides the full readable status snapshot. F46 real D1 repair, F57 independent indexed-query review and F55 corrected offline plan remain open; no new release is claimed here.


## Latest verified deployment — September 8, 06:10 UTC

**LIVE73fd7dc15801b3f1bc6eb5c40cd115a6b76edf1f**, Worker a38779e9-32c9-4a12-8aab-e9b8e380cf05, deployment942bfcae-e9f5-4ea7-9426-12c713494295, independently confirmed100% at2026-09-08T06:10:49.221845Z. Five fix-scoped commits deploy compact mobile Sales U13–U15, F56 expense version/zero-row guards, F58 frontend loading boundaries, and F59 exact Khmer labels ថ្លៃដឹកដើម / ថ្លៃដឹកដើមថ្មី. Frontend322/322, types/i18n, expense races6/6 and fees10/10, build, emitted chunk checks and303-asset dry-run passed. No schema migration; F46/F57/0136/0137 are excluded.

Open: F46 actual D1 preview compound-SELECT repair plus repeated real browser/combined gates; F57 indexed promotion-image lookup final independent review; F55 offline recovery plan correction/implementation; production duplicate merge after8cases (browser access pending); ambiguous historical/contact evidence; phone-camera validation; financial census; browser warning attribution; remaining U01–U12 UI/minimize work; legal/business/image-rights facts and bot token rotation. F60 Excel review of6145 source entries,5573 effective keys and572 overridden copies is in final formatting/validation. Broader Khmer proposals have not been applied.


## Active checkpoint and Khmer review — September 8, 06:04 UTC

Production remains4e576eaa at100%. Small checkpoint73fd7dc1 is in final build/dry-run verification after322/322 frontend files passed. It contains ONLY compact mobile Sales U13–U15, F56 expense concurrency/zero-row handling, F58 loading boundaries and F59 the two approved Khmer labels (ថ្លៃដឹកដើម; ថ្លៃដឹកដើមថ្មី). No schema migration. Five fix-scoped commits preserve provenance.

F46 is held: actual local Worker/browser preview of11 cases failed with D1 compound-SELECT limit before writes. Expense_version_guard owns a bounded query repair; the repeated real D1/browser check remains required. Broader integration gate initially288/294 backend and319/324frontend; five stale backend harnesses and three frontend source contracts repaired, native subtotal rerun3/3passed, two new received-date labels corrected to existing dictated vocabulary. This is not a passing combined release claim. Migration0136 remains local only.

F57 canonical promotion-image references and Library display have a final indexed-query candidate513b57f1, migration0137 local only, independent review pending. F55 offline recovery plan requires signed server scope, safe generation/version separation, correct reset boundaries and legacy reconciliation before implementation. No created_at heuristic or blind replay is approved.

F60 Excel wording review covers6145 source leaf strings:5573 effective UI keys and572 overridden source copies. Four original batches plus705 nested entries are being consolidated. Broader wording is proposal-only; only the two F59 terms are approved for code changes. The workbook will include all82 task entries and current states. Full review/status artifacts are in outputs/khmer-review-20260908.


## Latest verified deployment — September 8, 04:57 UTC

**LIVE: 4e576eaad290d158f4a388ef1652729bb103e720**, Worker c7b6a310-efb9-4106-b8cc-f0a56edf03ae, deployment4adb0e4d-6423-4abb-9d1f-a78f66115362, independently confirmed100% at2026-09-08T04:57:24.418726Z. F53 permission-refresh coalescing/session generation, F54 shared HTTP cache ownership/server precedence, and U05 positive profit headline colors are deployed. Frontend320/320, both types, i18n5384/566sources,1103-module build and300-asset dry-run passed. Backend source/migrations exactly match previous livec2eb; no migration. Nine individual commits preserve author/date/messages; source cutoff599f2b70 differs only by the eight approved private evidence exclusions.

Still active: F46 backend budget verification and combined browser/gates/migration0136 release; U13–U15 mobile Sales independent review; F55 offline quarantine/fencing plan review; F56 expense optimistic-write guard; F57 promotion image-reference protection with frontend usage display; F58 isolated loading-boundary candidate integration. Production duplicate merge remains eight completed cases and browser access pending. Legacy evidence cleanup, hardware camera validation, financial census, warning attribution, remaining UI/minimize, legal/business/image-rights facts and token rotation remain open as detailed below. Earlier deployment/current paragraphs are historical; this entry supersedes them.


## Current continuation — September 8, 04:46 UTC

Live remains c2eb9d57 / Worker3931ea55 at100%. The next small release from source599f2b70 includes F53 permission refresh, F54 HTTP cache ownership and U05 positive profit styling. Final frontend320/320, types, i18n, build and local dry-run passed; release provenance/parity is being finalized before deployment. Backend source and migrations are unchanged from live.

F46 remains separate: backend d7775ee8 is frozen for independent heavy-manifest budget verification; migration0136 and backup/reset integration are locally reviewed only. Frontend ed7f7ff9 has one reproduced remaining blocker: changing a visible stock choice after confirmation can disagree with the frozen Resume request. Sales is fixing and Media independently reviewing it. U13–U15 mobile Sales candidate cf3d4d23 is in independent review.

F55 read-only reproduction and plan are complete: origin-scoped offline quarantine, server generation fencing, privacy-filtered recovery and foreground/service-worker replay ownership need implementation. No production loss or backend authorization bypass was demonstrated. Do not erase or blindly replay pending work across accounts/runtime generations.

New source-confirmed candidates from the separately authorized overhaul review: F56 expense edit checks updated_at before an UPDATE that does not include that version in its predicate; F57 library image-usage/delete guard omits promotions.image_path. Neither is claimed repaired or observed in production. F58 isolated frontend chunk-policy candidate57854fd6 reduces measured asset loading and removes static cycles; exact independent certification/integration remains pending, excluded from the small release.

Other open work remains in the owner register: remaining production duplicate merge (eight completed cases; browser access pending), legacy identity and ambiguous historical evidence cleanup, actual phone-camera testing, F52 historical financial census, browser warning attribution, remaining UI/minimize items, business/market/image-rights facts and Telegram token rotation. Existing completed releases and data-repair evidence are preserved.

# Owner task register — September 7, 2026

This is the current request register. `progress.md` links here. Append new owner
requests and corrections; do not replace earlier requests or silently drop them.
Root owns prioritization, integration, evidence, and deployment claims.

Last reconciled: 2026-09-08T03:39:34.033Z. Functional fixes precede UI polish.
Current production: **c2eb9d57**, Worker **3931ea55-3f66-459e-823d-3339979bd441**,100% at **2026-09-08T03:37:12.286363Z**. F47A, canonical branch/import/transfer and export F51 followups are deployed, including resolved duplicate error cleanup. No migration; backend291/291 and frontend319/319 pass. Earlier proven historical repair and prior releases remain included. Production product merge remains eight completed cases.

First functional release **821efc94ce7a** is serving 100% traffic as Worker
**498efadb-f833-471d-a8b7-b4326950bd26**, deployed 2026-09-07 09:54:13 UTC.
Public Git branch: codex/release-fixes-20260907. Migrations 0128–0132 and required
security configuration applied. Full 306 frontend files and 274 backend suites,
both typechecks, i18n, build, and frozen browser smoke passed before deployment.
Live assets match the release; Sales bootstrap timed out during network failures
and is still under investigation (F36). Do not call every live workflow certified.
Delivery addition F32 is now deployed as **c475e637d197**, Worker
**d5aeeb82-cb0d-4047-8abf-8e96ba17f602**, 100% at 11:10:18 UTC; migration 0133
preserved all nine prior amendment rows and revisions. Live Sales and Records
loaded after connection recovery. F36 has further retry-visibility fixes pending.
Historical metadata correction was attempted but failed on the remote batch transport.
All 4,333 target rows were independently verified unchanged and audit count zero.
The guarded payload is being compacted; no correction or duplicate merge has committed.

State definitions: **Local pass** means implemented with relevant local evidence,
not production completion. **Integrated** means source is composed but final
release checks remain. **Active** means assigned work remains. **Pending live**
means a prepared operation has not run. **Deferred UI** follows the owner's
explicit priority correction. **Needs facts** means evidence cannot be invented.
Every shipped row must eventually record its actual deployment version.

## Functional requests

| ID | Request and latest accepted detail | State / owner | Evidence or next action |
|---|---|---|---|
| F01 | Completed sale changed back to awaiting payment must allow authorized payment method, amount, item and delete/correction actions. | Deployed 02eecbe3; live follow-through active | Sales correction and scope tests; final release smoke. |
| F02 | Audit all historical sales with missing branch, Warehouse/multiple branches, or N/A driver. | Proven branch repair complete; ambiguous provenance remains / root | Census covered 15,096 sales and 36,340 lines. Proven null metadata repair prepared; ambiguous fulfillment/driver facts remain unresolved. |
| F03 | Enforce Shop-only sales; Warehouse stock must transfer first, including added lines, imports, replacements and generated sales. | Deployed 821efc94; recorded limitations retained | Backend enforcement and sibling parity tests integrated. |
| F04 | Stock-in session times out after 12 seconds. | Deployed 821efc94; recorded limitations retained | Session-specific 60-second transport, stable request identity, durable retry; no global timeout inflation. |
| F05 | Multiple products with multiple images each fail in one stock session, including encoded spaces/Khmer/percent filenames. | Deployed 821efc94; recorded limitations retained | Older build reproduced 409; identical retained 3-product/6-image request succeeded once on eb06b80b. Six asset GETs and product/gallery ownership passed. |
| F06 | Add/edit/create product images: upload, attach from Library, files, camera entry, and PWA draft lifecycle. | Deployed 821efc94; recorded limitations retained | Upload/Library associations and close/minimize/retry passed. Actual phone camera hardware was unavailable; do not claim a hardware test. |
| F07 | Library totals: physical storage, file quantities by type, correct usage and deletion protection. | Deployed 821efc94; recorded limitations retained | Physical counts unchanged by retry; covers and gallery usage correct. |
| F08 | Same barcode/leading zeros: scanner, search, same-session recognition and merge must use compatible identity. | Deployed 821efc94; recorded limitations retained | Guarded UPC/internal-code parity; do not strip meaningful arbitrary code zeros. |
| F09 | Merge cost uses distinct nonzero available costs; highest retail/wholesale prices; preserve stock/relations/audit/undo. | Implementation deployed 821efc94; production merge pending / identity, root | 1,600 synthetic folds in 64 requests; retry mean remains fixed, changed source refuses retry. |
| F10 | Run the production duplicate merge; one confirmation, bounded progress, faster saves. | Partial: 8 committed; browser follow-through pending / root | Bounded implementation deployed da5c8b02; exact eight prior action IDs318–325 retained. Refresh preview through authenticated app before continuing; browser connector timed out. |
| F11 | Detect duplicate barcode OR name added earlier in the same session, including queued/saved lines; otherwise green only after resolved lookup. | Deployed 821efc94; recorded limitations retained | Session identity and duplicate parity tests integrated; explicit quantity edit preserved. |
| F12 | Gross sales, discounts, refunds and revenue must agree across Dashboard chart, headline, Sales, Inventory and reports. | Deployed 821efc94; recorded limitations retained | Tested gross 200, total discount 15, net 185; raw item-discount basis corrected. |
| F13 | Credit is recognized in revenue and profit (N39); latest visible wording overridden by F44 Not Paid / ប្រាក់ជំពាក់. | Deployed 821efc94; recorded limitations retained | Credit/revenue parity and report tests integrated. |
| F14 | Shift registration is report-only and close always works (N37). | Deployed 821efc94; recorded limitations retained | Real route tests; blank and explicit zero are different; invalid values rejected without blocking legitimate close. |
| F15 | Shift report compares registered opening/end USD and KHR; unknown stays unknown (N38). | Deployed 821efc94; recorded limitations retained | Migration 0132 conservatively treats ambiguous legacy zero as unknown; report/Telegram tests passed. |
| F16 | Shift Report is its own selectable report view with export, not an extra block in overview. | Deployed 821efc94; recorded limitations retained | Final browser smoke includes selection/export. |
| F17 | Concise Telegram reports (N42). | Deployed 821efc94; recorded limitations retained | Bilingual composed payloads, day-first dates and concise report tests passed; no live messages sent. |
| F18 | Delivery accounting clearly explains customer charge, actual courier cost, store-paid portion and contribution without double deduction. | Deployed 821efc94; recorded limitations retained | Financial parity verified; negative contribution can represent store subsidy. |
| F19 | Expenses generated by sales show a sale link; branch is Shop; manual expenses need no sale ID. | Implementation deployed 821efc94; proven branch correction complete / root | Existing unlinked legacy fees lack proof of a sale relationship. Never invent links; proven branch metadata correction prepared. |
| F20 | Records line belongs INSIDE expanded sale details, not the collapsed row (latest correction to N41). | Deployed 821efc94; recorded limitations retained | Browser placement, single dialog and return-to-detail flow passed. |
| F21 | Records includes actor/time, status, products/quantity, payments, delivery fee and actual cost with readable before/after detail. | Records deployed 821efc94; future snapshots F33 deployed 02eecbe3 / sales | Structured detail/integrity tests pass. Unknown/pruned provenance is explicit; retained replay history survives both clear paths. Sales list D1 failure is F34. |
| F22 | Customer delivery fee and actual delivery cost are separately editable and recorded. | Deployed 821efc94; conversion F32 deployed c475e637 / sales | Fee changes customer total; actual cost does not. No-delivery conversion is F32. |
| F23 | Dashboard low/out lists load more at the bottom and reset on leaving. | Deployed 821efc94; recorded limitations retained | Desktop and 375px scroll 10→20 and leave/reenter reset passed. |
| F24 | Total stock alerts use Shop+Warehouse; branch pages/POS branch options use individual branch stock. | Deployed 821efc94; recorded limitations retained | Pure aggregate/branch tests; alert setting events refresh Dashboard, POS and Branches. |
| F25 | Permissions/roles fully scoped across add/edit/session/images, review, imports, bulk, offline and undo. | Deployed 821efc94; recorded limitations retained | Synchronous matrix through 96abe402 and Queue authority through 1aae81d3 independently certified, including races, cancellation and current-role checks. Combined first-release sweep passed. |
| F26 | Dismiss offline/update notifications with X without hiding failed saves or lying about connectivity. | Deployed 821efc94; recorded limitations retained | Dismissal helper and App integration complete; reconnect/error behavior retained. |
| F27 | Remove redundant eye next to Print in sales rows. | Deployed 821efc94; recorded limitations retained | Browser row access remains; Actions shows Print only. |
| F28 | Take over Claude lanes, commits, dirty/unverified work and progress sessions. | Deployed 821efc94; recorded limitations retained | Twenty-lane lineage and shared patch inventory preserved; original dirty worktrees untouched. |
| F29 | Remove duplicate delivery_actual_cost_usd field and rejected stopgap kind comment in Sales merge fallout. | Deployed 821efc94; recorded limitations retained | Source/type/parity gates cover composed Sales. |
| F30 | Finish earlier N18/N21/N23 and N28–N36/audit lanes without losing their fixes. | Deployed 821efc94; recorded limitations retained | Canonical ea9f0d1b base includes checkpoint 2 and earlier integrations; individual follow-up fixes retained. |
| F31 | GitHub commits describe individual fixes, not checkpoint/batch commits. | Fix-scoped public commits pushed through dfb8932e / root | Each runtime fix retained separately on release branches; private reports excluded. |
| F32 | Sale originally without delivery allows later driver, customer fee and actual cost. | Deployed c475e637 / sales | Full backend 276 suites; all frontend 306 files covered; independent money/migration review and browser actual retry/driver/totals/Records passed. |
| F33 | Preserve original basket, payments, driver and actor for future sales. | Deployed 02eecbe3; live follow-through active | Four writers, migration 0134, backup and immutable Records independently pass; original basket/payment remain unchanged after later edits in browser. Backend 278/278 pass. |
| F34 | Sales list/detail Records SQL failed in real D1. | Deployed 821efc94 / sales | Frozen actual Worker list/detail now 200; count and compound ordering repaired. |
| F35 | Fast Stock minimize restored wrong host and consumed the chip. | Deployed 821efc94 / media | Exact user5 frozen browser restore passed; preserves draft and consumes only after modal mounts. |
| F36 | Sales read retry/deadline/cache cancellation and visible manual Retry after failure. | Deployed 02eecbe3; live follow-through active | Frozen 5ec39289 browser: one request aborted at 20s, visible Retry, one manual retry succeeds; late responses never overwrite data or navigation. |
| F37 | Duplicate preview times out on large catalogs because it queries stock/batches/cost per group. | Deployed 02eecbe3; live follow-through active | Independent real route 2,000 groups uses 43 reads instead of roughly 6,000; merge rules, prices and blockers preserved. |
| F38 | Immediately recording payment after changing Completed to Credit reports a false other-device conflict. | Deployed 02eecbe3; live follow-through active | 9d707f1d carries exact committed status version into payment review; real concurrent-write protection and typed tender values retained. |
| F39 | Live bulk merging remains about eight seconds per case and fails on database overload. | Bounded corrections deployed da5c8b02; production merge follow-through pending / root | Eight commits preceded an 87.3s request failure. Inspect serial D1 round trips and invocation limits; preserve atomic cases, undo and whole-cluster cost mean. |
| F40 | Bulk merge error falsely says data not saved after partial commits. | Deployed da5c8b02; production follow-through pending / root | Return/reconcile committed cases and undo IDs on failure; explicit resumable partial state, no blind retry. |

| F41 | Idle import polling writes to D1 and immediate retries amplify database overload. | Deployed 560bfbcb; independent PASS, backend 280/280 / sales | Skip no-op reaper writes when no stale jobs exist; preserve guarded stale recovery. Fail overload once instead of immediately retrying it. |

| F42 | Contacts duplicates: supplier creation in stock sessions, raw versus spaced customer phone numbers, obsolete membership IDs; inspect existing fixes before correction. | Canonical guards/atomic merge/formatting and hidden-supplier fix deployed; cleanup pending | Explicit manual/POS choices integrated at c09c707a, final gates/browser pending. Existing ambiguous memberships/contacts require reviewed identity evidence. |
| F43 | Contact phone entry automatically spaces digits as typed; formatted display and canonical matching must agree. | Deployed da5c8b02; independent PASS including mobile deletion and IME | Progressive spacing, prefixes, paste and caret covered in seven create/edit/quick-add fields. |
| F44 | Latest owner correction: visible Credit / ឥណទាន becomes Not Paid / ប្រាក់ជំពាក់ everywhere. | Deployed 560bfbcb; live EN/KM verified | Supersedes N39/F13 unpaid-state wording. Internal values/accounting unchanged; distinct Store Credit, supplier credit and overpayment concepts preserved. |
| F45 | Investigate failed admin WebSocket and reported content.js/VM listener/startTime errors. | Deployed 560bfbcb; independent PASS | Cooldown lacked wake-up and actual logout did not disconnect. Both corrected. content.js listener is extension noise; VM startTime ownership unproven. |
| F46 | Combined selected-conflict review and bounded merge. | Held for actual D1 compound-SELECT repair | Independent SQLite/source checks passed, but real11-case preview fails before writes. Migration0136 not deployed. |

| F47 | Prevent and clearly prompt about existing customers, suppliers and delivery contacts across add/create/edit/quick-add/import/session surfaces; distinguish reuse from intentional creation. | Deployed c2eb9d57 across A/B/C/D; legacy cleanup remains | Explicit reuse/separate choices, phone/name/membership guards, reviewed snapshots, import targets, atomic new-customer signup and no hidden supplier creation. Exact browser passed; unrelated failed saves remain visible. |
| F48 | Shift difference must show when supported across Telegram, reports and history; Closing cash / សាច់ប្រាក់បិទវេន; Not Paid / ប្រាក់ជំពាក់; use owner's supplied concise report arrangement. | Deployed 4afe9825; independent review passed / sales | Each known currency difference is shown even under review; missing inputs remain unknown. Requested section order and Closing cash labels are pinned. |
| F49 | Attribute Protected Audience, Shared Storage and StorageType.persistent deprecation warnings and fix actual app use. | Unresolved source attribution | No matching app API use found in source or clean-browser warnings. Exact reported third-party/extension source remains unproven; no suppression. |
| F50 | Correct unassociated form labels (browser reports four resources). | Deployed 4afe9825; exact four reproduced and fixed / responsive | Sales custom-export flow now has zero unassociated labels in the clean-browser check. Other forms remain separate follow-up candidates. |

| F51 | Enforce owner-confirmed canonical Shop/Warehouse and product/branch/lot identity across every writer; retain daily prompt/report-only cash and Not Paid revenue. | Canonical branch/lot followups deployed c2eb9d57 | CRUD/review/undo/reset and Warehouse→Shop transfer guards, disabled sale-side Warehouse, stale-lot checks, authoritative general/dated/sales imports, and canonical export buckets passed independent and combined checks. Historical unknown identities are not silently repaired. |
| F52 | Investigate negative revenue/profit accuracy. | Focused formula review complete; historical financial census open | No formula defect established. Preserve genuine losses; never clamp or invent money. |

## Public portal and legal requests

| ID | Request | State / owner | Evidence or next action |
|---|---|---|---|
| P01 | Privacy, Terms and Cookie policies; footer policy button reachable at page bottom. | Deployed 821efc94; recorded limitations retained | Reader routes, footer, focus/history/title/scroll behavior verified. |
| P02 | Determine cookie consent needs; form consent and durable policy version/time/locale. | Deployed 821efc94; recorded limitations retained | Optional map/AI/share consent controls and server enforcement; migrations 0130/0131 required. No claim of universal legal compliance. |
| P03 | Minimize collected data; inspect analytics/third-party embeds. | Deployed 821efc94; recorded limitations retained | Initial public load has no third-party requests/embeds; map revocation unloads; raw session identifiers removed; HMAC secret needed at release. |
| P04 | Accessible public site: alt text, contrast, keyboard forms, clear buttons and small-screen heading. | Deployed 821efc94; recorded limitations retained | 375px heading one line/no overflow; modal focus/inert/scroll checks and UI fixes passed. |
| P05 | Remove fake reviews/unsupported claims and review image copyright. | Reviewed; rights facts unresolved / portal | No invented reviews/claims added. Existing image ownership/license cannot be proven from a file alone; keep this risk visible. |
| P06 | Add truthful business details; check applicable local law and flag risks. | Needs facts / root, owner | Trade name/address/phone verified. Registered legal identity, registration, email and target markets remain unconfirmed; Cambodia sources and conditional foreign-market risks documented privately. |
| P07 | Configuration security findings discovered during takeover. | Configuration repaired; bot token rotation pending / root | Dedicated portal HMAC absent; one malformed Telegram binding exposes credential text in its name. Dedicated HMAC configured and stray binding removed; bot token rotation remains necessary. No credential values belong in this register. |

## UI follow-up queue

| ID | Request | State |
|---|---|---|
| U01 | Improve small-screen main/subpage back navigation and remove the large empty bottom gap. | Deferred UI |
| U02 | Add icons to subpage navigation. | Deferred UI |
| U03 | Reports centered with safe edge gutters, larger readable text, consistent larger filter button. | Core gutters, centered report document, readable type and mobile filter sizing deployed c2eb9d57/source-verified; final visual polish remains |
| U04 | Compact Shift button with stats/actions; move export beside section title or near small-screen page title without crowding notifications. | Core compact Shift/Export and dedicated shift-report actions deployed c2eb9d57/source-verified; remaining mobile arrangement review |
| U05 | One highlighted Not Paid row; positive total/final profit green. | Deployed4e576eaa | Selected headline contrast corrected; no accounting changes. |
| U06 | Receipt Item/Qty/Price/Total headings English by default, including mixed English/Khmer setting. | Deployed/source and render-test verified: literal Item/Qty/Price/Total in en/km/both |
| U07 | Add minus next to Close for edit/add/set/stock/session actions; Back/discard/minimize must cooperate with scoped drafts. | Partial deployed: Product, Fast Stock-In, Receive Batch, Create Products Session, Branch edit and Fee drafts minimize/restore; stock adjust/set/remove and broader rollout remain |
| U08 | Compact Start/End dates; default entire days 00:00–23:59 without extra selector; align with stats/actions across Dashboard/Sales/Expenses/Returns/Branches. | Deferred UI |
| U09 | Compact rectangular payment-method control while changing awaiting-payment status. | Deferred UI; F01 functional editing remains priority |
| U10 | Date/time before IDs on receipts, sessions and analogous rows. | Partial deployed: Shift/movement time-first; receipt and remaining list ordering still open |
| U11 | Compact report presets and This month on same row. | Deferred UI |
| U12 | Consistent button/stat heights following the Shift control. | Deferred UI |

| U13 | Expanded mobile Sales: Return/Print/Close one row, three status options one row, Cancel/Back alongside Update; Records at bottom; merge membership/attach controls. | Deployed73fd7dc1; independent source/focused checks and375/1280 writer browser passed |
| U14 | Expanded sale header compact ID/status/actions with date/time below; evaluate double-click/long-press copy with accessible explicit alternative. | Deployed73fd7dc1; independent source/focused checks and375/1280 writer browser passed |
| U15 | Collapsed mobile Sales: cashier and branch share receipt/time row, pipe separators, bold cashier. | Deployed73fd7dc1; independent source/focused checks and375/1280 writer browser passed |

## Release and follow-through

1. Verified application release 02eecbe3 is deployed at 100%; migration 0134 preservation checks pass.
2. Check live Sales and duplicate preview, then perform requested supported duplicate merge with audit/undo.
3. Historical correction completed against the reviewed 65-column schema. Preserve immutable private manifest, audit proof and recovery limits; ambiguous fulfillment, driver and sale-link facts remain unresolved.
4. Continue deferred UI and resolve business/rights facts and Telegram rotation.

Detailed evidence: [takeover ledger](2026-09-07-codex-takeover.md), individual Git
commits, and private local `outputs/takeover-20260907/` reports. Local checks do not
stand in for deployment, and missing historical evidence is never fabricated.

## Stability release candidate and repair transport

- Public fix branch codex/release-stability-20260907 at 560bfbcbbc6730e9bba305bec6b70af752579ad9 contains only F41, F44 and F45, separate from F39/F40. GitHub pushed. Backend 280/280 passed; frontend 307/309 initially passed, two stale assertions corrected and focused rerun passed 3/3; both types, i18n, build and deploy dry-run passed. Initial attempt failed after asset upload; retry succeeded, independently confirmed as Worker03aa25a5 at100% at15:36:03UTC.
- F39/F40 independent review found post-commit finalizer errors, unknown first-request timeout handling, normal-budget confirmation regression, and whole-cluster workload-bound gaps. Corrections are integrated progressively; not yet certified or deployed. Complex multi-product clusters must be refused before any fold unless a reviewed whole-cluster plan fits the bound. Their eventual correction remains open.
- Three grouped historical execution attempts through the remote development proxy failed. Each full REST postcheck reports 44 pending, 0 applied, 0 audits, 0 violations across all 4,333 target rows. Private atomic file-import transport is being prepared with the same reviewed manifest and audit/full-row guards; no historical repair is claimed complete.

Historical import follow-through: fees-001 committed 99 Shop branch corrections. CLI exit 0 output framing caused a safe pause; independent postcheck-after-file-import.json confirms exact state and audits. No later group ran. Parsing correction and explicit resume remain; the completed group must be skipped.


## September 8 follow-through (17:15 UTC September 7)

- F39/F40: bounded merge and redo economics passed independent review. Browser proved 20 pairs complete under one confirmation and normal continuation, undo works, and close aborts preview. It also exposed an unknown-outcome reload cache bug; fix integrated as 3b48412c, independent review and browser rerun pending. Persisted whole-cluster preview economics remains active. No new production product merges beyond the original eight.
- F42: read-only production census found three shared canonical customer-phone groups, one same-name/phone candidate, two stale lookup keys, two duplicate supplier-name groups, and no normalized membership collision. These are candidates, not proof that people or businesses are identical. Existing contacts remain unchanged.
- F42 merge review found missing delivery expense references, non-atomic writes, incomplete membership lineage and frontend permission mismatch. Backend and permission fixes assigned separately. Existing membership IDs must be preserved; no destructive candidate cleanup until supported by evidence and safe execution.
- F43: seven phone input surfaces now have independently reviewed digit-preserving spacing, caret/paste, mobile beforeinput and IME handling. Membership display accurately marks assigned IDs read-only while preserving the legacy blank-ID path. Release gates remain.
- F46: Products Conflicts performs up to two requests and one dialog per selected pair. Decision: combined review for exact two-row pairs with per-pair stock decisions, bounded execution and truthful partial progress; runtime follows the current release freeze.
- Historical repair resume 2: eight fee groups applied (792 rows), 36 pending, nine exact audit records and zero full-row violations. Network failure stopped group nine; independent postcheck proved it pending before explicit resume 3.

## Historical correction completed — 2026-09-07 17:39 UTC

Guarded file-import resume 4 completed all remaining groups and the completion audit. Independent full REST postcheck-after-file-import-resume-4.json reports completed: 44 applied, 0 pending, 0 inconsistent; fees4255/sales22/sale_items56; 46 exact audit records; zero violations. Only proven branch metadata changed, with expected revision/audit effects. No stock quantities, financial amounts, driver assignments or legacy sale links were invented. Completed plans are terminal and the private operator refuses logical recovery after completion. Source manifest lineage02eecbe3; current application remains560bfbcb.

## Current remaining work — September 8 owner update

- **Ready for rollout:** Contacts canonical matching/import guards, seven phone-entry fields, membership preservation, atomic merge and permissions; bounded product merge execution/preview, accurate partial outcomes and redo economics. Independent reviews passed; migration0135 and deployment/live validation remain.
- **Production operations pending:** resume requested product duplicate merge after release; only eight cases have committed. Existing Contacts duplicates are reviewed candidates, not yet merged; distinct membership and weak supplier identity evidence remain blockers to destructive cleanup.
- **Active next slices:** F47 contact duplicate prompts; F48 shift difference/closing-cash report parity; F49 browser warning attribution; F50 form-label associations.
- **Planned, runtime not started:** F46 combined selected-conflict review and batching; larger/complex product cluster continuation; remaining modal minimize rollout and mobile UI U01–U15. Existing partial UI fixes remain recorded above.
- **Needs external facts/hardware:** actual phone camera test; ambiguous historical driver/sale-link provenance; supplier/customer identity evidence; registered business details/markets; image ownership; Telegram bot token rotation.
- **Completed data correction:** all proven historical Shop branch metadata targets, independently checked. No amounts or unknown relationships were invented.
- **Release policy:** continue verified incremental deployments as functional slices clear checks; keep each fix in its own descriptive commit. No periodic automation was created; this is the ongoing release workflow.

## Latest release and remaining work — September 8

- Deployedda5c8b02 at100%, Workera49ba8c2-1192-4700-b626-564a72e54938, deploymentce856f22-34dc-469c-b4f9-3aed1d6513ea. GitHub fix branch pushed. Fullbackend283/283; frontend313/314 then sole stale moved-code contract fixed and rerun passed; finalPOST bounds/migration/whitespace follow-ups independently passed focused checks. Types/i18n/build/dryrun passed. Frozenrealbrowser20cases in2requests underoneconfirmation, exactcosts/20audits/20history, Undo restoredonepair.
- Remote0135 addedtwoindexes only; before/afterhashes for59snapshot/233actionrows and421prior schemaobjects match,423after. Historicalrepairall44groups/46audits remainscomplete.
- Productionduplicate merge remains8completedcases. Browserconnector timedoutduringpostdeployverification; no additionalproductionmergeattempt.
- Nextrelease candidates: F48Telegramdifference/order/Closingcash (0180fa3e,3892711b) independentlyPASS; F50exactfourSaleslabelerrors (747d7f44) independentlyPASS; F47Cremovehidden suppliercreation (74c4a0ce), F47Dportalatomic signup (c87eb4ad), F51salesimportguards (8ceb2b9b) awaitingintegration/independentchecks. F47Amanual/POSexplicitcandidateprompts, F47Bcontactimportambiguity, F51sale lotownership/atomicallocations/POSbranchlotguards active.
- Stillplanned: F46combinedconflict review/batching, complex productclusters, remainingmobile UI/minimize rollout, branchCRUD/review/undo canonicalidentity enforcement, canonical Salesexportbreakdowns. Stillneedsfacts: historicaldriver/salelinks, contactidentity cleanup, phonecamera hardware, legalbusiness/markets/image rights, bottokenrotation.
- Session limit permits eight simultaneous subagents, not ten; bounded tasks run in waves.

## Incremental deployment — September 8

Release 4afe9825 is live at 100%, independently confirmed by Cloudflare. Exactly four reviewed fixes were published separately; no migration. Types, i18n, production build, dry-run and focused shift/label/supplier checks passed. Newest broader integration gates exposed three stale tests and a native-select mismatch in the unfinished contact-import UI; these are being corrected before that later release.

Remaining functional owners: Identity handles explicit contact/POS duplicate choices and disabled Warehouse/stale-lot picker behavior; Media handles contact-import decisions, authoritative sale-import lot guards, and canonical import branch resolution; Accounting’s checkout lot guards passed independent race/rollback review; Portal handles canonical branch administration/review/undo/reset/transfer enforcement; Sales and Minimize independently verify follow-ups; Responsive repairs focused gate contracts. F47D portal signup atomicity is independently approved but not deployed. F46 combined conflict batching and the remaining mobile/minimize queue have not started runtime implementation. External facts and production merge access remain explicitly open.

## Current remaining work after dfb8932e

- Final verification: explicit duplicate decisions for customer/supplier/delivery/POS, old-client retry protection, disabled Warehouse and stale-lot picker behavior (F47A/F51).
- Active repairs: canonical branch CRUD/review/undo/reset/transfer enforcement and edit-only UI; general/dated stock imports including forged IDs, ambiguous defaults and atomic write guards; canonical export breakdown quantities/buckets/status counts. Independent reviewers reproduced blockers; none of those incomplete candidates are deployed.
- Not started runtime: F46 combined selected-conflict review/execution; larger complex duplicate merges beyond supported bounded cases; remaining mobile/layout/minimize U01–U15 items (partial earlier implementations remain listed individually).
- Pending live/evidence: remaining production product merge after eight cases; actual phone-camera testing; legacy customer/supplier membership identity cleanup; two ambiguous mixed/Warehouse sales, 21 unknown drivers, 4,282 unlinked legacy fees and six zero-item sales. Proven branch repair is already complete; no invented links.
- Unresolved attribution: reported deprecated browser APIs and anonymous VM startTime errors. Four reproduced form-label issues were fixed and deployed.
- Owner/external facts: registered legal identity, registration, contact email and target markets; image licenses/ownership; Telegram bot-token rotation. Existing portal policies/consent/accessibility fixes remain deployed with those limitations.
- Financial audit: canonical revenue includes Not Paid and is nonnegative. Genuine losses must remain visible as negative profit; no clamp or invented money. Clarify misleading nonnegative-profit test wording separately.

Release dfb8932e was independently confirmed at100%; no migration. Full285 backend suites and316 frontend test files passed before deployment. Source integration c09c707a remains a later candidate, not the deployed release.

## Functional follow-through — September 8, next checkpoint active

Production remains dfb8932e (Worker6abf6ffa,100%). Approved canonical branch administration/reset/transfers, guarded general/dated imports and export breakdown corrections are integrated through2766eb52. The provisional public candidate is dbdb24b7, pending final follow-ups; it is NOT deployed.

Exact-c09 Contacts/POS browser passed explicit duplicate decisions, blocked shared-phone/membership creation and disabled Warehouse. It found a stale resolved-error banner; fix1f9dd5a4 is in independent review and exact-browser validation. Full combined frontend317/318 passed; sole stale export-source assertion fixed and focused rerun passed. Frozen combined backend285/291 effective pass; six known stale test/fixture/loader failures, receipt already fixed and remaining five under correction. Do not label the combined gate green until these checks pass.

F46 runtime implementation is now ACTIVE (supersedes earlier not-started notes): dedicated backend owner conflict_batch_impl, frontend owner sales_impl, backup/reset owner media_stock_impl, isolated from this checkpoint. Migration0136 is reserved locally for durable selected-conflict run/case receipts; it has NOT been applied to production. Combined preview/one confirmation, scoped per-pair stock choices, atomic audit/undo and truthful continuation remain acceptance requirements.

Production product merge remains eight cases and browser access pending. Functional fixes still precede deferred UI. Original dirty workspace and historical evidence remain preserved.

## F53 — permission-refresh event coalescing (next checkpoint)

New reproduced frontend freshness bug from the separately authorized architecture review: an own-user update followed by an unrelated-user update within the debounce loses the required bootstrap; payloadless role refresh also misses bootstrap. Pinned e24fc25e actual-handler experiment has positive controls. No backend authorization bypass demonstrated. Identity owns isolated AppContext/helper/test correction from9654562d; independent review pending. It is excluded from the frozen branch/contact checkpoint. Evidence: C:/Users/mrkl6/Downloads/architecture-review-20260908/permission-event-experiment.cjs and .results.json. Do not change the review artifacts.

| F53 | Permission refresh intent and session isolation. | Deployed4e576eaa | Independent event/debounce/logout race checks passed; backend authority unchanged. |

## Branch/contact checkpoint deployed

Exact public c2eb9d57 is live100%, source9654562d, Worker3931ea55-3f66-459e-823d-3339979bd441 at2026-09-08T03:37:12.286363Z.31 individual commits pushed. Full291 backend suites and319 frontend files, types,5384 bilingual keys,1102-module build, dry-run and independent browser/source reviews passed. No remote migration. New migration0136 belongs exclusively to unfinishedF46 and is not deployed.

Remaining: F46 combined conflict review/execution and truthful saved run/undo status (backup/reset schema slice independently approved, runtime/UI still active); F53 permission-refresh coalescing; eight-case production merge continuation; legacy contact/membership evidence cleanup; ambiguous historical driver/sale links; real phone-camera verification; unresolved browser-warning attribution; U01–U15 remaining layouts/minimize/visual confirmation; business registration/market/contact and image-rights facts; Telegram token rotation.

## F54 — stale in-flight read/cache ownership (next checkpoint)

Separate authorized efficiency review reproduced invalidation while a read is pending: the next read reused stale in-flight work and old response repopulated shared cache. Isolated fix538d65ee (http.ts/apiHttp.test.ts) has focused tests and independent bounded review; not integrated/deployed here. Reviewer also reproduced a late local fallback replacing fresher server cache without invalidation; follow-up retained with the same external owner. Preserve resolved-error occurrence IDs fromc2eb. Callback-side persistent cache/IndexedDB effects remain outside the proven scope. Root will require exact independent evidence before integration. Active writer: efficiency-cache-worker in C:/Users/mrkl6/.codex/worktrees/bos-efficiency-20260908/business-os-v1; no overlapping HTTP edits.

| F54 | Shared HTTP cache invalidation and server precedence. | Deployed4e576eaa | 69 focused tests and512 timing schedules; callback-side persistent mirror effects remain outside scope. |

## Freshness follow-up candidate — September 8

Production remains c2eb9d57/Worker3931ea55,100%. Next isolated release includes F53 permission-refresh coalescing and session-generation isolation (independent review PASS); F54 HTTP invalidation/in-flight ownership and authoritative server-cache precedence (69 focused checks plus512 independent timing schedules); U05 selected positive profit headline stays green in both themes. Source b2299a2b is integrated, not deployed. Existing callbacks that write persistent queryCache/IndexedDB and already-started caller results are outside F54's proven shared-HTTP-cache boundary. No backend source or migration changes in this follow-up.

F46 is NOT in this candidate. Schema/backup/reset are independently approved locally; backend/UI parity still active. Required corrections: actionable-only manifest with blocked cases shown separately, exact same-request manual resume, changed-value markers after re-preview, complete image counts/primary indication. No incomplete F46 runtime or migration0136 is deployed. U13–U15 mobile Sales layouts are active separately.

## F55 — protect pending offline work across hard runtime changes

New read-only overhaul finding (not observed production loss): hard storageVersion/dataRootKey/organization changes can call resetLocalMirrorDb and erase pending queue/outbox/vault/chunks. Old queued work also lacks explicit actor/runtime origin binding. Identity is preparing a bounded plan/reproduction against1befb1d8, no implementation yet. Required design is origin-scoped quarantine and compatible reauthorization/reconciliation; never blindly preserve-and-replay across users/organizations or expose prior private data. Original probe/report: C:/Users/mrkl6/Downloads/overhaul-review-20260908/freshness-recovery.probe.cjs and freshness-recovery.md. Excluded from both deployedc2eb and frozen freshness checkpoint. Backend auth bypass is not demonstrated.
## Not Paid stock rule correction and timeout release deployed — September 9

- Owner correction is now applied live: `awaiting_payment` / Not Paid sales deduct stock exactly once, just like completed sales; cancellation restores it through the existing guarded path.
- The signed-in Admin recovery panel applied target `sale-not-paid-stock-recovery-20260909-v1` once after backup. It corrected four quantity-one lines across sales 16952, 16953 and 16954, created four `sale` inventory movements, restored all four unreleased allocations, and left sale 16951's existing 36-unit deduction unchanged. Header totals and delivery data were not changed.
- Postflight: 16952 has 1 item/revision 10, 16953 has 2 items/revision 7, 16954 has 1 item/revision 4; product stock is 859=0, 409=8, 3490=2, 5370=6. Recovery receipt is backed up and the exact operation has three members with no repeat guard.
- Release branch `codex/sale-create-trigger-release-20260909` is at `3b98fc1a`; Worker deployment `8bfacf42-bd8b-4e62-9d61-1c4f2c7ddf51` / version `fb2aa5c4-22ec-4de5-ab32-806de9fce7dd` is at 100%. The release includes 45-second mutation timeout handling with unknown-outcome preservation, Khmer write-error presentation, exact recovery-digest hardening, and the Edit Customer heading-row fix.
- Focused backend/frontend tests, both typechecks, i18n verification and frontend production build passed. No blind retry was used. Transfer durability, duplicate cleanup, broader UI/public portal, and offline work remain open; offline is paused.
