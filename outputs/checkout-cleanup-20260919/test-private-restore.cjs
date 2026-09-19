// Disposable restore drill; does not change original worktrees or approve deletion.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const archive='C:/Users/mrkl6/BusinessOS-Recovery/2026-09-19',store=path.join(archive,'git-common');
const id='e4b91e86f286dc90';
const record=JSON.parse(fs.readFileSync(path.join(archive,'snapshots',id+'-metadata.json'),'utf8').replace(/^\uFEFF/,''));
const verification=JSON.parse(fs.readFileSync(record.destination+'-regular-verification.json','utf8'));
assert.equal(verification.links.length,0);assert.equal(verification.databaseRelatedFiles,0);
const restored=path.join(archive,'restore-drill',id);assert(!fs.existsSync(restored),'Never overwrite a prior drill');
fs.cpSync(record.destination,restored,{recursive:true,filter:src=>path.basename(src)!=='.git'});
const pointer=fs.readFileSync(path.join(record.destination,'.git'),'utf8').trim();
assert(pointer.startsWith('gitdir: '));const adminName=path.basename(pointer.slice(8).replaceAll('\\','/'));
const admin=path.join(store,'worktrees',adminName),index=path.join(admin,'index');assert(fs.existsSync(index));
const cleanEnv={...process.env};for(const key of Object.keys(cleanEnv))if(key.toUpperCase().startsWith('GIT_'))delete cleanEnv[key];cleanEnv.GIT_OPTIONAL_LOCKS='0';
function git(args,env=cleanEnv){return cp.execFileSync('git',args,{cwd:archive,env,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});}
assert.equal(git(['--git-dir',admin,'rev-parse','HEAD']).trim(),record.head);
const checks=[['diff','--no-ext-diff','--no-textconv','--cached','--raw',record.head],['diff','--no-ext-diff','--no-textconv','--raw'],['ls-files','--others','--exclude-standard','-z'],['ls-files','--unmerged','-z']];
for(const args of checks){const original=git(['-C',record.source,...args]);const recovery=git(['--git-dir',store,'--work-tree',restored,...args],{...cleanEnv,GIT_INDEX_FILE:index});assert.equal(recovery,original,'Recovery state differs: '+args[0]);}
const report={restored,head:record.head,checks:['archived HEAD','staged raw diff','unstaged raw diff','untracked names','conflict index stages'],matched:true,scope:'one no-database/no-link real snapshot; broader adversarial and metadata gates remain',deletionApproved:false};
fs.writeFileSync(path.join(archive,'restore-drill-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({matched:true,checks:report.checks,deletionApproved:false}));
