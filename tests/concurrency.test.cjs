const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const {AsyncLocalStorage}=require('node:async_hooks');
const identity=new AsyncLocalStorage(),sql=new DatabaseSync(':memory:');
sql.exec(fs.readFileSync('drizzle/0000_common_guardsmen.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0001_membership_auth_source.sql','utf8'));
sql.exec(fs.readFileSync('drizzle/0002_tiny_wong.sql','utf8'));
let beforeBatch=null,batches=0;
const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return sql.prepare(query).run(...this.args)},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){if(beforeBatch)await beforeBatch();batches++;sql.exec('BEGIN');try{const results=statements.map(s=>sql.prepare(s.query).run(...s.args));sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
const fields=[{id:'a',label:'A',type:'text'},{id:'b',label:'B',type:'text'},{id:'evidence',label:'ראיה',type:'file'}];
const catalog={schemaVersion:'test',systems:[{id:'TSAL'},{id:'BMS'}],getSystem:id=>['TSAL','BMS','COORDINATOR'].includes(id)?{id}:undefined,getFields:()=>fields};
function load(file,deps){const exports={};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});throw Error('Unexpected import '+name)},console,Response,Request,Headers,TextEncoder,TextDecoder,URL,TransformStream,crypto:globalThis.crypto,Uint8Array,File,FormData},{filename:file});return exports;}
const progress=load('lib/progress.ts',{}),sourceImport=load('lib/source-import.ts',{}),merge=load('lib/answer-merge.ts',{});
const deps={'@/lib/team-entry':{teamEntryAllowed:()=>true},'@/lib/cloud-storage':{cloudDatabase:db,cloudBucket:{async put(key,bytes){return {size:bytes.byteLength}}}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>identity.getStore()??null},'@/lib/catalog':catalog,'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':merge};
let server=load('lib/server.ts',deps),cases=0,mutation=0;
const run=(subject,fn)=>identity.run({userId:subject,email:subject+'@example.invalid'},fn);
const save=(subject,base,answers,id='TSAL',mutationId='save_'+(++mutation).toString().padStart(8,'0'))=>run(subject,()=>server.saveSystem(id,{baseRevision:base,answers,mutationId}));
const read=(subject='contributor-a',id='TSAL')=>run(subject,()=>server.readSystem(id));
const plain=x=>JSON.parse(JSON.stringify(x));
function check(name,fn){fn();cases++;}
async function denied(name,fn,status=403){await assert.rejects(fn,e=>e.status===status);cases++;}
const answer=value=>({status:'answered',value});
const provenance=[{title:'Source',url:'https://drive.google.com/file/d/source/view',kind:'drive',applicability:'current'}];
sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner-fixture','2026-10-30');
for(const [subject,role,scope,active]of [['owner-fixture','coordinator',[],1],['contributor-a','contributor',['TSAL'],1],['contributor-b','contributor',['TSAL'],1],['other-scope','contributor',['BMS'],1],['reviewer-fixture','reviewer',['TSAL'],1],['inactive-fixture','contributor',['TSAL'],0]])sql.prepare('INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,?,?,?,?)').run(subject,role,JSON.stringify(scope),active,'2026-10-30');
(async()=>{
 await denied('anonymous',()=>server.saveSystem('TSAL',{baseRevision:0,answers:{},mutationId:'anonymous_test'}),401);
 for(const subject of ['stranger-fixture','other-scope','reviewer-fixture','inactive-fixture'])await denied(subject,()=>save(subject,0,{a:answer('forbidden')}));
 const initial=await save('contributor-a',0,{a:answer('A0'),b:answer('B0')});
 const first=await save('contributor-a',initial.revision,{...initial.answers,a:answer('A1')});
 const second=await save('contributor-b',initial.revision,{...initial.answers,b:answer('B1')});
 check('different fields merge',()=>assert.deepEqual(plain(second.answers),{a:answer('A1'),b:answer('B1')}));
 check('revision monotonic',()=>assert.equal(second.revision,first.revision+1));
 let conflict;try{await save('contributor-b',initial.revision,{...initial.answers,a:answer('A2')})}catch(e){conflict=e}
 check('same field conflicts explicitly',()=>{assert.equal(conflict.status,409);assert.equal(conflict.details.code,'REVISION_CONFLICT');assert.deepEqual(plain(conflict.details.conflictFieldIds),['a']);assert.equal(conflict.details.base.revision,initial.revision);assert.equal(conflict.details.server.revision,second.revision)});
 check('conflict has no write',()=>assert.equal(sql.prepare('SELECT revision FROM submissions WHERE id=?').get('TSAL').revision,second.revision));
 const noConflict=await save('contributor-b',initial.revision,{...initial.answers,a:answer('A1'),b:answer('B1')});
 check('identical field changes converge',()=>assert.deepEqual(plain(noConflict.answers),plain(second.answers)));
 const replayBody={baseRevision:noConflict.revision,answers:{...noConflict.answers,a:answer('A3')},mutationId:'stable_retry_0001'};
 const acknowledged=await run('contributor-a',()=>server.saveSystem('TSAL',replayBody));
 await save('contributor-b',acknowledged.revision,{...acknowledged.answers,b:answer('B2')});
 const replayed=await run('contributor-a',()=>server.saveSystem('TSAL',replayBody));
 check('idempotent retry returns exact acknowledged revision',()=>{assert.equal(replayed.revision,acknowledged.revision);assert.deepEqual(plain(replayed.answers),plain(acknowledged.answers))});
 await denied('mutation reused for other payload',()=>run('contributor-a',()=>server.saveSystem('TSAL',{...replayBody,answers:{a:answer('tampered')}})),409);
 let head=await read();const snapshotBeforeRace=head;
 let arrivals=0,release;const rendezvous=new Promise(resolve=>release=resolve);
 beforeBatch=async()=>{arrivals++;if(arrivals===2){beforeBatch=null;release()}await rendezvous};
 const racing=await Promise.all([save('contributor-a',head.revision,{...head.answers,a:answer('A-race')}),save('contributor-b',head.revision,{...head.answers,b:answer('B-race')})]);
 head=await read();check('CAS retry preserves both racing writes',()=>{assert.equal(head.answers.a.value,'A-race');assert.equal(head.answers.b.value,'B-race');assert.equal(head.revision,snapshotBeforeRace.revision+2)});
 check('two immutable revisions persisted',()=>assert.equal(new Set(racing.map(x=>x.revision)).size,2));
 // Force both calls to reach the transactional CAS before either can commit.
 async function atSameHead(operations){let arrived=0,open;const gate=new Promise(resolve=>open=resolve);beforeBatch=async()=>{if(++arrived===2){beforeBatch=null;open()}await gate};return Promise.allSettled(operations.map(fn=>fn()))}
 const sameHead=await read();const sameField=await atSameHead([()=>save('contributor-a',sameHead.revision,{...sameHead.answers,a:answer('same-field A')}),()=>save('contributor-b',sameHead.revision,{...sameHead.answers,a:answer('same-field B')})]);
 check('simultaneous same-field edits have one winner',()=>{assert.equal(sameField.filter(r=>r.status==='fulfilled').length,1);assert.equal(sameField.find(r=>r.status==='rejected').reason.details.code,'REVISION_CONFLICT')});
 const duplicateHead=await read();const duplicateBody={baseRevision:duplicateHead.revision,answers:{...duplicateHead.answers,b:answer('duplicate request')},mutationId:'duplicate_race_0001'};
 const duplicates=await atSameHead([()=>run('contributor-a',()=>server.saveSystem('TSAL',duplicateBody)),()=>run('contributor-a',()=>server.saveSystem('TSAL',duplicateBody))]);
 check('simultaneous identical request writes once',()=>{assert.equal(duplicates[0].status,'fulfilled');assert.equal(duplicates[1].status,'fulfilled');assert.equal(duplicates[0].value.revision,duplicates[1].value.revision);assert.equal(duplicates[0].value.revision,duplicateHead.revision+1)});
 head=await read();

 // A real completed attachment and reviewed source remain protected during stale edits.
 sql.prepare('INSERT INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,version,actor,created_at,mutation_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('original','TSAL','evidence','original.txt','original.txt','text/plain',1,'ab','local-original','complete',1,'owner-fixture','2026-10-30','fixture_upload');
 const sourced={...answer('source value'),provenance,sourceReview:'pending',importedBatchId:'source_batch_0001'};
 const seeded=await save('contributor-a',head.revision,{...head.answers,a:sourced,evidence:{status:'answered',value:'',attachmentIds:['original']}});
 const confirmed=await run('contributor-b',()=>server.confirmSourceContent('TSAL',{fieldId:'a',baseRevision:seeded.revision,mutationId:'confirm_source_0001'}));
 const submit=await run('contributor-a',()=>server.reviewSystem('TSAL',{action:'submit',baseRevision:confirmed.revision,mutationId:'submit_review_0001'}));
 const reviewed=await run('reviewer-fixture',()=>server.reviewSystem('TSAL',{action:'approve',baseRevision:submit.revision,fieldIds:['a'],reason:'fixture review',mutationId:'approve_review_0001'}));
 const staleOther=await save('contributor-b',seeded.revision,{...seeded.answers,b:answer('B-after-review')});
 check('metadata-only remote confirmation does not conflict',()=>assert.equal(staleOther.answers.a.sourceReview,'confirmed'));
 check('unmodified provenance and file retained',()=>{assert.deepEqual(plain(staleOther.answers.a.provenance),provenance);assert.equal(staleOther.attachments[0].id,'original')});
 check('unmodified engineering review retained',()=>assert.deepEqual(plain(staleOther.review.fields.a),plain(reviewed.review.fields.a)));
 const contentEdited=await save('contributor-a',staleOther.revision,{...staleOther.answers,a:answer('edited source content')});
 check('edited source keeps lineage and resets pending',()=>{assert.deepEqual(plain(contentEdited.answers.a.provenance),provenance);assert.equal(contentEdited.answers.a.importedBatchId,'source_batch_0001');assert.equal(contentEdited.answers.a.sourceReview,'pending');assert.equal(contentEdited.review.fields.a,undefined)});
 const omitted=await save('contributor-b',contentEdited.revision,{b:answer('only B sent')});
 check('omitted fields cannot delete source or attachments',()=>{assert.equal(omitted.answers.a.value,'edited source content');assert.deepEqual(plain(omitted.answers.evidence.attachmentIds),['original'])});
 const fileOmitted=await save('contributor-a',omitted.revision,{...omitted.answers,evidence:{status:'answered',value:'note'}});
 check('omitted attachment metadata cannot detach original',()=>assert.deepEqual(plain(fileOmitted.answers.evidence.attachmentIds),['original']));

 const uploadBase=await read();const form=new FormData();form.set('fieldId','evidence');form.set('baseRevision',String(uploadBase.revision));form.set('mutationId','upload_race_0001');form.set('file',new File(['retained original bytes'],'concurrency-fixture.txt',{type:'text/plain'}));
 beforeBatch=async()=>{beforeBatch=null;await save('contributor-b',uploadBase.revision,{...uploadBase.answers,b:answer('changed during upload')})};
 let uploadConflict;try{await run('contributor-a',()=>server.uploadFile('TSAL',form))}catch(e){uploadConflict=e}
 check('late upload CAS conflict exposes retained file',()=>{assert.equal(uploadConflict.status,409,String(uploadConflict));assert.equal(uploadConflict.details.attachment.state,'complete');assert.equal(uploadConflict.details.attachment.safeName,'concurrency-fixture.txt');assert.equal(uploadConflict.details.attachment.storageKey,undefined)});
 const retained=uploadConflict.details.attachment;const linked=await save('contributor-a',uploadBase.revision,{...uploadBase.answers,evidence:{...uploadBase.answers.evidence,attachmentIds:[...uploadBase.answers.evidence.attachmentIds,retained.id]}});
 check('retained upload linked without overwriting another field',()=>{assert.equal(linked.answers.b.value,'changed during upload');assert.ok(linked.answers.evidence.attachmentIds.includes(retained.id));assert.ok(linked.attachments.some(a=>a.id===retained.id))});
 const old=await run('contributor-a',()=>server.readRevision('TSAL',initial.revision));
 check('initial history immutable after all merges',()=>assert.deepEqual(plain(old.answers),{a:answer('A0'),b:answer('B0')}));
 const finalBeforeReload=await read();server=load('lib/server.ts',deps);const afterReload=await read();
 check('new server instance rereads persisted state',()=>assert.deepEqual(plain(afterReload),plain(finalBeforeReload)));
 check('every save has one snapshot',()=>{const row=sql.prepare('SELECT COUNT(*) AS count FROM revisions WHERE system_id=?').get('TSAL');assert.equal(row.count,afterReload.revision)});
 // Force a fresh competing save at each attempt to exercise the bounded retry path.
 let forced=0;
 // Use an explicitly named hook; no global identity switching is involved.
 const busyHook=async()=>{beforeBatch=null;forced++;const current=await read();await save('contributor-b',current.revision,{...current.answers,b:answer('busy '+forced)});beforeBatch=busyHook};forced=0;beforeBatch=busyHook;
 let busy;try{await save('contributor-a',afterReload.revision,{...afterReload.answers,a:answer('not committed busy')})}catch(e){busy=e}finally{beforeBatch=null}
 check('repeated races stop safely after4 attempts',()=>{assert.equal(forced,4);assert.equal(busy.details.code,'CONCURRENT_SAVE_BUSY');assert.deepEqual(plain(busy.details.conflictFieldIds),[])});
 check('busy save never overwrites stored data',()=>assert.notEqual(sql.prepare('SELECT answers FROM submissions WHERE id=?').get('TSAL').answers.includes('not committed busy'),true));
 console.log(cases+' multi-identity permission/concurrency/persistence cases passed with actual SQLite transactions; '+batches+' batches.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>sql.close());
