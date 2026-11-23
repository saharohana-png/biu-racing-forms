export type TableRow = { _id: string; [columnId: string]: string };
export type SourceProvenance={title:string;url:string;sourceDate?:string;excerpt?:string;kind:'drive'|'discord'|'official';applicability:'current'|'historical'|'uncertain'};
export type Answer = { status: 'answered'|'unknown'|'na'; value: string|TableRow[]; reason?: string; dependency?: string; attachmentIds?: string[]; provenance?:SourceProvenance[];sourceReview?:'pending'|'confirmed';importedBatchId?:string };
export type Answers = Record<string,Answer>;
export type Attachment = { id:string; systemId:string; fieldId:string; originalName:string; safeName:string; mime:string; size:number; sha256:string; state:string; replacesId:string|null; version:number; createdAt:string };
export type ReviewField = { fingerprint:string; verdict:'approved'|'changes_requested'; reason:string; role:string; at:string };
export type Review = { fields?:Record<string,ReviewField>; submittedRevision?:number; submittedAt?:string };
export type Progress = { complete:number; total:number; percent:number; filled:number;fillPercent:number;populated:number;sourcePending:number;sourceConfirmed:number; missing:{id:string;label:string;reason:string}[] };
export type SystemSnapshot = { id:string; answers:Answers; revision:number; status:'draft'|'in_review'|'changes_requested'|'approved'; attachments:Attachment[]; progress:Progress; updatedAt:string|null; review:Review; schemaVersion:string; contentHash?:string };
export type ProgressField = {id:string;label:string;required?:boolean;type?:string;kind?:string;attachmentRequired?:boolean;columns?:{id:string;required?:boolean;kind?:string;type?:string;attachmentRequired?:boolean}[];condition?:unknown};
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
export function fingerprint(answer:Answer|undefined):string {return canonical(answer ?? null);}
export function isUnknown(value:unknown):boolean {return typeof value==='string'&&['tbd','unknown','טרם נקבע','לא ידוע','טרם הוחלט'].includes(value.trim().toLowerCase());}
export function isNotApplicable(value:unknown):boolean {return typeof value==='string'&&['n/a','na','לא רלוונטי','not applicable','לא חל'].includes(value.trim().toLowerCase());}
export function referencedAttachmentIds(fields:ProgressField[],answers:Answers):Set<string> {
  const ids=new Set<string>();
  for(const answer of Object.values(answers))for(const id of answer.attachmentIds??[])if(id)ids.add(id);
  for(const field of fields){
    const answer=answers[field.id];if(!answer||!Array.isArray(answer.value))continue;
    const columns=field.columns?.filter(column=>column.type==='file'||column.kind==='file'||column.attachmentRequired)??[];
    for(const row of answer.value)for(const column of columns){const id=row[column.id];if(id&&!isUnknown(id)&&!isNotApplicable(id))ids.add(id);}
  }
  return ids;
}
export function computeProgress(fields:ProgressField[],answers:Answers,attachments:Attachment[]=[],review:Review={}):Progress {
  const unique = [...new Map(fields.filter(f=>f.required!==false).map(f=>[f.id,f])).values()];
  const missing:Progress['missing']=[];
  let filled=0;
  for(const field of unique){
    const answer=answers[field.id]; const inspected=review.fields?.[field.id];
    const currentReview=inspected?.fingerprint===fingerprint(answer)?inspected:undefined;
    let reason='';
    if(currentReview?.verdict==='changes_requested') reason='נדרש תיקון: '+currentReview.reason;
    else if(!answer) reason=field.condition?'טרם הוכרעה שאלת התחולה':'טרם נענתה';
    else if(answer.status==='unknown'||isUnknown(answer.value)) reason=answer.reason?.trim()?'טרם נקבע: '+answer.reason:'טרם נקבע';
    else if(answer.status==='na'||isNotApplicable(answer.value)) {
      if(!answer.reason?.trim()) reason='לא רלוונטי — חסר נימוק';
      else if(currentReview?.verdict!=='approved') reason='לא רלוונטי — ממתין לאישור בודק';
    } else {
      const kind=field.type ?? field.kind;
      if(kind==='table') {
        if(!Array.isArray(answer.value)||answer.value.length===0) reason='חסרה שורה מלאה';
        else if(answer.value.some(row=>!row._id || field.columns?.some(col=>col.required!==false && String(row[col.id]??'').trim()===''))) reason='חסרים נתונים בשורות הטבלה';
        else if(answer.value.some(row=>field.columns?.some(col=>col.required!==false&&isUnknown(row[col.id])))) reason='בטבלה יש נתון שטרם נקבע';
        else if(answer.value.some(row=>field.columns?.some(col=>col.required!==false&&isNotApplicable(row[col.id])))&&(!answer.reason?.trim()||currentReview?.verdict!=='approved')) reason='אי־תחולה בטבלה דורשת נימוק לשורות המתאימות ואישור בודק';
        else if(answer.value.some(row=>field.columns?.some(col=>(col.type==='file'||col.kind==='file'||col.attachmentRequired)&&!isNotApplicable(row[col.id])&&!(answer.attachmentIds??[]).includes(row[col.id])))) reason='יש לקשר קובץ ראיה שהעלאתו הסתיימה לכל שורה נדרשת';
        else if(answer.value.some(row=>field.columns?.some(col=>(col.type==='file'||col.kind==='file'||col.attachmentRequired)&&!isNotApplicable(row[col.id])&&!attachments.some(a=>a.id===row[col.id]&&a.fieldId===field.id&&a.state==='complete')))) reason='קובץ ראיה באחת השורות טרם הועלה בהצלחה';
      } else if(kind!=='file' && (typeof answer.value!=='string'||answer.value.trim()==='')) reason='חסרה תשובה';
      const fileColumns=field.columns?.filter(col=>col.type==='file'||col.kind==='file'||col.attachmentRequired)??[];
      const tableNeedsFile=kind==='table'&&fileColumns.length>0&&Array.isArray(answer.value)?answer.value.some(row=>fileColumns.some(col=>!isNotApplicable(row[col.id]))):true;
      if((kind==='file'||(field.attachmentRequired&&tableNeedsFile))&&!(answer.attachmentIds??[]).some(id=>attachments.some(a=>a.id===id&&a.fieldId===field.id&&a.state==='complete'))) reason='חסר קובץ שהעלאתו הושלמה';
    }
    // Assess the same content and evidence requirements once. Source verification
    // affects formal completion, while filled tracks usable documentation.
    if(!reason)filled++;
    if(answer?.sourceReview==='pending') {
      const sourceReason='תוכן מהמקורות: ממתין לאימות הצוות';
      reason=reason?`${reason}; ${sourceReason}`:sourceReason;
    }
    if(reason) missing.push({id:field.id,label:field.label,reason});
  }
  const total=unique.length,complete=total-missing.length;
  const populated=unique.filter(field=>{const a=answers[field.id];return a&&(a.provenance?.length||a.reason?.trim()||a.attachmentIds?.length||(typeof a.value==='string'?a.value.trim():a.value.length));}).length;
  const sourcePending=unique.filter(field=>answers[field.id]?.sourceReview==='pending').length;
  const sourceConfirmed=unique.filter(field=>answers[field.id]?.sourceReview==='confirmed'&&answers[field.id].provenance?.length).length;
  const percentage=(count:number)=>total===0?0:count===total?100:Math.min(99,Math.floor(count*100/total));
  return {complete,total,filled,fillPercent:percentage(filled),populated,sourcePending,sourceConfirmed,percent:percentage(complete),missing};
}
