const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}}},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){sql.exec('BEGIN');try{const out=statements.map(s=>({meta:{changes:sql.prepare(s.query).run(...s.args).changes}}));sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 const fields=[{id:'text',label:'תיאור',prompt:'תיאור הנדסי',type:'text'},{id:'other',label:'הערות',type:'text'},{id:'file',type:'file'},{id:'choice',type:'select',options:[{value:'לא',label:'לא'},{value:'NO',label:'פתוח'}]},{id:'numeric',type:'text',sourceInputSchema:{type:'number_with_unit_and_source'}},{id:'table',type:'table',columns:[{id:'description',type:'text'},{id:'proof',type:'file'},{id:'enum',type:'select',options:[{value:'לא'}]},{id:'number',sourceInputSchema:{type:'number_with_unit_and_source'}}]}];
 const catalog={schemaVersion:'test',systems:[{id:'TSAL'},{id:'BMS'}],getSystem:id=>['TSAL','BMS','COORDINATOR'].includes(id)?{id}:undefined,getFields:()=>fields};
 const env={DB:db},scheduled=[];let identity={userId:'owner',email:'owner@example.invalid'},clock=100000,fetches=0;
 sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner','2026-10-31');for(const [id,role,scope,active]of [['owner','coordinator',[],1],['writer','contributor',['TSAL'],1],['reviewer','reviewer',['TSAL'],1],['other','contributor',['BMS'],1],['disabled','contributor',['TSAL'],0]])sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,?,?)').run(id,role,JSON.stringify(scope),active,'2026-10-31');
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const require=name=>{if(name==='@/lib/team-entry')return {teamEntryAllowed:()=>true};if(name==='@/lib/cloud-storage')return {cloudDatabase:db};if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(task){scheduled.push(task)}};if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>identity};if(name==='@/lib/catalog'||name==='./catalog')return catalog;if(name.startsWith('@/'))return load(name.slice(2)+(name.endsWith('.mjs')?'':'.ts'));if(name.startsWith('.'))return load(path.normalize(path.join(path.dirname(file),name+(name.endsWith('.mjs')?'':'.ts'))));throw Error(name)};vm.runInNewContext(code,{exports,require,console,Error,TypeError,Response,Request,Headers,URL,TransformStream,TextEncoder,TextDecoder,crypto:globalThis.crypto,Uint8Array,ArrayBuffer,Map,Set,AbortController,setTimeout,clearTimeout,fetch:(...args)=>config.fetcher(...args),File,FormData},{filename:file});return exports;}
 const content=load('lib/translation-content.ts'),core=load('lib/translation.ts'),server=load('lib/server.ts');
 const providerResponse=(body,transform=masked=>'Engineering description '+(masked.match(/⟦P\d+⟧/g)||[]).join(' '))=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:JSON.parse(body.input).items.map(item=>({id:item.id,text:transform(item.text)}))})}]}]});
 const config={apiKey:'fixture-secret-not-real',model:'fixture-model',now:()=>clock,fetcher:async(url,options)=>{fetches++;return providerResponse(JSON.parse(options.body))}};
 let n=0;const save=(answers,base=0,mutationId='translation_save_'+(++n))=>server.saveSystem('TSAL',{answers,baseRevision:base,mutationId});
 return {sql,db,fields,env,scheduled,content,core,server,load,save,config,providerResponse,get fetches(){return fetches},set clock(value){clock=value},get clock(){return clock},actor(who){identity=who?{userId:who,email:'fixture@example.invalid'}:null}};
}
const a=value=>({status:'answered',value});


test('Hebrew prose in scalar, numeric-style and table cells is translated; enums, evidence and IDs stay literal',async t=>{
 const f=fixture(t),answers={text:{...a('הממסר פתוח ב־24 V'),reason:'נבדק',dependency:'לבדוק מול BMS'},numeric:a('טרם נקבע'),choice:a('לא'),file:{...a(''),attachmentIds:['proof']},table:a([{_id:'row1',description:'הערה',number:'טרם נקבע',proof:'proof',enum:'לא'}])};
 const original=JSON.stringify(answers),plan=await f.content.makeTranslationPlan('TSAL',f.fields,answers,'model');
 assert.equal(plan.chunks.length,6);assert.ok(plan.chunks.some(x=>x.path.endsWith('/number')));
 const result=f.content.assembleTranslation(plan,new Map(plan.chunks.map(c=>[c.key,'English'])));
 assert.equal(JSON.stringify(answers),original);assert.equal(result.englishAnswers.choice.value,'לא');assert.equal(result.englishAnswers.table.value[0]._id,'row1');assert.deepEqual(plain(result.englishAnswers.file.attachmentIds),['proof']);
});
test('source save queues content atomically without scheduling a server or provider task',async t=>{
 const f=fixture(t),saved=await f.save({text:a('הנורה אדומה')},0,'idempotent_save_01');await f.save(saved.answers,0,'idempotent_save_01');
 assert.equal(f.scheduled.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_jobs').get().n,1);
 const snapshot=await f.core.getTranslationSnapshot(f.db,saved);assert.equal(snapshot.engine,'browser-local');assert.equal(snapshot.status,'queued');assert.equal(snapshot.pendingChunks[0].text,'הנורה אדומה');
});
test('validated browser output persists separately; unchanged text reuses cache after metadata revision',async t=>{
 const f=fixture(t),saved=await f.save({text:a('המתח הוא 24 V')});
 let state=await f.core.getTranslationSnapshot(f.db,saved);
 const body={sourceRevision:saved.revision,sourceHash:state.sourceHash,model:state.model,results:[{key:state.pendingChunks[0].key,text:'The voltage is 24 V'}]};
 state=await f.core.acceptLocalTranslations(f.db,saved,body);assert.equal(state.status,'ready');assert.equal(state.englishAnswers.text.value,'The voltage is 24 V');assert.equal((await f.server.readSystem('TSAL')).answers.text.value,'המתח הוא 24 V');
 const next=await f.save({text:{...saved.answers.text,dependency:'BMS'}},saved.revision);
 state=await f.core.getTranslationSnapshot(f.db,next);assert.equal(state.status,'ready');assert.equal(state.englishAnswers.text.dependency,'BMS');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_cache').get().n,1);
});
test('stale completion cannot enter cache even when source changes after the caller read it',async t=>{
 const f=fixture(t),saved=await f.save({text:a('ראשון')});const state=await f.core.getTranslationSnapshot(f.db,saved);
 await f.save({text:a('שני')},saved.revision);
 await assert.rejects(()=>f.core.acceptLocalTranslations(f.db,saved,{sourceRevision:saved.revision,sourceHash:state.sourceHash,model:state.model,results:[{key:state.pendingChunks[0].key,text:'First'}]}),e=>e.status===409);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_cache').get().n,0);assert.equal((await f.server.readSystem('TSAL')).answers.text.value,'שני');
});
test('invalid numbers, units, Hebrew, model, key and duplicate outputs never populate cache',async t=>{
 const f=fixture(t),saved=await f.save({text:a('הנגד 10 kΩ מחובר ל־J1.2')});const state=await f.core.getTranslationSnapshot(f.db,saved);
 const base={sourceRevision:saved.revision,sourceHash:state.sourceHash,model:state.model};
 for(const text of ['The 11 kΩ resistor connects to J1.2','The 10 k resistor connects to J1.2','The 10 kΩ resistor connects to J1.3','ערך 10 kΩ J1.2',''])await assert.rejects(()=>f.core.acceptLocalTranslations(f.db,saved,{...base,results:[{key:state.pendingChunks[0].key,text}]}));
 await assert.rejects(()=>f.core.acceptLocalTranslations(f.db,saved,{...base,model:'other',results:[]}));
 await assert.rejects(()=>f.core.acceptLocalTranslations(f.db,saved,{...base,results:[{key:'foreign-key',text:'English'}]}));
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM translation_cache').get().n,0);
});
test('translation endpoints enforce writer, system and origin boundaries',async t=>{
 const f=fixture(t),saved=await f.save({text:a('תיאור')});const state=await f.core.getTranslationSnapshot(f.db,saved),route=f.load('app/api/systems/[id]/translation/route.ts');
 const body={action:'complete',sourceRevision:saved.revision,sourceHash:state.sourceHash,model:state.model,results:[{key:state.pendingChunks[0].key,text:'Description'}]};
 const req=(origin='https://site.invalid')=>new Request('https://site.invalid/api/systems/TSAL/translation',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const context={params:Promise.resolve({id:'TSAL'})};
 for(const who of [null,'other','disabled','reviewer']){f.actor(who);assert.equal((await route.POST(req(),context)).status,who?403:401);}
 f.actor('reviewer');assert.equal((await route.GET(new Request('https://site.invalid/api/systems/TSAL/translation'),context)).status,200);
 f.actor('writer');assert.equal((await route.POST(req('https://attacker.invalid'),context)).status,403);assert.equal((await route.POST(req(),context)).status,200);
});
test('read-only revision requests are bounded and never start inference',async t=>{
 const f=fixture(t);await f.save({text:a('תיאור')});const route=f.load('app/api/systems/[id]/translation/route.ts'),context={params:Promise.resolve({id:'TSAL'})};
 for(const revision of ['00','-1','1e2','9007199254740992'])assert.equal((await route.GET(new Request('https://site.invalid/api/systems/TSAL/translation?revision='+revision),context)).status,400);
 assert.equal(f.scheduled.length,0);
});
test('long free text is split without loss, and partial fields are withheld until all chunks exist',async t=>{
 const f=fixture(t),text='תיאור ארוך. '.repeat(250),plan=await f.content.makeTranslationPlan('TSAL',f.fields,{text:a(text)},'model');
 assert.equal(plan.chunks.map(c=>c.text).join(''),text);assert.ok(plan.chunks.every(c=>c.text.length<=501));
 const incomplete=f.content.assembleTranslation(plan,new Map([[plan.chunks[0].key,'English ']]));assert.equal(incomplete.fieldStates.text,'pending');assert.equal(incomplete.englishAnswers.text,undefined);
});
