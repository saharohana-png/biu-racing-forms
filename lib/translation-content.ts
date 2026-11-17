import type { Field } from './catalog';
import { canonical, type Answers, type Answer } from './progress';
import { TRANSLATION_VERSION } from './translation-version';

export type TranslationChunk = {key:string;fieldId:string;path:string;text:string;context:string;index:number};
export type TranslationPlan = {chunks:TranslationChunk[];fields:Record<string,{answer:Answer;paths:Record<string,string[]>}>};
export async function translationSourceHash(answers:Answers):Promise<string> {return textHash(canonical(answers));}
export async function textHash(value:string):Promise<string> {const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}

const technicalPattern=/https?:\/\/[^\s<>"'\u0590-\u05ff]+|[A-Za-z][A-Za-z0-9_./:+-]*|[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?|[≤≥<>±Ωµμ°%]/g;
export function protectTechnicalText(text:string) {
  const tokens:string[]=[];
  const masked=text.replace(technicalPattern,token=>{tokens.push(token);return `⟦P${tokens.length-1}⟧`;});
  return {masked,tokens};
}
export function validateTranslationText(source:string,translated:string):string {
  const {tokens}=protectTechnicalText(source);
  if(typeof translated!=='string'||!translated.trim()||translated.length>Math.max(2000,source.length*5))throw new Error('INVALID_TRANSLATION');
  const seen=[...translated.matchAll(/⟦P(\d+)⟧/g)].map(match=>Number(match[1]));
  if(seen.length!==tokens.length||tokens.some((_,i)=>seen.filter(n=>n===i).length!==1))throw new Error('PROTECTED_TOKEN_CHANGED');
  const prose=translated.replace(/⟦P\d+⟧/g,'');
  if(/[\u0590-\u05ff—;]/.test(prose)||/\d|[⟦⟧]/.test(prose))throw new Error('INVALID_TRANSLATION');
  if(/^(?:sure|certainly|of course|here (?:is|are)|as an ai)\b/i.test(prose.trim()))throw new Error('INVALID_TRANSLATION');
  return (source.match(/^\s*/)?.[0]??'')+translated.trim().replace(/⟦P(\d+)⟧/g,(_,i)=>tokens[Number(i)])+(source.match(/\s*$/)?.[0]??'');
}
function proseNeedsTranslation(text:string) {return /[\u0590-\u05ff]/.test(text);}
function isLiteral(field:{type?:string;kind?:string;options?:unknown[];sourceInputSchema?:Record<string,unknown>}) {
  return ['file','select'].includes(field.type??field.kind??'')||!!field.options?.length||/linked_record_picker/.test(String(field.sourceInputSchema?.type??''));
}
function splitText(text:string):string[] {
  const parts:string[]=[];let remaining=text;
  while(remaining.length>500){let cut=Math.max(remaining.lastIndexOf('\n',500),remaining.lastIndexOf('. ',500));if(cut<120)cut=remaining.lastIndexOf(' ',500);if(cut<1)cut=500;else cut++;parts.push(remaining.slice(0,cut));remaining=remaining.slice(cut);}
  if(remaining)parts.push(remaining);return parts;
}
/** Only free language reaches the provider. All IDs, enums, numbers and evidence remain in the source clone. */
export async function makeTranslationPlan(systemId:string,fields:Field[],answers:Answers,model:string):Promise<TranslationPlan> {
  const plan:TranslationPlan={chunks:[],fields:{}};
  for(const field of fields){const source=answers[field.id];if(!source)continue;const paths:Record<string,string[]>={};
    const context=canonical({systemId,fieldId:field.id,label:field.label,prompt:field.prompt,unit:field.unit,columns:field.columns?.map(c=>({id:c.id,label:c.label,unit:c.unit,prompt:c.prompt}))});
    const add=async(path:string,text:string)=>{if(!text||!proseNeedsTranslation(text))return;const chunks=splitText(text);paths[path]=[];for(let index=0;index<chunks.length;index++){const piece=chunks[index];const key=await textHash(canonical({version:TRANSLATION_VERSION,model,context,path,text:piece}));paths[path].push(key);plan.chunks.push({key,fieldId:field.id,path,text:piece,context,index});}};
    if(Array.isArray(source.value)){for(let row=0;row<source.value.length;row++)for(const column of field.columns??[])if(!isLiteral(column))await add(`value/${row}/${column.id}`,source.value[row][column.id]??'');}
    else if(!isLiteral(field))await add('value',source.value);
    if(source.reason)await add('reason',source.reason);
    // A structural dependency has no natural Hebrew and is never sent for translation.
    if(source.dependency&&/[\u0590-\u05ff]/.test(source.dependency))await add('dependency',source.dependency);
    plan.fields[field.id]={answer:JSON.parse(JSON.stringify(source)) as Answer,paths};
  }
  return plan;
}
export function assembleTranslation(plan:TranslationPlan,cache:Map<string,string>) {
  const englishAnswers:Answers={},fieldStates:Record<string,'ready'|'pending'|'failed'>={};let completedFields=0;
  for(const [fieldId,entry]of Object.entries(plan.fields)){
    if(Object.values(entry.paths).some(keys=>keys.some(key=>!cache.has(key)))){fieldStates[fieldId]='pending';continue;}
    const answer=JSON.parse(JSON.stringify(entry.answer)) as Answer;
    for(const [path,keys]of Object.entries(entry.paths)){
      const value=keys.map(key=>cache.get(key)!).join('');
      if(path==='value')answer.value=value;else if(path==='reason')answer.reason=value;else if(path==='dependency')answer.dependency=value;
      else {const [,row,column]=path.split('/');if(Array.isArray(answer.value))answer.value[Number(row)][column]=value;}
    }
    englishAnswers[fieldId]=answer;fieldStates[fieldId]='ready';completedFields++;
  }
  return {englishAnswers,fieldStates,completedFields,totalFields:Object.keys(plan.fields).length};
}
