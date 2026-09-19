// Read staged index entries against the copied object store, not live Git.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const archive='C:/Users/mrkl6/BusinessOS-Recovery/2026-09-19';
const store=path.join(archive,'git-common');
const cleanEnv={...process.env};
for(const key of Object.keys(cleanEnv))if(key.toUpperCase().startsWith('GIT_'))delete cleanEnv[key];
cleanEnv.GIT_OPTIONAL_LOCKS='0';
if(fs.existsSync(path.join(store,'objects/info/alternates')))throw Error('External object alternates require separate preservation');
const indexes=[path.join(store,'index')];
for(const name of fs.readdirSync(path.join(store,'worktrees')))indexes.push(path.join(store,'worktrees',name,'index'));
const objects=new Set();let checked=0,entries=0,submoduleEntries=0;
for(const index of indexes.filter(x=>fs.existsSync(x))){
 const output=cp.execFileSync('git',['--git-dir',store,'ls-files','--stage','-z'],{cwd:archive,encoding:'utf8',maxBuffer:64*1024*1024,env:{...cleanEnv,GIT_INDEX_FILE:index},stdio:['ignore','pipe','pipe']});
 for(const row of output.split('\0').filter(Boolean)){
  const match=/^(\d+) ([0-9a-f]+) (\d)\t/.exec(row);if(!match)throw Error('Unexpected index record');
  entries++;if(match[1]==='160000'){submoduleEntries++;continue;}
  if(!/^0+$/.test(match[2]))objects.add(match[2]);
 }checked++;
}
const output=cp.execFileSync('git',['--git-dir',store,'cat-file','--batch-check'],{cwd:archive,input:[...objects].join('\n')+'\n',encoding:'utf8',maxBuffer:64*1024*1024,env:cleanEnv,stdio:['pipe','pipe','pipe']});
if(output.split('\n').filter(Boolean).some(x=>!/^\w+ blob \d+$/.test(x)))throw Error('Missing or wrong-type staged object in private archive');
const report={verifiedAt:new Date().toISOString(),indexes:checked,indexEntries:entries,uniqueStagedBlobs:objects.size,submoduleEntries,allStagedBlobsReadableFromArchive:true,doesNotAuthorizeDeletion:true};
fs.writeFileSync(path.join(archive,'index-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
