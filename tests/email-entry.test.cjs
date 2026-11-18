const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{AsyncLocalStorage}=require('node:async_hooks');

function fixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const name of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this},async run(){return {meta:{changes:sql.prepare(query).run(...this.args).changes}}},async first(){return sql.prepare(query).get(...this.args)??null},async all(){return {results:sql.prepare(query).all(...this.args)}}}},async batch(statements){sql.exec('BEGIN');try{const out=statements.map(statement=>({meta:{changes:sql.prepare(statement.query).run(...statement.args).changes}}));sql.exec('COMMIT');return out}catch(error){sql.exec('ROLLBACK');throw error}}};
 sql.prepare('INSERT INTO workspace VALUES(?,?,?)').run('2027','owner-fixture','2026-10-31');
 sql.prepare("INSERT INTO memberships(subject,role,system_ids,active,created_at) VALUES(?,'coordinator','[]',1,?)").run('owner-fixture','2026-10-31');
 const systems=JSON.parse(fs.readFileSync('data/systems.normalized.json','utf8'));
 const catalog={schemaVersion:'test',systems,getSystem:id=>id==='COORDINATOR'?{id}:systems.find(system=>system.id===id),getFields:id=>systems.find(system=>system.id===id)?.fields??[]};
 const context=new AsyncLocalStorage(),modules=new Map();let sitesReads=0;
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  const imports=name=>{
   if(name==='@/lib/team-entry')return {teamEntryAllowed:()=>true};if(name==='@/lib/cloud-storage')return {cloudDatabase:db};
   if(name==='next/server')return {after(){}};
   if(name==='@/lib/owner-session')return {OWNER_COOKIE:'biu_owner_session'};
   if(name==='next/headers')return {cookies:async()=>({delete(){}}),headers:async()=>new Headers(context.getStore()?.headers??{})};
   if(name==='@/app/chatgpt-auth')return {getChatGPTUser:async()=>{sitesReads++;return context.getStore()?.sites??null}};
   if(name==='@/lib/catalog')return catalog;
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
   if(name.startsWith('.'))return load(path.normalize(path.join(path.dirname(file),name+'.ts')));
   throw Error('Unexpected import '+name);
  };
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:imports,console,Response,Request,Headers,URL,TransformStream,TextEncoder,TextDecoder,crypto:globalThis.crypto,Uint8Array,ArrayBuffer,Map,Set,File,FormData},{filename:file});
  return exports;
 }
 const server=load('lib/server.ts'),helper=load('lib/email-entry-session.ts'),entry=load('app/api/auth/email-entry/route.ts'),logout=load('app/api/auth/logout/route.ts');
 const as=(cookie,fn,sites=null)=>context.run({headers:cookie?{cookie}:{},sites},fn);
 const post=(route,body={},cookie='',origin='https://site.invalid')=>route.POST(new Request('https://site.invalid/api/auth/email-entry',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{}),...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
 const enter=async(email='fixture@live.biu.ac.il',cookie='',extra={})=>{const response=await post(entry,{email,...extra},cookie);const body=await response.json();return {response,body,cookie:response.headers.get('set-cookie')?.split(';')[0]??''}};
 return {sql,db,server,helper,entry,logout,post,as,enter,sitesReads:()=>sitesReads};
}

test('email entry creates unverified contributor sessions with independent subjects and no stored address or raw token',async t=>{
 const f=fixture(t),one=await f.enter('Owner@LIVE.BIU.AC.IL','',{subject:'owner-fixture',role:'coordinator',emailVerified:true,systemIds:['COORDINATOR']}),two=await f.enter('Owner@LIVE.BIU.AC.IL');
 assert.equal(one.response.status,200);assert.equal(one.response.headers.get('cache-control'),'private, no-store');
 assert.equal(one.body.role,'contributor');assert.equal(one.body.authMethod,'email_entry');assert.equal(one.body.emailVerified,false);assert.equal(one.body.systemIds.length,22);assert.equal(one.body.systemIds.includes('COORDINATOR'),false);
 assert.notEqual(one.body.subject,'owner-fixture');assert.notEqual(one.body.subject,two.body.subject);assert.notEqual(one.cookie,two.cookie);
 const token=one.cookie.split('=')[1],rows=f.sql.prepare('SELECT * FROM email_entry_sessions').all();
 assert.match(token,/^[a-f0-9]{64}$/);assert.equal(rows[0].token_hash,await f.helper.emailEntryTokenHash(token));assert.notEqual(rows[0].token_hash,token);assert.ok(rows[0].expires_at>Date.now()+13*86400000);
 assert.equal(JSON.stringify(rows).includes(token),false);assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM memberships').all()).includes('@'),false);
 assert.equal(JSON.stringify(one.body).includes('@'),false);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='self_declared_email_entry'").get().n,2);
 assert.match(one.response.headers.get('set-cookie'),/HttpOnly/);assert.match(one.response.headers.get('set-cookie'),/SameSite=Lax/);assert.match(one.response.headers.get('set-cookie'),/Secure/);assert.match(one.response.headers.get('set-cookie'),/Path=\//);assert.match(one.response.headers.get('set-cookie'),/Max-Age=1209600/);
 const current=await f.as(one.cookie,()=>f.server.session(),{userId:'owner-fixture',email:'owner@example.invalid'});assert.equal(current.subject,one.body.subject);assert.equal(current.role,'contributor');assert.equal(f.sitesReads(),0);
});

test('entry rejects nonmatching addresses, malformed bodies, oversized requests and cross-origin writes before creating a member',async t=>{
 const f=fixture(t);
 for(const email of ['fixture@gmail.com','fixture@biu.ac.il','fixture@sub.live.biu.ac.il','fixture@live.biu.ac.il.evil.test','fixture@live.biu.ac.il.','fixture@live.bıu.ac.il','fixture@live.biu.ac.il@evil.test','@live.biu.ac.il',' fixture@live.biu.ac.il','fixture@live.biu.ac.il\n','fixture name@live.biu.ac.il','fixture..name@live.biu.ac.il',null,42])assert.equal((await f.enter(email)).response.status,400);
 assert.equal((await f.post(f.entry,{email:'fixture@live.biu.ac.il'},'',null)).status,403);
 assert.equal((await f.post(f.entry,{email:'fixture@live.biu.ac.il'},'','https://other.invalid')).status,403);
 assert.equal((await f.post(f.entry,{email:'fixture@live.biu.ac.il',padding:'x'.repeat(1025)})).status,413);
 assert.equal((await f.entry.POST(new Request('https://site.invalid/api/auth/email-entry',{method:'POST',headers:{origin:'https://site.invalid'},body:'null'}))).status,400);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM email_entry_sessions').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM memberships').get().n,1);
 f.sql.prepare('DELETE FROM workspace').run();assert.equal((await f.enter()).response.status,503);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM memberships').get().n,1);
});

test('entry contributors can save all systems but cannot review, administer or access coordinator content',async t=>{
 const f=fixture(t),one=await f.enter(),two=await f.enter();
 const saved=await f.as(one.cookie,()=>f.server.saveSystem('TSAL',{baseRevision:0,mutationId:'email_entry_save_001',answers:{'EP-C01-F01':{status:'answered',value:'isolated test fixture'}}}));
 assert.equal(saved.answers['EP-C01-F01'].value,'isolated test fixture');assert.equal((await f.as(two.cookie,()=>f.server.readSystem('TSAL'))).revision,1);
 await assert.rejects(()=>f.as(two.cookie,()=>f.server.saveSystem('TSAL',{baseRevision:0,mutationId:'email_entry_save_002',answers:{'EP-C01-F01':{status:'answered',value:'conflicting test fixture'}}})),error=>error.status===409);
 for(const operation of [()=>f.server.requireCoordinator(),()=>f.server.requireAccess('COORDINATOR'),()=>f.server.updateMember({subject:one.body.subject,role:'coordinator'}),()=>f.server.previewSourceImport({}),()=>f.server.reviewSystem('TSAL',{action:'approve',baseRevision:1,reason:'fixture',fieldIds:['EP-C01-F01']})])await assert.rejects(()=>f.as(one.cookie,operation),error=>error.status===403);
 const actors=f.sql.prepare('SELECT actor FROM revisions').all();assert.equal(actors[0].actor,one.body.subject);
 f.sql.prepare("UPDATE memberships SET role='coordinator',system_ids='[\"COORDINATOR\"]' WHERE subject=?").run(one.body.subject);
 assert.equal((await f.as(one.cookie,()=>f.server.session())).role,'contributor');await assert.rejects(()=>f.as(one.cookie,()=>f.server.requireCoordinator()),error=>error.status===403);
 f.sql.prepare("UPDATE memberships SET auth_source='manual' WHERE subject=?").run(one.body.subject);await assert.rejects(()=>f.as(one.cookie,()=>f.server.session()),error=>error.status===401);
});

test('disabled, absent, expired, revoked and forged entry identities fail without falling through to Sites owner',async t=>{
 const f=fixture(t),owner={userId:'owner-fixture',email:'owner@example.invalid'},one=await f.enter();
 const denied=()=>assert.rejects(()=>f.as(one.cookie,()=>f.server.session(),owner),error=>error.status===401||error.status===403);
 f.sql.prepare('UPDATE memberships SET active=0 WHERE subject=?').run(one.body.subject);await denied();assert.equal((await f.enter('fixture@live.biu.ac.il',one.cookie)).response.status,403);
 f.sql.prepare('UPDATE memberships SET active=1 WHERE subject=?').run(one.body.subject);
 f.sql.prepare('UPDATE email_entry_sessions SET expires_at=0').run();await denied();
 f.sql.prepare('UPDATE email_entry_sessions SET expires_at=?,revoked_at=?').run(Date.now()+60000,'revoked');await denied();
 f.sql.prepare('UPDATE email_entry_sessions SET revoked_at=NULL').run();f.sql.prepare('DELETE FROM memberships WHERE subject=?').run(one.body.subject);await denied();
 for(const cookie of ['biu_email_session=invalid','biu_email_session='+'a'.repeat(64),'biu_email_session='+one.cookie.split('=')[1]+'; '+one.cookie])await assert.rejects(()=>f.as(cookie,()=>f.server.session(),owner),error=>error.status===401);
 assert.equal(f.sitesReads(),0);assert.equal((await f.as('',()=>f.server.session(),owner)).role,'coordinator');
});

test('reentry rotates and revokes the old token, signout is same-origin, durable and idempotent',async t=>{
 const f=fixture(t),one=await f.enter(),two=await f.enter('second@live.biu.ac.il',one.cookie);
 await assert.rejects(()=>f.as(one.cookie,()=>f.server.session()),error=>error.status===401);assert.equal((await f.as(two.cookie,()=>f.server.session())).subject,two.body.subject);
 assert.equal((await f.post(f.logout,{},two.cookie,'https://other.invalid')).status,403);assert.equal((await f.as(two.cookie,()=>f.server.session())).role,'contributor');
 const response=await f.post(f.logout,{},two.cookie);assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/Secure/);
 await assert.rejects(()=>f.as(two.cookie,()=>f.server.session()),error=>error.status===401);assert.equal((await f.post(f.logout,{},two.cookie)).status,200);assert.equal((await f.post(f.logout)).status,200);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM email_entry_sessions WHERE revoked_at IS NULL').get().n,0);
});
