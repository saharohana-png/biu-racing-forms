const assert = require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
let identity=null,member=null,queries=0,ownerConfigured=true;
const database={prepare(sql){queries++;return {bind(){return this},async run(){return {}},async first(){if(sql.includes('FROM workspace'))return ownerConfigured?{owner_subject:'owner-fixture'}:null;if(sql.includes('FROM memberships'))return member;return null}}}};
const catalog={schemaVersion:'test',systems:[{id:'TSAL'},{id:'BMS'}],getSystem:id=>['TSAL','BMS','COORDINATOR'].includes(id)?{id}:undefined,getFields:()=>[]};
function load(file,deps){const exports={};const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:name=>{if(name in deps)return deps[name];if(name==='@/lib/email-entry-session')return {readEmailEntryToken:async()=>null};if(name==='next/server')return {after(){}};if(name==='@/lib/translation-version')return load('lib/translation-version.ts',{});throw Error('Unexpected import '+name)},console,Response,Request,Headers,TextEncoder,URL,crypto:globalThis.crypto,Uint8Array,File,FormData},{filename:file});return exports;}
const progress=load('lib/progress.ts',{});
const sourceImport=load('lib/source-import.ts',{});
const answerMerge=load('lib/answer-merge.ts',{});
const server=load('lib/server.ts',{'cloudflare:workers':{env:{DB:database}},'@/app/chatgpt-auth':{getChatGPTUser:async()=>identity},'@/lib/catalog':catalog,'@/lib/progress':progress,'@/lib/source-import':sourceImport,'@/lib/answer-merge':answerMerge});
function actor(role,scope=['TSAL'],active=1){identity={userId:'opaque-local-subject',email:'never-returned@example.invalid'};member=role?{subject:identity.userId,role,system_ids:JSON.stringify(scope),active}:null;}
async function denied(fn,status){await assert.rejects(fn,e=>e.status===status);}
(async()=>{
 await denied(()=>server.requireAccess('TSAL'),401);
 actor(null);await denied(()=>server.requireAccess('TSAL'),403);
 ownerConfigured=false;await denied(()=>server.requireAccess('TSAL'),503);ownerConfigured=true;
 actor('contributor');assert.equal((await server.requireAccess('TSAL')).role,'contributor');assert.equal((await server.requireAccess('TSAL',true)).role,'contributor');
 await denied(()=>server.requireAccess('BMS'),403);
 await denied(()=>server.requireAccess('COORDINATOR'),403);
 await denied(()=>server.requireCoordinator(),403);await denied(()=>server.previewSourceImport({}),403);await denied(()=>server.applySourceImport({}),403);
 actor('reviewer');assert.equal((await server.requireAccess('TSAL')).role,'reviewer');await denied(()=>server.requireAccess('TSAL',true),403);await denied(()=>server.confirmSourceContent('TSAL',{}),403);
 actor('reviewer',['BMS']);await denied(()=>server.requireAccess('TSAL'),403);
 actor('contributor',['TSAL'],0);await denied(()=>server.requireAccess('TSAL'),403);
 actor('coordinator',[]);assert.equal((await server.requireAccess('BMS',true)).role,'coordinator');assert.equal((await server.requireAccess('COORDINATOR',true)).role,'coordinator');assert.equal((await server.requireCoordinator()).role,'coordinator');
 const s=await server.session();assert.deepEqual(Object.keys(s).sort(),['authMethod','role','subject','systemIds']);
 identity=null;queries=0;await denied(()=>server.getFileRecord('guessed-attachment'),401);assert.equal(queries,0,'Anonymous requests rejected before looking up files');

 console.log('19 access-control cases passed using isolated identity and database fixtures.');
})().catch(error=>{console.error(error);process.exitCode=1});
