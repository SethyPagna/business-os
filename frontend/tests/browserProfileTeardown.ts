// Shared harness helpers for the browser-driven fixture tests: the CDP
// fixtures that spawn a real headless Chrome/Edge against a scratch
// `--user-data-dir` (auditDetailContextSmallScreen,
// dateTimeRangePickerResponsive, lazyPortalMenuFirstClick,
// mergeDuplicatesReviewPagination, mobileSectionMenuIcons,
// productNameAdoption, productNameRail, promotionClickPaths,
// reportsDetailFloatClose, reportsHubComposedResponsive, reportsRenderPass,
// stockChangeComposedResponsive), which wait with waitForBrowser and close
// Chrome with closeCdpBrowser, and the Playwright one (helpPopoverResponsive).
// Every one of them ends in closeBrowserFixture.
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
// nothing ever tells the runner or the summary that it happened. That is
// why the teardown always ends in a forced exit (closeBrowserFixture below)
// carrying the verdict the assertions produced.
import { spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'

export function removeBrowserProfile(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.warn(`WARN could not remove browser profile ${dir}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// The one wait every CDP fixture polls its page with; each binds its own
// label and default budget (a cold vite compile needs far more than a click).
// A read that THROWS is "not ready yet", not a failure: every read is a
// `Runtime.evaluate` over a page that may still be navigating or compiling a
// module, so a transient CDP error used to escape the loop and end the file
// before a single assertion ran -- roughly one run in three under load. Only
// the deadline ends the wait; the last error travels with the timeout so a
// persistent fault is still diagnosable rather than a bare "timed out".
export async function waitForBrowser<T>(read: () => Promise<T | null>, label: string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value !== null) return value
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}; last=${lastError || 'no value'}`)
}

// Quit the Chrome/Edge a CDP fixture launched: ask over the protocol, allow
// 2s, then kill the whole process tree (taskkill /T on Windows) and allow 2s
// more for the exit, before the profile directory is removed.
export async function closeCdpBrowser(browser: ChildProcess, exited: Promise<unknown>, socket: WebSocket | null): Promise<void> {
  const exitsWithin2s = () => Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => { setTimeout(() => resolve(false), 2_000).unref() }),
  ])
  // Nobody reads the reply, so any int32 id will do.
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 1_000_000, method: 'Browser.close', params: {} }))
  if (await exitsWithin2s()) return
  if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
  else browser.kill()
  await exitsWithin2s()
}

// The forced exit, for fixtures that CANNOT let their teardown throw or
// hang -- a Playwright `browser.close()` and a `vite.close()` both keep
// handles that can outlive everything meaningful (see the history above) --
// while still reporting the verdict the assertions produced.
//
// Why it exists: helpPopoverResponsive ran its teardown inside a plain
// `finally`, so when an assertion (or a navigation) failed, the error was
// queued to rethrow AFTER the finally block, `server.close()` parked, and
// Node reported "Detected unsettled top-level await" with an exit code and no
// sign of the real failure. The CDP fixtures had the same shape (an unbounded
// server close in a plain `finally`): a failure queued behind a close that
// never settles is never printed and the process never exits, and
// tests/runTestChain.ts spawns each file with no timeout and prints its
// output only after it exits -- so the whole gate would stall in silence.
// The message a red test prints is the whole point of the test, so the
// caller catches it, prints it and passes 1 here.
//
// Each closer gets its own bounded wait: a stuck close is logged and stepped
// over, never able to change the code. The timer is unref'd so a fast close
// does not hold the loop open for the rest of the budget.
export async function closeBrowserFixture(code: number, ...closers: Array<() => unknown>): Promise<never> {
  for (const [step, close] of closers.entries()) {
    try {
      const finished = await Promise.race([
        Promise.resolve(close()).then(() => true),
        new Promise<false>((resolve) => { setTimeout(() => resolve(false), 5_000).unref() }),
      ])
      if (!finished) console.warn(`WARN fixture teardown step ${step + 1} did not finish within 5s; stepped over`)
    } catch (error) {
      console.warn(`WARN fixture teardown step failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  process.exit(code)
}
