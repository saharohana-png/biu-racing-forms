'use client';
import {request} from './client-types';
import {TRANSLATION_VERSION} from './translation-version';
import type {TranslationSnapshot} from './translation';
import {validateLocalTranslation} from './local-translation-validation';
export type LocalTranslationState={revision:number;phase:'queued'|'loading'|'translating'|'ready'|'error';message:string;snapshot?:TranslationSnapshot;done?:number;total?:number};
const states=new Map<string,LocalTranslationState>(),listeners=new Map<string,Set<(state:LocalTranslationState)=>void>>();
const jobs=new Map<string,{revision:number;promise:Promise<void>}>();
let sequence=Promise.resolve(),worker:Worker|undefined;
const pending=new Map<string,{resolve:(text:string)=>void;reject:(error:Error)=>void;progress:(value:Record<string,unknown>)=>void;timer:ReturnType<typeof setTimeout>}>();
function engine(){
 if(worker)return worker;
 worker=new Worker('/translation/translation.worker.js?v='+encodeURIComponent(TRANSLATION_VERSION),{type:'module',name:'Hebrew to English'});
 worker.onmessage=event=>{
  const {id,text,error,progress}=event.data,entry=pending.get(id);if(!entry)return;
  if(progress){entry.progress(progress);return;}
  clearTimeout(entry.timer);pending.delete(id);
  if(error)entry.reject(new Error(error));else entry.resolve(text);
 };
 worker.onerror=(event)=>{console.warn('Local translation worker failed:',event.message,event.filename,event.lineno);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(new Error('LOCAL_ENGINE_FAILED'));}pending.clear();worker?.terminate();worker=undefined;};
 return worker;
}
function infer(text:string,progress:(value:Record<string,unknown>)=>void){
 return new Promise<string>((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('LOCAL_ENGINE_TIMEOUT'));worker?.terminate();worker=undefined;},600000);
  pending.set(id,{resolve,reject,progress,timer});
  try{engine().postMessage({id,text});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
 });
}
function publish(id:string,state:LocalTranslationState){states.set(id,state);for(const listener of listeners.get(id)??[])listener(state);}
export function subscribeLocalTranslation(id:string,listener:(state:LocalTranslationState)=>void){
 const set=listeners.get(id)??new Set();set.add(listener);listeners.set(id,set);
 const current=states.get(id);if(current)listener(current);
 return()=>{set.delete(listener);if(!set.size)listeners.delete(id);};
}
export function scheduleLocalTranslation(id:string,revision:number,retry=false):Promise<void>{
 if(typeof window==='undefined'||revision<1)return Promise.resolve();
 const previous=jobs.get(id);
 if(previous&&previous.revision>=revision&&!retry)return previous.promise;
 const job={revision,promise:Promise.resolve()};
 jobs.set(id,job);publish(id,{revision,phase:'queued',message:'העברית נשמרה. מכינים את התרגום המקומי…'});
 job.promise=sequence.catch(()=>{}).then(async()=>{
  const active=()=>jobs.get(id)===job;
  if(!active())return;
  const url=`/api/systems/${encodeURIComponent(id)}/translation`;
  let snapshot:TranslationSnapshot|undefined;
  try{
   snapshot=await request<TranslationSnapshot>(url+'?revision='+revision);
   if(!active()||!snapshot.isCurrent)return;
   if(snapshot.errorCode)throw new Error(snapshot.errorCode);
   const total=snapshot.pendingChunkCount,attempted=new Set<string>();let done=0,failed=0,lastFailure='';
   while(active()&&snapshot.pendingChunks.some(chunk=>!attempted.has(chunk.key))){
    for(const chunk of snapshot.pendingChunks){
     if(!active())return;if(attempted.has(chunk.key))continue;attempted.add(chunk.key);
     publish(id,{revision,phase:'translating',message:'מתרגמים במכשיר הזה…',snapshot,done,total});
     let text:string;
     try{
      text=validateLocalTranslation(chunk.text,await infer(chunk.text,progress=>{
       if(!active())return;
       publish(id,{revision,phase:'loading',message:progress.status==='progress'?'מורידים את מנוע התרגום למכשיר. ההורדה הראשונית היא כ־365 MB ונשמרת לשימוש חוזר.':'טוענים את מנוע התרגום המקומי…',snapshot,done,total});
      }));
     }catch(error){lastFailure=error instanceof Error?error.message:'LOCAL_ENGINE_FAILED';console.warn('Local translation failed:',lastFailure);failed++;continue;}
     if(!active())return;
     snapshot=await request<TranslationSnapshot>(url,{method:'POST',body:JSON.stringify({action:'complete',sourceRevision:revision,sourceHash:snapshot.sourceHash,model:snapshot.model,results:[{key:chunk.key,text}]})});
     done++;
    }
   }
   if(!active())return;
   if(failed||snapshot.status!=='ready')publish(id,{revision,phase:'error',message:/PROTECTED_TEXT_CHANGED|INVALID_LOCAL_TRANSLATION/.test(lastFailure)?'חלק מהתרגום לא עבר את הבדיקה. העברית נשמרה; אפשר לנסות שוב או לפשט את הניסוח.':'מנוע התרגום לא השלים את הפעולה. העברית נשמרה; בדקו את החיבור לאינטרנט ונסו שוב.',snapshot,done,total});
   else publish(id,{revision,phase:'ready',message:'התרגום לאנגלית נשמר אוטומטית.',snapshot,done,total});
   window.dispatchEvent(new CustomEvent('biu-translation-complete',{detail:{id,revision}}));
  }catch(error){
   if(!active())return;
   if((error as {status?:number}).status===409){publish(id,{revision,phase:'queued',message:'המקור עודכן. ממתינים לגרסה השמורה החדשה.'});return;}
   publish(id,{revision,phase:'error',message:navigator.onLine?'התרגום המקומי לא הושלם. העברית נשמרה; אפשר לנסות שוב.':'אין חיבור כרגע. התרגום ימשיך כשהחיבור יחזור.',snapshot});
  }
 });
 sequence=job.promise;return job.promise;
}
if(typeof window!=='undefined')window.addEventListener('online',()=>{
 for(const [id,state]of states)if(state.phase==='error')void scheduleLocalTranslation(id,state.revision,true);
});
