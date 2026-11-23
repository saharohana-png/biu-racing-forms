import assert from 'node:assert/strict';
import {computeProgress,fingerprint} from '../lib/progress.ts';
const fields=[{id:'voltage',label:'מתח',type:'text',required:true},{id:'failure',label:'תקלה',type:'select',required:true},{id:'evidence',label:'ראיה',type:'file',required:true}];
const file={id:'original',fieldId:'evidence',state:'complete'};
const answers={voltage:{status:'answered',value:'0'},failure:{status:'answered',value:'לא'},evidence:{status:'answered',value:'',attachmentIds:['original']}};
assert.equal(computeProgress(fields,answers,[file]).percent,100,'Zero and no are valid answers');
assert.equal(computeProgress(fields,answers,[{...file,state:'uploading'}]).complete,2,'Incomplete upload never counts');
assert.equal(computeProgress(fields,{...answers,voltage:{status:'unknown',value:'24'}} ,[file]).complete,2,'Unknown never counts');
assert.equal(computeProgress(fields,{...answers,voltage:{status:'answered',value:'טרם נקבע'}} ,[file]).complete,2,'Unknown words cannot bypass status');
const na={status:'na',value:'',reason:'המערכת אינה מוזנת בנפרד'};
assert.equal(computeProgress(fields,{...answers,voltage:na},[file]).complete,2,'N/A requires engineering approval');
const approved={fields:{voltage:{fingerprint:fingerprint(na),verdict:'approved',reason:'נבדק',role:'reviewer',at:'2026-10-30'}}};
assert.equal(computeProgress(fields,{...answers,voltage:na},[file],approved).percent,100,'Exact N/A approval counts');
assert.equal(computeProgress(fields,{...answers,voltage:{...na,reason:'נימוק חדש'}},[file],approved).complete,2,'Edited N/A invalidates old review');
const requested={fields:{voltage:{fingerprint:fingerprint(answers.voltage),verdict:'changes_requested',reason:'נדרש מקור',role:'reviewer',at:'2026-10-30'}}};
assert.equal(computeProgress(fields,answers,[file],requested).complete,2,'Change request lowers progress');
assert.equal(computeProgress([...fields,...fields],answers,[file]).total,3,'Duplicate official mappings counted once');
const many=Array.from({length:201},(_,i)=>({id:'f'+i,label:'field'+i,type:'text'}));
const almost=Object.fromEntries(many.slice(1).map(f=>[f.id,{status:'answered',value:'0'}]));
assert.equal(computeProgress(many,almost).percent,99,'Missing requirement never rounds to 100');
const table=[{id:'tests',label:'בדיקות',type:'table',columns:[{id:'result'},{id:'proof',type:'file'}],attachmentRequired:true}];
const tableAnswer={status:'answered',value:[{_id:'row-1',result:'עבר',proof:'test-file'}],attachmentIds:['test-file']};
assert.equal(computeProgress(table,{tests:tableAnswer},[{id:'test-file',fieldId:'tests',state:'complete'}]).percent,100,'Linked completed row evidence counts');
assert.equal(computeProgress(table,{tests:{...tableAnswer,value:[{_id:'row-1',result:'עבר',proof:'filename.pdf'}]}},[{id:'test-file',fieldId:'tests',state:'complete'}]).percent,0,'Arbitrary filename is not uploaded evidence');
const tableNa={...tableAnswer,value:[{_id:'row-1',result:'N/A',proof:'test-file'}],reason:'בדיקה זו אינה חלה על הגרסה'};
assert.equal(computeProgress(table,{tests:tableNa},[{id:'test-file',fieldId:'tests',state:'complete'}]).percent,0,'Table N/A needs review');
const tableApproved={fields:{tests:{fingerprint:fingerprint(tableNa),verdict:'approved',reason:'נבדק'}}};
assert.equal(computeProgress(table,{tests:tableNa},[{id:'test-file',fieldId:'tests',state:'complete'}],tableApproved).percent,100,'Reviewed explained table N/A counts');
assert.equal(computeProgress([{id:'conditional',label:'שאלת תחולה',condition:'אם נדרש'}],{}).percent,0,'Unresolved condition blocks completion');
const noEvidence={status:'answered',value:[{_id:'row-1',result:'עבר',proof:'N/A'}],reason:'אין קובץ נדרש לבדיקה זו'};
assert.equal(computeProgress(table,{tests:noEvidence},[],{fields:{tests:{fingerprint:fingerprint(noEvidence),verdict:'approved',reason:'נבדק'}}}).percent,100,'Reviewed row-file N/A does not require an irrelevant upload');
const provenance=[{title:'מקור מערכת',url:'https://drive.google.com/file/d/source/view',kind:'drive',applicability:'current'}];
const pending={status:'answered',value:'24 V',provenance,sourceReview:'pending'};
const textField=[fields[0]],fileField=[fields[2]];
const pendingText=computeProgress(textField,{voltage:pending});
assert.deepEqual(
  {filled:pendingText.filled,fillPercent:pendingText.fillPercent,complete:pendingText.complete,percent:pendingText.percent,sourcePending:pendingText.sourcePending,sourceConfirmed:pendingText.sourceConfirmed},
  {filled:1,fillPercent:100,complete:0,percent:0,sourcePending:1,sourceConfirmed:0},
  'Complete pending source text is filled, but not formally complete');
assert.deepEqual(pendingText.missing,[{id:'voltage',label:'מתח',reason:'תוכן מהמקורות: ממתין לאימות הצוות'}],'Existing pending missing reason is preserved');
const partialUnknown={...pending,status:'unknown',reason:'חסר המתח המרבי'};
const unknownPending=computeProgress(textField,{voltage:partialUnknown});
assert.deepEqual(
  [unknownPending.filled,unknownPending.complete,unknownPending.missing[0].reason],
  [0,0,'טרם נקבע: חסר המתח המרבי; תוכן מהמקורות: ממתין לאימות הצוות'],
  'An unanswered design requirement and pending source verification remain visible together');
assert.equal(computeProgress(textField,{voltage:{...pending,value:''}}).filled,0,'Provenance without an answer is not filled');
const pendingFile={...answers.evidence,provenance,sourceReview:'pending'};
const missingFile=computeProgress(fileField,{evidence:pendingFile});
assert.deepEqual(
  [missingFile.filled,missingFile.complete,missingFile.missing[0].reason],
  [0,0,'חסר קובץ שהעלאתו הושלמה; תוכן מהמקורות: ממתין לאימות הצוות'],
  'Pending source verification does not conceal a required missing upload');
assert.equal(computeProgress(fileField,{evidence:pendingFile},[{...file,state:'uploading'}]).filled,0,'Uploading evidence is not filled');
const uploaded=computeProgress(fileField,{evidence:pendingFile},[file]);
assert.deepEqual([uploaded.filled,uploaded.complete,uploaded.fillPercent,uploaded.percent],[1,0,100,0],'Completed pending original counts as filled only');
const openFile=computeProgress(fileField,{evidence:{...pendingFile,status:'unknown',reason:'חסר אישור הגרסה'}},[file]);
assert.deepEqual([openFile.filled,openFile.complete],[0,0],'A saved source attached to an unknown file field does not complete it');
const pendingTable={...tableAnswer,provenance,sourceReview:'pending'};
const tableFile={id:'test-file',fieldId:'tests',state:'complete'};
assert.equal(computeProgress(table,{tests:{...pendingTable,value:[{_id:'row-1',result:'',proof:'test-file'}]}},[tableFile]).filled,0,'Pending table with a required blank cell is not filled');
assert.deepEqual(
  [computeProgress(table,{tests:pendingTable},[tableFile]).filled,computeProgress(table,{tests:pendingTable},[tableFile]).complete],
  [1,0],'Complete pending table and evidence count as filled only');
const pendingChanges={fields:{voltage:{fingerprint:fingerprint(pending),verdict:'changes_requested',reason:'יש לתקן',role:'reviewer',at:'2026-10-30'}}};
const needsChange=computeProgress(textField,{voltage:pending},[],pendingChanges);
assert.deepEqual([needsChange.filled,needsChange.complete,needsChange.missing[0].reason],[0,0,'נדרש תיקון: יש לתקן; תוכן מהמקורות: ממתין לאימות הצוות'],'Pending source verification does not conceal an engineering change request');
const confirmed={...pending,sourceReview:'confirmed'};
const confirmedProgress=computeProgress(textField,{voltage:confirmed});
assert.deepEqual([confirmedProgress.filled,confirmedProgress.complete,confirmedProgress.sourceConfirmed,confirmedProgress.sourcePending],[1,1,1,0],'Source confirmation keeps fill and increases formal completion');
const confirmedUnknown=computeProgress(textField,{voltage:{...partialUnknown,sourceReview:'confirmed'}});
assert.deepEqual([confirmedUnknown.filled,confirmedUnknown.complete,confirmedUnknown.sourceConfirmed],[0,0,1],'Confirmed source may still contain unknown content; confirmation is a separate count');
assert.equal(confirmedUnknown.missing[0].reason,'טרם נקבע: חסר המתח המרבי','Confirming the source removes only its pending message, not the unanswered requirement');
assert.equal(computeProgress(textField,{voltage:{...na,provenance,sourceReview:'pending'}}).filled,0,'Pending N/A still needs current engineering review to count as filled');
assert.equal(computeProgress([...many,...many],almost).fillPercent,99,'Fill percentage deduplicates fields and never rounds a gap to100');
assert.deepEqual(
  {filled:computeProgress([],{}).filled,fillPercent:computeProgress([],{}).fillPercent,sourceConfirmed:computeProgress([],{}).sourceConfirmed},
  {filled:0,fillPercent:0,sourceConfirmed:0},'No requirements yields zero fill and source confirmation');
const before=structuredClone({pending,tableAnswer,provenance});
computeProgress(textField,{voltage:pending});computeProgress(table,{tests:{...tableAnswer,provenance,sourceReview:'pending'}},[tableFile]);
assert.deepEqual({pending,tableAnswer,provenance},before,'Progress does not mutate answers, rows or provenance');
console.log('Progress acceptance cases passed.');
