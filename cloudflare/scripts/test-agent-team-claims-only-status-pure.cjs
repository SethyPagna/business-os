const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
execFileSync(process.execPath, [resolve(root, 'agent-team/scripts/test-team-state.mjs')], {
  cwd: root,
  stdio: 'inherit',
  timeout: 60_000
});
