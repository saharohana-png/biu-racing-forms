import {answerContent,mergeAnswers} from './answer-merge';
import type {Answers,Pending,Snapshot} from './client-types';

function stable(value:unknown):string{if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stable(v)).join(',')+'}';return JSON.stringify(value)??'null';}
export function sameAnswer(a:Answers[string]|undefined,b:Answers[string]|undefined){return stable(answerContent(a))===stable(answerContent(b));}

/** Carry edits onto a newer server snapshot, retaining both sides of unresolved fields. */
export function rebaseDraft(base:Answers,local:Answers,server:Snapshot,forcedConflicts:string[]=[]){
 const merged=mergeAnswers(base,server.answers,local);
 const conflictFieldIds=[...new Set([...merged.conflictFieldIds,...forcedConflicts.filter(id=>!sameAnswer(local[id],server.answers[id]))])];
 const answers={...merged.answers};
 for(const id of conflictFieldIds)if(local[id])answers[id]=local[id];
 return {answers,conflictFieldIds};
}

/** Only changes made after the sent snapshot are replayed over its acknowledgement. */
export function rebaseAfterSave(sent:Pending,latest:Pending,server:Snapshot){
 return rebaseDraft(sent.answers,latest.answers,server,latest.conflictFieldIds);
}

export function resolveDraft(pending:Pending,server:Snapshot,choices:Record<string,'local'|'server'>):Answers{
 const merged=rebaseDraft(pending.baseAnswers??server.answers,pending.answers,server,pending.conflictFieldIds);
 for(const id of merged.conflictFieldIds){
  if(!choices[id])throw new Error('יש לבחור תשובה לכל שדה מתנגש.');
  if(choices[id]==='server'){
   if(server.answers[id])merged.answers[id]=server.answers[id];else delete merged.answers[id];
  }
 }
 return merged.answers;
}

export function pendingFromMerge(server:Snapshot,result:ReturnType<typeof rebaseDraft>,mutationId:string,attachments:Pending['attachments']=[]):Pending{
 return {answers:result.answers,baseRevision:server.revision,baseAnswers:server.answers,mutationId,updatedAt:new Date().toISOString(),...(result.conflictFieldIds.length?{conflictFieldIds:result.conflictFieldIds}:{}),...(attachments?.length?{attachments}: {})};
}

/** Mirror the upload link on conflict without losing file references in table cells. */
export function answersWithUpload(base:Answers,fieldId:string,attachmentId:string,replaces:string|undefined,columns:{id:string;kind?:string}[]=[],table=false):Answers{
 const prior=base[fieldId]??{status:'answered' as const,value:table?[]:''};
 const value=Array.isArray(prior.value)&&replaces?prior.value.map(row=>{
  const updated={...row};for(const column of columns)if(column.kind==='file'&&updated[column.id]===replaces)updated[column.id]=attachmentId;return updated;
 }):prior.value;
 return {...base,[fieldId]:{...prior,status:'answered',value,attachmentIds:[...(prior.attachmentIds??[]).filter(id=>id!==replaces&&id!==attachmentId),attachmentId]}};
}
