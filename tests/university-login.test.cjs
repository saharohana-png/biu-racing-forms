const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react');
const source=ts.transpileModule(fs.readFileSync('components/racing/university-login.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(request,{search='',onSuccess}={}){
 let cursor=0,cells=[],tree;const assigned=[];
 const hooks={...React,useState(initial){const index=cursor++;if(!cells[index])cells[index]={value:initial};return[cells[index].value,next=>cells[index].value=typeof next==='function'?next(cells[index].value):next];},useRef(initial){const index=cursor++;if(!cells[index])cells[index]={current:initial};return cells[index];}};
 const deps={'react':hooks,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/client-types':{request}};
 const exports={};
 vm.runInNewContext(source,{exports,require:id=>{if(deps[id])return deps[id];throw Error('Unexpected import '+id);},URL,URLSearchParams,window:{location:{search,assign:url=>assigned.push(url)}}});
 const render=()=>{cursor=0;tree=exports.UniversityLogin({onSuccess});return tree;};
 const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
 const find=type=>all(tree).find(node=>node.type===type);
 render();
 return{exports,assigned,render,find,nodes:()=>all(tree),email(value){find('input').props.onChange({target:{value}});render();},submit(){return find('form').props.onSubmit({preventDefault(){}});}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('team entry has an email field and no ChatGPT, password or code step',()=>{
 const h=harness(async()=>{}),input=h.find('input');
 assert.equal(input.props.type,'email');assert.equal(input.props.dir,'ltr');assert.equal(input.props.autoComplete,'email');
 assert.equal(input.props.placeholder,'name@live.biu.ac.il');
 assert.equal(h.nodes().filter(node=>node.type==='input').length,1);
 assert.equal(h.nodes().filter(node=>node.type==='a').length,0);
 assert.equal(h.find('button').props.children,'כניסה');
});
test('invalid and lookalike domains never create a session',async()=>{
 let calls=0;const h=harness(async()=>calls++);
 for(const email of ['','name@gmail.com','name@biu.ac.il','name@live.biu.ac.il.evil.test','name@@live.biu.ac.il','name @live.biu.ac.il','@live.biu.ac.il']){
  h.email(email);await h.submit();h.render();assert.equal(h.find('input').props['aria-invalid'],true);
 }
 assert.equal(calls,0);
});
test('one active submission normalizes the email, blocks duplicate requests and refreshes home on success',async()=>{
 const active=deferred(),requests=[],sessions=[];
 const h=harness((url,options)=>{requests.push({url,options});return active.promise;},{onSuccess:session=>sessions.push(session)});
 h.email('  Member@LIVE.BIU.AC.IL  ');
 const first=h.submit(),second=h.submit();h.render();
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/auth/email-entry');
 assert.equal(requests[0].options.method,'POST');assert.deepEqual(JSON.parse(requests[0].options.body),{email:'member@live.biu.ac.il'});
 assert.equal(h.find('input').props.disabled,true);assert.equal(h.find('button').props.disabled,true);
 const session={authMethod:'email_entry',emailVerified:false,role:'contributor',subject:'entry_1',systemIds:['TSAL']};
 active.resolve(session);await Promise.all([first,second]);h.render();
 assert.equal(sessions.length,1);assert.equal(sessions[0],session);assert.equal(h.assigned.length,0);
});
test('failure keeps the typed address, shows safe errors and permits retry',async()=>{
 let count=0;const h=harness(async()=>{count++;throw Object.assign(Error(count===1?'Raw database failure':'יש לנסות שוב בעוד רגע.'),{status:count===1?500:429});});
 h.email('Member@live.biu.ac.il');await h.submit();h.render();
 assert.equal(h.find('input').props.value,'Member@live.biu.ac.il');assert.equal(h.find('button').props.disabled,false);
 const alert=()=>h.nodes().find(node=>node.props?.role==='alert');
 assert.doesNotMatch(alert().props.children,/Raw database/);
 await h.submit();h.render();assert.equal(alert().props.children,'יש לנסות שוב בעוד רגע.');assert.equal(count,2);
});
test('login returns to the requested workbook and rejects external or authentication redirects',async()=>{
 const h=harness(async()=>({authMethod:'email_entry'}),{search:'?returnTo=%2Fdocuments%2Fesf'});
 h.email('name@live.biu.ac.il');await h.submit();assert.deepEqual(h.assigned,['/documents/esf']);
 const safe=h.exports.safeLoginReturnTo;
 assert.equal(safe('/documents/ases?sheet=Cover#preview'),'/documents/ases?sheet=Cover#preview');
 for(const input of [undefined,'https://evil.test','//evil.test','/\\evil.test','/%5c%5cevil.test','/%2f%2fevil.test','/\nevil.test','/login','/signin-with-chatgpt','/api/auth/logout','/%E0%A4%A'])assert.equal(safe(input),'/',String(input));
});
