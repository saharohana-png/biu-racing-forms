const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const sql=new DatabaseSync(':memory:');
sql.exec(fs.readFileSync('drizzle/0000_common_guardsmen.sql','utf8'));
let queries=0,authCalls=0;
const db={prepare(query){return {args:[],bind(...args){this.args=args;return this},async all(){queries++;return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){return Promise.all(statements.map(statement=>statement.all()))}};
const fields=[{id:'note',label:'תשובה',type:'text'},{id:'evidence',label:'ראיה',type:'file'}];
const catalog={schemaVersion:'test-schema',systems:[{id:'TSAL'}],getFields:()=>fields,getSystem:id=>['TSAL','COORDINATOR'].includes(id)?{id,fields}:undefined};
function load(file,imports){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const exports={};vm.runInNewContext(code,{exports,require:id=>{if(id in imports)return imports[id];throw Error('Unexpected import '+id)},console,TextEncoder,ReadableStream,Response,URL});return exports}
const progress=load('lib/progress.ts',{});
const exporter=load('lib/data-export.ts',{'./catalog':catalog,'./progress':progress});
const answer={note:{status:'answered',value:'תשובה עם מקור',provenance:[{title:'מפרט',url:'https://drive.google.com/file/d/source/view',kind:'drive',applicability:'current'}]},evidence:{status:'answered',value:'',attachmentIds:['active']}};
sql.prepare('INSERT INTO submissions(id,answers,revision,status,review,updated_at) VALUES(?,?,?,?,?,?)').run('TSAL',JSON.stringify(answer),12,'draft','{}','2026-10-30');
for(let revision=1;revision<=12;revision++)sql.prepare('INSERT INTO revisions(id,system_id,revision,answers,status,review,schema_version,content_hash,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('revision-'+revision,'TSAL',revision,JSON.stringify({note:{status:'answered',value:'version '+revision}}),'draft','{}','test-schema','hash-'+revision,'private-actor','2026-10-30','revision-mutation-'+revision);
for(const [id,version]of [['historical',1],['active',2]])sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'TSAL','evidence',id+'.txt',id+'.txt','text/plain',12,'sha-'+id,'private-storage-'+id,'complete',version,'private-actor','2026-10-30','upload-'+id);
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
let member={subject:'owner',role:'coordinator',systemIds:['TSAL']};
const server={ApiError,database:()=>db,session:async()=>{authCalls++;if(!member)throw new ApiError(401,'sign in');return member},requireCoordinator:async()=>{if(member?.role!=='coordinator')throw new ApiError(403,'coordinator only')},getSharedRecords:async()=>({records:[]}),guard:async(request,operation)=>{try{return await operation()}catch(error){return Response.json({error:error.message},{status:error.status??500})}}};
const route=load('app/api/export/route.ts',{'@/lib/server':server,'@/lib/catalog':catalog,'@/lib/data-export':exporter,'@/lib/archive':{},'@/lib/report':{makeReport(){throw Error('PDF path must not run')}},'@/lib/pdf':{renderPDF(){throw Error('PDF must not run')}},'@/data/formal-field-coverage.json':{},'@/data/leaf-example-matrix.json':{},'@/data/system-form-plan.json':{}});
(async()=>{
 const response=await route.GET(new Request('https://site.example/api/export?system=all&format=json'));
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('content-disposition'),/attachment;.*\.json"$/);
 // A save after capture must not leak a newer revision into this backup.
 sql.prepare('INSERT INTO revisions(id,system_id,revision,answers,status,review,schema_version,content_hash,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('revision-13','TSAL',13,'{}','draft','{}','test-schema','later-hash','private-actor','later','revision-mutation-13');
 const data=await response.json(),system=data.systems[0];
 assert.equal(data.systems.length,2);assert.equal(data.includesBinaryFiles,false);assert.deepEqual(system.answers,answer);assert.equal(system.revision,12);assert.equal(system.revisions.length,12);assert.equal(system.revisions[11].contentHash,'hash-12');assert.equal(system.attachments.length,1);assert.equal(system.attachments[0].id,'active');assert.deepEqual(system.files.map(file=>file.id),['active','historical']);assert.equal(data.systems[1].revision,0);
 const serialized=JSON.stringify(data);assert.ok(!serialized.includes('private-storage'));assert.ok(!serialized.includes('private-actor'));assert.ok(queries<=6,'bounded collection queries plus paginated history');assert.equal(authCalls,1);
 member={subject:'contributor',role:'contributor',systemIds:['TSAL']};
 assert.equal((await route.GET(new Request('https://site.example/api/export?system=all&format=json'))).status,403);
 assert.equal((await route.GET(new Request('https://site.example/api/export?system=COORDINATOR&format=json'))).status,403);
 assert.equal((await route.GET(new Request('https://site.example/api/export?system=INVALID&format=json'))).status,404);
 assert.equal((await route.GET(new Request('https://site.example/api/export?system=TSAL&format=invalid'))).status,400);
 const single=await route.GET(new Request('https://site.example/api/export?system=TSAL&format=json'));assert.equal(single.status,200);assert.equal((await single.json()).systems.length,1);
 member=null;assert.equal((await route.GET(new Request('https://site.example/api/export?system=all&format=json'))).status,401);
 console.log('Data export: content, evidence history, revision pagination, snapshot cutoff, privacy, scope and authentication passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
