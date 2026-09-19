// Verifies a private Git storage COPY. Does not grant checkout deletion approval.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const source='C:/Users/mrkl6/Downloads/business-os-v1/.git';
const archive='C:/Users/mrkl6/BusinessOS-Recovery/2026-09-19';
const destination=path.join(archive,'git-common');
function inventory(root) {
  const rows=[]; const stack=[''];
  while(stack.length){ const rel=stack.pop();
    for(const name of fs.readdirSync(path.join(root,rel))){const relative=path.join(rel,name);const stat=fs.lstatSync(path.join(root,relative));
      if(stat.isSymbolicLink()) rows.push({relative,type:'link',target:fs.readlinkSync(path.join(root,relative))});
      else if(stat.isDirectory()){rows.push({relative,type:'directory'});stack.push(relative);}
      else if(stat.isFile()) rows.push({relative,type:'file',size:stat.size,mtimeMs:stat.mtimeMs});
      else throw Error('Unsupported file type: '+relative);
    }
  }return rows.sort((a,b)=>a.relative.localeCompare(b.relative));
}
const hash=file=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const stream=fs.createReadStream(file);stream.on('data',x=>h.update(x));stream.on('error',reject);stream.on('end',()=>resolve(h.digest('hex')));});
(async()=>{
 const before=inventory(source),copied=inventory(destination);
 const shape=rows=>JSON.stringify(rows.map(x=>({relative:x.relative,type:x.type,size:x.size,target:x.target})));
 if(shape(before)!==shape(copied))throw Error('Source/archive path inventories differ');
 const files=before.filter(x=>x.type==='file');let cursor=0;const hashes=[];
 async function worker(){while(cursor<files.length){const row=files[cursor++]; const a=await hash(path.join(source,row.relative)),b=await hash(path.join(destination,row.relative));if(a!==b)throw Error('Archive content mismatch: '+row.relative);hashes.push({relative:row.relative,sha256:a,size:row.size});if(hashes.length%10000===0)console.log('Verified '+hashes.length+' files');}}
 await Promise.all(Array.from({length:4},worker));
 const after=inventory(source);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during verification');
 fs.writeFileSync(path.join(archive,'git-file-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),source,destination,files:hashes.length,bytes:hashes.reduce((s,x)=>s+x.size,0),regularStreamsOnly:true,deletionAuthorizedByThisReport:false,entries:hashes},null,2));
 console.log(JSON.stringify({verifiedRegularFiles:hashes.length,bytes:hashes.reduce((s,x)=>s+x.size,0),sourceMetadataStable:true,additionalStreamAndRestoreChecksRequired:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
