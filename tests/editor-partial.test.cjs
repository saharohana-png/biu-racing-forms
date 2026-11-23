const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
// Exercise the actual component event handlers without a browser or server writes.
const source=fs.readFileSync('components/racing/editor.tsx','utf8')+'\nexport {AnswerField,AnswerPreview};';
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const compiledExports={};
const sandbox={exports:compiledExports,crypto:require('node:crypto').webcrypto,require(id){if(id==='react'||id==='react/jsx-runtime')return require(id);if(id==='@/lib/catalog')return {systems:[],getSystem:()=>undefined};if(id==='./example')return {ExampleButton:()=>null};return {};}};
vm.runInNewContext(compiled,sandbox,{filename:'editor.tsx'});
const {AnswerField,AnswerPreview}=compiledExports;
const field={id:'partial',label:'נתונים',prompt:'תעדו את הנתונים',kind:'table',section:'תיעוד',columns:[{id:'part',label:'רכיב',kind:'text'},{id:'value',label:'ערך',kind:'text'}]};
const original={status:'unknown',value:[{_id:'same-row',part:'Known component',value:''}],reason:'חסר ערך מדוד',dependency:'DRIVE',provenance:[{title:'מפרט',url:'https://drive.google.com/file/d/source/view',kind:'drive',applicability:'current'}],sourceReview:'confirmed',attachmentIds:['kept-file']};
let saved;
const props={field,answer:original,attachments:[],onChange:value=>saved=value,onUpload:()=>assert.fail('unexpected upload'),uploading:false,demo:false,readOnly:false,onConfirmSource(){},confirmingSource:false};
function nodes(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(nodes);if(typeof node.type==='function')return nodes(node.type(node.props));return[node,...nodes(node.props?.children)];}
const render=(patch={})=>AnswerField({...props,...patch});
let cases=0;const check=(name,fn)=>{try{fn();cases++;}catch(e){e.message=name+': '+e.message;throw e;}};
check('unknown table and reason both render',()=>{const html=renderToStaticMarkup(render());assert.match(html,/Known component/);assert.match(html,/חסר ערך מדוד/);assert.match(html,/המידע שכבר ידוע/)});
check('table cell edit retains unknown, row, reason, dependency and files',()=>{nodes(render()).find(n=>n.type==='input'&&n.props.value==='Known component').props.onChange({target:{value:'Updated component'}});assert.equal(saved.status,'unknown');assert.equal(saved.value[0]._id,'same-row');assert.equal(saved.value[0].part,'Updated component');assert.equal(saved.reason,original.reason);assert.equal(saved.dependency,'DRIVE');assert.deepEqual(Array.from(saved.attachmentIds),original.attachmentIds);assert.equal(saved.sourceReview,'pending')});
check('add row retains unknown',()=>{nodes(render()).find(n=>n.type==='button'&&String(n.props.children).includes('הוספת רשומה')).props.onClick();assert.equal(saved.status,'unknown');assert.equal(saved.value.length,2);assert.equal(saved.value[0]._id,'same-row')});
check('remove row retains unknown',()=>{nodes(render()).find(n=>n.type==='button'&&n.props.children==='הסרת רשומה').props.onClick();assert.equal(saved.status,'unknown');assert.equal(saved.value.length,0);assert.equal(saved.reason,original.reason)});
check('only explicit answered button promotes status',()=>{nodes(render()).find(n=>n.type==='button'&&n.props.children==='יש תשובה').props.onClick();assert.equal(saved.status,'answered');assert.deepEqual(saved.value,original.value)});
check('unknown text displays and edit stays unknown',()=>{const tree=render({field:{...field,kind:'text',columns:[]},answer:{...original,value:'Known text'}});assert.match(renderToStaticMarkup(tree),/Known text/);nodes(tree).find(n=>n.type==='textarea'&&n.props.value==='Known text').props.onChange({target:{value:'New text'}});assert.equal(saved.status,'unknown');assert.equal(saved.value,'New text')});
check('unknown file keeps its saved source visible without enabling file changes',()=>{
 const answer={...original,value:''};
 const attachments=[{id:'kept-file',fieldId:'partial',safeName:'saved-source.pdf'},{id:'unlinked-file',fieldId:'partial',safeName:'unlinked.pdf'}];
 for(const readOnly of [false,true]){
  const tree=render({field:{...field,kind:'file',columns:[]},answer,attachments,readOnly});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/href="\/api\/files\/kept-file"/);
  assert.match(html,/saved-source\.pdf/);
  assert.match(html,/חסר ערך מדוד/);
  assert.doesNotMatch(html,/unlinked\.pdf/);
  assert.ok(!nodes(tree).some(n=>n.type==='input'&&n.props.type==='file'));
  assert.ok(!nodes(tree).some(n=>n.type==='button'&&n.props.children==='הסרה'));
 }
 assert.equal(answer.status,'unknown');
 assert.deepEqual(answer.attachmentIds,['kept-file']);
});
check('unknown selection remains unknown including NA option',()=>{const tree=render({field:{...field,kind:'select',columns:[],options:[{value:'N/A',label:'N/A'}]},answer:{...original,value:''}});nodes(tree).find(n=>n.type==='select'&&n.props.id==='partial').props.onChange({target:{value:'N/A'}});assert.equal(saved.status,'unknown');assert.equal(saved.value,'N/A')});
check('history/conflict preview shows unknown table and gap',()=>{const html=renderToStaticMarkup(React.createElement(AnswerPreview,{answers:{partial:original},fields:[field]}));assert.match(html,/Known component/);assert.match(html,/חסר ערך מדוד/);assert.match(html,/לא מולא/);assert.match(html,/kept-file/)});
check('read-only viewer can see partial data without enabled edit controls',()=>{const tree=render({readOnly:true});assert.match(renderToStaticMarkup(tree),/Known component/);for(const n of nodes(tree)){if(n.type==='input'||n.type==='textarea')assert.equal(n.props.readOnly,true);if(n.type==='button'||n.type==='select')assert.equal(n.props.disabled,true)}});
check('NA keeps content hidden and answered content still normal',()=>{assert.doesNotMatch(renderToStaticMarkup(render({answer:{...original,status:'na'}})),/Known component/);const tree=render({answer:{...original,status:'answered'}});nodes(tree).find(n=>n.type==='input'&&n.props.value==='Known component').props.onChange({target:{value:'Changed'}});assert.equal(saved.status,'answered')});
check('identical unknown text shows only reason without changing stored value',()=>{const answer={...original,value:'  Shared known and gap text  ',reason:'Shared known and gap text'};const tree=render({field:{...field,kind:'text',columns:[]},answer});const html=renderToStaticMarkup(tree);assert.equal(html.split('Shared known and gap text').length-1,1);assert.ok(!nodes(tree).some(n=>n.type==='textarea'&&n.props.id==='partial'));nodes(tree).find(n=>n.type==='textarea'&&n.props.id==='partial-reason').props.onChange({target:{value:'Updated gap explanation'}});assert.equal(saved.status,'unknown');assert.equal(saved.value,answer.value);assert.equal(saved.reason,'Updated gap explanation');const updated=renderToStaticMarkup(render({field:{...field,kind:'text',columns:[]},answer:saved}));assert.match(updated,/Shared known and gap text/);assert.match(updated,/Updated gap explanation/)});
check('history/conflict preview suppresses identical unknown text only',()=>{const answer={...original,value:'Same text',reason:' Same text '};const html=renderToStaticMarkup(React.createElement(AnswerPreview,{answers:{partial:answer},fields:[field]}));assert.equal(html.split('Same text').length-1,1);assert.equal(answer.value,'Same text');assert.equal(answer.reason,' Same text ')});
check('official source displays its own label without implying confirmation',()=>{const tree=render({answer:{...original,sourceReview:'pending',provenance:[{title:'Rules2027',url:'https://www.formulastudent.de/rules.pdf',kind:'official',applicability:'current'}]}});const html=renderToStaticMarkup(tree);assert.match(html,/מקור רשמי/);assert.match(html,/ממתין לבדיקה מול המקורות/);assert.doesNotMatch(html,/Discord/)});
check('input object never mutated by rendering or editing',()=>{assert.equal(original.status,'unknown');assert.equal(original.value[0].part,'Known component');assert.equal(original.sourceReview,'confirmed')});
console.log(cases+' partial-answer visibility and status-preservation cases passed.');
