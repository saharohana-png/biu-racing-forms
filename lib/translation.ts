import {getFields} from './catalog';
import type {Answers,SystemSnapshot} from './progress';
import {makeTranslationPlan,assembleTranslation,translationSourceHash,type TranslationPlan,type TranslationChunk} from './translation-content';
import {validateLocalTranslation} from './local-translation-validation';
import {LOCAL_MODEL} from './local-translation-config';
import {TRANSLATION_VERSION} from './translation-version';
export {translationSourceHash} from './translation-content';
export type TranslationConfig={model?:string};
export type TranslationStatus='queued'|'processing'|'partial'|'ready'|'failed';
export type TranslationSnapshot={
 systemId:string;sourceRevision:number;sourceHash:string;status:TranslationStatus;isCurrent:boolean;
 providerConfigured:boolean;retryable:boolean;englishAnswers:Answers;fieldStates:Record<string,'ready'|'pending'|'failed'>;
 completedFields:number;totalFields:number;updatedAt:string|null;errorCode?:string;retryAt?:string|null;
 model:string;promptVersion:string;pendingChunks:TranslationChunk[];pendingChunkCount:number;engine:'browser-local';
};
const jobId=(id:string,revision:number)=>`${id}:${revision}:${TRANSLATION_VERSION}`;
async function cached(db:D1Database,plan:TranslationPlan){
 if(!plan.chunks.length)return new Map<string,string>();
 const keys=[...new Set(plan.chunks.map(chunk=>chunk.key))];
 const result=await db.prepare('SELECT input_hash,translated_text FROM translation_cache WHERE input_hash IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all<{input_hash:string;translated_text:string}>();
 return new Map(result.results.map(row=>[row.input_hash,row.translated_text]));
}
/** Read-only. Caller must authorize this system. */
export async function getTranslationSnapshot(db:D1Database,snapshot:Pick<SystemSnapshot,'id'|'revision'|'answers'>,_config:TranslationConfig={}):Promise<TranslationSnapshot>{
 const hash=await translationSourceHash(snapshot.answers);
 const plan=await makeTranslationPlan(snapshot.id,getFields(snapshot.id),snapshot.answers,LOCAL_MODEL);
 const cache=await cached(db,plan),assembled=assembleTranslation(plan,cache);
 const current=await db.prepare('SELECT revision FROM submissions WHERE id=?').bind(snapshot.id).first<{revision:number}>();
 const job=await db.prepare('SELECT source_hash,updated_at FROM translation_jobs WHERE id=?').bind(jobId(snapshot.id,snapshot.revision)).first<{source_hash:string;updated_at:string}>();
 const pending=[...new Map(plan.chunks.filter(chunk=>!cache.has(chunk.key)).map(chunk=>[chunk.key,chunk])).values()];
 let status:TranslationStatus=pending.length?(assembled.completedFields?'partial':'queued'):'ready',errorCode:string|undefined;
 if(job&&job.source_hash!==hash){status='failed';errorCode='SOURCE_HASH_MISMATCH';assembled.englishAnswers={};assembled.completedFields=0;for(const id of Object.keys(assembled.fieldStates))assembled.fieldStates[id]='failed';}
 return {systemId:snapshot.id,sourceRevision:snapshot.revision,sourceHash:hash,status,isCurrent:(current?.revision??0)===snapshot.revision,
 providerConfigured:true,retryable:status!=='ready'&&!errorCode,...assembled,updatedAt:job?.updated_at??null,errorCode,
 model:LOCAL_MODEL,promptVersion:TRANSLATION_VERSION,engine:'browser-local',pendingChunks:errorCode?[]:pending.slice(0,32),pendingChunkCount:pending.length};
}
/** Writer authorization is mandatory. This function never changes source answers. */
export async function acceptLocalTranslations(db:D1Database,snapshot:Pick<SystemSnapshot,'id'|'revision'|'answers'>,body:Record<string,unknown>){
 const hash=await translationSourceHash(snapshot.answers);
 if(body.sourceRevision!==snapshot.revision||body.sourceHash!==hash||body.model!==LOCAL_MODEL)throw Object.assign(new Error('STALE_TRANSLATION'),{status:409});
 if(!Array.isArray(body.results)||body.results.length<1||body.results.length>32)throw new Error('INVALID_TRANSLATION_BATCH');
 const plan=await makeTranslationPlan(snapshot.id,getFields(snapshot.id),snapshot.answers,LOCAL_MODEL),chunks=new Map(plan.chunks.map(c=>[c.key,c]));
 const seen=new Set<string>(),stamp=new Date().toISOString();
 const values=body.results.map((item:unknown)=>{
  if(!item||typeof item!=='object')throw new Error('INVALID_TRANSLATION');
  const {key,text}=item as {key:string;text:string},chunk=chunks.get(key);
  if(!chunk||seen.has(key))throw new Error('INVALID_TRANSLATION_KEY');seen.add(key);
  return {key,text:validateLocalTranslation(chunk.text,text)};
 });
 const statements=values.map(({key,text})=>db.prepare(`INSERT OR IGNORE INTO translation_cache(input_hash,translated_text,model,prompt_version,created_at)
 SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM submissions s JOIN revisions r ON s.id=r.system_id AND s.revision=r.revision WHERE s.id=? AND s.revision=? AND r.content_hash=?)`)
 .bind(key,text,LOCAL_MODEL,TRANSLATION_VERSION,stamp,snapshot.id,snapshot.revision,hash));
 statements.push(db.prepare('UPDATE translation_jobs SET model=?,updated_at=? WHERE id=? AND source_hash=?').bind(LOCAL_MODEL,stamp,jobId(snapshot.id,snapshot.revision),hash));
 await db.batch(statements);
 const result=await getTranslationSnapshot(db,snapshot);
 if(!result.isCurrent)throw Object.assign(new Error('STALE_TRANSLATION'),{status:409});
 return result;
}
