const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const fields=[{id:'document',label:'ראיה',type:'file'},{id:'tests',label:'בדיקות',type:'table',columns:[{id:'proof',type:'file'}]}];
const currentAnswers={document:{status:'answered',value:'',attachmentIds:['replacement']},tests:{status:'answered',value:[{_id:'row-1',proof:'table-evidence'}],attachmentIds:['table-evidence']}};
const originalAnswers={document:{status:'answered',value:'',attachmentIds:['original']}};
const rows=['original','replacement','orphan','table-evidence'].map(id=>({id,system_id:'TSAL',field_id:id==='table-evidence'?'tests':'document',original_name:id+'.txt',safe_name:id+'.txt',mime:'text/plain',size:1,sha256:id,state:'complete',storage_key:id,replaces_id:id==='replacement'?'original':null,version:id==='replacement'?2:1,created_at:'2026-10-30',mutation_key:id}));
const database={prepare(sql){return {bind(){return this},async run(){return {}},async first(){if(sql.includes('FROM workspace'))return {owner_subject:'opaque-test'};if(sql.includes('FROM memberships'))return {subject:'opaque-test',role:'coordinator',system_ids:'[]',active:1};if(sql.includes('FROM submissions'))return {id:'TSAL',revision:2,answers:JSON.stringify(currentAnswers),status:'draft',review:'{}',updated_at:'2026-10-30'};if(sql.includes('FROM revisions'))return {id:'TSAL',revision:1,answers:JSON.stringify(originalAnswers),status:'in_review',review:'{}',updated_at:'2026-10-29',content_hash:'original-hash',schema_version:'test'};return null},async all(){return {results:rows}}}}};
function load(file,deps){const exports={};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});throw Error('Unexpected import '+name)},console,Response,Request,Headers,TextEncoder,URL,TransformStream,crypto:globalThis.crypto,Uint8Array,File,FormData},{filename:file});return exports;}
const progress=load('lib/progress.ts',{});
const sourceImport=load('lib/source-import.ts',{});
const answerMerge=load('lib/answer-merge.ts',{});
const server=load('lib/server.ts',{'@/lib/team-entry':{teamEntryAllowed:()=>true},'@/lib/cloud-storage':{cloudDatabase:database},'@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:'opaque-test',email:'hidden@example.invalid'})},'@/lib/catalog':{schemaVersion:'test',systems:[{id:'TSAL'}],getSystem:id=>id==='TSAL'?{id}:undefined,getFields:()=>fields},'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':answerMerge});
(async()=>{
 const current=await server.readSystem('TSAL');assert.deepEqual(Array.from(current.attachments,a=>a.id).sort(),['replacement','table-evidence'],'Reload returns only currently referenced originals');
 assert.equal(current.progress.complete,2,'Linked table evidence still contributes to completion');
 const old=await server.readRevision('TSAL',1);assert.deepEqual(Array.from(old.attachments,a=>a.id),['original'],'Earlier snapshot retains its exact original evidence');
 const history=await server.listFiles('TSAL');assert.deepEqual(Array.from(history,a=>a.id),rows.map(r=>r.id),'History preserves replacements and unlinked completed uploads');
 const columnOnly=progress.referencedAttachmentIds(fields,{tests:{status:'answered',value:[{_id:'row-1',proof:'table-evidence'}]}});assert.equal(columnOnly.has('table-evidence'),true,'File-column references are collected independently of attachmentIds');
 const unrelated=progress.referencedAttachmentIds([{id:'text',type:'table',columns:[{id:'name',type:'text'}]}],{text:{status:'answered',value:[{_id:'row-1',name:'orphan'}]}});assert.equal(unrelated.size,0,'Ordinary table values cannot expose unlinked files');
 const empty=progress.referencedAttachmentIds(fields,{});assert.equal(empty.size,0,'An empty submission has no active files');
 console.log('7 active-attachment and immutable-history cases passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
