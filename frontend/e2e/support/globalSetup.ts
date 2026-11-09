import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ADMIN_ORIGIN, E2E_PORT } from '../../playwright.config'
import { distMismatch } from './distIdentity'

/**
 * Runs once, after the fixture server is up (Playwright starts webServer first),
 * for the app tier only. Refuses to run the suite against a server that serves
 * another checkout's build; see distIdentity.ts for why this exists.
 */
export default async function globalSetup(): Promise<void> {
  const localIndex = readFileSync(fileURLToPath(new URL('../../dist/index.html', import.meta.url)), 'utf8')
  const response = await fetch(`${ADMIN_ORIGIN}/`, { headers: { Accept: 'text/html' } })
  const problem = distMismatch(await response.text(), localIndex, E2E_PORT)
  if (problem) throw new Error(`[e2e] ${problem}`)
}
