const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { runInNewContext } = require('node:vm');

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
    if (caseFlag >= 0) assert(cases.some(([name]) => name === selectedCase) || ['setup', 'pending', 'locking'].includes(selectedCase), 'Isolation case must name an actual test');
    let completedCases = 0;
    if (!selectedCase || selectedCase === 'locking') {
      const cliSource = readFileSync(join(root, 'agent-team/scripts/team-state.mjs'), 'utf8');
      const start = cliSource.indexOf('function processIsAlive(');
      const end = cliSource.indexOf('function portablePath(');
      assert(start >= 0 && end > start, 'Recovery tests must execute actual CLI locking functions');
      const lockingSource = cliSource.slice(start, end);
      const oldOwner = { pid: 2147483647, nonce: 'old-lock-generation', created_at: '2000-01-01T00:00:00.000Z' };
      const liveOwner = { pid: process.pid, nonce: 'new-live-generation', created_at: oldOwner.created_at };
      const ownerText = (owner) => `${JSON.stringify(owner)}\n`;
      const lockCase = (name, owner, overrides = {}) => {
        const stateDir = join(fixture, `lock-case-${name}`);
        const lockPath = join(stateDir, 'state.lock');
        mkdirSync(lockPath, { recursive: true });
        const lockOwnerPath = join(lockPath, 'owner.json');
        if (owner) writeFileSync(lockOwnerPath, ownerText(owner));
        else require('node:fs').utimesSync(lockPath, new Date('2000-01-01'), new Date('2000-01-01'));
        const scope = { ...require('node:fs'), process, Date, Math, Number, String, JSON, join, randomUUID: require('node:crypto').randomUUID, stateDir, statePath: join(stateDir, 'state.json'), lockPath, lockOwnerPath, staleLockMs: 30_000, heldLockNonce: null, sleep() {}, now: () => new Date().toISOString(), ...overrides };
        runInNewContext(lockingSource + '\nthis.recover = recoverStaleLock; this.acquire = lock; this.releaseLock = unlock; this.runMutation = mutate;', scope);
        return { scope, stateDir, lockPath, lockOwnerPath };
      };
      const live = lockCase('live', liveOwner);
      live.scope.recover();
      assert.equal(readFileSync(live.lockOwnerPath, 'utf8'), ownerText(liveOwner), 'Stale-aged live PID must retain ownership');
      assert.throws(() => live.scope.acquire(), /Agent-team state is busy/, 'Current live lock must preserve bounded busy semantics');
      assert.equal(live.scope.heldLockNonce, null, 'Busy client must not gain unlock ownership');
      const race = lockCase('retirement-race', oldOwner);
      let successfulRetirements = 0;
      race.scope.renameSync = (from, to) => {
        require('node:fs').renameSync(from, to);
        successfulRetirements += 1;
        mkdirSync(from);
        writeFileSync(join(from, 'owner.json'), ownerText(liveOwner));
        return require('node:fs').renameSync(from, to);
      };
      assert.doesNotThrow(() => race.scope.recover(), 'A same-generation retirement loser must recognize existing proof without EPERM');
      assert.equal(successfulRetirements, 1, 'Only one old-generation retirement may win');
      assert.equal(readFileSync(race.lockOwnerPath, 'utf8'), ownerText(liveOwner), 'Old snapshot must not retire a newer live owner');
      const permission = lockCase('permission-denied', oldOwner, { renameSync() { throw Object.assign(new Error('Controlled EPERM without tombstone'), { code: 'EPERM' }); } });
      assert.throws(() => permission.scope.recover(), /Controlled EPERM without tombstone/, 'EPERM without proof must surface');
      assert.equal(readFileSync(permission.lockOwnerPath, 'utf8'), ownerText(oldOwner), 'Unproven EPERM must preserve owner');
      const changed = lockCase('owner-changed-before-rename', oldOwner);
      let ownerReads = 0;
      let changedRenames = 0;
      changed.scope.readFileSync = (file, ...args) => {
        if (file === changed.lockOwnerPath && ++ownerReads === 2) writeFileSync(file, ownerText(liveOwner));
        return readFileSync(file, ...args);
      };
      changed.scope.renameSync = () => { changedRenames += 1; };
      changed.scope.recover();
      assert.equal(changedRenames, 0, 'Changed generation must be rechecked before retirement');
      assert.equal(readFileSync(changed.lockOwnerPath, 'utf8'), ownerText(liveOwner), 'Changed live owner must retain exact bytes');
      for (const [name, sourceOwner, retiredText] of [
        ['wrong-nonce', oldOwner, ownerText({ ...oldOwner, nonce: 'different-owner' })],
        ['empty-tombstone', oldOwner, null],
        ['sanitized-collision', { ...oldOwner, nonce: 'same/nonce' }, ownerText({ ...oldOwner, nonce: 'same?nonce' })],
        ['same-nonce-different-pid', oldOwner, ownerText({ ...oldOwner, pid: 0 })]
      ]) {
        const collision = lockCase(name, sourceOwner);
        const tombstone = join(collision.stateDir, `state.lock.stale.${sourceOwner.nonce.replace(/[^A-Za-z0-9._-]/g, '_')}`);
        mkdirSync(tombstone);
        if (retiredText) writeFileSync(join(tombstone, 'owner.json'), retiredText);
        assert.throws(() => collision.scope.recover(), /tombstone conflicts with owner/, `${name}: mismatched tombstone must fail closed`);
        assert.equal(readFileSync(collision.lockOwnerPath, 'utf8'), ownerText(sourceOwner), `${name}: source owner bytes preserved`);
        assert.equal(retiredText ? readFileSync(join(tombstone, 'owner.json'), 'utf8') : readdirSync(tombstone).length, retiredText || 0, `${name}: conflicting evidence preserved`);
      }
      const interrupted = lockCase('placeholder-crash', null, { renameSync() { throw Object.assign(new Error('Controlled crash before rename'), { code: 'EIO' }); } });
      assert.throws(() => interrupted.scope.recover(), /Controlled crash before rename/, 'Actual placeholder must survive interrupted retirement');
      const placeholderBytes = readFileSync(interrupted.lockOwnerPath, 'utf8');
      const placeholder = JSON.parse(placeholderBytes);
      assert.equal(placeholder.pid, 0, 'Placeholder must not pretend to be a live owner');
      assert.equal(typeof placeholder.nonce, 'string', 'Placeholder must have a stored generation identity');
      assert.equal(Date.parse(placeholder.created_at), Date.parse('2000-01-01'), 'Placeholder must retain original stale age');
      interrupted.scope.renameSync = require('node:fs').renameSync;
      interrupted.scope.recover();
      assert.equal(existsSync(interrupted.lockPath), false, 'Interrupted placeholder generation must retire on next attempt');
      assert.equal(readFileSync(join(interrupted.stateDir, `state.lock.stale.${placeholder.nonce}`, 'owner.json'), 'utf8'), placeholderBytes, 'Retirement evidence must remain nonempty and immutable');
      const equalTime = lockCase('equal-time-other-generation', null, { renameSync() { throw Object.assign(new Error('Controlled crash before rename'), { code: 'EIO' }); } });
      assert.throws(() => equalTime.scope.recover(), /Controlled crash before rename/);
      assert.notEqual(JSON.parse(readFileSync(equalTime.lockOwnerPath, 'utf8')).nonce, placeholder.nonce, 'Equal-mtime directories must have different generation identities');
      for (const [name, malformed] of [
        ['json', '{invalid'], ['null', 'null'], ['nonce-missing', JSON.stringify({ ...oldOwner, nonce: undefined })],
        ['nonce-empty', JSON.stringify({ ...oldOwner, nonce: '' })], ['pid-string', JSON.stringify({ ...oldOwner, pid: '2147483647' })],
        ['date-invalid', JSON.stringify({ ...oldOwner, created_at: 'invalid' })]
      ]) {
        const broken = lockCase(`malformed-${name}`, oldOwner);
        writeFileSync(broken.lockOwnerPath, malformed);
        broken.scope.recover();
        assert.equal(readFileSync(broken.lockOwnerPath, 'utf8'), malformed, `${name}: malformed legacy owner must remain byte-exact`);
        assert.deepEqual(readdirSync(broken.stateDir), ['state.lock'], `${name}: malformed owner must not gain retirement evidence`);
        assert.throws(() => broken.scope.acquire(), /Agent-team state is busy/, `${name}: malformed owner fails closed with busy semantics`);
        assert.equal(broken.scope.heldLockNonce, null, `${name}: malformed owner must not grant ownership`);
      }
      const delayed = lockCase('delayed-publisher', null, { randomUUID: () => 'delayed-attempt-nonce' });
      require('node:fs').rmSync(delayed.lockPath, { recursive: true });
      let delayedFirstMkdir = true;
      delayed.scope.mkdirSync = (file, options) => {
        const value = mkdirSync(file, options);
        if (file === delayed.lockPath && delayedFirstMkdir) {
          delayedFirstMkdir = false;
          require('node:fs').utimesSync(file, new Date('2000-01-01'), new Date('2000-01-01'));
          delayed.scope.recover();
          mkdirSync(file);
          writeFileSync(delayed.lockOwnerPath, ownerText({ ...liveOwner, nonce: 'delayed-attempt-nonce' }));
        }
        return value;
      };
      let delayedMutations = 0;
      assert.throws(() => delayed.scope.runMutation(() => { delayedMutations += 1; }), /Agent-team state is busy/, 'Delayed failed publisher cannot enter mutation');
      assert.equal(delayedMutations, 0, 'Delayed publisher must perform zero mutations');
      assert.equal(delayed.scope.heldLockNonce, null, 'Failed exclusive publication cannot retain unlock nonce');
      const delayedOwnerBytes = readFileSync(delayed.lockOwnerPath, 'utf8');
      delayed.scope.releaseLock();
      assert.equal(readFileSync(delayed.lockOwnerPath, 'utf8'), delayedOwnerBytes, 'Failed publisher cannot unlock newer live owner even with colliding nonce');
      const missing = lockCase('publication-enoent', null);
      require('node:fs').rmSync(missing.lockPath, { recursive: true });
      missing.scope.writeFileSync = (file, ...args) => {
        if (file === missing.lockOwnerPath) throw Object.assign(new Error('Controlled publication ENOENT'), { code: 'ENOENT' });
        return writeFileSync(file, ...args);
      };
      let missingMutations = 0;
      assert.throws(() => missing.scope.runMutation(() => { missingMutations += 1; }), /Controlled publication ENOENT/, 'ENOENT publication must surface without mutation');
      assert.equal(missingMutations, 0);
      assert.equal(missing.scope.heldLockNonce, null, 'ENOENT publication cannot grant unlock ownership');
      missing.scope.releaseLock();
      assert.equal(existsSync(missing.lockPath), true, 'Failed publisher without ownership cannot remove directory');
      const preempted = lockCase('placeholder-preempted', null);
      preempted.scope.writeFileSync = (file, ...args) => {
        if (file === preempted.lockOwnerPath) writeFileSync(file, ownerText(liveOwner));
        return writeFileSync(file, ...args);
      };
      preempted.scope.recover();
      assert.equal(readFileSync(preempted.lockOwnerPath, 'utf8'), ownerText(liveOwner), 'Exclusive placeholder publication must not overwrite a legitimate publisher');
      assert.deepEqual(readdirSync(preempted.stateDir), ['state.lock'], 'Preempted recovery cannot retire a newly published live owner');
      if (process.platform === 'win32') {
        const released = lockCase('sharing-release', oldOwner);
        let releaseRenames = 0;
        let releaseWaits = 0;
        released.scope.renameSync = (from, to) => {
          releaseRenames += 1;
          if (releaseWaits === 0) throw Object.assign(new Error('Controlled Windows sharing denial'), { code: 'EPERM' });
          return require('node:fs').renameSync(from, to);
        };
        released.scope.sleep = (ms) => { assert.equal(ms, 10); releaseWaits += 1; };
        assert.doesNotThrow(() => released.scope.recover(), 'Fresh recovery may succeed after sharing holder releases');
        assert.equal(releaseRenames, 2);
        assert.equal(releaseWaits, 1);
        assert.equal(existsSync(released.lockPath), false);
        const newer = lockCase('sharing-new-live-owner', oldOwner);
        let newerRenames = 0;
        newer.scope.renameSync = () => { newerRenames += 1; throw Object.assign(new Error('Controlled sharing before new owner'), { code: 'EPERM' }); };
        newer.scope.sleep = () => writeFileSync(newer.lockOwnerPath, ownerText(liveOwner));
        assert.doesNotThrow(() => newer.scope.recover(), 'A retry must reevaluate a newly live generation');
        assert.equal(newerRenames, 1, 'Captured stale rename must not be reused');
        assert.equal(readFileSync(newer.lockOwnerPath, 'utf8'), ownerText(liveOwner));
        const exhausted = lockCase('sharing-exhaustion', oldOwner);
        let deniedRenames = 0;
        let deniedWaits = 0;
        exhausted.scope.renameSync = () => { deniedRenames += 1; throw Object.assign(new Error('Persistent controlled Windows EPERM'), { code: 'EPERM' }); };
        exhausted.scope.sleep = (ms) => { assert.equal(ms, 10); deniedWaits += 1; };
        assert.throws(() => exhausted.scope.recover(), (error) => error.code === 'EPERM' && error.retirementAttempts === 3 && /Persistent controlled Windows EPERM; stale lock retirement failed after 3 attempts/.test(error.message), 'Exhaustion must retain underlying EPERM and bounded diagnostics');
        assert.equal(deniedRenames, 3, 'At most three actual retirement attempts');
        assert.equal(deniedWaits, 2);
        assert.equal(readFileSync(exhausted.lockOwnerPath, 'utf8'), ownerText(oldOwner));
        assert.equal(exhausted.scope.heldLockNonce, null, 'Denied retirement must not grant ownership');
        const otherError = lockCase('sharing-other-errno', oldOwner);
        let otherRenames = 0;
        let otherWaits = 0;
        otherError.scope.renameSync = () => { otherRenames += 1; throw Object.assign(new Error('Controlled EACCES'), { code: 'EACCES' }); };
        otherError.scope.sleep = () => { otherWaits += 1; };
        assert.throws(() => otherError.scope.recover(), /Controlled EACCES/);
        assert.equal(otherRenames, 1);
        assert.equal(otherWaits, 0, 'Other filesystem errors must not retry');
        for (const kind of ['current-owner-read', 'target-stat', 'changed-owner', 'target-mismatch']) {
          const denied = lockCase(`sharing-refusal-${kind}`, oldOwner);
          let deniedAttempts = 0;
          let refusalWaits = 0;
          let afterDenial = false;
          denied.scope.renameSync = (from, to) => {
            deniedAttempts += 1;
            afterDenial = true;
            if (kind === 'changed-owner') writeFileSync(denied.lockOwnerPath, ownerText(liveOwner));
            if (kind === 'target-mismatch') {
              mkdirSync(to);
              writeFileSync(join(to, 'owner.json'), ownerText(liveOwner));
            }
            throw Object.assign(new Error(`Controlled refusal ${kind}`), { code: 'EPERM' });
          };
          denied.scope.readFileSync = (file, ...args) => {
            if (afterDenial && kind === 'current-owner-read' && file === denied.lockOwnerPath) throw Object.assign(new Error('Controlled current owner read denial'), { code: 'EACCES' });
            return readFileSync(file, ...args);
          };
          denied.scope.statSync = (file, ...args) => {
            if (afterDenial && kind === 'target-stat') throw Object.assign(new Error('Controlled target stat denial'), { code: 'EACCES' });
            return require('node:fs').statSync(file, ...args);
          };
          denied.scope.sleep = () => { refusalWaits += 1; };
          assert.throws(() => denied.scope.recover(), new RegExp(`Controlled refusal ${kind}`), `${kind}: proof failure must preserve original error`);
          assert.equal(deniedAttempts, 1, `${kind}: unproven retry must refuse`);
          assert.equal(refusalWaits, 0);
          assert.equal(denied.scope.heldLockNonce, null);
        }
      }
      process.stdout.write('PASS locking generation, collision, crash, malformed-owner, delayed-publisher and busy controls\n');
    }
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
