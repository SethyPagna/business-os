#!/usr/bin/env node
// `npm run test:e2e:system`.
//
// This exists only because `E2E_SYSTEM=1 playwright test` is not portable
// shell on Windows, and the alternative -- adding cross-env -- would put a
// dependency into frontend/package.json for one environment variable. The
// suite's only new dependency is @playwright/test, and it stays that way.
//
// Everything else is passed straight through, so this still works:
//   npm run test:e2e:system -- --project=ios-webkit --headed
// Resolve Playwright's own CLI and run it through THIS node rather than
// through `npx`: on Windows a spawned `npx.cmd` needs a shell, and without one
// Node returns status 0 with no output at all -- measured here, and a silent
// green is the worst possible failure mode for a test runner.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cli = require.resolve('@playwright/test/cli')

const result = spawnSync(
  process.execPath,
  [cli, 'test', 'e2e/system', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, E2E_SYSTEM: '1' } },
)
process.exit(result.status == null ? 1 : result.status)
