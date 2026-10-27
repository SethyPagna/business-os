# Releases, holds and production gates

Moved from progress.md on 27 Oct 2026 (6.0.998); the board keeps a short "Release process" summary that links here. Every rule below still applies.

## Standing release process

- **Release gate** for every new candidate: exact-SHA full GitHub gate, independent Astra review, adversarial/threat review and secrets scan, authorized Paid workflow and independent production postflight. Earlier Opus reviews remain evidence for their historical releases, not new Astra certificates.
- **Versions**: `Records/Recovery/COMMIT-VERSIONS.json` is the authority. Reserve before committing; titles use `n.n.n — concise description` and brief clear bodies; new commits only, never rewrite pushed history.
- **Privacy**: the GitHub repository is PUBLIC (verified 12 Oct). Customer names and phones lived in the old `progress.md` and in four lines of `docs/history/session-log.md`, and remain in git history. Owner ruling 13 Oct: scrub and purge history later (force-push, after the current lanes merge), keep customer data organised in local Records, keep a regularly pushed private mirror. Not urgent. A Haiku scan of seven pushed branches (13 Oct) found no real secret, token, phone, email or chat id in added lines; the commit author identity is the owner's configured git user, already in main history (owner info, no rewrite). See Privacy in the queue.
- **Deploy slots:** at most two per Cambodia date (07:00, and one after 20:00 with fresh `open_today=0`); since 22 Oct the owner allows a daytime deploy once the work is finished, gated and reviewed.

## Holds and production-only actions

Production actions never happen from a planning, review or lane agent. Deployments, remote migrations, secret sync and any remote D1 command are production actions.

- **Migration 0238 (return owed backfill) HOLD** at `ops/scripts/migration/held/0238_return_owed_backfill.sql`: the owner gave the go on 6 Oct, but it may be admitted to the chain only AFTER 0234 and the RET-A returns-money code are live, with the held-0200 column allowlist; RET-A is still MISSING on production (findings D/E/F). Do not admit it earlier.
- **Held migration families stay excluded:** the historical counted-stock chain `bbd692ee` and its damaged conversion are not admitted wholesale. The current bounded release includes exactly0243,0251,0255,0256,0257,0258 beyond the last verified201 production migrations;606 stages0243 and0258 before the cost migrations.0244–0249 and0253/0254 remain excluded. This supersedes older blanket0243–0248 HOLD wording for the explicitly integrated0243 admission dependency only. New allocations still require both fresh `d1_migrations` and every-ref census. Migrations remain append-only, trigger SQL LF-only, with tested recovery and pre/post assertions.
- **Superseded held repair SQL is unsafe under current guards:** local fixture755 proves the old unwrapped script can change a movement and its bookkeeping before stock admission refuses it. It is excluded from runtime paths and numbered migrations, remains outside deployment, and must never be manually executed as a current repair. Exact partial effects and original failure evidence are preserved privately; this is not rollback certification. The supported atomic repair separately proves refusal with all business tables unchanged.
- **Never rerun the cutover.** The Shop → "Old Shop" (inactive) and Warehouse → "LC Store" consolidation is done; no cutover mode is to be rerun; no Undo for it.
- **Deploy window rule**: at most2 deploys per Cambodia date:07:00 regardless of shift, and one after20:00 with fresh Ops `open_today=0`. Every release requires its exact-SHA full GitHub gate, independent Astra review, adversarial/threat review, secrets scan, `deploy.yml plan=paid` and independent postflight. Unattended schedules remain paused. Skip unready or unchanged candidates; old one-off exceptions do not authorize extra deployments. Never infer that main is deployed.
- **Remote D1 only through the ops workflows** (read-only counts/ids queries, results kept in local Records); never wrangler or the D1 connector directly from an agent (13 Oct: one refuter ran a read-only SELECT outside the rule; future prompts forbid it). Local D1 harness only for destructive-operation work. Use full wrangler version UUIDs, never 8-hex tokens.
- **RC1 `efaac4452` is live (26 Oct) and RC2b `a8dbbe1fc` is deploying (27 Oct).** Every new candidate still requires its exact-SHA gate, independent review, secrets scan, a fresh slot check, the Paid workflow and postflight; a release containing 6.0.984 rolls back only by redeploying the prior sha. The historical counted-stock conversion remains HOLD.
- **Held branches and data**: DO NOT delete remote branches before the cleanup manifest is independently reviewed (expected-SHA atomic push); do not rewrite pushed history except the owner-approved privacy purge, scheduled after the lanes merge; no permanent deletion of data, buckets or zones without the owner; historical data repairs (sales 16671/16835/16917/16827, shift 20, nine unreversed deductions, expense note, membership prefix, duplicate customer pairs) only with exact evidence, a backup and owner approval.
- **Counted-stock root-chain commits stay out of every release candidate**; repro tests that are RED by design (`test-al-money-c/d/e/f/g-native.cjs`, M case, `test-al-stock-i-native.cjs`) must not be in a gate-bound candidate until their fix lands.
- **Protected work and active authority**: the owner resumed Codex supervision and the full goal on15Oct; this supersedes the12Oct work pause. Unattended schedules and snapshot loop remain paused. Frozen release candidates and original dirty trees are preserved; PR9 and uncertain branches require their recorded disposition before cleanup. Never deploy a dirty tree or edit the stale `Downloads/business-os-v1` checkout.

## Release history since release 2e

Dates are UTC. Gate, review and postflight evidence for each row is in the private lane log; the session log carries the narrative.

| date | sha | what shipped |
| --- | --- | --- |
| 14 Oct | `2bb192bcb` | release 2e (see the session log done log) |
| 21 Oct | `d3b02a072` | owner-requested release checkpoint; health pack HEALTHY with 214 migrations recorded |
| 22 Oct | `169215b95` | next-20261022, migration 0269 (owner daytime override) |
| 22 Oct | `db2440bb9` | follow-up release (replaced candidate `c2f27dce6`) |
| 23 Oct | `96bdb1cf6` | owner daytime override |
| 24 Oct | `cc735e89e` | 6.0.968 iPhone camera, 6.0.970 D1 read cuts |
| 24 Oct | `e8613f438` | 6.0.966 follow-ups, 6.0.967 permission consistency (part A), 6.0.972 sale payments S1+S2 (migrations 0270, 0271) |
| 25 Oct | `f07fcf82e` | 6.0.974 sale payments S3 readers |
| 25 Oct | `0da8f9f52` | 6.0.977 scanner test deflake, 6.0.978 iPhone camera stops on close |
| 26 Oct | `efaac4452` | RC1: 6.0.983, 6.0.984, 6.0.986, 6.0.987, 6.0.993 (live) |
| 27 Oct | `a8dbbe1fc` | RC2b: 6.0.985, 6.0.989, 6.0.991, exchange budget fix, migration 0272 (deploying) |

Earlier releases are in the compact done log in [session-log.md](session-log.md) (entry "27 Oct 2026 — 6.0.998").
