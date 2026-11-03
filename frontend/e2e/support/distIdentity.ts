/**
 * e2e/support/distIdentity.ts -- is the fixture server on this port serving THIS checkout's build?
 *
 * Pure on purpose (no Playwright import) so tests/e2eDistIdentity.test.ts can pin it.
 *
 * WHY: playwright.config.ts reuses a server that already answers on E2E_PORT
 * when CI is not set ("reusing an existing dist is the fast path locally").
 * Several sessions share one machine and every worktree defaults to port 4318,
 * so a fixture server started from ANOTHER checkout can be sitting there. The
 * suite then runs against that checkout's build without a word: measured on
 * 4 Nov, a cover-image selector timed out on a storefront markup this tree does
 * not contain, and the red was nobody's bug. A "passes locally" that is really
 * "passes against someone else's dist" is exactly how local and CI disagree.
 *
 * The comparison is on the hashed asset names in index.html (the Vite output
 * names every chunk by content), so it needs nothing from the server it is
 * checking: an older server that predates this check is caught too.
 */

const ASSET_REFERENCE = /(?:src|href)="\/?(assets\/[A-Za-z0-9_.-]+\.(?:js|css))"/g

/** Every built asset index.html references, sorted and de-duplicated. */
export function assetNames(indexHtml: string): string[] {
  const names = new Set<string>()
  for (const match of indexHtml.matchAll(ASSET_REFERENCE)) names.add(match[1])
  return [...names].sort()
}

/**
 * null when the served document is this checkout's build; otherwise a sentence
 * that says which port is wrong and how to get out of it.
 */
export function distMismatch(servedIndexHtml: string, localIndexHtml: string, port: number | string): string | null {
  const local = assetNames(localIndexHtml)
  if (local.length === 0) return `this checkout's dist/index.html references no built assets; run "npm run build" first`
  const served = assetNames(servedIndexHtml)
  if (served.length === local.length && served.every((name, index) => name === local[index])) return null
  const missing = local.filter((name) => !served.includes(name))
  return [
    `the fixture server answering on port ${port} serves a different build than this checkout's dist/ (`,
    `${missing.length} of ${local.length} assets are not served, e.g. ${missing[0] ?? 'none'}). `,
    'It is most likely another worktree\'s server that was left running. ',
    'Stop that server or set E2E_PORT to a free port, so the results are about this tree.',
  ].join('')
}
