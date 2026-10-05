// The request-path entry to the core-data invariants (G39 efficiency item 3).
//
// index.ts mounts this on /api/* only. /uploads/*, /ws, /health and the
// static/document handlers never touch it: an image or a socket upgrade on a
// cold isolate no longer waits for a D1 projection it does not need, and none
// of those paths depends on a seeded organization (/ws authenticates with an
// existing session; every sign-in, portal and admin call is under /api/).
//
// A stamped build (scripts/deploy.cjs, lib/buildStamp.ts) goes through the
// once-per-build gate in lib/coreDataInvariants.ts. An UNSTAMPED build -- local
// `wrangler dev`, a bare `wrangler deploy`, every test that does not define the
// stamp -- keeps the original once-per-isolate check unchanged: with no build
// identity there is nothing safe to key a shared verification on.
//
// Kept apart from coreDataInvariants.ts on purpose: that module is loaded by
// ~10 pure-test harnesses with hand-written module maps, and its import list
// stays exactly as it was.

import type { Env } from '../index'
import { getBuildStamp, isUnstampedBuild, type BuildStamp } from './buildStamp'
import { getPlanLimits } from './planTier'
import { ensureCoreDataInvariantsForBuildOnce, ensureCoreDataInvariantsOnce } from './coreDataInvariants'

/** `revision:sourceHash` of a stamped build, or null when unstamped. */
export function coreInvariantsBuildKey(stamp: BuildStamp = getBuildStamp()): string | null {
  if (isUnstampedBuild(stamp)) return null
  return `${stamp.revision}:${stamp.sourceHash}`
}

export async function ensureCoreDataInvariantsForRequest(env: Env): Promise<void> {
  const buildKey = coreInvariantsBuildKey()
  if (!buildKey) {
    await ensureCoreDataInvariantsOnce(env)
    return
  }
  await ensureCoreDataInvariantsForBuildOnce(env, {
    buildKey,
    reverifyAfterMs: getPlanLimits(env).coreInvariantsReverifySeconds * 1000,
  })
}
