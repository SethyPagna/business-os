// Read filenames/link metadata only. Never reads secret or database contents.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const entries = source.results.filter(x => x.disposition === 'review-ignored-data-and-active-use');
const results = []; let cursor = 0;
const ignored = cwd => new Promise(resolve => execFile('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'],
  { cwd, windowsHide: true, timeout: 90000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve({ error: error ? String(error.code) : null, paths: (stdout || '').split('\0').filter(Boolean) })));
async function worker() {
  while (cursor < entries.length) {
    const entry = entries[cursor++]; const listing = await ignored(entry.path);
    const files = listing.paths.map(relative => {
      const full = path.join(entry.path, relative.replace(/\/$/, ''));
      try {
        const stat = fs.lstatSync(full);
        return { relative, link: stat.isSymbolicLink(), target: stat.isSymbolicLink() ? fs.readlinkSync(full) : null,
          category: /(^|\/)(node_modules)\/?$/.test(relative) ? 'dependency-directory-review' :
            /(^|\/)dist\/?$/.test(relative) ? 'build-output-review' : 'preserve-unclassified-local-data' };
      } catch (error) { return { relative, category: 'preserve-inspection-error', error: error.code }; }
    });
    results.push({ path: entry.path, error: listing.error, files,
      classification: listing.error || files.some(x => x.category.startsWith('preserve')) ? 'preserve-local-data' :
        files.every(x => x.link && x.category === 'dependency-directory-review') ? 'dependency-links-only-review' : 'dependency-build-review' });
  }
}
(async () => {
  await Promise.all([worker(), worker(), worker()]);
  const counts = {}; for (const row of results) counts[row.classification] = (counts[row.classification] || 0) + 1;
  fs.writeFileSync(path.join(__dirname, 'ignored-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, results }, null, 2));
  console.log(JSON.stringify(counts));
})().catch(error => { console.error(error); process.exitCode = 1; });
