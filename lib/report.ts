import { getSystem } from './catalog';
import type { SystemSnapshot } from './progress';
import type { ReportLine } from './pdf';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const statuses:Record<string,string>={answered:'נענה',unknown:'טרם נקבע',na:'לא רלוונטי — כפוף לאישור',draft:'במילוי',in_review:'בבדיקה',changes_requested:'נדרש תיקון',approved:'אושר בבדיקה'};
export function makeReport(snapshots:SystemSnapshot[],createdAt:string){
  const lines:ReportLine[]=[{text:'BIU Racing | תיק החשמל 2027',title:true},{text:'ייצוא פרטי של התשובות והראיות כפי שנשמרו בשרת. נוצר: '+createdAt,small:true},{text:'תקנון התכן: Formula Student 2027 v1.0. תבניות ההגשה הממופות: ESF FEI2023 ו־ASES FS26. תבניות איטליה 2027 טרם אומתו. השלמת תיעוד אינה אישור הנדסי או אישור הגשה.'}];
  let body='';
  for(const snapshot of snapshots){
    const system=getSystem(snapshot.id)!;
    const progress=snapshot.progress;
    const fillSummary=`מילוי התיעוד: ${progress.filled} מתוך ${progress.total} שדות (${progress.fillPercent}%)`;
    const sourceTotal=progress.sourceConfirmed+progress.sourcePending;
    const sourceSummary=sourceTotal?`אימות מקורות: ${progress.sourceConfirmed} מתוך ${sourceTotal} תשובות מקור אומתו`:'אין תשובות מקור שממתינות לאימות';
    lines.push({text:system.label,title:true},{text:`גרסה ${snapshot.revision} | ${statuses[snapshot.status]??snapshot.status}`},{text:fillSummary},{text:sourceSummary},{text:`דרישות שהושלמו לאחר הבדיקות הנדרשות: ${progress.complete} מתוך ${progress.total}`,small:true});
    body+=`<section><h2>${esc(system.label)}</h2><p>גרסה ${snapshot.revision} · ${esc(statuses[snapshot.status]??snapshot.status)}</p><p>${esc(fillSummary)}</p><p>${esc(sourceSummary)}</p><p>דרישות שהושלמו לאחר הבדיקות הנדרשות: ${progress.complete} מתוך ${progress.total}</p>`;
    let section='';
    for(const field of system.fields){
      if(section!==field.section){section=field.section;lines.push({text:section,title:true});body+=`<h3>${esc(section)}</h3>`;}
      const answer=snapshot.answers[field.id];
      const label=field.label+(field.unit?' ('+field.unit+')':'');
      lines.push({text:label},{text:field.id,small:true});
      body+=`<article id="${esc(field.id)}"><h4>${esc(field.label)}${field.unit?` <bdi>(${esc(field.unit)})</bdi>`:''}</h4><p class="id" dir="ltr">${esc(field.id)}</p><p class="hint">${esc(field.prompt)}</p>`;
      if(!answer){lines.push({text:'טרם נענתה'});body+='<p>טרם נענתה</p>';}
      else {
        lines.push({text:statuses[answer.status]??answer.status});body+=`<p>${esc(statuses[answer.status]??answer.status)}</p>`;
        if(Array.isArray(answer.value)){
          body+='<div class="table-wrap"><table><thead><tr>'+ (field.columns??[]).map(c=>`<th>${esc(c.label)}${c.unit?` <bdi>(${esc(c.unit)})</bdi>`:''}</th>`).join('')+'</tr></thead><tbody>';
          for(const row of answer.value){lines.push({text:'שורה: '+row._id,small:true});body+='<tr>';for(const col of field.columns??[]){const value=row[col.id]??'';lines.push({text:col.label+(col.unit?' ('+col.unit+')':'')+': '+value});body+=`<td dir="auto">${esc(value)}</td>`;}body+='</tr>';}
          body+='</tbody></table></div>';
        }else{lines.push({text:answer.value||'ללא ערך טקסטואלי'});body+=`<p dir="auto" class="answer">${esc(answer.value)}</p>`;}
        for(const [label,value] of [['נימוק',answer.reason],['מידע חסר או מערכת תלויה',answer.dependency]])if(value){lines.push({text:label+': '+value});body+=`<p>${esc(label)}: ${esc(value)}</p>`;}
        if(answer.provenance?.length){const sourceStatus=answer.sourceReview==='confirmed'?'תוכן המקור אומת בידי הצוות; אינו אישור הנדסי':'תוכן מהמקורות — ממתין לאימות הצוות';lines.push({text:sourceStatus});body+=`<div class="source-provenance"><strong>${esc(sourceStatus)}</strong>`;for(const source of answer.provenance){const context=(source.kind==='official'?'מקור רשמי':source.kind==='drive'?'Drive':'Discord')+' · '+(source.applicability==='current'?'מקור עדכני':source.applicability==='historical'?'מקור היסטורי — לבדוק התאמה':'התאמה לעונה הנוכחית דורשת בירור')+(source.sourceDate?' · '+source.sourceDate:'');lines.push({text:'מקור: '+source.title,small:true},{text:context,small:true},{text:source.url,small:true});body+=`<p><a href="${esc(source.url)}">${esc(source.title)}</a><br><small>${esc(context)}</small></p>`;if(source.excerpt){lines.push({text:'קטע מהמקור: '+source.excerpt,small:true});body+=`<blockquote dir="auto">${esc(source.excerpt)}</blockquote>`;}}body+='</div>';}
        for(const id of answer.attachmentIds??[]){const file=snapshot.attachments.find(f=>f.id===id);if(file){const path=`files/${file.id}${file.safeName.match(/\.[A-Za-z0-9]+$/)?.[0]??'.bin'}`;lines.push({text:`קובץ מצורף: ${file.safeName} · גרסה ${file.version}`,small:true});body+=`<p><a href="${path}" dir="auto">${esc(file.safeName)}</a> · גרסת קובץ ${file.version}</p>`;}}
      }
      const missing=snapshot.progress.missing.find(m=>m.id===field.id);if(missing){lines.push({text:'להשלמה: '+missing.reason,small:true});body+=`<p class="missing">להשלמה: ${esc(missing.reason)}</p>`;}
      body+='</article>';
    }
    body+='</section>';
  }
  const html=`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BIU Racing | תיק החשמל 2027</title><style>body{font-family:Arial,sans-serif;color:#080e0d;max-width:980px;margin:40px auto;padding:0 24px;line-height:1.7}h1,h2,h3{color:#00523c}h2{border-bottom:2px solid #00523c;margin-top:48px}h4{margin-bottom:0}.id,.hint{color:#4b615b;font-size:13px}.answer{white-space:pre-wrap}.missing{color:#794b10}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bdcfc7;padding:8px;text-align:start}article{padding:14px 0;border-bottom:1px solid #e1e8e5}a{color:#00523c;overflow-wrap:anywhere}@media print{body{margin:16mm;font-size:10pt}article{break-inside:avoid}h2,h3,h4{break-after:avoid}}</style><h1>BIU Racing | תיק החשמל 2027</h1><p>ייצוא פרטי · ${esc(createdAt)}</p><p>תקנון התכן: 2027 v1.0. תבניות ESF FEI2023 ו־ASES FS26 — גרסת ההגשה לאיטליה 2027 טרם אומתה. השלמת תיעוד אינה אישור הנדסי או אישור הגשה.</p>${body}</html>`;
  return {html,lines};
}
