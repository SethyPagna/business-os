// Metadata only: no file contents, credential values or business records read.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const downloads = 'C:/Users/mrkl6/Downloads';
function git(args, cwd = root) {
  try { return { ok: true, text: execFileSync('git', args, { cwd, windowsHide: true, timeout: 60000, maxBuffer: 16*1024*1024, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim() }; }
  catch { return { ok: false, text: '' }; }
}
const registry = git(['worktree','list','--porcelain']);
if (!registry.ok) throw Error('Cannot enumerate worktrees');
const registered = new Set(registry.text.split(/\r?\n/).filter(x=>x.startsWith('worktree ')).map(x=>path.resolve(x.slice(9)).toLowerCase()));
const names = fs.readdirSync(downloads, {withFileTypes:true}).filter(x=>x.isDirectory() && /^(bos|business-os)/.test(x.name));
const results=[];
for (const entry of names) {
  const dir=path.join(downloads,entry.name);
  if (registered.has(path.resolve(dir).toLowerCase())) continue;
  const row={path:dir,rootLink:fs.lstatSync(dir).isSymbolicLink(),topLevel:fs.readdirSync(dir),fileCount:0,bytes:0,links:0,skippedDependencyTrees:0,databaseFiles:0,errors:0};
  const stack=row.rootLink?[]:[dir];
  while(stack.length) {
    const current=stack.pop();
    try { for(const child of fs.readdirSync(current,{withFileTypes:true})) {
      const full=path.join(current,child.name),stat=fs.lstatSync(full);
      if(stat.isSymbolicLink()){row.links++;continue;}
      if(stat.isDirectory()) {
        if(child.name==='node_modules'||child.name==='.git'){row.skippedDependencyTrees++;continue;}
        stack.push(full);
      } else {row.fileCount++;row.bytes+=stat.size;if(/\.(db|sqlite|sqlite3)(-|$)/i.test(child.name))row.databaseFiles++;}
    }}catch{row.errors++;}
  }
  const top=git(['rev-parse','--show-toplevel'],dir);
  row.repositoryRoot=top.ok?top.text:null;
  if(top.ok && path.resolve(top.text).toLowerCase()===path.resolve(dir).toLowerCase()) {
    row.head=git(['rev-parse','HEAD'],dir).text;
    const status=git(['status','--porcelain','--untracked-files=normal'],dir);
    row.statusOk=status.ok; row.statusRecordCount=status.ok?status.text.split(/\r?\n/).filter(Boolean).length:null;
  }
  results.push(row);
}
fs.writeFileSync(path.join(__dirname,'unregistered-manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),scope:'Unregistered matching Downloads folders, no changes; size excludes .git, node_modules and links',results},null,2));
console.log(JSON.stringify(results.map(x=>({name:path.basename(x.path),files:x.fileCount,MB:Math.round(x.bytes/1048576),db:x.databaseFiles,git:!!x.repositoryRoot,errors:x.errors})),null,2));
