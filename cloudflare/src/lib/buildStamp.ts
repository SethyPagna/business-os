// What commit is this Worker? Until this module existed, nothing could answer
// that question about a running deploy.
//
// On 2026-09-03 a deploy from a clean, fully certified `main` replaced a
// production build that had been made from an unmerged branch, deleting 24
// live commits. Every check passed, because no check could see what was
// actually running. `GET /api/runtime/version` reported `revision: ''` and
// `sourceHash: ''` -- hard-coded empty literals -- and `/health`'s `version`
// is an unrelated fixed string, so neither had changed across any deploy.
// Provenance had to be rebuilt from the Cloudflare API and `d1_migrations`
// with a live regression in front of the user.
//
// The values below are substituted at build time by esbuild (wrangler's
// bundler) from `--define` flags that `scripts/deploy.cjs` computes from git.
// This deliberately mirrors how the frontend already stamps itself
// (`frontend/vite.config.ts` -> `__FRONTEND_BUILD_REVISION__`), so the two
// halves of a deploy can be compared against each other and against
// `wrangler deployments list`.
//
// The `typeof` guards are load-bearing: a build made WITHOUT the defines (a
// bare `wrangler deploy`, `wrangler dev`, a test importing this module) must
// still compile and run. It reports 'dev' rather than crashing -- and 'dev'
// in production is itself the signal that a deploy bypassed the stamping
// path, which is worth seeing.

declare const __WORKER_BUILD_REVISION__: string | undefined
declare const __WORKER_BUILD_HASH__: string | undefined
declare const __WORKER_BUILT_AT__: string | undefined

export type BuildStamp = {
  /** Short git commit the Worker was built from, or 'dev' when unstamped. */
  revision: string
  /** Content hash of the build, or 'dev' when unstamped. */
  sourceHash: string
  /** ISO timestamp the build was stamped, or '' when unstamped. */
  builtAt: string
}

function readDefine(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

export function getBuildStamp(): BuildStamp {
  const revision = typeof __WORKER_BUILD_REVISION__ !== 'undefined' ? readDefine(__WORKER_BUILD_REVISION__) : ''
  const sourceHash = typeof __WORKER_BUILD_HASH__ !== 'undefined' ? readDefine(__WORKER_BUILD_HASH__) : ''
  const builtAt = typeof __WORKER_BUILT_AT__ !== 'undefined' ? readDefine(__WORKER_BUILT_AT__) : ''
  return {
    revision: revision || 'dev',
    sourceHash: sourceHash || 'dev',
    builtAt,
  }
}

/** True when this build carries no git provenance -- i.e. it was not deployed through scripts/deploy.cjs. */
export function isUnstampedBuild(stamp: BuildStamp = getBuildStamp()): boolean {
  return stamp.revision === 'dev' || stamp.sourceHash === 'dev'
}
