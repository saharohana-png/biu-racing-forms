import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import templatesData from '@/private-data/official-workbook-templates.json';
import guards from '@/data/ses-export-guards.json';
import {getFields} from './catalog';
import {canonical,type Answer} from './progress';
import type {OfficialWorkbookInput,OfficialWorkbookResult,OfficialWorkbookReport,OfficialFieldResult,OfficialCellStatus,OfficialCellWrite} from './official-workbooks';
type Template={filename:string;year:number;sha256:string;base64:string;sheets:{name:string;path:string;state:string;writableCells:string[];formulaCells:string[]}[]};
const template=(templatesData as unknown as {ses:Template}).ses;
const xmlEscape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const attr=(xml:string,key:string)=>new RegExp('(?:^|\\s)'+key+'="([^"]*)"').exec(xml)?.[1];
const hash=async(value:string|Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',(typeof value==='string'?new TextEncoder().encode(value):value) as BufferSource))].map(x=>x.toString(16).padStart(2,'0')).join('');
function point(ref:string){const m=/^([A-Z]{1,3})([1-9]\d*)$/.exec(ref);if(!m)return null;let col=0;for(const x of m[1])col=col*26+x.charCodeAt(0)-64;return {col,row:Number(m[2])};}
function within(ref:string,range:string){const p=point(ref),[a,b=a]=range.replace(/\$/g,'').split(':'),start=point(a),end=point(b);return !!p&&!!start&&!!end&&p.col>=start.col&&p.col<=end.col&&p.row>=start.row&&p.row<=end.row;}
const validNumber=(value:string)=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)&&Number.isFinite(Number(value))&&value.replace(/[^\d]/g,'').length<=15;
function validationStatus(blocks:string[],ref:string,value:string):'ok'|'invalid_value'|'manual_mapping'{
 for(const block of blocks)for(const match of block.matchAll(/<(?:\w+:)?dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?dataValidation>)/g)){
  const attrs=match[1],body=match[2]??'',ranges=(attr(attrs,'sqref')??/<(?:\w+:)?sqref>([^<]+)<\/(?:\w+:)?sqref>/.exec(body)?.[1]??'').split(/\s+/);
  if(!ranges.some(range=>within(ref,range)))continue;
  const type=attr(attrs,'type')??'none',operator=attr(attrs,'operator')??'between';
  if(type==='none')continue;
  const formula=(n:number)=>new RegExp('<(?:\\w+:)?formula'+n+'[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?formula'+n+'>').exec(body)?.[1]?.replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const f1=formula(1),f2=formula(2);
  if(type==='list'){
   if(!f1||!/^"[^"]*"$/.test(f1))return 'manual_mapping';
   if(!f1.slice(1,-1).split(',').includes(value))return 'invalid_value';
  }else if(['whole','decimal','textLength'].includes(type)){
   if(!f1||!validNumber(f1)||(f2&&!validNumber(f2)))return 'manual_mapping';
   const x=type==='textLength'?value.length:Number(value),a=Number(f1),b=Number(f2);
   if(type!=='textLength'&&(!validNumber(value)||type==='whole'&&!Number.isInteger(x)))return 'invalid_value';
   const valid:Record<string,boolean>={between:x>=a&&x<=b,notBetween:x<a||x>b,equal:x===a,notEqual:x!==a,lessThan:x<a,lessThanOrEqual:x<=a,greaterThan:x>a,greaterThanOrEqual:x>=a};
   if(!(operator in valid))return 'manual_mapping';if(!valid[operator])return 'invalid_value';
  }else return 'manual_mapping';
 }
 return 'ok';
}
const messages:Partial<Record<OfficialCellStatus,string>>={
 written:'תאי הקלט נכתבו, ללא שינוי נוסחאות, עיצוב או הגנות.',
 empty:'טרם נשמרה תשובה. ערכי תבנית אינם תשובות של הקבוצה.',
 out_of_scope:'לא התקבלה גרסת SES מורשית.',
 translation_pending:'ממתין לתרגום תואם לגרסה השמורה.',
 source_conflict:'התרגום או מבנה השורות אינם תואמים למקור.',
 evidence_required:'הראיה נשמרת בחבילת הקבצים; יש לשבץ אותה במקום המתאים ב־Excel.',
 protected:'כתובת מוגנת, נוסחה, תא שאינו עוגן מיזוג או יעד שאינו קלט מאומת.',
 invalid_value:'ערך או כתובת אינם תקינים, או שתא נבחר יותר מפעם אחת. הטבלה לא נכתבה חלקית.',
 manual_mapping:'אימות Excel תלוי בנוסחה או ברשימה דינמית; התא מחייב בדיקה ב־Excel.',
 unknown:'המידע טרם נקבע.',not_applicable:'אי־תחולה ממתינה לבדיקה.'
};
export async function buildSesWorkbook(input:OfficialWorkbookInput):Promise<OfficialWorkbookResult>{
 if(input.kind!=='ses')throw new Error('Wrong workbook adapter');
 const candidates=input.snapshots.filter(s=>s.id==='SES');if(candidates.length>1)throw new Error('Duplicate SES snapshot');
 const snapshot=candidates[0];if(snapshot&&(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<0))throw new Error('Invalid SES revision');
 const sourceHash=snapshot?await hash(canonical(snapshot.answers)):'';
 const translations=(input.translations??[]).filter(t=>t.systemId==='SES');if(translations.length>1)throw new Error('Duplicate SES translation');
 const translation=translations[0],current=!!snapshot&&translation?.isCurrent&&translation.sourceRevision===snapshot.revision&&translation.sourceHash===sourceHash;
 const original=Uint8Array.from(atob(template.base64),c=>c.charCodeAt(0));if(await hash(original)!==template.sha256)throw new Error('SES template checksum mismatch');
 const parts=unzipSync(original),generatedAt=input.generatedAt??new Date().toISOString();if(!Number.isFinite(Date.parse(generatedAt)))throw new Error('Invalid workbook date');
 const report:OfficialWorkbookReport={format:'BIU-OFFICIAL-WORKBOOK-DRAFT',version:1,kind:'ses',workingSeason:2027,generatedAt,readyForSubmission:false,
 template:{filename:template.filename,year:template.year,sha256:template.sha256,submission2027Verified:false},
 sourceSnapshots:snapshot?[{systemId:'SES',revision:snapshot.revision,sourceHash}]:[],projectMetadata:[],fields:[],writtenCells:[],clearedTemplateValues:[],preservedTemplateValues:[],unmappedSourceFields:[],changedParts:[],formulaResults:'not_calculated_open_in_excel',
 warnings:['תבנית Italy SES 2026 v1.3; קבלה לעונת 2027 טרם אומתה.','שיוך האחריות לצוותי מכניקה הוא הצעה שטרם אושרה.','ערכי תבנית שלא הוחלפו נשמרים כערכי תבנית, ואינם תשובות או אישור של BIU.','יש לפתוח ב־Excel 2021 ומעלה לחישוב נוסחאות, אימות תלוי נוסחה ושיבוץ ראיות.']};
 const patches=new Map<string,Map<string,OfficialCellWrite>>();
 for(const field of getFields('SES')){
  const mapping=(field as unknown as {officialTemplate:{sheet:string;editableRanges:string[]}}).officialTemplate;
  const sheet=template.sheets.find(s=>s.name===mapping.sheet),guard=guards.find(g=>g.sheet===mapping.sheet);
  const result:OfficialFieldResult={controlId:field.id,systemId:'SES',fieldId:field.id,sheet:mapping.sheet,ranges:mapping.editableRanges,status:'empty',message:'',writtenCells:[],sourceRevision:snapshot?.revision};
  const finish=(status:OfficialCellStatus)=>{result.status=status;result.message=messages[status]??status;report.fields.push(result);};
  if(!snapshot){finish('out_of_scope');continue;}
  const answer=snapshot.answers[field.id];
  if(!answer){finish('empty');continue;}
  if(field.kind==='file'){finish('evidence_required');continue;}
  if(answer.status==='unknown'){finish('unknown');continue;}if(answer.status==='na'){finish('not_applicable');continue;}
  if(!Array.isArray(answer.value)||!answer.value.length){finish('empty');continue;}
  let english:Answer=answer;
  if(/[\u0590-\u05ff]/.test(canonical(answer.value))){
   if(!current||translation.fieldStates[field.id]!=='ready'){finish('translation_pending');continue;}
   const translated=translation.englishAnswers[field.id];
   if(!translated||!Array.isArray(translated.value)||translated.value.length!==answer.value.length||answer.value.some((row,i)=>row._id!==(translated.value as Record<string,string>[])[i]._id||canonical(Object.keys(row).sort())!==canonical(Object.keys((translated.value as Record<string,string>[])[i]).sort()))){finish('source_conflict');continue;}
   english=translated;
  }
  if(!sheet||!guard)throw new Error('SES sheet mapping missing');
  const xml=strFromU8(parts[sheet.path]),cellMap=new Map<string,{attributes:string;body:string}>();
  for(const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const ref=attr(match[1],'r');if(ref)cellMap.set(ref,{attributes:match[1],body:match[2]??''});}
  const writes:OfficialCellWrite[]=[],seen=new Set<string>(),already=patches.get(sheet.path)??new Map();
  let failure:OfficialCellStatus|undefined;
  for(let index=0;index<answer.value.length;index++){
   const source=answer.value[index],row=(english.value as Record<string,string>[])[index];
   const ref=(source[field.id+'-CELL']??'').trim().toUpperCase(),value=(row[field.id+'-VALUE']??'').trim(),cell=cellMap.get(ref);
   if(!point(ref)||!value||value.length>32767||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0590-\u05ff]/.test(value)||seen.has(ref)||already.has(ref)){failure='invalid_value';break;}
   seen.add(ref);
   if(row[field.id+'-CELL']!==source[field.id+'-CELL']){failure='source_conflict';break;}
   if(!cell||!sheet.writableCells.includes(ref)||!guard.editableRanges.some(range=>within(ref,range))||/<f\b/.test(cell.body)||guard.formulaCellsInsideEditableRanges.includes(ref)||guard.mergedRanges.some(range=>within(ref,range)&&range.split(':')[0]!==ref)){failure='protected';break;}
   const validation=validationStatus(guard.rawDataValidationBlocks,ref,value);if(validation!=='ok'){failure=validation;break;}
   writes.push({sheet:sheet.name,cell:ref,type:validNumber(value)?'number':'text',value,systemId:'SES',fieldId:field.id,rowId:source._id,sourceRevision:snapshot.revision,sourceHash,controlId:field.id});
  }
  if(failure){finish(failure);continue;}
  for(const write of writes)already.set(write.cell,write);patches.set(sheet.path,already);report.writtenCells.push(...writes);result.writtenCells=writes.map(w=>w.cell);result.rowIds=writes.map(w=>w.rowId??'');finish('written');
 }
 for(const [path,writes]of patches){
  const xml=strFromU8(parts[path]);let count=0;
  parts[path]=strToU8(xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(all,attributes:string,body='')=>{
   const ref=attr(attributes,'r'),write=ref?writes.get(ref):undefined;if(!write)return all;count++;
   const attrs=attributes.replace(/\s+t="[^"]*"/g,'').replace(/\s*\/$/,'');
   const extra=body.replace(/<v\b[^>]*>[\s\S]*?<\/v>|<v\b[^>]*\/>|<is\b[^>]*>[\s\S]*?<\/is>|<is\b[^>]*\/>/g,'');
   return write.type==='number'?`<c${attrs}><v>${xmlEscape(write.value)}</v>${extra}</c>`:`<c${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(write.value)}</t></is>${extra}</c>`;
  }));if(count!==writes.size)throw new Error('Missing SES target');report.changedParts.push(path);
 }
 const workbook=strFromU8(parts['xl/workbook.xml']);
 const recalc=(attributes:string)=>`<calcPr${attributes.replace(/\s+(?:fullCalcOnLoad|forceFullCalc|calcMode)="[^"]*"/g,'').replace(/\s*\/$/,'')} fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>`;
 parts['xl/workbook.xml']=strToU8(/<calcPr\b/.test(workbook)?workbook.replace(/<calcPr\b([^>]*?)(?:\/>|>[\s\S]*?<\/calcPr>)/,(_,a)=>recalc(a)):workbook.replace('</workbook>',recalc('')+'</workbook>'));
 report.changedParts.push('xl/workbook.xml');
 return {bytes:zipSync(parts,{level:6}),filename:'BIU_Racing_2027_SES_WORKING_DRAFT_template_2026.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',report,sheets:template.sheets.map((s,index)=>({name:s.name,index,state:s.state}))};
}
