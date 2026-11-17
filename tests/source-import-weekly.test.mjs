import assert from 'node:assert/strict';
import {parseImportMode,parseImportSystem,validateWeeklyImport,emptyAnswerDecision,mergeSourceImport} from '../lib/source-import.ts';
const source={title:'מפרט רכיב',url:'https://drive.google.com/file/d/source/view',kind:'drive',applicability:'current'};
const fields=[{id:'text',label:'תפקיד',type:'text'},{id:'file',label:'סכמה',type:'file'},{id:'table',label:'טבלה',type:'table',columns:[{id:'part',type:'text',required:true},{id:'value',type:'text',required:true},{id:'optional',type:'text',required:false},{id:'proof',type:'file',required:true}]}];
const answer=value=>({status:'answered',value,provenance:[source]});
const incoming=(id,value)=>parseImportSystem({id:'TSAL',answers:{[id]:answer(value)}},()=>fields);
let count=0;const test=(name,fn)=>{try{fn();count++;}catch(error){error.message=name+': '+error.message;throw error;}};
test('manual remains the omitted-mode API default',()=>assert.equal(parseImportMode(undefined),'manual'));
test('weekly mode accepted',()=>assert.equal(parseImportMode('weekly_empty_fill'),'weekly_empty_fill'));
test('unknown mode rejected',()=>assert.throws(()=>parseImportMode('weekly')));
for(const value of ['TBD','Unknown','טרם נקבע','לא ידוע','טרם הוחלט','אין מידע','לא נמצא מקור','להשלמה','—','???','...'])test('placeholder rejected '+value,()=>assert.throws(()=>validateWeeklyImport(incoming('text',value),fields)));
for(const value of ['0','לא','24 V','GND','600 VDC / 4.2 V per cell','https://docs.google.com/document/d/source/edit'])test('substantive engineering text accepted '+value,()=>assert.doesNotThrow(()=>validateWeeklyImport(incoming('text',value),fields)));
test('manual unknown notes remain valid',()=>assert.doesNotThrow(()=>parseImportSystem({id:'TSAL',answers:{text:{...answer(''),status:'unknown',reason:'נדרש מפרט עדכני'}}},()=>fields)));
test('weekly unknown scaffolds rejected',()=>assert.throws(()=>validateWeeklyImport(parseImportSystem({id:'TSAL',answers:{text:{...answer(''),status:'unknown',reason:'נדרש מפרט עדכני'}}},()=>fields),fields)));
test('weekly file scaffolds rejected',()=>assert.throws(()=>validateWeeklyImport(parseImportSystem({id:'TSAL',answers:{file:{...answer(''),status:'unknown',reason:'נדרש מקור ממשי'}}},()=>fields),fields)));
for(const row of [{_id:'one'},{_id:'one',part:'R1'},{_id:'one',part:'R1',value:'TBD'},{_id:'one',part:'?',value:'—'}])test('incomplete table rejected '+JSON.stringify(row),()=>assert.throws(()=>validateWeeklyImport(incoming('table',[row]),fields)));
test('complete table content permits separately uploaded evidence',()=>assert.doesNotThrow(()=>validateWeeklyImport(incoming('table',[{_id:'one',part:'R1',value:'0',proof:''}]),fields)));
for(const existing of [
 {status:'unknown',value:''},{status:'na',value:''},{status:'answered',value:'0'},
 {status:'answered',value:'לא'},{status:'answered',value:[{_id:'one'}]},
 {status:'answered',value:[{_id:'one',part:'',value:''}]},
 {status:'answered',value:'',reason:'נימוק קיים'},{status:'answered',value:'',dependency:'דרושה מערכת נוספת'},
 {status:'answered',value:'',attachmentIds:['old']},{status:'answered',value:'',provenance:[source]},
 {status:'answered',value:'',sourceReview:'pending'},{status:'answered',value:'',sourceReview:'confirmed'},
 {status:'answered',value:'',importedBatchId:'prior_batch'},
])test('all existing decisions and partial content preserved '+JSON.stringify(existing),()=>{
 assert.equal(emptyAnswerDecision(existing).empty,false);
 const result=mergeSourceImport({text:existing},incoming('text','מידע חדש'),'weekly_test',fields);
 assert.equal(result.imported,0);assert.equal(result.skipped,1);assert.deepEqual(result.answers.text,existing);
});
for(const existing of [undefined,{status:'answered',value:' \n '},{status:'answered',value:[]}])test('truly blank permitted '+JSON.stringify(existing),()=>assert.equal(emptyAnswerDecision(existing).empty,true));
for(const reason of ['קיימת החלטת בדיקה','קיימת גרסת קובץ'])test('external evidence protects absent answer '+reason,()=>{
 const result=mergeSourceImport({},incoming('text','מידע חדש'),'weekly_test',fields,{text:reason});
 assert.equal(result.imported,0);assert.equal(result.decisions[0].reason,reason);assert.deepEqual(result.answers,{});
});
test('successful weekly input remains pending source review',()=>{
 const result=mergeSourceImport({},incoming('text','תיאור מערכת'),'weekly_test',fields);
 assert.equal(result.answers.text.sourceReview,'pending');assert.equal(result.answers.text.importedBatchId,'weekly_test');assert.deepEqual(result.answers.text.provenance,[source]);
});
console.log(count+' weekly import substantive-content/preservation cases passed.');
