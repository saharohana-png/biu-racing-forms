const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
function load(file,deps={}){const exports={},code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});throw Error(name)},Response,Request,Headers,TextEncoder,TextDecoder,URL,TransformStream,crypto:globalThis.crypto,Uint8Array,File,FormData,console});return exports;}
function fixture(t){
 let reservationGate=null;const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const name of ['0000_common_guardsmen.sql','0001_membership_auth_source.sql','0002_tiny_wong.sql'])sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}}},async first(){const row=sql.prepare(query).get(...this.args)??null;if(reservationGate&&query==='SELECT * FROM attachments WHERE mutation_key=?')await reservationGate();return row},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:{changes:sql.prepare(s.query).run(...s.args).changes}}));sql.exec('COMMIT');return out}catch(error){sql.exec('ROLLBACK');throw error}}};
 sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner-fixture','2026-10-31');sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,1,?)').run('owner-fixture','coordinator','[]','2026-10-31');
 const fields=[{id:'evidence',type:'file',label:'ראיה'},{id:'table',type:'table',label:'בדיקות',columns:[{id:'result',type:'text',label:'תוצאה'},{id:'proof',type:'file',label:'ראיה'}]}];
 const catalog={schemaVersion:'test',systems:[{id:'TSAL'}],getSystem:id=>id==='TSAL'?{id}:undefined,getFields:()=>fields};
 let puts=0,failPuts=false;
 const bucket={async put(key,bytes){puts++;if(failPuts)throw Error('Isolated storage failure');return {size:bytes.byteLength}}};
 const progress=load('lib/progress.ts'),sourceImport=load('lib/source-import.ts'),merge=load('lib/answer-merge.ts');
 const server=load('lib/server.ts',{'@/lib/team-entry':{teamEntryAllowed:()=>true},'@/lib/cloud-storage':{cloudDatabase:db,cloudBucket:bucket},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:'owner-fixture',email:'fixture@example.invalid'})},'@/lib/catalog':catalog,'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':merge});
 const insertFile=(id,field='evidence',size=1,digest='fixture',state='complete')=>sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'TSAL',field,id+'.txt',id+'.txt','text/plain',size,digest,'fixture/'+id,state,1,'owner-fixture','2000-01-01','seed:'+id);
 const form=(base,mutation='upload_fixture_01',field='evidence',replaces,content='same original bytes')=>{const data=new FormData();data.set('fieldId',field);data.set('baseRevision',String(base));data.set('mutationId',mutation);data.set('file',new File([content],'evidence.txt',{type:'text/plain'}));if(replaces)data.set('replaces',replaces);return data};
 return {sql,server,insertFile,form,gateReservations(){let arrivals=0,release;const gate=new Promise(resolve=>release=resolve);reservationGate=async()=>{if(++arrivals===2){reservationGate=null;release()}await gate}},get puts(){return puts},fail(value){failPuts=value}};
}
test('replacing table evidence updates matching cells and preserves immutable original',async t=>{
 const f=fixture(t);f.insertFile('original','table');
 const initial=await f.server.saveSystem('TSAL',{baseRevision:0,mutationId:'seed_table_answer',answers:{table:{status:'answered',value:[{_id:'row1',result:'1',proof:'original'},{_id:'row2',result:'2',proof:'original'}],attachmentIds:['original']}}});
 const result=await f.server.uploadFile('TSAL',f.form(initial.revision,'replace_table_file','table','original','new bytes'));
 assert.ok(result.system.answers.table.value.every(row=>row.proof===result.attachment.id));
 assert.deepEqual(Array.from(result.system.answers.table.attachmentIds),[result.attachment.id]);
 assert.equal((await f.server.readRevision('TSAL',initial.revision)).answers.table.value[0].proof,'original');
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,2);
});
test('a failed upload retry must reserve quota again before touching object storage',async t=>{
 const f=fixture(t),data=f.form(0);f.fail(true);await assert.rejects(()=>f.server.uploadFile('TSAL',data));
 assert.equal(f.sql.prepare('SELECT state FROM attachments').get().state,'failed');
 f.insertFile('fills-quota','evidence',f.server.SYSTEM_QUOTA_BYTES);f.fail(false);
 await assert.rejects(()=>f.server.uploadFile('TSAL',data),e=>e.status===413);
 assert.equal(f.puts,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,0);
});
test('simultaneous identical uploads converge on one file and one revision',async t=>{
 const f=fixture(t);f.gateReservations();const results=await Promise.allSettled([f.server.uploadFile('TSAL',f.form(0)),f.server.uploadFile('TSAL',f.form(0))]);
 assert.ok(results.every(result=>result.status==='fulfilled'),JSON.stringify(results.map(result=>result.status==='rejected'?String(result.reason):'ok')));
 assert.equal(results[0].value.attachment.id,results[1].value.attachment.id);
 assert.equal(results[0].value.system.revision,results[1].value.system.revision);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1);
});
test('retry returns the exact uploaded file even when identical bytes already existed',async t=>{
 const f=fixture(t),content='same original bytes',digest=await f.server.sha256(content);f.insertFile('earlier-copy','evidence',content.length,digest);
 const initial=await f.server.saveSystem('TSAL',{baseRevision:0,mutationId:'seed_existing_file',answers:{evidence:{status:'answered',value:'',attachmentIds:['earlier-copy']}}});
 const data=f.form(initial.revision),first=await f.server.uploadFile('TSAL',data),retry=await f.server.uploadFile('TSAL',data);
 assert.equal(retry.attachment.id,first.attachment.id);assert.notEqual(retry.attachment.id,'earlier-copy');assert.equal(retry.system.revision,first.system.revision);
});
test('file limits cannot make the current answer impossible to save',async t=>{
 const f=fixture(t),ids=Array.from({length:40},(_,i)=>'existing-'+i);ids.forEach(id=>f.insertFile(id));
 const initial=await f.server.saveSystem('TSAL',{baseRevision:0,mutationId:'seed_forty_files',answers:{evidence:{status:'answered',value:'',attachmentIds:ids}}});
 await assert.rejects(()=>f.server.uploadFile('TSAL',f.form(initial.revision)),e=>e.status===413);
 assert.equal(f.puts,0);assert.equal((await f.server.readSystem('TSAL')).answers.evidence.attachmentIds.length,40);
});
