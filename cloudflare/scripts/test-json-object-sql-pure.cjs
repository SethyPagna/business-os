'use strict'
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const {DatabaseSync}=require('node:sqlite')
const mod={exports:{}}
const text=fs.readFileSync(path.join(__dirname,'../src/lib/jsonObjectSql.ts'),'utf8')
new Function('module','exports',ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod,mod.exports)
const {jsonObjectSql}=mod.exports

function calls(sql){
  const stack=[],result=[]
  let quoted=false
  for(let index=0;index<sql.length;index++){
    const char=sql[index]
    if(quoted){if(char==="'"){if(sql[index+1]==="'")index++;else quoted=false}continue}
    if(char==="'"){quoted=true;if(stack.length)stack.at(-1).content=true}
    else if(char==='('){
      const name=/([a-z_][a-z_0-9]*)\s*$/i.exec(sql.slice(0,index))?.[1]
      if(stack.length)stack.at(-1).content=true
      stack.push({name,commas:0,content:false})
    }else if(char===','){if(stack.length)stack.at(-1).commas++}
    else if(char===')'){
      const frame=stack.pop()
      assert.ok(frame,'balanced SQL parentheses')
      if(frame.name)result.push({name:frame.name,args:frame.content?frame.commas+1:0})
    }else if(/\S/.test(char)&&stack.length)stack.at(-1).content=true
  }
  assert.equal(stack.length,0)
  assert.equal(quoted,false)
  return result
}

const db=new DatabaseSync(':memory:')
try{
  for(const count of [0,1,16,17,31,32,48,100]){
    const fields=[],params=[],expected={}
    for(let index=0;index<count;index++){
      const key='field_'+index
      const nested=index===count-1
      const value=nested?JSON.stringify({nested:[null,'ក"\\',1.0001]}):index%5===0?null:index%3===0?'ក"\\\n':index%2===0?'[1,null]':index/10
      fields.push([key,nested?'json(?)':'?']);params.push(value);expected[key]=nested?JSON.parse(value):value
    }
    const expression=jsonObjectSql(fields)
    assert.ok(calls(expression).every(call=>call.args<=32),JSON.stringify(calls(expression)))
    const row=db.prepare(`SELECT ${expression} AS value`).get(...params)
    const actual=JSON.parse(row.value)
    assert.deepEqual(actual,expected)
    assert.deepEqual(Object.keys(actual),Object.keys(expected))
  }
  const old=`json_object(${Array.from({length:31},(_,index)=>`'field_${index}',NULL`).join(',')})`
  assert.equal(Math.max(...calls(old).map(call=>call.args)),62,'old receipt projection exceeds D1 function argument limit')
  assert.deepEqual(JSON.parse(db.prepare(`SELECT ${jsonObjectSql([['must_remain_null','NULL'],['other','0']])} AS value`).get().value),{must_remain_null:null,other:0})
  assert.throws(()=>jsonObjectSql([["unsafe'key",'0']]),/Invalid SQL JSON field/)
}finally{db.close()}
console.log('PASS D1 <=32 function arguments, 16/17 and31/32 boundaries, native JSON/null/text/nested parity and62-argument negative control')
