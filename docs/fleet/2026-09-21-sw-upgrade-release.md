# Legacy browser-worker upgrade release — September 21

## Scope and source

- Root a1ed5ca3 integrates runtime/test candidate18e1868b; aa5762b4 integrates test-only0eb6b644.
- Restore-query consolidation21bf39ce is included, with its separately recorded root and independent native checks.
- No migration, secret sync, finance/UI rule change or business-data repair in this release.
- Existing live source before this release:590a62399d22, Workerfe1e59bf-2c86-4b10-a687-2f08241310e6.

## Behavior

After complete precache, directly query the actual incumbent worker. Only a verified
legacy protocol response permits one-time controller takeover. Do not reload pages,
replay queued writes or clear account/recovery storage. Preserve validated static
generations needed by existing documents; fallback uses exact same-origin hashed
JS/CSS URLs and valid MIME. Unknown identity cannot authorize takeover or guessed
cleanup. Future capable updates retain consent-based waiting.

## Evidence and limits

- Independent runtime review890e71fa: four files/eight tests pass, including native healthy/poisoned legacy cases, actual waiting-cache-only chunk, draft/IDB preservation, strict fallback and future waiting.
- First integrated gate56075 failed: swShellContent navigation waited for load and timed out while the fixture held a response. Five other files passed. Keep this failure; exact cause remains unproven.
- Test-only correction checks committed SW HTML/MIME/rendered content before releasing held JSON; before/after cache poisoning assertions remain. Independent exact sequence67795: six/six pass. Separate native eight/eight pass.
- Corrected root8181: twelve/twelve focused SW, ownership, recovery and replay files pass.
- Root19655: frontend types, EN/KM5892 keys across647 files, build and startup graph269 chunks/zero cycles pass. Existing large language-chunk and candidate-unused-key warnings remain, not proof of dead code.
- Root86723: clean Paid and Free dry runs pass. Packaging evidence only, not full Free-plan workflow/capacity certification.
- Built frontend revisiona1ed5ca3bad6/hash23cc431e6e86d05e, built2026-09-20T18:59:38.390Z. Later test/docs commits do not change runtime assets.
- Native browser proof is Chromium, not all browser engines or every historical generation. Production preserved-tab smoke remains required after deployment.

## Excluded work

Returns candidate66399fef is NOT integrated: independent0b9e3d76 found missing
business_dataset_generation and actual reset/restore lifecycle prerequisites.
Installing0187 alone would cause fail-closed503 exports. Finalized0185/0186 and
lifecycle preservation/invalidation tests must precede it. Transfer continuation,
full Free backup/restore budgets, public backlog and full-goal acceptance remain open.

## Deployment

Pending. Record exact deployment ID, source and live smoke; never infer from main.
