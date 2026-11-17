import type {Answer,Answers} from './progress';
export type {Answer,Answers,SourceProvenance} from './progress';
export type Progress = { complete:number;total:number;percent:number;filled?:number;fillPercent?:number;populated?:number;sourcePending?:number;sourceConfirmed?:number;missing:{id:string;label:string;reason?:string}[] };
export type Attachment = {id:string;fileName?:string;safeName?:string;name?:string;originalName?:string;fieldId:string;version?:number;size?:number;createdAt?:string;status?:string};
export type Snapshot = {id:string;answers:Answers;revision:number;status:string;attachments:Attachment[];progress:Progress;updatedAt:string|null;review?:unknown};
export type Session = {subject:string;role:'coordinator'|'reviewer'|'contributor';systemIds:string[];authMethod?:'sites'|'team'|'email_entry';emailVerified?:boolean};
export type Summary = Pick<Snapshot,'id'|'revision'|'status'|'progress'|'updatedAt'>;
export type SaveAttempt={answers:Answers;baseRevision:number;baseAnswers?:Answers;mutationId:string;updatedAt:string};
export type Pending = SaveAttempt&{conflictFieldIds?:string[];attachments?:Attachment[];retry?:SaveAttempt};
export type LocalDraft={key:string;pending:Pending};
export const statusLabels:Record<string,string> = {draft:'במילוי',submitted:'ממתין לבדיקה',in_review:'בבדיקה',approved:'אושר בבדיקה',changes_requested:'נדרש תיקון',review:'ממתין לבדיקה'};
export const fillCount=(progress:Progress)=>progress.filled??progress.complete;
export const fillPercent=(progress:Progress)=>progress.fillPercent??progress.percent;
export function sourceValidationLabel(progress:Pick<Progress,'sourcePending'|'sourceConfirmed'>){const confirmed=progress.sourceConfirmed??0;const total=confirmed+(progress.sourcePending??0);return total?`${confirmed} מתוך ${total} תשובות מקור אומתו`:'אין תשובות מקור שממתינות לאימות';}
export const engineeringStatusLabel=(status:string)=>status==='draft'?'טרם הועבר לבדיקה':statusLabels[status]||'טרם הועבר לבדיקה';
export function errorText(error:unknown) {if(error instanceof Error){if(error.name==='AbortError'||error.name==='TimeoutError')return 'השרת לא אישר את הפעולה בזמן. אפשר לנסות שוב.';if(/Failed to fetch|NetworkError|Load failed|network request/i.test(error.message))return 'החיבור לשרת אינו זמין כרגע.';return error.message;}return 'הפעולה לא הושלמה. נסו שוב.';}
export async function request<T>(url:string,options?:RequestInit):Promise<T> {
 const controller=options?.signal?null:new AbortController();
 const timeout=controller?setTimeout(()=>controller.abort(),options?.body instanceof FormData?120000:30000):null;
 try{
  const headers=new Headers(options?.headers);
  if(!(options?.body instanceof FormData)&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const response=await fetch(url,{...options,headers,signal:options?.signal??controller?.signal,cache:'no-store'});
  const data=await response.json().catch(()=>{throw Object.assign(new Error('לא התקבלה תשובה תקינה מהשרת. יש לנסות שוב.'),{status:response.ok?undefined:response.status});}) as Record<string,unknown>;
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('לא התקבלה תשובה תקינה מהשרת. יש לנסות שוב.');
  if(!response.ok)throw Object.assign(new Error(String(data.error||data.message||'הפעולה לא הושלמה')),{status:response.status,data});
  return data as T;
 }finally{if(timeout)clearTimeout(timeout);}
}
let runtimeTabId:string|undefined;
let previousTabId:string|null=null;
const recoveredScopes=new Set<string>();
function outboxTabId(){if(!runtimeTabId){runtimeTabId=crypto.randomUUID();try{const key='biu-electrical-outbox-tab';previousTabId=sessionStorage.getItem(key);sessionStorage.setItem(key,runtimeTabId);}catch{/* A session-storage restriction must not prevent a local-storage draft. */}}return runtimeTabId;}
export function pendingKey(subject:string,system:string){return `biu-electrical-v2:${subject}:${system}:${outboxTabId()}`;}
function parsePending(raw:string|null):Pending|null {try{const value=raw?JSON.parse(raw):null;return value&&value.answers&&typeof value.answers==='object'&&!Array.isArray(value.answers)&&Number.isInteger(value.baseRevision)&&value.baseRevision>=0&&typeof value.mutationId==='string'&&typeof value.updatedAt==='string'?value:null;}catch{return null;}}
export function readPending(subject:string,system:string):Pending|null {try {const key=pendingKey(subject,system);let data=localStorage.getItem(key);const scope=`${subject}:${system}`;if(!data&&!recoveredScopes.has(scope)&&previousTabId){data=localStorage.getItem(`biu-electrical-v2:${scope}:${previousTabId}`);if(data){try{localStorage.setItem(key,data);}catch{/* Keep the recoverable original when copying is unavailable. */}}}recoveredScopes.add(scope);return parsePending(data);}catch{return null;}}
export function listLocalDrafts(subject:string,system:string):LocalDraft[]{try{const own=pendingKey(subject,system),prefix=`biu-electrical-v2:${subject}:${system}:`,seen=new Set<string>();const ownDraft=parsePending(localStorage.getItem(own));if(ownDraft)seen.add(ownDraft.mutationId);const drafts:LocalDraft[]=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key||key===own||!key.startsWith(prefix))continue;const pending=parsePending(localStorage.getItem(key));if(pending&&!seen.has(pending.mutationId)){seen.add(pending.mutationId);drafts.push({key,pending});}}return drafts.sort((a,b)=>b.pending.updatedAt.localeCompare(a.pending.updatedAt));}catch{return [];}}
export function writePending(subject:string,system:string,value:Pending){localStorage.setItem(pendingKey(subject,system),JSON.stringify(value));}
export function clearPending(subject:string,system:string,mutationId?:string){try{const key=pendingKey(subject,system);const stored=parsePending(localStorage.getItem(key));if(mutationId&&stored?.mutationId!==mutationId)return;localStorage.removeItem(key);}catch{/* A server acknowledgement remains valid if browser storage becomes unavailable. */}}
let navigationGuard:((proceed:()=>void)=>void)|null=null;
export function registerNavigationGuard(guard:(proceed:()=>void)=>void){navigationGuard=guard;return()=>{if(navigationGuard===guard)navigationGuard=null;};}
export function navigateSafely(proceed:()=>void){if(navigationGuard)navigationGuard(proceed);else proceed();}
export function dateLabel(date?:string|null){return date?new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Jerusalem'}).format(new Date(date)):'עדיין לא נשמר';}
