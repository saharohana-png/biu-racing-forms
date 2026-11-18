/** Fixed application SQL only. Values are quoted as SQL literals, never substituted as syntax. */
export function postgresStatement(sql:string, values:unknown[]=[]):string {
 sql=sql.replace(/length\(CAST\((answers|review) AS BLOB\)\)/gi,'octet_length($1)');
 sql=sql.replace(/SELECT value FROM json_each\(\?\)/g,'SELECT value FROM jsonb_array_elements_text(CAST(? AS jsonb)) AS elements(value)');
 sql=sql.replace(/\bAS\s+([a-z][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g, 'AS "$1"');
 let n=0, quoted=false, output='';
 for(let i=0;i<sql.length;i++){
  const c=sql[i];
  if(c==="'") { output+=c;if(quoted&&sql[i+1]==="'"){output+=sql[++i];continue;}quoted=!quoted;continue; }
  if(c==='?'&&!quoted){
   if(n>=values.length)throw Error('Missing SQL parameter');
   const value=values[n++];
   if(value===null)output+='NULL';
   else if(typeof value==='number'&&Number.isFinite(value))output+=String(value);
   else if(typeof value==='string'&&!value.includes('\0'))output+="'"+value.replaceAll("'","''")+"'";
   else throw Error('Unsupported SQL parameter');
  } else output+=c;
 }
 if(quoted||n!==values.length)throw Error('Invalid SQL binding');
 // PostgreSQL folds unquoted aliases; preserve the application's JSON keys.

 if(/^\s*INSERT OR IGNORE /i.test(output))output=output.replace(/INSERT OR IGNORE /i,'INSERT ')+' ON CONFLICT DO NOTHING';
 return output;
}
