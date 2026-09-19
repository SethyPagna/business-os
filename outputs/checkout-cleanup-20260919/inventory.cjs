// Read-only Git inventory. Writes only its generated report beside this script.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const git = (args, cwd = root) => new Promise((resolve) => {
  execFile('git', args, { cwd, windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout) => resolve({ ok: !error, text: stdout || '', error: error ? String(error.code) : null }));
});
(async () => {
  const listing = await git(['worktree', 'list', '--porcelain']);
  if (!listing.ok) throw Error('Cannot inventory worktrees');
  const entries = listing.text.trim().split(/\r?\n\r?\n/).map(block => {
    const lines = block.split(/\r?\n/);
    return { path: lines.find(x => x.startsWith('worktree '))?.slice(9),
      head: lines.find(x => x.startsWith('HEAD '))?.slice(5),
      branch: lines.find(x => x.startsWith('branch '))?.slice(7) || '(detached)' };
  }).filter(x => x.path);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], entry.path);
      const remote = await git(['for-each-ref', '--format=%(refname)', '--contains', entry.head, 'refs/remotes/origin']);
      const ignored = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], entry.path);
      const records = status.text.split('\0').filter(Boolean);
      const isPrimary = entry.path.toLowerCase() === 'c:/users/mrkl6/downloads/business-os-v1';
      const isCurrent = path.resolve(entry.path).toLowerCase() === root.toLowerCase();
      const remoteContained = remote.ok && remote.text.trim().length > 0;
      const ignoredCount = ignored.text.split('\0').filter(Boolean).length;
      results.push({ ...entry, statusOk: status.ok, trackedStatusRecords: records.filter(x => !x.startsWith('??')).length,
        untrackedEntries: records.filter(x => x.startsWith('??')).length, ignoredEntries: ignoredCount,
        remoteContained, remoteRefs: remote.text.trim().split(/\r?\n/).filter(Boolean),
        disposition: isPrimary || isCurrent ? 'retain-required' :
          !status.ok || !ignored.ok || !remote.ok ? 'retain-inspection-error' :
          records.length || !remoteContained ? 'retain-local-work-or-unbacked-head' :
          ignoredCount ? 'review-ignored-data-and-active-use' : 'review-active-use-before-removal' });
      if (results.length % 50 === 0) console.log(`Inspected ${results.length}/${entries.length}`);
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  results.sort((a,b) => a.path.localeCompare(b.path));
  const counts = {};
  for (const item of results) counts[item.disposition] = (counts[item.disposition] || 0) + 1;
  const report = { generatedAt: new Date().toISOString(), scope: 'registered Business OS worktrees; no deletion',
    caveats: ['Remote-tracking refs refreshed before this run; not a backup of dirty or ignored data.',
      'No entry is approved for deletion; ignored data, junctions, active processes and nested worktrees require review.',
      'Status records are not exact file counts when renames occur.'], counts, results };
  fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ total: results.length, counts }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
