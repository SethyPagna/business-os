const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const directTest = resolve(root, 'agent-team/scripts/test-team-state.mjs');
if (process.argv.includes('--fixture-child')) {
  execFileSync(process.execPath, [directTest], { cwd: root, stdio: 'inherit', timeout: 60_000 });
} else {
  const fixture = mkdtempSync(join(tmpdir(), 'business-os-agent-team-isolation-'));
  try {
    assert.equal(dirname(realpathSync.native(fixture)), realpathSync.native(tmpdir()), 'Sentinel fixture must stay inside temporary directory');
    const emptyConfig = join(fixture, 'empty-config');
    const emptyTemplate = join(fixture, 'empty-template');
    writeFileSync(emptyConfig, '');
    mkdirSync(emptyTemplate);
    const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    Object.assign(cleanEnvironment, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_TERMINAL_PROMPT: '0' });
    const victim = join(fixture, 'external-repository');
    mkdirSync(victim);
    const victimGit = (args) => execFileSync('git', args, { cwd: victim, env: cleanEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    victimGit(['init', '--quiet', `--template=${emptyTemplate}`]);
    const victimGitDir = realpathSync.native(join(victim, '.git'));
    assert.equal(realpathSync.native(victimGit(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()), victimGitDir, 'Sentinel Git directory must be local before mutation');
    writeFileSync(join(victim, 'sentinel.txt'), 'External repository must not change.\n');
    victimGit(['add', '--', 'sentinel.txt']);
    victimGit(['-c', 'user.name=Sentinel fixture', '-c', 'user.email=sentinel@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Disposable sentinel']);
    mkdirSync(join(victimGitDir, 'agent-team'));
    writeFileSync(join(victimGitDir, 'agent-team/state.json'), JSON.stringify({ schemaVersion: 1, claims: [], messages: [{ text: 'Synthetic external ledger sentinel' }] }));
    const inheritedConfig = join(fixture, 'inherited-config');
    const hookTemplate = join(fixture, 'inherited-template');
    mkdirSync(join(hookTemplate, 'hooks'), { recursive: true });
    const hookMarker = join(fixture, 'hook-executed');
    writeFileSync(join(hookTemplate, 'hooks/pre-commit'), `#!/bin/sh\nprintf 'unexpected hook execution' > '${hookMarker.replaceAll('\\', '/')}'\n`, { mode: 0o755 });
    writeFileSync(inheritedConfig, `[core]\n\tworktree = ${victim.replaceAll('\\', '/')}\n\thooksPath = ${join(hookTemplate, 'hooks').replaceAll('\\', '/')}\n`);
    const scratch = join(fixture, 'child-temp');
    mkdirSync(scratch);
    const snapshot = () => {
      const files = {};
      const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = join(dir, entry.name);
          if (entry.isDirectory()) visit(file);
          else files[file] = createHash('sha256').update(readFileSync(file)).digest('hex');
        }
      };
      visit(victim);
      for (const file of [inheritedConfig, join(hookTemplate, 'hooks/pre-commit')]) files[file] = createHash('sha256').update(readFileSync(file)).digest('hex');
      files.hookExecuted = existsSync(hookMarker);
      return files;
    };
    const cases = [
      ['routing', { GIT_DIR: victimGitDir, GIT_WORK_TREE: victim, GIT_COMMON_DIR: victimGitDir }],
      ['index-object', { GIT_INDEX_FILE: join(victimGitDir, 'index'), GIT_OBJECT_DIRECTORY: join(victimGitDir, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: join(victimGitDir, 'objects'), GIT_NAMESPACE: 'fixture-isolation' }],
      ['indexed-config', { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: victim, GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: join(hookTemplate, 'hooks') }],
      ['config-paths-template', { GIT_CONFIG_GLOBAL: inheritedConfig, GIT_CONFIG_SYSTEM: inheritedConfig, GIT_CONFIG: inheritedConfig, GIT_TEMPLATE_DIR: hookTemplate, GIT_CONFIG_NOSYSTEM: '0' }],
      ['config-parameters', { GIT_CONFIG_PARAMETERS: `'core.worktree=${victim.replaceAll('\\', '/')}' 'core.hooksPath=${join(hookTemplate, 'hooks').replaceAll('\\', '/')}'` }],
      ['lowercase-routing', { git_dir: victimGitDir, git_work_tree: victim, git_common_dir: victimGitDir }]
    ];
    const caseFlag = process.argv.indexOf('--isolation-case');
    const selectedCase = caseFlag < 0 ? null : process.argv[caseFlag + 1];
    if (caseFlag >= 0) assert(cases.some(([name]) => name === selectedCase) || ['setup', 'pending'].includes(selectedCase), 'Isolation case must name an actual test');
    let completedCases = 0;
    for (const [name, injected] of cases) {
      if (selectedCase && selectedCase !== name) continue;
      for (const [surface, script, args] of [['direct', directTest, []], ['wrapper', __filename, ['--fixture-child']]]) {
        const before = snapshot();
        const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env: { ...cleanEnvironment, ...injected, TMPDIR: scratch, TEMP: scratch, TMP: scratch }, encoding: 'utf8', timeout: 60_000 });
        if (result.status !== 0) process.stdout.write(`${name}/${surface}: status=${result.status} signal=${result.signal} error=${result.error?.code || 'none'}\n${result.stdout || ''}${result.stderr || ''}\n`);
        assert.deepEqual(snapshot(), before, `${name}/${surface}: external HEAD/index/objects/config/ledger must remain byte-identical`);
        assert.deepEqual(readdirSync(scratch), [], `${name}/${surface}: all inner fixtures must be cleaned`);
        assert.equal(result.status, 0, `${name}/${surface}: actual integration test must pass: ${result.stderr || result.error || result.stdout}`);
        process.stdout.write(`PASS Git environment isolation ${name}/${surface}\n`);
        completedCases += 1;
      }
    }
    if (!selectedCase || selectedCase === 'pending') {
      for (const surface of ['direct', 'wrapper']) {
        const controlledSource = join(fixture, `pending-source-${surface}`);
        for (const file of ['agent-team/agents.json', 'agent-team/scripts/team-state.mjs', 'agent-team/scripts/test-team-state.mjs', 'cloudflare/scripts/test-agent-team-claims-only-status-pure.cjs']) {
          const target = join(controlledSource, file);
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(join(root, file), target);
        }
        const closeMarker = join(fixture, `pending-child-closed-${surface}`);
        const controlledCliPath = join(controlledSource, 'agent-team/scripts/team-state.mjs');
        const controlledBehavior = `
const controlledTask = process.argv[process.argv.indexOf('--task') + 1];
const controlledHandleFile = join(root, 'controlled-pending-child');
if (controlledTask === 'selftest-lock-b') {
  const controlledFs = await import('node:fs');
  const fd = controlledFs.openSync(controlledHandleFile, 'w');
  controlledFs.writeSync(fd, 'Pending sibling');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  controlledFs.closeSync(fd);
  writeFileSync(${JSON.stringify(closeMarker)}, 'Child handle closed');
}
if (controlledTask === 'selftest-lock-a') {
  for (let tries = 0; tries < 100 && !existsSync(controlledHandleFile); tries += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  process.stderr.write('CONTROLLED PRIMARY EXIT 17 AFTER SIBLING OPEN\\n');
  process.exit(17);
}
`;
        const controlledCli = readFileSync(controlledCliPath, 'utf8');
        assert(controlledCli.includes('const roleIds ='), 'Pending-child fixture must use actual CLI initialization');
        writeFileSync(controlledCliPath, controlledCli.replace('const roleIds =', controlledBehavior + '\nconst roleIds ='));
        const before = snapshot();
        const script = join(controlledSource, surface === 'direct' ? 'agent-team/scripts/test-team-state.mjs' : 'cloudflare/scripts/test-agent-team-claims-only-status-pure.cjs');
        const result = spawnSync(process.execPath, [script, ...(surface === 'wrapper' ? ['--fixture-child'] : [])], { cwd: controlledSource, env: { ...cleanEnvironment, TMPDIR: scratch, TEMP: scratch, TMP: scratch }, encoding: 'utf8', timeout: 60_000 });
        assert.notEqual(result.status, 0, `${surface}: controlled primary failure must surface`);
        assert.match(result.stderr, /CONTROLLED PRIMARY EXIT 17 AFTER SIBLING OPEN/, `${surface}: retain genuine first-child error`);
        assert.equal(existsSync(closeMarker), true, `${surface}: sibling must close before test returns`);
        assert.doesNotMatch(result.stderr, /EPERM/, `${surface}: cleanup must not mask primary error`);
        assert.deepEqual(readdirSync(scratch), [], `${surface}: pending-child failure must clean all inner fixtures`);
        assert.deepEqual(snapshot(), before, `${surface}: pending-child failure must preserve external repository`);
        completedCases += 1;
        process.stdout.write(`PASS pending-child failure, close and cleanup/${surface}\n`);
      }
    }
    if (!selectedCase || selectedCase === 'setup') {
    const incompleteSource = join(fixture, 'incomplete-source');
    mkdirSync(join(incompleteSource, 'agent-team/scripts'), { recursive: true });
    copyFileSync(directTest, join(incompleteSource, 'agent-team/scripts/test-team-state.mjs'));
    copyFileSync(join(root, 'agent-team/scripts/team-state.mjs'), join(incompleteSource, 'agent-team/scripts/team-state.mjs'));
    const beforeFailure = snapshot();
    const failed = spawnSync(process.execPath, [join(incompleteSource, 'agent-team/scripts/test-team-state.mjs')], { env: { ...cleanEnvironment, TMPDIR: scratch, TEMP: scratch, TMP: scratch }, encoding: 'utf8', timeout: 60_000 });
    assert.notEqual(failed.status, 0, 'Missing fixture source must fail during setup');
    assert.match(failed.stderr, /ENOENT.*agents\.json/s, 'Setup failure must be the missing actual source file');
    assert.deepEqual(readdirSync(scratch), [], 'Setup failure must clean its temporary fixture');
    assert.deepEqual(snapshot(), beforeFailure, 'Setup failure must preserve external repository');
    process.stdout.write('PASS setup-failure cleanup\n');
    }
    process.stdout.write(`Agent-team Git environment isolation: ${completedCases} sentinel cases passed; scope=${selectedCase || 'all plus setup cleanup'}.\n`);
  } finally {
    assert.equal(dirname(realpathSync.native(fixture)), realpathSync.native(tmpdir()), 'Sentinel cleanup must stay inside temporary directory');
    rmSync(fixture, { recursive: true, force: true });
  }
}
