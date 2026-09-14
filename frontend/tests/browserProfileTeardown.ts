// Shared teardown helper for the browser-driven fixture tests (the ones that
// spawn a real headless Chrome/Edge over CDP against a scratch
// `--user-data-dir`: mobileSectionMenuIcons, dateTimeRangePickerResponsive,
// lazyPortalMenuFirstClick, reportsHubComposedResponsive,
// stockChangeComposedResponsive, mergeDuplicatesReviewPagination,
// productNameRail, productNameAdoption).
//
// Not a test file (no `.test.ts` suffix, so tests/runTestChain.ts does not
// execute it directly).
//
// History: under parallel load (several of these tests launched together)
// Chrome, or an OS handle left over from it (antivirus scan, a lagging
// crashpad subprocess), can still hold the profile directory open for a
// few hundred ms after the `exit` event fires. Every file already waited
// for that exit (and force-killed after a 2s grace period) before calling
// `fs.rmSync`, but the removal itself was unguarded: when the widened
// window still wasn't enough, the EPERM thrown out of rmSync propagated
// from an already-PASSED test's top-level `finally` block as an uncaught
// rejection, reporting a phantom red for a test whose assertions all held.
// `removeBrowserProfile` below only widens the retry budget and makes the
// removal itself never able to flip an already-decided test result: a
// stubborn lock is logged and left for the OS temp reaper, not thrown.
//
// Fixing that unmasked a second, worse failure mode. The old unguarded
// rmSync crashed the process on a stubborn lock, which -- by accident --
// force-terminated it. Once the throw was replaced with a caught warning,
// a run that hit that same lock kept running: `vite.close()`, the CDP
// `WebSocket`, and Node's own fetch/undici keep-alive can each leave a
// handle referenced past the point everything meaningful is done, so the
// process sat idle (confirmed live: ~0.1s of CPU time over 20 wall-clock
// seconds, i.e. genuinely parked, not merely starved) instead of exiting --
// a PASS that never reports itself, which is worse than a red because
// nothing ever tells the runner or the summary that it happened.
// `finishBrowserTest` forces the exit once teardown is done so the test's
// own result (always 0 here -- it is only reached after `finally` completes
// without the try block having thrown) is what actually gets reported.
import fs from 'node:fs'

export function removeBrowserProfile(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.warn(`WARN could not remove browser profile ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Call as the last statement after the test's try/finally. Never call it
// from inside the try block or before assertions have run -- an assertion
// failure must keep throwing so the runner sees the real (nonzero) exit.
export function finishBrowserTest(): never {
  process.exit(0)
}
