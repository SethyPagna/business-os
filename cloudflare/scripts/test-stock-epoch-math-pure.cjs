const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const cache=new Map();
const sourceOverrides=new Map();
function load(name){
  if(cache.has(name))return cache.get(name).exports;
  const file=path.join(__dirname,'../src/lib',name+'.ts'),source=sourceOverrides.get(name)??fs.readFileSync(file,'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};cache.set(name,mod);
  new Function('require','module','exports',output)(id=>id.startsWith('./')?load(id.slice(2)):require(id),mod,mod.exports);
  return mod.exports;
}
const {epochReceiptOpening,splitEpochBasis,assertEpochPartition,acceptEpochAgreement,epochActiveQuantity}=load('stockEpochMath');
const original={source_id:'s',event_id:'e0',segment_id:'p',parent_segment_id:null,quantity:'3',gross4:70001,coverage4:0};
const first=splitEpochBasis(original,'1','one');
assert.deepEqual([first.selected.gross4,first.remaining.gross4],[23333,46668]);
const two=splitEpochBasis(original,'2','two');
assert.deepEqual([two.selected.gross4,two.remaining.gross4],[46667,23334]);
const next=splitEpochBasis(first.remaining,'1','next');
assert.deepEqual([next.selected.gross4,next.remaining.gross4],[23334,23334]);
assertEpochPartition([original],[first.selected,first.remaining]);
assert.throws(()=>assertEpochPartition([original,original],[first.selected,first.remaining]),/before_member_duplicate/);
assert.throws(()=>assertEpochPartition([original],[first.selected]),/not_conserved/);
assert.throws(()=>assertEpochPartition([original],[first.selected,first.selected,first.remaining]),/after_member_invalid/);
assert.throws(()=>assertEpochPartition([original],[{...first.selected,source_id:'foreign'},first.remaining]),/after_member_invalid/);
assert.throws(()=>assertEpochPartition([original],[{...first.selected,gross4:23334},first.remaining]),/not_conserved/);
const refuterControls = [
  ['negative before coverage masked by acceptance', () => assertEpochPartition([{...original,quantity:'1',gross4:100,coverage4:-1}], [{...first.selected,quantity:'1',gross4:100,coverage4:0}], new Map([[JSON.stringify(['s','p']),1]]))],
  ['zero quantity carries basis', () => assertEpochPartition([original], [{...first.selected,quantity:'0',gross4:70001},{...first.remaining,quantity:'3',gross4:0}])],
  ['conserved but misallocated ordered basis', () => assertEpochPartition([original], [{...first.selected,gross4:0},{...first.remaining,gross4:70001}])],
  ['generated remaining identity collides with parent', () => splitEpochBasis({...original,segment_id:'x-remaining'},'1','x')],
];
const admittedRefuterControls = refuterControls.filter(([,run]) => { try { run(); return true; } catch(error) { assert.ok(error instanceof RangeError); return false; } }).map(([name])=>name);
assert.deepEqual(admittedRefuterControls, [], 'Independent reviewer counterexamples must all be rejected');
const fullTake=splitEpochBasis(original,'3','full');
assertEpochPartition([original],[fullTake.selected,fullTake.remaining]);
assert.deepEqual([fullTake.remaining.quantity,fullTake.remaining.gross4,fullTake.remaining.coverage4],['0',0,0]);
const coveredParent={...original,coverage4:3};
const coveredSplit=splitEpochBasis(coveredParent,'1','covered');
assert.deepEqual([coveredSplit.selected.gross4,coveredSplit.selected.coverage4,coveredSplit.remaining.gross4,coveredSplit.remaining.coverage4],[23333,1,46668,2]);
assertEpochPartition([coveredParent],[coveredSplit.selected,coveredSplit.remaining]);
assertEpochPartition([{...original,quantity:'1',gross4:100}],[{...first.selected,quantity:'1',gross4:100,coverage4:1}],new Map([[JSON.stringify(['s','p']),1]]));
const promise=id=>({source_id:'s',agreement_id:id,amount4:100000,remaining4:100000,targets:[{allocation_id:'x',amount4:100000,remaining4:100000}]});
const share=(agreement,amount)=>[{source_id:'s',agreement_id:agreement,allocation_id:'x',amount4:amount}];
const a=acceptEpochAgreement(promise('a'),share('a',80000));
assert.equal(a.remaining4,20000);
assert.throws(()=>acceptEpochAgreement(a,share('a',80000)),/exhausted/);
assert.equal(acceptEpochAgreement(a,share('a',20000)).remaining4,0);
assert.equal(acceptEpochAgreement(promise('b'),share('b',100000)).remaining4,0);
assert.throws(()=>acceptEpochAgreement(a,share('b',10000)),/membership/);
assert.throws(()=>acceptEpochAgreement(a,[{...share('a',10000)[0],source_id:'other'}]),/membership/);
assert.throws(()=>acceptEpochAgreement(a,share('a',0.5)),/money_invalid/);
assert.deepEqual(epochReceiptOpening(7,1,'paid'),{quantity:'7',gross4:70000,paid4:70000,debt4:0});
assert.deepEqual(epochReceiptOpening(13,1,'credit'),{quantity:'13',gross4:130000,paid4:0,debt4:130000});
assert.throws(()=>epochReceiptOpening(13,1,null),/reconciliation_required/);
assert.equal(epochActiveQuantity(2,1,false),'1');
assert.equal(epochActiveQuantity(2,1,true),'0');
const actualSource=fs.readFileSync(path.join(__dirname,'../src/lib/stockEpochMath.ts'),'utf8');
function mutant(before,after){
  assert.equal(actualSource.split(before).length,2);
  sourceOverrides.set('stockEpochMath',actualSource.replace(before,after));
  cache.delete('stockEpochMath');
  return load('stockEpochMath');
}
const wrongResidue=mutant('gross4: split.gross4,','gross4: split.gross4 + 1,');
assert.throws(()=>assert.equal(wrongResidue.splitEpochBasis(original,'1','one').selected.gross4,23333),assert.AssertionError);
const missingBeforeGuard=mutant('keys.has(key) || parents.has(parent)','false');
assert.throws(()=>assert.throws(()=>missingBeforeGuard.assertEpochPartition([original,original],[first.selected,first.remaining]),/before_member_duplicate/),assert.AssertionError);
const targetBalance={source_id:'s',agreement_id:'a',amount4:100000,remaining4:100000,targets:[{allocation_id:'x',amount4:20000,remaining4:20000},{allocation_id:'y',amount4:80000,remaining4:80000}]};
assert.throws(()=>acceptEpochAgreement(targetBalance,share('a',80000)),/epoch_agreement_target_exhausted/);
const uncappedTarget=mutant('amount > target.remaining4','false');
assert.throws(()=>assert.throws(()=>uncappedTarget.acceptEpochAgreement(targetBalance,share('a',80000)),/epoch_agreement_target_exhausted/),assert.AssertionError);
const uncheckedOrder=mutant('share.gross4 !== child.gross4 || share.coverage4 !== child.coverage4','false');
assert.throws(()=>assert.throws(()=>uncheckedOrder.assertEpochPartition([original],[{...first.selected,gross4:0},{...first.remaining,gross4:70001}]),/epoch_partition_order_mismatch/),assert.AssertionError);
console.log('PASS exact ordered70001 residue, distinct split membership, partial agreement caps, receipt-specific paid/debt and active quantity math');
console.log('PASS four reviewer counterexamples rejected; full-take empty remainder, covered ordered split and explicit acceptance remain valid');
console.log('PASS independent literal assertions reject wrong-residue, duplicate-before, removed target-cap and unchecked-order source mutants');
