const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}}},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:{changes:sql.prepare(s.query).run(...s.args).changes}}));sql.exec('COMMIT');return out}catch(error){sql.exec('ROLLBACK');throw error}}};
 const fields=[{id:'note',type:'text'}],catalog={schemaVersion:'test',systems:[{id:'TSAL'},{id:'BMS'}],getSystem:id=>['TSAL','BMS','COORDINATOR'].includes(id)?{id}:undefined,getFields:()=>fields};
 sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner','2026-10-31');for(const [id,role,ids,active] of [['owner','coordinator',[],1],['writer','contributor',['TSAL'],1],['reviewer','reviewer',['TSAL'],1],['disabled','contributor',['TSAL'],0]])sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,?,?)').run(id,role,JSON.stringify(ids),active,'2026-10-31');
 for(const [id,revision]of [['TSAL',3],['BMS',4],['COORDINATOR',7]])sql.prepare('INSERT INTO submissions(id,revision,answers,updated_at) VALUES(?,?,?,?)').run(id,revision,JSON.stringify({note:{status:'answered',value:'מקור עברי '+id}}),'2026-10-31');
 let identity={userId:'owner',email:'fixture@example.invalid'},config={},translations={};const schedules=[],builds=[],reads=[];
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);const require=name=>{
  if(name==='cloudflare:workers')return {env:{DB:db}};
  if(name==='next/server')return {after(){throw Error('GET must not schedule translation')}};
  if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};
  if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>identity};
  if(name==='@/lib/catalog'||name==='./catalog')return catalog;
  if(name==='@/lib/translation-runtime')return {translationConfig:()=>config,scheduleTranslation:(_db,id,revision)=>schedules.push({id,revision})};
  if(name==='@/lib/translation')return {getTranslationSnapshot:async(_db,snapshot)=>{reads.push(snapshot.id);return {systemId:snapshot.id,sourceRevision:snapshot.revision,sourceHash:'hash',isCurrent:true,status:'queued',providerConfigured:!!config.apiKey,retryable:true,englishAnswers:{},fieldStates:{note:'pending'},completedFields:0,totalFields:1,updatedAt:null,...translations[snapshot.id]}}};
  if(name==='@/lib/official-workbooks')return {buildOfficialWorkbook:async input=>{builds.push(input);return {bytes:new TextEncoder().encode('official draft'),mime:'application/test-workbook',filename:'working-draft.xlsx',report:{state:'working-draft'},sheets:[{name:'Main',state:'visible'}]}},getOfficialWorkbookSheet:async()=>({name:'Main',rows:[]})};
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('.'))return load(path.normalize(path.join(path.dirname(file),name+'.ts')));throw Error('Unexpected '+name);
 };const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require,console,Error,TypeError,Response,Request,Headers,URL,TransformStream,TextEncoder,TextDecoder,crypto:globalThis.crypto,Uint8Array,ArrayBuffer,Map,Set,AbortController,setTimeout,clearTimeout,fetch,File,FormData},{filename:file});return exports;}
 const route=load('app/api/documents/[kind]/route.ts'),params=kind=>({params:Promise.resolve({kind})});
 return {sql,db,schedules,builds,reads,route,params,actor(id){identity=id?{userId:id,email:'fixture@example.invalid'}:null},configure(value){config=value},states(value){translations=value},get(query='',kind='esf'){return route.GET(new Request('https://site.invalid/api/documents/'+kind+query),params(kind))},post(body={action:'process'},origin='https://site.invalid'){return route.POST(new Request('https://site.invalid/api/documents/esf',{method:'POST',headers:{...(origin?{origin}:{}),'content-type':'application/json'},body:JSON.stringify(body)}),params('esf'))}};
}
test('document GET keeps existing access and coordinator boundaries and exposes no provider credentials',async t=>{
 const f=fixture(t);for(const who of [null,'outsider','disabled']){f.actor(who);assert.equal((await f.get()).status,who?403:401);assert.equal(f.builds.length,0);}f.actor('writer');f.configure({apiKey:'fixture-private-config',model:'fixture-model'});let response=await f.get();assert.equal(response.status,200);let data=await response.json();assert.deepEqual(data.scope.systemIds,['TSAL']);assert.equal(data.scope.complete,false);assert.equal(data.scope.includesCoordinator,false);assert.deepEqual(plain(f.builds.at(-1).snapshots.map(s=>s.id)),['TSAL']);assert.equal(JSON.stringify(data).includes('fixture-private-config'),false);assert.equal(response.headers.get('cache-control'),'private, no-store');f.actor('reviewer');response=await f.get();assert.equal((await response.json()).canProcess,false);f.actor('owner');data=await (await f.get()).json();assert.deepEqual(data.scope.systemIds,['TSAL','BMS','COORDINATOR']);assert.equal(data.scope.complete,true);
});
test('draft view, report and workbook download remain available without translation and GET is read-only',async t=>{
 const f=fixture(t);f.actor('writer');for(const format of ['view','report','download']){const response=await f.get('?format='+format);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');if(format==='download'){assert.equal(response.headers.get('x-biu-document-state'),'working-draft');assert.match(response.headers.get('content-disposition'),/working-draft\.xlsx/);assert.equal(await response.text(),'official draft');}else await response.json();}assert.equal(f.schedules.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_jobs').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM mutations').get().n,0);
});
test('document POST returns only current authorized browser jobs and never schedules paid processing',async t=>{
 const f=fixture(t);f.configure({apiKey:'ignored',model:'ignored'});f.actor('writer');const response=await f.post({action:'process',systemId:'COORDINATOR',sourceRevision:999});assert.equal(response.status,202);const data=await response.json();assert.equal(data.engine,'browser-local');assert.deepEqual(data.systems,[{id:'TSAL',revision:3}]);assert.deepEqual(f.schedules,[]);
});

test('document POST rejects anonymous, disabled, reviewer and cross-origin mutations',async t=>{
 const f=fixture(t);for(const who of [null,'outsider','disabled','reviewer']){f.actor(who);assert.equal((await f.post()).status,who?403:401);}f.actor('writer');assert.equal((await f.post({},null)).status,403);assert.equal((await f.post({action:'process'},'https://other.invalid')).status,403);assert.equal(f.schedules.length,0);
});
test('browser job listing excludes stale, unsaved and completed revisions',async t=>{
 const f=fixture(t);f.actor('writer');for(const state of [{isCurrent:false},{sourceRevision:0},{status:'ready'}]){f.states({TSAL:state});assert.deepEqual((await (await f.post()).json()).systems,[]);}assert.equal(f.schedules.length,0);
});

test('local translation needs no provider configuration and document parameters stay bounded',async t=>{
 const f=fixture(t);f.actor('writer');const result=await f.post();assert.equal(result.status,202);assert.equal((await result.json()).engine,'browser-local');assert.equal(f.schedules.length,0);assert.equal((await f.get('','invalid')).status,404);assert.equal((await f.get('?format=invalid')).status,400);assert.equal((await f.get('?sheet=missing')).status,404);assert.equal((await f.post({action:'invalid'})).status,400);assert.equal((await f.post({action:'process',padding:'x'.repeat(1025)})).status,413);
});
