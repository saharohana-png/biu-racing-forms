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
const preview=(input,mode='editorial_revision')=>owner(()=>server.previewSourceImport(input,mode));
const request=(input,p)=>({mode:p.mode,batchId:input.batchId,batchDigest:p.digest,system:input.systems[0],baseRevision:p.systems[0].baseRevision,systemDigest:p.systems[0].systemDigest,mutationId:p.systems[0].mutationId,expectedOldFieldHashes:p.systems[0].expectedOldFieldHashes,expectedAttachmentIds:p.systems[0].expectedAttachmentIds});
const apply=body=>owner(()=>server.applySourceImport(body));
const contents=()=>['submissions','revisions','mutations','attachments','review_events','audit_events'].map(table=>[table,sql.prepare('SELECT * FROM '+table+' ORDER BY id').all()]);
function reset(answers={},review={}){beforeBatch=null;for(const table of ['submissions','revisions','mutations','attachments','review_events','audit_events'])sql.exec('DELETE FROM '+table);sql.prepare('INSERT INTO submissions(id,revision,answers,status,review,updated_at) VALUES(?,1,?,?,?,?)').run('TSAL',JSON.stringify(answers),'draft',JSON.stringify(review),'2026-10-30');}
function file(field='a',state='complete',id='orphan'){sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'TSAL',field,'fixture.txt','fixture.txt','text/plain',1,'fixture','test-only/'+id,state,1,'owner','2026-10-30',id);}
let cases=0;function check(name,fn){try{fn();cases++;}catch(error){error.message=name+': '+error.message;throw error;}}
async function rejects(name,fn,status,code){await assert.rejects(fn,error=>error.status===status&&(!code||error.details.code===code),name);cases++;}
(async()=>{
 const oldSource={title:'מפרט קודם',url:'https://drive.google.com/file/d/old/view',kind:'drive',applicability:'historical'};
 const old={...answer('תיאור קודם'),provenance:[oldSource],sourceReview:'confirmed',importedBatchId:'older_batch',attachmentIds:['original']};
 const reviewA={fingerprint:progress.fingerprint(old),verdict:'approved',reason:'בדיקה קודמת',role:'reviewer',at:'2026-10-30'};
 const reviewB={...reviewA,reason:'בדיקה שלא משתנה'};
 const input=batch({a:sourced('תיאור מעודכן'),b:sourced('תיאור חדש')},'editorial_fixture_0001');
 reset({a:old},{fields:{a:reviewA}});file('a','complete','original');
 await rejects('coordinator-only editorial preview',()=>as('writer',()=>server.previewSourceImport(input,'editorial_revision')),403);
 await rejects('coordinator-only editorial apply',()=>as('reviewer',()=>server.applySourceImport({})),403);
 const before=contents(),p=await preview(input),body=request(input,p);
 check('editorial preview returns before/after and add/replace',()=>{assert.equal(p.mode,'editorial_revision');assert.equal(p.systems[0].fields[0].action,'replace');assert.equal(p.systems[0].fields[1].action,'add');assert.equal(p.systems[0].fields[0].before.value,old.value);assert.equal(p.systems[0].fields[0].after.value,'תיאור מעודכן');assert.deepEqual(plain(p.systems[0].expectedAttachmentIds),['original']);assert.equal(Object.keys(p.systems[0].expectedOldFieldHashes).length,2)});
 check('editorial preview writes nothing',()=>assert.deepEqual(contents(),before));
 await rejects('missing expected hashes refused',()=>apply({...body,expectedOldFieldHashes:undefined}),400);
 await rejects('missing evidence snapshot refused',()=>apply({...body,expectedAttachmentIds:undefined}),400);
 await rejects('tampered incoming content refused',()=>apply({...body,system:{id:'TSAL',answers:{a:sourced('different')}}}),400);
 await rejects('tampered oldhash refused',()=>apply({...body,expectedOldFieldHashes:{...body.expectedOldFieldHashes,a:'0'.repeat(64)}}),400);
 await rejects('tampered file snapshot refused',()=>apply({...body,expectedAttachmentIds:[]}),400);
 await rejects('tampered baseRevision bound to digest',()=>apply({...body,baseRevision:2}),400);
 await rejects('editorial cannot use weekly mode',()=>apply({...body,mode:'weekly_empty_fill'}),400);
 await rejects('unknown mode refused',()=>owner(()=>server.guard(new Request('https://fixture.test/api/import'),()=>server.previewSourceImport(input,'overwrite'))).then(async response=>{if(response.status!==400)throw Error('wrong status');throw new server.ApiError(400,'fixture')}),400);
 check('invalid preview contexts leave data unchanged',()=>assert.deepEqual(contents(),before));
 const accepted=await apply(body);
 check('applied edit retains original file and both source lineages',()=>{const a=accepted.system.answers.a;assert.equal(a.value,'תיאור מעודכן');assert.deepEqual(plain(a.attachmentIds),['original']);assert.deepEqual(plain(a.provenance),[oldSource,...provenance]);assert.equal(accepted.system.attachments[0].id,'original');assert.equal(a.sourceReview,'pending');assert.equal(a.importedBatchId,input.batchId);assert.equal(accepted.system.review.fields.a,undefined);assert.equal(accepted.system.status,'draft')});
 const after=contents(),replay=await apply(body);
 check('editorial retry idempotent with old snapshot',()=>{assert.equal(replay.replayed,true);assert.equal(replay.system.revision,accepted.system.revision);assert.deepEqual(contents(),after)});
 check('editorial action and changed field IDs auditable',()=>{assert.equal(sql.prepare('SELECT action FROM audit_events').get().action,'editorial_revision');assert.deepEqual(JSON.parse(sql.prepare('SELECT field_ids FROM review_events').get().field_ids),['a','b'])});

 reset({a:answer('תשובה ישנה'),b:answer('ממשק שלא משתנה')},{fields:{a:reviewA,b:reviewB}});
 const onlyA=batch({a:sourced('תשובה חדשה')},'editorial_only_a'),pa=await preview(onlyA);
 const edited=await apply(request(onlyA,pa));
 check('only targeted fields and their reviews change',()=>{assert.equal(edited.system.answers.b.value,'ממשק שלא משתנה');assert.deepEqual(plain(edited.system.review.fields.b),reviewB);assert.equal(edited.system.review.fields.a,undefined)});
 const weekly=await preview(onlyA,'weekly_empty_fill');
 check('weekly mode still skips now-nonempty content',()=>assert.equal(weekly.systems[0].importCount,0));

 reset({a:answer('לפני')});const stalePreview=await preview(onlyA);
 await as('writer',()=>server.saveSystem('TSAL',{baseRevision:1,mutationId:'edit_race_before_1',answers:{a:answer('עריכת צוות')}}));
 const staleBefore=contents();await rejects('human edit after preview returns409',()=>apply(request(onlyA,stalePreview)),409,'CONFLICT');
 check('stale editorial cannot overwrite human edit',()=>assert.deepEqual(contents(),staleBefore));
 reset({a:answer('לפני')});const latePreview=await preview(onlyA);
 beforeBatch=async()=>{beforeBatch=null;await as('writer',()=>server.saveSystem('TSAL',{baseRevision:1,mutationId:'edit_race_commit_1',answers:{a:answer('עריכה בזמן שמירה')}}));};
 await rejects('edit racing transactional commit returns409',()=>apply(request(onlyA,latePreview)),409,'CONFLICT');
 check('atomic CAS preserves latest edit and one history record',()=>{assert.equal(JSON.parse(sql.prepare('SELECT answers FROM submissions').get().answers).a.value,'עריכה בזמן שמירה');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1)});

 reset({a:answer('לפני')});const changedReview=await preview(onlyA);
 sql.prepare('UPDATE submissions SET review=? WHERE id=?').run(JSON.stringify({fields:{a:reviewA}}),'TSAL');
 await rejects('old field hash detects review change even withoutrevision',()=>apply(request(onlyA,changedReview)),409,'EDITORIAL_BASE_CHANGED');
 reset({a:answer('לפני')});const changedAnswer=await preview(onlyA);
 sql.prepare('UPDATE submissions SET answers=? WHERE id=?').run(JSON.stringify({a:answer('שינוי חריג ללא גרסה')}),'TSAL');
 await rejects('old field hash detects unexpected same-revision content drift',()=>apply(request(onlyA,changedAnswer)),409,'EDITORIAL_BASE_CHANGED');
 reset({a:answer('לפני')});const fileBeforeApply=await preview(onlyA);file('a');
 await rejects('new file after preview withoutrevision requires freshpreview',()=>apply(request(onlyA,fileBeforeApply)),409,'EDITORIAL_BASE_CHANGED');
 for(const state of ['complete','uploading','failed']){
  reset({a:old});file('a','complete','original');const fp=await preview(onlyA);beforeBatch=async()=>{beforeBatch=null;file('a',state,'arrived_during_edit')};
  await rejects('new '+state+' file at commit aborts editorial atomically',()=>apply(request(onlyA,fp)),409,'CONFLICT');
  check('both old/new '+state+' evidence and original answer preserved',()=>{assert.deepEqual(JSON.parse(sql.prepare('SELECT answers FROM submissions').get().answers),{a:old});assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,2);assert.equal(sql.prepare('SELECT revision FROM submissions').get().revision,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM mutations').get().n,0)});
 }
 reset({a:old});file('a','complete','original');const unrelated=await preview(onlyA);beforeBatch=async()=>{beforeBatch=null;file('b','complete','unrelated')};
 const unaffected=await apply(request(onlyA,unrelated));
 check('unrelated uploaded file remains stored while editorial succeeds',()=>{assert.equal(unaffected.imported,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,2)});
 reset({table:{...sourced([{_id:'stable_row',part:'old',value:'10',proof:'original'}]),attachmentIds:['original']}});file('table','complete','original');
 const tableBatch=batch({table:sourced([{_id:'stable_row',part:'new',value:'20',proof:''}])},'editorial_table_1'),tablePreview=await preview(tableBatch),tableResult=await apply(request(tableBatch,tablePreview));
 check('table evidence cell survives real validated commit',()=>{assert.equal(tableResult.system.answers.table.value[0].proof,'original');assert.equal(tableResult.system.answers.table.value[0].part,'new');assert.equal(tableResult.system.attachments[0].id,'original');assert.deepEqual(plain(tableResult.system.answers.table.attachmentIds),['original'])});
 const wrongRows=batch({table:sourced([{_id:'different_row',part:'newer',value:'30',proof:''}])},'editorial_table_2'),wrongPreview=await preview(wrongRows),beforePreserve=contents();
 const preserved=await apply(request(wrongRows,wrongPreview));
 check('unmatched evidence row preserved without new revision',()=>{assert.equal(preserved.imported,0);assert.equal(wrongPreview.systems[0].fields[0].action,'preserve');assert.deepEqual(contents(),beforePreserve)});
 console.log(cases+' editorial permission/digest/history/CAS/evidence cases passed using isolated SQLite transactions.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>sql.close());
