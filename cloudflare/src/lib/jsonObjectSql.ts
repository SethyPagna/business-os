export function jsonObjectSql(fields:readonly (readonly [string,string])[]):string{
  for(const [key] of fields)if(!/^[a-z][a-z0-9_]*$/.test(key))throw new Error('Invalid SQL JSON field')
  let sql=`json_object(${fields.slice(0,16).map(([key,value])=>`'${key}',${value}`).join(',')})`
  for(let offset=16;offset<fields.length;offset+=15){
    const additions=fields.slice(offset,offset+15).map(([key,value])=>`'$.${key}',${value}`).join(',')
    sql=`json_set(${sql},${additions})`
  }
  return sql
}
