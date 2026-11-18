const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{AsyncLocalStorage}=require('node:async_hooks');
// These tests only write an isolated in-memory database. They never connect to
// a preview, hosted site, user database or storage bucket.
const sql=new DatabaseSync(':memory:'),identity=new AsyncLocalStorage();
sql.exec(fs.readFileSync('drizzle/0000_common_guardsmen.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0001_membership_auth_source.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0002_tiny_wong.sql','utf8'));
let beforeBatch=null;
const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return sql.prepare(query).run(...this.args)},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){if(beforeBatch)await beforeBatch();sql.exec('BEGIN');try{const results=statements.map(s=>sql.prepare(s.query).run(...s.args));sql.exec('COMMIT');return results}catch(error){sql.exec('ROLLBACK');throw error}}};
const fields=[{id:'a',label:'תיאור',prompt:'מה תפקיד המערכת?',type:'text',kind:'text',required:true},{id:'b',label:'ממשק',prompt:'תארו את הממשק',type:'text',kind:'text',required:true},{id:'evidence',label:'ראיה',prompt:'צרפו מקור ממשי',type:'file',kind:'file',required:true},{id:'table',label:'טבלה',prompt:'רשימת רכיבים',type:'table',kind:'table',required:true,columns:[{id:'part',label:'רכיב',type:'text',required:true},{id:'value',label:'ערך',type:'text',required:true},{id:'proof',label:'קובץ',type:'file',required:true}]}];
const systems=Array.from({length:21},(_,i)=>({id:i===0?'TSAL':'SYSTEM_'+i,label:'מערכת '+i}));
const catalog={schemaVersion:'fixture-schema',systems,getSystem:id=>systems.find(s=>s.id===id),getFields:()=>fields};
function load(file,deps){const exports={},compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});throw Error('Unexpected import '+name)},console,Response,Request,Headers,TextEncoder,TextDecoder,URL,TransformStream,crypto:globalThis.crypto,Uint8Array,File,FormData},{filename:file});return exports;}
const progress=load('lib/progress.ts',{}),sourceImport=load('lib/source-import.ts',{}),merge=load('lib/answer-merge.ts',{});
const server=load('lib/server.ts',{'@/lib/team-entry':{teamEntryAllowed:()=>true},'@/lib/cloud-storage':{cloudDatabase:db},'@/app/chatgpt-auth':{getChatGPTUser:async()=>identity.getStore()??null},'@/lib/catalog':catalog,'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':merge});
const route=load('app/api/import/route.ts',{'@/lib/server':server});
sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner','2026-10-30');
for(const [subject,role]of [['owner','coordinator'],['writer','contributor'],['reviewer','reviewer']])sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,1,?)').run(subject,role,JSON.stringify(systems.map(s=>s.id)),'2026-10-30');
const as=(subject,fn)=>identity.run({userId:subject,email:subject+'@example.invalid'},fn),owner=fn=>as('owner',fn),plain=x=>JSON.parse(JSON.stringify(x));
const provenance=[{title:'מפרט בדיקה',url:'https://drive.google.com/file/d/fixture/view',kind:'drive',applicability:'current'}];
const answer=value=>({status:'answered',value}),sourced=value=>({...answer(value),provenance});
const batch=(answers={a:sourced('תוכן מקור ממשי')},batchId='weekly_fixture_0001')=>({version:1,batchId,systems:[{id:'TSAL',answers}]});
const preview=(input,mode='weekly_empty_fill')=>owner(()=>server.previewSourceImport(input,mode));
const request=(input,p)=>({mode:p.mode,batchId:input.batchId,batchDigest:p.digest,system:input.systems[0],baseRevision:p.systems[0].baseRevision,systemDigest:p.systems[0].systemDigest,mutationId:p.systems[0].mutationId});
const apply=body=>owner(()=>server.applySourceImport(body));
const contents=()=>['submissions','revisions','mutations','attachments','review_events','audit_events'].map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY id').all()]);
function reset(answers={},review={}){beforeBatch=null;for(const table of ['submissions','revisions','mutations','attachments','review_events','audit_events'])sql.exec('DELETE FROM '+table);sql.prepare('INSERT INTO submissions(id,revision,answers,status,review,updated_at) VALUES(?,1,?,?,?,?)').run('TSAL',JSON.stringify(answers),'draft',JSON.stringify(review),'2026-10-30');}
function file(field='a',state='complete',id='orphan'){sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'TSAL',field,'fixture.txt','fixture.txt','text/plain',1,'fixture','test-only/'+id,state,1,'owner','2026-10-30',id);}
let cases=0;function check(name,fn){try{fn();cases++;}catch(error){error.message=name+': '+error.message;throw error;}}
async function rejects(name,fn,status,code){await assert.rejects(fn,error=>error.status===status&&(!code||error.details.code===code),name);cases++;}
(async()=>{
 reset();
 await rejects('anonymous gaps denied',()=>server.getImportGaps(),401);
 await rejects('contributor gaps denied',()=>as('writer',()=>server.getImportGaps()),403);
 await rejects('reviewer preview denied',()=>as('reviewer',()=>server.previewSourceImport(batch(),'weekly_empty_fill')),403);
 await rejects('contributor apply denied',()=>as('writer',()=>server.applySourceImport({})),403);
 const before=contents(),gaps=await owner(()=>server.getImportGaps());
 check('gaps has all21 systems and exact definitions',()=>{assert.equal(gaps.systems.length,21);assert.equal(gaps.schemaVersion,'fixture-schema');assert.equal(gaps.systems[0].revision,1);assert.equal(gaps.systems[0].emptyFields[0].prompt,fields[0].prompt);assert.deepEqual(plain(gaps.systems[0].emptyFields[3].columns),fields[3].columns);assert.equal(gaps.totals.empty,84);assert.equal(gaps.totals.weeklyImportable,63);assert.equal(gaps.systems[0].emptyFields.find(f=>f.id==='evidence').weeklyImportable,false)});
 check('gaps performs no content or evidence writes',()=>assert.deepEqual(contents(),before));
 const http=await owner(()=>route.GET(new Request('https://fixture.test/api/import?action=gaps')));
 check('gaps endpoint private no-store and JSON shape',()=>{assert.equal(http.status,200);assert.match(http.headers.get('cache-control'),/no-store/)});
 const badAction=await owner(()=>route.GET(new Request('https://fixture.test/api/import?action=write')));
 check('GET unsupported action rejected without write',()=>{assert.equal(badAction.status,400);assert.deepEqual(contents(),before)});
 const input=batch(),p=await preview(input),manual=await preview(input,'manual');
 check('preview is read-only',()=>assert.deepEqual(contents(),before));
 check('mode binds batch digest/system digest/mutation identity',()=>{assert.equal(p.mode,'weekly_empty_fill');assert.notEqual(p.digest,manual.digest);assert.notEqual(p.systems[0].systemDigest,manual.systems[0].systemDigest);assert.notEqual(p.systems[0].mutationId,manual.systems[0].mutationId)});
 await rejects('weekly preview cannot apply as manual',()=>apply({...request(input,p),mode:'manual'}),400);
 await rejects('manual mutation cannot be transplanted to weekly mode',()=>apply({...request(input,p),mutationId:manual.systems[0].mutationId}),400);
 await rejects('weekly digest cannot be replaced with manual digest',()=>apply({...request(input,p),systemDigest:manual.systems[0].systemDigest}),400);
 check('mode tampering produces no writes',()=>assert.deepEqual(contents(),before));
 const accepted=await apply(request(input,p));
 check('fresh weekly fills only target and keeps pending provenance',()=>{assert.equal(accepted.imported,1);assert.equal(accepted.mode,'weekly_empty_fill');assert.equal(accepted.system.revision,2);assert.equal(accepted.system.answers.a.sourceReview,'pending');assert.deepEqual(plain(accepted.system.answers.a.provenance),provenance);assert.deepEqual(plain(accepted.system.review.fields),{});assert.equal(accepted.system.status,'draft')});
 const after=contents(),replay=await apply(request(input,p));
 check('exact retry is idempotent',()=>{assert.equal(replay.replayed,true);assert.equal(replay.system.revision,2);assert.deepEqual(contents(),after)});
 check('history and audit preserve weekly source action',()=>{assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1);assert.equal(sql.prepare('SELECT action FROM audit_events').get().action,'weekly_empty_fill');assert.equal(sql.prepare('SELECT action FROM review_events').get().action,'weekly_empty_fill')});
 await rejects('mutated batch after preview rejected',()=>apply({...request(input,p),system:{id:'TSAL',answers:{a:sourced('changed')}}}),400);
 reset({a:answer('0'),b:{status:'unknown',value:'',reason:'החלטת צוות'},table:answer([{_id:'partial'}])});
 const preserveBatch=batch({a:sourced('new'),b:sourced('new'),table:sourced([{_id:'new',part:'R1',value:'10k',proof:''}])});
 const preserveBefore=contents(),preservePreview=await preview(preserveBatch),preserved=await apply(request(preserveBatch,preservePreview));
 check('unknown numericzero partial table all protected',()=>{assert.equal(preserved.imported,0);assert.equal(preserved.skipped,3);assert.deepEqual(contents(),preserveBefore)});
 reset({a:answer('')},{fields:{a:{fingerprint:'fixture',verdict:'changes_requested',reason:'בדיקת צוות'}}});
 const reviewedBefore=contents(),reviewPreview=await preview(input),reviewGaps=await owner(()=>server.getImportGaps());
 await apply(request(input,reviewPreview));
 check('engineering decision protects otherwise empty answer',()=>{assert.equal(reviewPreview.systems[0].importCount,0);assert.equal(reviewGaps.systems[0].preservedFields[0].id,'a');assert.match(reviewPreview.systems[0].fields[0].reason,/בדיקה/);assert.deepEqual(contents(),reviewedBefore)});
 for(const state of ['complete','uploading','failed']){
  reset();file('a',state);const old=contents(),fp=await preview(input),fg=await owner(()=>server.getImportGaps());await apply(request(input,fp));
  check('existing unlinked '+state+' attachment blocks blank answer',()=>{assert.equal(fp.systems[0].skipCount,1);assert.ok(fg.systems[0].preservedFields.some(f=>f.id==='a'));assert.deepEqual(contents(),old)});
 }
 reset({a:{...answer(''),provenance,sourceReview:'confirmed',importedBatchId:'previous_batch'}});
 const metadataBefore=contents(),metadataPreview=await preview(input);await apply(request(input,metadataPreview));
 check('source-only metadata retained unchanged',()=>assert.deepEqual(contents(),metadataBefore));
 reset();const stalePreview=await preview(input);
 await as('writer',()=>server.saveSystem('TSAL',{baseRevision:1,mutationId:'concurrent_writer_1',answers:{b:answer('כתב הצוות')}}));
 const staleBefore=contents();await rejects('stale preview requires409 even for otherfield',()=>apply(request(input,stalePreview)),409,'CONFLICT');
 check('stale apply preserves all existing data',()=>assert.deepEqual(contents(),staleBefore));
 reset();const racePreview=await preview(input);
 beforeBatch=async()=>{beforeBatch=null;await as('writer',()=>server.saveSystem('TSAL',{baseRevision:1,mutationId:'concurrent_writer_2',answers:{a:answer('עריכת צוות במקביל')}}));};
 await rejects('write racing at commit returns409',()=>apply(request(input,racePreview)),409,'CONFLICT');
 check('commit race keeps teammate content and no import mutation',()=>{assert.equal(JSON.parse(sql.prepare('SELECT answers FROM submissions').get().answers).a.value,'עריכת צוות במקביל');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mutations').get().n,1);assert.equal(sql.prepare('SELECT action FROM audit_events').get().action,'save')});
 for(const state of ['complete','uploading','failed']){
  reset();const fp=await preview(input);beforeBatch=async()=>{beforeBatch=null;file('a',state)};
  await rejects('file appears at commit withoutrevision '+state,()=>apply(request(input,fp)),409,'CONFLICT');
  check('file race does not write answers or revision '+state,()=>{const row=sql.prepare('SELECT * FROM submissions').get();assert.equal(row.revision,1);assert.equal(row.answers,'{}');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mutations').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,0);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,1)});
 }
 reset();const unaffectedPreview=await preview(input);beforeBatch=async()=>{beforeBatch=null;file('b')};const unaffected=await apply(request(input,unaffectedPreview));
 check('unrelated file does not block empty target field',()=>assert.equal(unaffected.imported,1));
 reset();const both=batch({a:sourced('מפרט ראשון'),b:sourced('מפרט שני')}),bothPreview=await preview(both);beforeBatch=async()=>{beforeBatch=null;file('b')};
 await rejects('single protected target aborts entire atomic system import',()=>apply(request(both,bothPreview)),409,'CONFLICT');
 check('atomic rejection never partially imports earlier field',()=>assert.equal(sql.prepare('SELECT answers FROM submissions').get().answers,'{}'));
 reset();const unknown=batch({a:{status:'unknown',value:'',reason:'טרם נמצא מפרט',provenance}}),manualUnknown=await preview(unknown,'manual');
 const manualResult=await apply(request(unknown,manualUnknown));
 check('manual unknown import compatibility retained',()=>{assert.equal(manualResult.imported,1);assert.equal(manualResult.system.answers.a.status,'unknown');assert.equal(manualResult.system.answers.a.sourceReview,'pending')});
 console.log(cases+' weekly import access/read-only/mode/CAS/evidence cases passed using isolated SQLite transactions.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>sql.close());
