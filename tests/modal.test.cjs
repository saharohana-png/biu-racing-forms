const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const source=fs.readFileSync('components/racing/modal.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const doc={body:{style:{overflow:'auto'}},activeElement:null};
class Focusable{isConnected=true;focus(options){doc.activeElement=this;this.focusOptions=options;}}
class Dialog extends Focusable{open=false;showModal(){assert.equal(this.open,false);this.open=true;}close(){this.open=false;}}
let effects=[],sequence=0;
const exportsObject={};
const react={...React,useId:()=>`dialog-${++sequence}`,useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
vm.runInNewContext(compiled,{exports:exportsObject,document:doc,HTMLElement:Focusable,require(id){if(id==='react')return react;if(id==='react/jsx-runtime')return require(id);throw Error(id);}});
function mount(title){let closed=0;effects=[];const element=exportsObject.Modal({title,children:'body',onClose:()=>closed++});const dialog=new Dialog(),heading=new Focusable();element.props.ref.current=dialog;const header=element.props.children.props.children[0];header.props.children[0].props.ref.current=heading;const cleanup=effects[0]();return {element,dialog,heading,cleanup,header,get closed(){return closed;}};}
let cases=0;function check(name,test){try{test();cases++;}catch(error){error.message=name+': '+error.message;throw error;}}
const opener=new Focusable();doc.activeElement=opener;const first=mount('first');
check('native dialog opens, receives title focus and locks page',()=>{assert.equal(first.dialog.open,true);assert.equal(doc.activeElement,first.heading);assert.equal(doc.body.style.overflow,'hidden');assert.equal(first.element.props['aria-labelledby'],first.header.props.children[0].props.id);assert.equal(first.element.props['aria-modal'],'true');assert.equal(first.heading.focusOptions.preventScroll,true);});
const second=mount('second');
check('nested dialogs have unique accessible names',()=>assert.notEqual(first.element.props['aria-labelledby'],second.element.props['aria-labelledby']));
check('closing inner dialog retains lock and restores inner opener',()=>{second.cleanup();assert.equal(doc.body.style.overflow,'hidden');assert.equal(doc.activeElement,first.heading);assert.equal(second.dialog.open,false);});
check('release is safe when repeated and outer close restores original overflow',()=>{second.cleanup();assert.equal(doc.body.style.overflow,'hidden');first.cleanup();assert.equal(doc.body.style.overflow,'auto');assert.equal(doc.activeElement,opener);});
check('Escape cancels browser default and delegates one close',()=>{let prevented=0;first.element.props.onCancel({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(first.closed,1);});
check('drag starting inside does not close on backdrop release',()=>{first.element.props.onPointerDown({target:{},currentTarget:first.dialog});first.element.props.onClick({target:first.dialog,currentTarget:first.dialog});assert.equal(first.closed,1);});
check('a deliberate backdrop click closes once',()=>{first.element.props.onPointerDown({target:first.dialog,currentTarget:first.dialog});first.element.props.onClick({target:first.dialog,currentTarget:first.dialog});assert.equal(first.closed,2);});
check('close control cannot submit a parent form',()=>{assert.equal(first.header.props.children[1].props.type,'button');assert.equal(first.header.props.children[1].props['aria-label'],'סגירת first');});
console.log(cases+' modal focus, scroll-lock and dismissal cases passed.');
