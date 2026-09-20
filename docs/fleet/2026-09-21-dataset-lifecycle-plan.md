# Dataset lifecycle integration — open implementation plan

Read-only architecture evidence: abe43bfa; Returns dependency review0b9e3d76.
Baseline2489fd7a. This document is a plan, not completion or production evidence.

## Confirmed gaps

- Current maintenance acquisition is read-then-upsert. Two request owners can both acquire it. Progress can recreate an old marker; release deletes by key rather than exact ownership/state.
- Corrupt maintenance rows and arbitrary D1 read failures currently look like no maintenance. Missing-table compatibility must not mask unrelated failures.
- Backup clear/restore handlers ignore the release boolean and can report success despite a retained/replaced hold. Force-clear must target the state observed by that request, not a newer holder read later.
- Factory reset has separate custom-table, main DB, staging DB, reseed and R2 phases. An appended retirement call is not a complete atomic or resumable solution.
- Transfer retirement's statement count is bounded, but row work is not. Full-size Free/Paid capacity remains unproved.
- Returns export requires dataset-generation lifecycle, absent from root. Do not enable its UI using0187 alone.

## Ordered implementation and gates

Step1 checkpoint: integratedefcfa855/d2adbf04, root6325 terminal0 and independent
1a391746 pass.11pure checks, native acquisition/progress/release races with12corrupt
states, five actualHono route cases and Worker types. Exactraw observation revision
binds operator clear; failed release cannot report success. Not deployed. This does
not stop effects of a previously running restore after forceclear; steps2-6 required.

1. Atomic maintenance ownership, guarded progress/release and truthful route outcomes. Test competing acquire, old progress after new owner, normal/force clear interleavings, corrupt marker and unrelated D1 failures. Isolated writer assigned; no migration required for this prerequisite.
2. Durable operation journal plus transaction-time write fences. Record immutable request/owner/source identity, phase and cursor; acquire/update them atomically with each bounded batch. Do not rely only on an earlier middleware read.
3. Page transfer retirement with atomic progress, permanent retry tombstones and one guarded generation transition. Test lost acknowledgments and every crash boundary; never reuse old identities after restoring older backups.
4. Pinned restore source and permanent-evidence union. Restore historical receipt/member links without resurrecting employee retry authority. Preserve untouched finance and four-decimal rules.
5. Shared resumable reset/restore coordinator across main/staging/R2, preserving control records. Validate restart/retry/abort and partial service failures before remote use.
6. Integrate actual transfer handlers/replay contract, then complete Returns export. Verify old-backup restore, generation ABA, recreated accounts, historical undo authority, export invalidation and actual browser downloads.

Migration dependency order is finalized0185,0186,0187,0188,0189 plus reviewed additive
journal support.0189 remains a prototype until real route/replay/lifecycle integration.
No remote migration is authorized by this document; recheck user's actual approvals
and record pre/post assertions/recovery before any remote execution.

## Council challenge (one model simulating five perspectives)

### Principal-destructive phase decision — September 21

The journal primitive fails closed if its initiating principal is deleted,
recreated, or loses authorization. Reset/restore must pause before destructive
principal phases until a separately verified explicit administrator recovery
binding exists. No synthetic actor or automatic trust of a recreated account ID.
This is a bounded primitive decision, not a claim of end-to-end restore continuity.

One model simulating five perspectives: Skeptic rejects restored-account authority
reuse; Engineer requires current authority and exact operation identity; Expansionist
proposes a separately audited recovery coordinator; Outsider requires a visible
paused state instead of apparent completion; Executor implements fail-closed tests
before recovery. Anonymous cross-critique: A needs an operational recovery path;
B cannot assume original authority survives restoration; C must not introduce a
bypass; D needs durable backend evidence; E is only a prerequisite. Chairman:
implement the safe primitive now, separately review recovery before route enablement.
Biggest risk is accidentally continuing under a different person's restored ID.
First test is principal deletion/recreation between admission and the atomic batch.

Restore admission 2c6a1e38 separately rejects uncertain import lookup; root dab734
and independent 4d6ecef8 passed. This does not close the import-start TOCTOU gap.
Transfer review 3e326b6c accepts source-only integration; 0188 immediately changes
receipt deletion behavior when applied and is not safe to deploy before lifecycle
and permanent retirement-evidence preservation are integrated.

Independent first-pass lenses: Skeptic rejects a false completion based on metadata
alone or midpoint crashes; Engineer requires atomic ownership and phase/cursor/data
agreement; Expansionist proposes full fault-injection across every device/tier,
aspirational beyond the first slice; Outsider requires understandable paused/failed
states and no misleading success; Executor starts with the concrete lease race.

Anonymous critique: A identifies loss but needs an executable remedy; B must cover
cross-database/R2 effects, not just SQL; C cannot substitute an ideal test platform
for shipped correctness; D needs backend truth not UI wording alone; E is a useful
prerequisite but cannot be labeled the whole solution. Chairman: implement and
independently verify the lease prerequisite now, then the journal/coordinator.
Largest risk is old operations continuing after control changes. First gate is real
D1 interleaving plus route parity, not only source-string assertions.
