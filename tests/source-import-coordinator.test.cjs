const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{AsyncLocalStorage}=require('node:async_hooks');
// Real catalog and transactional SQL, isolated entirely from local/hosted data.
const sql=new DatabaseSync(':memory:'),identity=new AsyncLocalStorage();
for(const file of ['0000_common_guardsmen.sql','0001_membership_auth_source.sql','0002_tiny_wong.sql'])sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
let beforeBatch=null;
const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return sql.prepare(query).run(...this.args)},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){if(beforeBatch){const action=beforeBatch;beforeBatch=null;await action()}sql.exec('BEGIN');try{const result=statements.map(s=>sql.prepare(s.query).run(...s.args));sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
function load(file,deps={}){const exports={},compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});if(name.startsWith('@/data/'))return {default:JSON.parse(fs.readFileSync(name.slice(2),'utf8'))};throw Error('Unexpected import '+name)},console,Response,Request,Headers,TextEncoder,TextDecoder,URL,TransformStream,crypto:globalThis.crypto,Uint8Array,File,FormData},{filename:file});return exports;}
const catalog=load('lib/catalog.ts'),progress=load('lib/progress.ts'),sourceImport=load('lib/source-import.ts'),merge=load('lib/answer-merge.ts');
const server=load('lib/server.ts',{'cloudflare:workers':{env:{DB:db}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>identity.getStore()??null},'@/lib/catalog':catalog,'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':merge});
const route=load('app/api/import/route.ts',{'@/lib/server':server});
sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner-fixture','2026-10-30');
for(const [subject,role]of [['owner-fixture','coordinator'],['writer-fixture','contributor'],['reviewer-fixture','reviewer']])sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,1,?)').run(subject,role,JSON.stringify(catalog.systems.map(s=>s.id)),'2026-10-30');
const as=(subject,fn)=>identity.run({userId:subject,email:'fixture@example.invalid'},fn),owner=fn=>as('owner-fixture',fn),plain=value=>JSON.parse(JSON.stringify(value));
const fields=catalog.getFields('COORDINATOR'),textFields=fields.filter(f=>f.type==='text'),a=textFields[0].id,b=textFields[1].id,table=fields.find(f=>f.type==='table'),fileField=fields.find(f=>f.type==='file');
const source={title:'מקור בדיקה',url:'https://drive.google.com/file/d/fixture/view',kind:'drive',applicability:'current'};
const oldSource={...source,title:'מקור קודם',url:'https://drive.google.com/file/d/previous/view',applicability:'historical'};
const answer=value=>({status:'answered',value}),sourced=value=>({...answer(value),provenance:[source]});
const batch=(answers,batchId='coordinator_fixture_0001')=>({version:1,batchId,systems:[{id:'COORDINATOR',answers}]});
const preview=(input,mode='editorial_revision')=>owner(()=>server.previewSourceImport(input,mode));
const request=(input,p)=>({mode:p.mode,batchId:input.batchId,batchDigest:p.digest,system:input.systems[0],baseRevision:p.systems[0].baseRevision,systemDigest:p.systems[0].systemDigest,mutationId:p.systems[0].mutationId,expectedOldFieldHashes:p.systems[0].expectedOldFieldHashes,expectedAttachmentIds:p.systems[0].expectedAttachmentIds});
const apply=body=>owner(()=>server.applySourceImport(body));
const contents=()=>['submissions','revisions','mutations','attachments','review_events','audit_events'].map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY id').all()]);
const reset=()=>{beforeBatch=null;for(const table of ['submissions','revisions','mutations','attachments','review_events','audit_events'])sql.exec('DELETE FROM '+table)};
const save=(answers,baseRevision=0,mutationId='coordinator_seed_0001')=>owner(()=>server.saveSystem('COORDINATOR',{answers,baseRevision,mutationId}));
function file(fieldId,id){sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'COORDINATOR',fieldId,'fixture.txt','fixture.txt','text/plain',1,'fixture','test-only/'+id,'complete',1,'owner-fixture','2026-10-30',id)}
let count=0;const check=(name,fn)=>{try{fn();count++}catch(error){error.message=name+': '+error.message;throw error}};
async function rejected(name,fn,status,code){await assert.rejects(fn,error=>error.status===status&&(!code||error.details?.code===code),name);count++}
async function invalid(name,fn){await assert.rejects(fn,error=>error instanceof sourceImport.SourceImportError,name);count++}
(async()=>{
 const incoming=batch({[a]:sourced('תוכן מקור מעודכן'),[b]:sourced('נתון נוסף')});
 const full={...incoming,systems:catalog.systems.map(system=>({id:system.id,answers:{[(system.fields.find(f=>f.type==='text')||system.fields[0]).id]:sourced(system.id==='SES'?[{_id:'r1',[system.fields[0].columns[0].id]:'A4'}]:'תוכן בדיקה')}})).concat(incoming.systems)};
 check('real catalog accepts all21 plus coordinator',()=>assert.equal(sourceImport.parseImportBatch(full,id=>catalog.getSystem(id)?.fields).systems.length,23));
 check('batch beyond22 rejected',()=>assert.throws(()=>sourceImport.parseImportBatch({...full,systems:[...full.systems,full.systems[0]]},id=>catalog.getSystem(id)?.fields)));
 const before=contents();
 await rejected('anonymous cannot preview',()=>server.previewSourceImport(incoming,'manual'),401);
 for(const role of ['writer-fixture','reviewer-fixture']){
  await rejected(role+' cannot preview coordinator',()=>as(role,()=>server.previewSourceImport(incoming,'editorial_revision')),403);
  await rejected(role+' cannot apply coordinator',()=>as(role,()=>server.applySourceImport({})),403);
  await rejected(role+' cannot read coordinator record',()=>as(role,()=>server.readSystem('COORDINATOR')),403);
 }
 await invalid('unknown system remains rejected',()=>preview({...incoming,systems:[{...incoming.systems[0],id:'UNLISTED'}]}));
 await invalid('ordinary system field invalid in coordinator',()=>preview(batch({'EP-C01-F01':sourced('תוכן')})));
 await invalid('unknown coordinator table column rejected',()=>preview(batch({[table.id]:sourced([{_id:'row_1',unknown_column:'x'}])})));
 check('rejected access/shape writes no data',()=>assert.deepEqual(contents(),before));
 const p=await preview(incoming,'manual');
 check('manual preview uses actual coordinator labels',()=>{assert.equal(p.systems[0].label,catalog.coordinatorSystem.label);assert.equal(p.systems[0].fields[0].label,fields.find(f=>f.id===a).label);assert.equal(p.systems[0].importCount,2);assert.deepEqual(contents(),before)});
 await invalid('weekly preview rejects coordinator',()=>preview(incoming,'weekly_empty_fill'));
 await invalid('weekly apply cannot reuse manual coordinator preview',()=>apply({...request(incoming,p),mode:'weekly_empty_fill'}));
 const gaps=await owner(()=>server.getImportGaps());
 check('weekly gaps remain exactly21',()=>{assert.equal(gaps.systems.length,22);assert.ok(gaps.systems.every(s=>s.id!=='COORDINATOR'))});
 const accepted=await apply(request(incoming,p));
 check('manual saves coordinator source draft and immutable revision',()=>{assert.equal(accepted.system.id,'COORDINATOR');assert.equal(accepted.system.revision,1);assert.equal(accepted.system.answers[a].sourceReview,'pending');assert.equal(accepted.system.answers[a].importedBatchId,incoming.batchId);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1)});
 const persisted=contents(),replayed=await apply(request(incoming,p));
 check('coordinator retry is idempotent',()=>{assert.equal(replayed.replayed,true);assert.deepEqual(contents(),persisted)});
 const readback=await owner(()=>server.readSystem('COORDINATOR')),index=await owner(()=>server.getRevisionIndex('COORDINATOR'));
 check('coordinator readback/history retain content',()=>{assert.deepEqual(plain(readback.answers),plain(accepted.system.answers));assert.equal(index.length,1)});
 const listed=await owner(()=>server.listSystems());
 check('coordinator never added to21 summary',()=>assert.equal(listed.systems.length,22));
 const kept=await preview(batch({[a]:sourced('לא לדרוס')},'manual_preserve_coordinator'),'manual');
 check('manual import never replaces existing coordinator content',()=>assert.equal(kept.systems[0].importCount,0));

 reset();file(a,'original');const old={...answer('תוכן קודם'),provenance:[oldSource],sourceReview:'confirmed',attachmentIds:['original']};const seeded=await save({[a]:old,[b]:answer('ללא שינוי')});
 await owner(()=>server.confirmSourceContent('COORDINATOR',{fieldId:a,baseRevision:seeded.revision,mutationId:'coordinator_confirm_source'}));
 const review={fields:{[a]:{fingerprint:progress.fingerprint(old),verdict:'approved',reason:'בדיקת דמה',role:'coordinator'},[b]:{fingerprint:progress.fingerprint(answer('ללא שינוי')),verdict:'approved',reason:'בדיקה אחרת',role:'coordinator'}}};
 sql.prepare('UPDATE submissions SET review=? WHERE id=?').run(JSON.stringify(review),'COORDINATOR');
 const editorial=batch({[a]:sourced('תוכן מעודכן')},'coordinator_editorial_01'),ep=await preview(editorial),eb=request(editorial,ep);
 check('editorial coordinator preview binds old content and evidence',()=>{assert.equal(ep.systems[0].fields[0].before.value,'תוכן קודם');assert.equal(ep.systems[0].fields[0].before.sourceReview,'confirmed');assert.equal(ep.systems[0].fields[0].after.value,'תוכן מעודכן');assert.deepEqual(plain(ep.systems[0].expectedAttachmentIds),['original']);assert.equal(Object.keys(ep.systems[0].expectedOldFieldHashes).length,1)});
 await rejected('coordinator digest tamper rejected',()=>apply({...eb,system:{id:'COORDINATOR',answers:{[a]:sourced('תוכן אחר')}}}),400);
 const updated=await apply(eb);
 check('editorial preserves evidence/provenance and resets onlychanged review',()=>{const value=updated.system.answers[a];assert.deepEqual(plain(value.attachmentIds),['original']);assert.deepEqual(plain(value.provenance),[oldSource,source]);assert.equal(value.sourceReview,'pending');assert.equal(updated.system.review.fields[a],undefined);assert.deepEqual(plain(updated.system.review.fields[b]),review.fields[b]);assert.equal(updated.system.attachments[0].id,'original');assert.equal(updated.system.answers[b].value,'ללא שינוי')});
 const initial=await owner(()=>server.readRevision('COORDINATOR',1));
 check('original coordinator revision remains readable',()=>assert.deepEqual(plain(initial.answers[a]),plain(seeded.answers[a])));

 reset();await save({[a]:answer('לפני')});const stale=await preview(editorial);
 await save({[a]:answer('עריכה חדשה')},1,'coordinator_human_edit');const latest=contents();
 await rejected('stale coordinator preview returns409',()=>apply(request(editorial,stale)),409,'CONFLICT');
 check('stale coordinator import cannot alter saved data',()=>assert.deepEqual(contents(),latest));
 reset();await save({[a]:answer('לפני')});const racing=await preview(editorial);
 beforeBatch=()=>save({[a]:answer('עריכה בזמן שמירה')},1,'coordinator_atomic_edit');
 await rejected('coordinator CAS race rejected',()=>apply(request(editorial,racing)),409,'CONFLICT');
 check('racing human edit and exact history survive',()=>{assert.equal(JSON.parse(sql.prepare('SELECT answers FROM submissions').get().answers)[a].value,'עריכה בזמן שמירה');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,2)});
 reset();await save({[a]:answer('לפני')});const racingFile=await preview(editorial);beforeBatch=()=>file(a,'new-during-commit');
 await rejected('coordinator file arrival without revision aborts atomic edit',()=>apply(request(editorial,racingFile)),409,'CONFLICT');
 check('new evidence and old answer retained after abort',()=>{assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,1);assert.equal(JSON.parse(sql.prepare('SELECT answers FROM submissions').get().answers)[a].value,'לפני');assert.equal(sql.prepare('SELECT revision FROM submissions').get().revision,1)});
 reset();file(fileField.id,'uploaded-original');await save({[fileField.id]:{status:'answered',value:'',attachmentIds:['uploaded-original']}});
 const fileInput=batch({[fileField.id]:{status:'unknown',value:'',reason:'תיאור חלופי לבדיקה',provenance:[source]}},'coordinator_file_preserve'),fp=await preview(fileInput),unchanged=contents();
 const fileResult=await apply(request(fileInput,fp));
 check('coordinator file answer cannot lose original',()=>{assert.equal(fp.systems[0].fields[0].action,'preserve');assert.equal(fileResult.imported,0);assert.deepEqual(contents(),unchanged)});
 const req=new Request('https://fixture.test/api/import',{method:'POST',headers:{Origin:'https://fixture.test','Content-Type':'application/json'},body:JSON.stringify({action:'preview',mode:'weekly_empty_fill',batch:incoming})});
 const deniedWeekly=await owner(()=>route.POST(req));
 check('HTTP weekly coordinator refusal is readable400',()=>assert.equal(deniedWeekly.status,400));
 console.log(count+' coordinator import catalog/access/manual/editorial/CAS/evidence cases passed in isolated SQLite.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>sql.close());
