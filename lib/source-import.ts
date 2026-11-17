import type { Answer,Answers,TableRow,SourceProvenance } from './progress';

export type ImportField={id:string;label:string;type?:string;kind?:string;options?:{value:string;label:string}[];columns?:{id:string;label?:string;type?:string;kind?:string;required?:boolean;options?:{value:string;label:string}[]}[]};
export type ImportMode='manual'|'weekly_empty_fill'|'editorial_revision';
export type ImportSystem={id:string;answers:Answers};
export type ImportBatch={version:1;batchId:string;systems:ImportSystem[]};
export type ImportFieldDecision={id:string;label:string;action:'import'|'add'|'replace'|'preserve';reason?:string;before?:Answer|null;after?:Answer;columns?:{id:string;label?:string;type?:string}[]};
export class SourceImportError extends Error {}
export function parseImportMode(value:unknown):ImportMode {if(value===undefined||value==='manual')return 'manual';if(value==='weekly_empty_fill'||value==='editorial_revision')return value;throw new SourceImportError('מצב הייבוא אינו נתמך.');}
function fail(message:string):never{throw new SourceImportError(message);}
function record(value:unknown,label:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' אינו במבנה תקין.');return value as Record<string,unknown>;}
function text(value:unknown,label:string,max:number,optional=false):string|undefined{if(value===undefined&&optional)return undefined;if(typeof value!=='string'||value.length>max||(!optional&&!value.trim()))fail(label+' חסר או ארוך מדי.');if(/[\u0000-\u0008\u000b-\u001f]/.test(value))fail(label+' כולל תווים שאינם נתמכים.');return value;}
function noContact(value:string){if(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)||/(?:טלפון|נייד|phone|mobile|whatsapp)\s*[:=]?\s*\+?[\d() -]{8,}/i.test(value))fail('קובץ הייבוא כולל פרטי קשר. יש להסיר פרטי קשר ושמות אנשים מהתוכן המשותף.');}
export function validateProvenance(value:unknown):SourceProvenance[]{
 if(!Array.isArray(value)||value.length<1||value.length>12)fail('לכל תשובה מיובאת נדרשים 1–12 מקורות.');
 return value.map((input,index)=>{const source=record(input,'מקור '+(index+1));const title=text(source.title,'כותרת המקור',300)!;const raw=text(source.url,'קישור המקור',2000)!;let url:URL;try{url=new URL(raw);}catch{fail('קישור מקור אינו תקין.');}
 const expectedKind:SourceProvenance['kind']|undefined=({'docs.google.com':'drive','drive.google.com':'drive','discord.com':'discord','www.formulastudent.de':'official','formulastudent.de':'official','docs.formula-ata.it':'official'} as Record<string,SourceProvenance['kind']>)[url!.hostname];
 if(url!.protocol!=='https:'||url!.username||url!.password||url!.port||!expectedKind)fail('קישורי מקורות חייבים להיות HTTPS באחד מאתרי המקורות המורשים.');
 if(source.kind!==expectedKind)fail('סוג המקור אינו תואם לקישור.');
 if(!['current','historical','uncertain'].includes(String(source.applicability)))fail('יש לציין אם המקור עדכני, היסטורי או דורש בירור.');
 const date=text(source.sourceDate,'תאריך המקור',40,true),excerpt=text(source.excerpt,'קטע מהמקור',2000,true);
 if(date&&(!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/.test(date)||!Number.isFinite(Date.parse(date))))fail('תאריך מקור צריך להיות תאריך ISO תקין.');
 noContact(title);if(excerpt)noContact(excerpt);
 return {title,url:raw,kind:source.kind as SourceProvenance['kind'],applicability:source.applicability as SourceProvenance['applicability'],...(date?{sourceDate:date}:{}),...(excerpt?{excerpt}:{})};
 });
}
export function validateBatchId(value:unknown):string {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(value))fail('מזהה חבילת המקורות חייב לכלול 8–80 אותיות לטיניות, ספרות, קו או קו תחתון.');return value;}
export function parseImportSystem(input:unknown,getFields:(id:string)=>ImportField[]|undefined):ImportSystem{
 const system=record(input,'מערכת');if(typeof system.id!=='string')fail('מזהה מערכת אינו נתמך בייבוא.');const fields=getFields(system.id);if(!fields)fail('מערכת לא מוכרת: '+system.id);
 const values=record(system.answers,'תשובות המערכת'),answers:Answers={};if(Object.keys(values).length===0)fail('אין תשובות במערכת '+system.id);
 for(const [id,inputAnswer]of Object.entries(values)){
  const field=fields.find(f=>f.id===id);if(!field)fail('שדה לא מוכר במערכת '+system.id+': '+id);const answer=record(inputAnswer,'תשובה');
  if(Object.keys(answer).some(key=>!['status','value','reason','dependency','provenance'].includes(key)))fail('תשובת ייבוא כוללת מאפיין לא נתמך: '+id);
  if(answer.status!=='answered'&&answer.status!=='unknown')fail('ייבוא מאפשר תשובה או טרם נקבע בלבד.');
  if(!Object.prototype.hasOwnProperty.call(answer,'value'))fail('ערך התשובה חסר בשדה '+id);
  const kind=field.type??field.kind;let value:string|TableRow[];
  if(Array.isArray(answer.value)){
   if(kind!=='table'||answer.value.length>200)fail('מבנה הטבלה אינו תואם לשדה '+id);const rowIds=new Set<string>();
   value=answer.value.map(raw=>{const row=record(raw,'שורה');if(typeof row._id!=='string'||!/^[\w-]{1,120}$/.test(row._id)||rowIds.has(row._id))fail('שורות ייבוא צריכות מזהים ייחודיים ויציבים.');rowIds.add(row._id);const clean:TableRow={_id:row._id};
    for(const [key,inputValue]of Object.entries(row)){if(key==='_id')continue;const column=field.columns?.find(c=>c.id===key);if(!column)fail('עמודה לא מוכרת בשדה '+id+': '+key);const cell=text(inputValue,'ערך בטבלה',10000,true)??'';noContact(cell);
     if((column.type??column.kind)==='file'&&cell!=='')fail('קובצי ראיה מועלים בנפרד; אין לייבא קישורים או מזהי קובץ לתא קובץ.');
     if(column.options?.length&&cell!==''&&!['טרם נקבע','TBD','N/A','לא רלוונטי'].includes(cell)&&!column.options.some(o=>o.value===cell))fail('ערך שאינו ברשימת הבחירה בעמודה '+key);clean[key]=cell;}
    return clean;});
  }else{value=text(answer.value,'ערך התשובה',50000,true)??'';noContact(value);if(kind==='table'&&value!=='')fail('שדה טבלה דורש שורות, לא טקסט.');if(kind==='table')value=[];}
  if(answer.status==='answered'&&typeof value==='string'&&['n/a','na','לא רלוונטי','not applicable','לא חל'].includes(value.trim().toLowerCase()))fail('אי־תחולה אינה מיובאת כתשובה מאושרת. יש לשמור טרם נקבע עם הסבר לבדיקה.');
  if(kind==='file'&&(answer.status!=='unknown'||value!==''))fail('שדה קובץ מיובא רק כטרם נקבע עם הסבר; את המקור יש להעלות בנפרד.');
  if(kind==='select'&&answer.status==='answered'&&typeof value==='string'&&!field.options?.some(o=>o.value===value))fail('ערך בחירה לא מוכר בשדה '+id);
  const reason=text(answer.reason,'נימוק',10000,true),dependency=text(answer.dependency,'תלות',1000,true);if(reason)noContact(reason);if(dependency)noContact(dependency);
  if(answer.status==='unknown'&&!reason?.trim())fail('טרם נקבע דורש הסבר על החוסר בשדה '+id);
  if(answer.status==='answered'&&(typeof value==='string'?!value.trim():!value.length))fail('תשובה מיובאת אינה יכולה להיות ריקה.');
  const provenance=validateProvenance(answer.provenance);answers[id]={status:answer.status,value,provenance,...(reason!==undefined?{reason}:{}),...(dependency!==undefined?{dependency}:{})};
 }
 return {id:system.id,answers};
}
export function parseImportBatch(input:unknown,getFields:(id:string)=>ImportField[]|undefined):ImportBatch{const batch=record(input,'חבילה');if(batch.version!==1)fail('גרסת חבילת המקורות אינה נתמכת.');const batchId=validateBatchId(batch.batchId);if(!Array.isArray(batch.systems)||batch.systems.length<1||batch.systems.length>23)fail('חבילת ייבוא יכולה לכלול עד 22 מערכות ואת טופס הרכז.');const seen=new Set<string>();const systems=batch.systems.map(inputSystem=>{const system=parseImportSystem(inputSystem,getFields);if(seen.has(system.id))fail('מערכת מופיעה יותר מפעם אחת בחבילה.');seen.add(system.id);return system;});return {version:1,batchId,systems};}
export function emptyAnswerDecision(answer:Answer|undefined,protectedReason?:string):{empty:boolean;reason?:string} {
 if(protectedReason)return {empty:false,reason:protectedReason};
 if(!answer)return {empty:true};
 if(answer.status!=='answered')return {empty:false,reason:'כבר נשמרה החלטת טרם נקבע או אי־תחולה.'};
 if(answer.attachmentIds?.length)return {empty:false,reason:'כבר מקושרים קבצים לשדה.'};
 if(answer.provenance?.length||answer.importedBatchId||answer.sourceReview)return {empty:false,reason:'כבר נשמרו מקור או החלטת אימות לשדה.'};
 if(answer.reason?.trim()||answer.dependency?.trim())return {empty:false,reason:'כבר נשמרו נימוק או תלות בשדה.'};
 if(Array.isArray(answer.value))return answer.value.length?{empty:false,reason:'כבר קיימת טבלה, גם אם חלק מהתאים ריקים.'}:{empty:true};
 return answer.value.trim()===''?{empty:true}:{empty:false,reason:'כבר נשמר תוכן בשדה.'};
}
export function answerIsTrulyEmpty(answer:Answer|undefined):boolean {return emptyAnswerDecision(answer).empty;}
function substantive(value:string):boolean {
 const normalized=value.trim().toLowerCase();
 return !!normalized.replace(/[\s\-–—_?.!…]/g,'')&&!['tbd','unknown','n/a','na','not applicable','טרם נקבע','לא ידוע','טרם הוחלט','לא רלוונטי','לא חל','אין מידע','לא נמצא מקור','להשלמה'].includes(normalized);
}
export function validateWeeklyImport(incoming:ImportSystem,fields:ImportField[]):void {
 if(incoming.id==='COORDINATOR')fail('טופס הרכז זמין לייבוא ידני או לעריכה מפורשת בלבד; הוא אינו חלק מהמילוי השבועי.');
 for(const [id,answer]of Object.entries(incoming.answers)){
  const field=fields.find(f=>f.id===id)!;
  if(answer.status!=='answered')fail('במילוי השבועי מוסיפים מידע מבוסס בלבד; אין ליצור תשובת טרם נקבע: '+id);
  if((field.type??field.kind)==='file')fail('המילוי השבועי אינו יוצר מצייני מקום לקבצים. יש להעלות מקור ממשי בנפרד: '+id);
  if(typeof answer.value==='string'){if(!substantive(answer.value))fail('המילוי השבועי דורש תוכן ממשי ולא מציין מקום: '+id);}
  else {
   const contentColumns=(field.columns??[]).filter(column=>(column.type??column.kind)!=='file');
   if(!answer.value.length||!contentColumns.length||answer.value.some(row=>!contentColumns.some(column=>substantive(row[column.id]??''))||contentColumns.some(column=>column.required!==false&&!substantive(row[column.id]??''))))fail('במילוי השבועי כל שורת טבלה צריכה לכלול מידע מבוסס בכל עמודות התוכן הנדרשות: '+id);
  }
 }
}
export function mergeSourceImport(existing:Answers,incoming:ImportSystem,batchId:string,fields:ImportField[],protectedFields:Record<string,string>={}){const answers={...existing};const decisions:ImportFieldDecision[]=[];for(const [id,answer]of Object.entries(incoming.answers)){const label=fields.find(f=>f.id===id)?.label??id,decision=emptyAnswerDecision(existing[id],protectedFields[id]);if(!decision.empty){decisions.push({id,label,action:'preserve',reason:decision.reason});continue;}answers[id]={...answer,sourceReview:'pending',importedBatchId:batchId};decisions.push({id,label,action:'import'});}return {answers,decisions,imported:decisions.filter(f=>f.action==='import').length,skipped:decisions.filter(f=>f.action==='preserve').length};}

function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stable(item)).join(',')+'}';return JSON.stringify(value)??'null';}
/** Explicit coordinator editing only. Empty-only import never calls this path. */
export function mergeEditorialImport(existing:Answers,incoming:ImportSystem,batchId:string,fields:ImportField[]){
 const answers={...existing},decisions:ImportFieldDecision[]=[];
 for(const [id,input]of Object.entries(incoming.answers)){
  const field=fields.find(item=>item.id===id)!,before=existing[id],columns=field.columns?.map(column=>({id:column.id,label:column.label,type:column.type??column.kind}));
  const decision={id,label:field.label,before:before??null,...(columns?{columns}:{})};
  const fileColumns=(field.columns??[]).filter(column=>(column.type??column.kind)==='file');
  const oldRows=Array.isArray(before?.value)?before.value:[],newRows=Array.isArray(input.value)?input.value:[];
  // A rewritten table may retain evidence only when the original row identity
  // is retained. Never silently reassign a file to a different engineering row.
  const evidenceRows=oldRows.filter(row=>fileColumns.some(column=>row[column.id]?.trim()));
  if(((field.type??field.kind)==='file'&&before?.attachmentIds?.length)||evidenceRows.some(row=>!newRows.some(next=>next._id===row._id))){
   decisions.push({...decision,action:'preserve',after:before,reason:'קיימות ראיות מקושרות. יש לערוך את השדה ידנית או לשמור את מזהי שורות הראיות המקוריות.'});continue;
  }
  const sources=[...new Map([...(before?.provenance??[]),...(input.provenance??[])].map(source=>[stable(source),source])).values()];
  if(sources.length>12)fail('העריכה בשדה '+id+' תחרוג מ־12 מקורות. יש לצמצם מקורות חדשים כפולים; המקורות הקיימים נשמרים.');
  const retainedIds=[...new Set([...(before?.attachmentIds??[]),...evidenceRows.flatMap(row=>fileColumns.map(column=>row[column.id]).filter(value=>value&&!['n/a','na','לא רלוונטי','לא חל'].includes(value.trim().toLowerCase())))])];
  const value=Array.isArray(input.value)?input.value.map(row=>{const next={...row},old=oldRows.find(prior=>prior._id===row._id);if(old)for(const column of fileColumns)if(old[column.id]?.trim())next[column.id]=old[column.id];return next;}):input.value;
  const updated:Answer={...input,value,provenance:sources,sourceReview:'pending',importedBatchId:batchId,...(before?.attachmentIds!==undefined||retainedIds.length?{attachmentIds:retainedIds}:{})};
  const comparable=(answer:Answer|undefined)=>answer?{status:answer.status,value:answer.value,reason:answer.reason??'',dependency:answer.dependency??'',attachmentIds:[...(answer.attachmentIds??[])].sort(),provenance:answer.provenance??[]}:null;
  if(stable(comparable(before))===stable(comparable(updated))){decisions.push({...decision,action:'preserve',after:before,reason:'התוכן והמקורות זהים לתשובה השמורה.'});continue;}
  answers[id]=updated;decisions.push({...decision,action:answerIsTrulyEmpty(before)?'add':'replace',after:updated});
 }
 return {answers,decisions,imported:decisions.filter(item=>item.action!=='preserve').length,skipped:decisions.filter(item=>item.action==='preserve').length};
}
