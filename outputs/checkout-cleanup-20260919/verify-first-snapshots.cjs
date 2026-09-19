// Regular-byte verification only. Remaining ADS/database/restore gates are explicit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const archive='C:/Users/mrkl6/BusinessOS-Recovery/2026-09-19';
const records=JSON.parse(fs.readFileSync(path.join(archive,'first-batch-copy.json'),'utf8').replace(/^\uFEFF/,''));
const hash=file=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(file);s.on('data',x=>h.update(x));s.on('end',()=>resolve(h.digest('hex')));s.on('error',reject);});
function inventory(root,excluded=[]){
 const rows=[],links=[],stack=[''];const skip=new Set(excluded.map(x=>path.resolve(x).toLowerCase()));
 while(stack.length){const rel=stack.pop();for(const name of fs.readdirSync(path.join(root,rel))){const relative=path.join(rel,name),full=path.join(root,relative);if(skip.has(path.resolve(full).toLowerCase()))continue;const stat=fs.lstatSync(full);
  if(stat.isSymbolicLink()){links.push({relative,target:fs.readlinkSync(full)});continue;}
  if(stat.isDirectory()){rows.push({relative,type:'directory'});stack.push(relative);}
  else if(stat.isFile())rows.push({relative,type:'file',size:stat.size,mtime:stat.mtimeMs});
  else throw Error('Unsupported file type');
 }}return {rows:rows.sort((a,b)=>a.relative.localeCompare(b.relative)),links:links.sort((a,b)=>a.relative.localeCompare(b.relative))};
}
(async()=>{
 const results=[];
 for(const record of records){
  const source=inventory(record.source,record.nestedRootsExcluded),destination=inventory(record.destination);
  const shape=x=>JSON.stringify(x.rows.map(r=>({relative:r.relative,type:r.type,size:r.size})));
  if(shape(source)!==shape(destination))throw Error('Path or size mismatch in snapshot '+path.basename(record.destination));
  for(const link of destination.links){const original=source.links.find(x=>x.relative===link.relative);if(!original||original.target!==link.target)throw Error('Copied link mismatch');}
  const files=source.rows.filter(x=>x.type==='file'),hashes=[];let cursor=0;
  async function worker(){while(cursor<files.length){const row=files[cursor++];const a=await hash(path.join(record.source,row.relative)),b=await hash(path.join(record.destination,row.relative));if(a!==b)throw Error('Byte mismatch in snapshot');hashes.push({relative:row.relative,sha256:a,size:row.size});}}
  await Promise.all([worker(),worker(),worker(),worker()]);
  if(JSON.stringify(source)!==JSON.stringify(inventory(record.source,record.nestedRootsExcluded)))throw Error('Source metadata changed during verification');
  const report={source:record.source,destination:record.destination,regularFiles:hashes.length,bytes:hashes.reduce((s,x)=>s+x.size,0),links:source.links,nestedRootsExcluded:record.nestedRootsExcluded,databaseRelatedFiles:files.filter(x=>/\.(db|sqlite|sqlite3)(-|$)/i.test(x.relative)).length,hashes,sourceMetadataStable:true,remainingGates:['ADS and attributes','independent restore','database consistency where applicable','fresh pre-removal source verification'],deletionApproved:false};
  fs.writeFileSync(record.destination+'-regular-verification.json',JSON.stringify(report,null,2));
  results.push({snapshot:path.basename(record.destination),regularFiles:report.regularFiles,bytes:report.bytes,links:report.links.length,databaseRelatedFiles:report.databaseRelatedFiles,deletionApproved:false});
  console.log('Verified regular bytes '+results.length+'/'+records.length);
 }
 fs.writeFileSync(path.join(archive,'first-batch-regular-verification.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({snapshots:results.length,files:results.reduce((s,x)=>s+x.regularFiles,0),bytes:results.reduce((s,x)=>s+x.bytes,0),deletionApproved:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
