# Return frontend integration follow-up — 2026-09-13

- Parent candidate: `b0688bda11662e7d59ff2c828aa0b4fdfb9a1ff8` (left frozen and unchanged for its active verifiers).
- Follow-up branch: `codex/precision-integrated-return-20260913`.
- Follow-up content commit: `dbf2d8bc`.
- Ordered source commits: `19197d2eef96c5b64a6b3ceb1baf30eda3e871aa`, then `9cfd18153ef356cc90f62e268e1f653b0fede4b6`.
- Exact paths: `frontend/src/api/returnsTransport.ts`; `frontend/src/components/returns/EditReturnModal.tsx`; `frontend/src/components/returns/NewReturnModal.tsx`; `frontend/tests/returnMoneyV1Flow.test.ts`; `frontend/tests/returnMoneyV1Transport.test.ts`.
- Excluded dependency copy: `09864c881c4fa776107dbcbc0371715c2c523fce`; its locale changes were already present in the parent candidate. No locale or generated-public-runtime file was copied.

The earlier reconciliation manifest incorrectly excluded `19197d2e` as unnecessary because the return frontend commit was not in the frontend sale-money branch ancestry and the root locale dependency was mistaken for the runtime implementation. This follow-up restores the required runtime and test implementation without changing the frozen parent worktree or any backend file.

Verification on the follow-up candidate passed: frontend typecheck; `verify:i18n` with 5,788 pack keys and 613 source files; and the exact five focused suites selected by the source handoff (`directMutationRequest`, two `returnMoneyV1` suites, `returnsExchangeFlow`, and `returnsLayout`). No deployment or production action was run.
