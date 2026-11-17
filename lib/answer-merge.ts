import type {Answer,Answers} from './progress';

function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value)??'null';
}

/** Only user-editable content participates in a concurrent-edit conflict. */
export function answerContent(answer:Answer|undefined):unknown {
  if(!answer)return null;
  return {status:answer.status,value:answer.value,reason:answer.reason??'',dependency:answer.dependency??'',attachmentIds:[...new Set(answer.attachmentIds??[])].sort()};
}
function equal(a:Answer|undefined,b:Answer|undefined){return canonical(answerContent(a))===canonical(answerContent(b));}

export function mergeAnswers(base:Answers,current:Answers,incoming:Answers):{answers:Answers;conflictFieldIds:string[];changedFieldIds:string[]} {
  const answers:Answers={...current},conflictFieldIds:string[]=[],changedFieldIds:string[]=[];
  for(const id of new Set([...Object.keys(base),...Object.keys(current),...Object.keys(incoming)])){
    const before=base[id],remote=current[id];
    // Omitted fields are retained. Clearing content requires an explicit answer;
    // omitted attachment metadata likewise cannot silently detach an original.
    const raw=incoming[id]??before;
    const local=raw&&raw.attachmentIds===undefined&&before?.attachmentIds?{...raw,attachmentIds:before.attachmentIds}:raw;
    if(equal(local,before)||equal(local,remote))continue;
    if(!equal(remote,before)){conflictFieldIds.push(id);continue;}
    if(!local)continue;
    const prior=remote?.provenance?.length?remote:before?.provenance?.length?before:undefined;
    const updated:Answer={...local};
    if(prior){updated.provenance=prior.provenance;if(prior.importedBatchId)updated.importedBatchId=prior.importedBatchId;else delete updated.importedBatchId;updated.sourceReview='pending';}
    else if(local.provenance?.length)updated.sourceReview='pending';
    answers[id]=updated;
    changedFieldIds.push(id);
  }
  return {answers,conflictFieldIds,changedFieldIds};
}
