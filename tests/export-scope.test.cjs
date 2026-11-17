const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:id=>imports[id],console,crypto:require('node:crypto').webcrypto,TextEncoder,ReadableStream,Response,URL});return exports;}
const archive=load('lib/archive.ts');
let pdfCalls=0;
const answer={status:'answered',value:'תוכן הצוות'};
const snapshot=id=>({id,answers:{note:answer},revision:1,progress:{missing:[]}});
const server={guard:async(_r,op)=>op(),session:async()=>({role:'coordinator',systemIds:['TSAL']}),readSystem:async id=>snapshot(id),getSharedRecords:async()=>({records:[]}),getRevisionIndex:async()=>[{revision:1}],getReviewHistory:async()=>[{revision:1,reason:'included-review'},{revision:2,reason:'future-review-after-snapshot'}],listFiles:async id=>id==='TSAL'?[{id:'original',state:'complete',safeName:'original.txt',size:8,sha256:'test'}]:[],getFileRecord:async()=>({storageKey:'private'}),bucket:()=>({get:async()=>({body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('original'));c.close();}})})}),database:()=>({prepare:()=>({bind(...args){this.args=args;return this;},first:async()=>({bytes:100}),async all(){return {results:this.args[1]===0?[{revision:1,answers:JSON.stringify({note:answer}),review:'{}',status:'draft',schemaVersion:'test',contentHash:'hash',createdAt:'date'}]:[]};}})})};
const catalog={systems:[{id:'TSAL'}],getSystem:id=>({id}),schemaVersion:'test',coverage:{},coordinatorQueue:{},sourceSummary:{}};
const route=load('app/api/export/route.ts',{'@/lib/server':server,'@/lib/catalog':catalog,'@/lib/archive':archive,'@/lib/report':{makeReport:()=>({html:'<html>תוכן הצוות</html>',lines:['תוכן הצוות']})},'@/lib/pdf':{renderPDF:async()=>{pdfCalls++;return new TextEncoder().encode('%PDF-test')}},'@/lib/data-export':{},'@/data/formal-field-coverage.json':{},'@/data/leaf-example-matrix.json':{},'@/data/system-form-plan.json':{}});
(async()=>{
 const all=await route.GET(new Request('https://example.test/api/export?system=all'));
 const bytes=Buffer.from(await all.arrayBuffer());
 assert.equal(all.status,200);assert.equal(pdfCalls,0);
 for(const name of ['report.html','answers.json','attachments.json','history/TSAL/1.json','files/original.txt','manifest.json'])assert.ok(bytes.includes(Buffer.from(name)),name);
 assert.ok(!bytes.includes(Buffer.from('report.pdf')));
 assert.ok(bytes.includes(Buffer.from('included-review')));assert.ok(!bytes.includes(Buffer.from('future-review-after-snapshot')),'Review events must stop at the captured revision');
 assert.ok(bytes.includes(Buffer.from('תוכן הצוות')));assert.ok(bytes.includes(Buffer.from('original')));
 assert.ok(bytes.includes(Buffer.from('PDF נכלל בייצוא של מערכת בודדת')));
 const one=await route.GET(new Request('https://example.test/api/export?system=TSAL'));
 const single=Buffer.from(await one.arrayBuffer());assert.equal(pdfCalls,1);assert.ok(single.includes(Buffer.from('report.pdf')));assert.ok(single.includes(Buffer.from('%PDF-test')));
 console.log('Export scope passed: full ZIP retains HTML/answers/originals/history without bulk PDF; single-system PDF preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
