const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,env={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='server-only'?{}:require(name),process:{env},Buffer,Date});return exports;}
const {postgresStatement}=load('lib/sql-compat.ts');
test('SQL binding preserves quotes, Unicode, punctuation and camel-case aliases without interpreting values',()=>{
 const text="עברית ? O'Brien AS sourceRevision changes(); DROP TABLE submissions; --";
 const result=postgresStatement('SELECT ? AS originalName, ? AS size',[text,25]);
 assert.equal(result,`SELECT '${text.replaceAll("'","''")}' AS "originalName", 25 AS size`);
 assert.equal(postgresStatement("SELECT '?' AS literal, ? AS value",['abc']),"SELECT '?' AS literal, 'abc' AS value");
 assert.equal(postgresStatement('INSERT OR IGNORE INTO t(id) VALUES(?)',['x']),"INSERT INTO t(id) VALUES('x') ON CONFLICT DO NOTHING");
 assert.equal(postgresStatement('SELECT length(CAST(answers AS BLOB))+length(CAST(review AS BLOB)) FROM revisions WHERE system_id=?',['TSAL']),"SELECT octet_length(answers)+octet_length(review) FROM revisions WHERE system_id='TSAL'");
 assert.equal(postgresStatement('SELECT input_hash FROM translation_cache WHERE input_hash IN (SELECT value FROM json_each(?))',['["a","b"]']),`SELECT input_hash FROM translation_cache WHERE input_hash IN (SELECT value FROM jsonb_array_elements_text(CAST('["a","b"]' AS jsonb)) AS elements(value))`);
 assert.throws(()=>postgresStatement('SELECT ?',[]));assert.throws(()=>postgresStatement('SELECT ?',[{}]));
});
test('owner sessions reject wrong, modified, missing and expired credentials',()=>{
 const key='a'.repeat(48),mod=load('lib/owner-session.ts',{FORMS_OWNER_KEY:key,FORMS_SESSION_KEY:'b'.repeat(64)});
 assert.equal(mod.ownerKeyMatches(key),true);assert.equal(mod.ownerKeyMatches('ג'.repeat(48)),false);assert.equal(mod.ownerKeyMatches(undefined),false);
 const token=mod.ownerToken();assert.equal(mod.validOwnerToken(token),true);assert.equal(mod.validOwnerToken(token.slice(0,-1)+(token.endsWith('0')?'1':'0')),false);
 assert.equal(mod.validOwnerToken('1000000000000.'+token.split('.')[1]),false);
});
test('team access is closed when unconfigured and requires the exact private code',()=>{
 assert.equal(load('lib/team-entry.ts').teamEntryAllowed('any'),false);
 const {teamEntryAllowed}=load('lib/team-entry.ts',{FORMS_TEAM_CODE:'test-team-code'});
 assert.equal(teamEntryAllowed('test-team-code'),true);assert.equal(teamEntryAllowed('other-team-code'),false);assert.equal(teamEntryAllowed(undefined),false);
});
