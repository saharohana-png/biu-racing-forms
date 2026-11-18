import { cloudDatabase, cloudBucket } from '@/lib/cloud-storage';
import {teamEntryAllowed} from '@/lib/team-entry';
import { translationQueueStatement } from '@/lib/translation-version';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { readEmailEntryToken, emailEntryTokenFromCookie, emailEntryTokenHash, newEmailEntryToken, emailEntryCookie, EMAIL_ENTRY_MAX_AGE } from '@/lib/email-entry-session';
import { getSystem, getFields, systems, schemaVersion } from '@/lib/catalog';
import {SourceImportError,validateProvenance,validateBatchId,parseImportBatch,parseImportSystem,mergeSourceImport,mergeEditorialImport,parseImportMode,validateWeeklyImport,emptyAnswerDecision,type ImportMode,type ImportSystem} from '@/lib/source-import';
import {mergeAnswers} from '@/lib/answer-merge';
import { canonical, computeProgress, referencedAttachmentIds, fingerprint, isNotApplicable, isUnknown, type Answers, type Answer, type Attachment, type SystemSnapshot, type Review } from '@/lib/progress';

export const SCHEMA_VERSION=schemaVersion;
export const MAX_FILE_BYTES=25*1024*1024;
export const SYSTEM_QUOTA_BYTES=500*1024*1024;
export const PROJECT_QUOTA_BYTES=950*1024*1024;
export type Session={subject:string;role:'coordinator'|'reviewer'|'contributor';systemIds:string[];authMethod?:'sites'|'email_entry';emailVerified?:boolean};
export class ApiError extends Error {constructor(public status:number,message:string,public details:Record<string,unknown>={}){super(message);}}
export function database():D1Database {return cloudDatabase;}
export function bucket():R2Bucket {return cloudBucket;}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export async function guard(request:Request,operation:()=>Promise<unknown|Response>):Promise<Response>{
  try {
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){
      const origin=request.headers.get('origin');
      const expected=new URL(request.url),host=request.headers.get('host');
      // Next may construct request.url using its internal listen hostname.
      // Compare the browser's Origin with the actual HTTP Host, never a client-supplied forwarded host.
      if(host)expected.host=host;
      if(!origin||origin!==expected.origin) throw new ApiError(403,'הפעולה דורשת בקשה מאותו אתר.');
      if(Number(request.headers.get('content-length')??0)>MAX_FILE_BYTES+1024*1024) throw new ApiError(413,'הקובץ גדול מהמגבלה המותרת: 25 MiB.');
    }
    const result=await operation();return result instanceof Response?result:json(result);
  } catch(error){
    if(error instanceof SourceImportError)return json({error:error.message},400);
    if(error instanceof ApiError) return json({error:error.message,...error.details},error.status);
    console.error('API operation failed',error instanceof Error?error.message:'unknown');
    return json({error:'הפעולה לא הושלמה בשרת. המידע המקומי נשמר ככל שהדפדפן מאפשר זאת. אפשר לנסות שוב.'},500);
  }
}
function boundedBody(request:Request,limit:number):Response {
  if(!request.body)throw new ApiError(400,'גוף הבקשה חסר.');
  let received=0;
  const limiter=new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){received+=chunk.byteLength;if(received>limit)throw new ApiError(413,'הבקשה גדולה מהמגבלה המותרת. יש לפצל את התוכן או לצרף קובץ קטן יותר.');controller.enqueue(chunk);}});
  return new Response(request.body.pipeThrough(limiter),{headers:{'Content-Type':request.headers.get('content-type')??'application/octet-stream'}});
}
export async function readUploadForm(request:Request):Promise<FormData> {try{return await boundedBody(request,MAX_FILE_BYTES+1024*1024).formData();}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'העלאת הקובץ נקטעה או שמבנה הבקשה אינו תקין.');}}
export async function readJson(request:Request,maxBytes=1024*1024):Promise<Record<string,unknown>> {
  const raw=await boundedBody(request,maxBytes).text();
  try {const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new ApiError(400,'מבנה הנתונים אינו תקין.');}
}
export async function sha256(value:string|ArrayBuffer|Uint8Array):Promise<string>{const bytes=typeof value==='string'?new TextEncoder().encode(value):value;const digest=await crypto.subtle.digest('SHA-256',bytes as BufferSource);return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function isUniversityEmail(value:unknown):boolean {
  if(typeof value!=='string'||value.length>254||/[^\x21-\x7e]/.test(value))return false;
  const parts=value.split('@');
  return parts.length===2&&parts[0].length<=64&&/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(parts[0])&&parts[1].toLowerCase()==='live.biu.ac.il';
}
async function requireConfiguredOwner(db:D1Database):Promise<void>{
  // Sharing must never promote the first visitor. The owner was established
  // while the site was private and must already exist before accepting access.
  const workspace=await db.prepare("SELECT owner_subject FROM workspace WHERE id='2027'").first<{owner_subject:string}>();
  if(!workspace?.owner_subject)throw new ApiError(503,'הגישה לאתר טרם הוגדרה בידי הבעלים.',{code:'OWNER_NOT_CONFIGURED'});
}
type EmailEntryMember={subject:string;active:number;auth_source:string};
async function emailEntryMember(db:D1Database,token:string):Promise<EmailEntryMember|null>{
  return db.prepare('SELECT m.subject,m.active,m.auth_source FROM email_entry_sessions s JOIN memberships m ON m.subject=s.subject WHERE s.token_hash=? AND s.expires_at>? AND s.revoked_at IS NULL').bind(await emailEntryTokenHash(token),Date.now()).first<EmailEntryMember>();
}
function selfDeclaredSession(member:EmailEntryMember):Session{
  if(!member.active)throw new ApiError(403,'הגישה לחשבון הזה הושבתה. יש לפנות לרכז המסמכים.',{code:'MEMBERSHIP_DISABLED',subject:member.subject});
  // A self-declared session cannot inherit a role changed through the admin UI.
  if(member.auth_source!=='email_entry')throw new ApiError(401,'יש להיכנס מחדש.',{code:'SIGN_IN_REQUIRED'});
  return {subject:member.subject,role:'contributor',systemIds:systems.map(system=>system.id),authMethod:'email_entry',emailVerified:false};
}
export async function enterWithEmail(request:Request,body:Record<string,unknown>):Promise<Response>{
  if(!isUniversityEmail(body.email))throw new ApiError(400,'יש להזין כתובת מייל בסיומת @live.biu.ac.il.',{code:'UNIVERSITY_EMAIL_REQUIRED'});
  if(!teamEntryAllowed(body.accessCode))throw new ApiError(403,'יש להזין את קוד הצוות שקיבלת מרכז התיעוד.',{code:'TEAM_CODE_REQUIRED'});
  const db=database();await requireConfiguredOwner(db);
  const currentToken=emailEntryTokenFromCookie(request.headers.get('cookie'));
  if(currentToken){const current=await emailEntryMember(db,currentToken);if(current)selfDeclaredSession(current);}
  const token=newEmailEntryToken(),tokenHash=await emailEntryTokenHash(token),subject='email-entry:'+crypto.randomUUID(),now=new Date().toISOString();
  const statements=[
    db.prepare("INSERT INTO memberships(subject,role,system_ids,active,created_at,auth_source) VALUES(?,'contributor',?,1,?,'email_entry')").bind(subject,JSON.stringify(systems.map(system=>system.id)),now),
    db.prepare('INSERT INTO email_entry_sessions(token_hash,subject,expires_at,created_at) VALUES(?,?,?,?)').bind(tokenHash,subject,Date.now()+EMAIL_ENTRY_MAX_AGE*1000,now),
    db.prepare("INSERT INTO audit_events(id,action,actor,created_at) VALUES(?,'self_declared_email_entry',?,?)").bind('email-entry:'+crypto.randomUUID(),subject,now),
  ];
  if(currentToken)statements.push(db.prepare('UPDATE email_entry_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now,await emailEntryTokenHash(currentToken)));
  await db.batch(statements);
  // The email has served its only purpose: suffix eligibility. Do not store or
  // publish it, and never treat its value as a verified account identity.
  const response=json(selfDeclaredSession({subject,active:1,auth_source:'email_entry'}));
  response.headers.set('Set-Cookie',emailEntryCookie(request,token));return response;
}
export async function logoutEmailEntry(request:Request):Promise<Response>{
  const token=emailEntryTokenFromCookie(request.headers.get('cookie'));
  if(token)await database().prepare('UPDATE email_entry_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(new Date().toISOString(),await emailEntryTokenHash(token)).run();
  const response=json({ok:true});response.headers.set('Set-Cookie',emailEntryCookie(request,null));return response;
}
export async function session():Promise<Session>{
  const token=await readEmailEntryToken();
  // A present entry cookie is authoritative, including when it has expired.
  // Never silently switch a contributor browser to a stronger Sites identity.
  if(token!==null){
    if(!token)throw new ApiError(401,'יש להיכנס מחדש.',{code:'SIGN_IN_REQUIRED'});
    const db=database(),member=await emailEntryMember(db,token);
    if(!member)throw new ApiError(401,'יש להיכנס מחדש.',{code:'SIGN_IN_REQUIRED'});
    await requireConfiguredOwner(db);return selfDeclaredSession(member);
  }
  const user=await getChatGPTUser();if(!user)throw new ApiError(401,'יש להתחבר כדי לגשת לתיק החשמל.',{code:'SIGN_IN_REQUIRED'});
  const db=database();await requireConfiguredOwner(db);
  await db.prepare("INSERT OR IGNORE INTO memberships(subject,role,system_ids,active,created_at) SELECT owner_subject,'coordinator','[]',1,created_at FROM workspace WHERE id='2027' AND owner_subject=?").bind(user.userId).run();
  type Member={subject:string;role:Session['role'];system_ids:string;active:number;auth_source:string};
  const readMember=()=>db.prepare('SELECT subject,role,system_ids,active,auth_source FROM memberships WHERE subject=?').bind(user.userId).first<Member>();
  let member=await readMember();
  // Keep the existing trusted Sites flow for the owner and manually granted
  // members. Self-declared entry above always uses its separate random subject.
  const university=isUniversityEmail(user.email);
  if(!member&&university){
    const now=new Date().toISOString();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO memberships(subject,role,system_ids,active,created_at,auth_source) SELECT ?,'contributor',?,1,?,'biu_domain' WHERE EXISTS(SELECT 1 FROM workspace WHERE id='2027')").bind(user.userId,JSON.stringify(systems.map(system=>system.id)),now),
      db.prepare("INSERT OR IGNORE INTO audit_events(id,action,actor,created_at) SELECT ?,'university_enrollment',subject,created_at FROM memberships WHERE subject=? AND auth_source='biu_domain'").bind('university-enrollment:'+user.userId,user.userId),
    ]);
    member=await readMember();
  }
  if(member&&!member.active)throw new ApiError(403,'הגישה לחשבון הזה הושבתה. יש לפנות לרכז המסמכים.',{code:'MEMBERSHIP_DISABLED',subject:user.userId});
  if(!member||(member.auth_source==='biu_domain'&&!university))throw new ApiError(403,'יש להיכנס באמצעות מייל בסיומת @live.biu.ac.il.',{code:'UNIVERSITY_EMAIL_REQUIRED',subject:user.userId});
  const domainMember=member.auth_source==='biu_domain';
  return {subject:member.subject,role:domainMember?'contributor':member.role,systemIds:domainMember||member.role==='coordinator'?systems.map(s=>s.id):JSON.parse(member.system_ids),authMethod:'sites'};
}
export async function requireAccess(systemId:string,write=false):Promise<Session>{
  if(!getSystem(systemId))throw new ApiError(404,'המערכת לא נמצאה.');
  const member=await session();if(systemId==='COORDINATOR'){if(member.role!=='coordinator')throw new ApiError(403,'מסלול הרכז זמין לרכז המסמכים בלבד.');return member;}if(!member.systemIds.includes(systemId))throw new ApiError(403,'אין הרשאה למערכת הזו.');
  if(write&&member.role==='reviewer')throw new ApiError(403,'בודק הנדסי יכול לבדוק ולאשר, אך אינו עורך את תשובות הצוות.');return member;
}
export async function requireCoordinator(){const member=await session();if(member.role!=='coordinator')throw new ApiError(403,'הפעולה מיועדת לרכז המסמכים.');return member;}
type SubmissionRow={id:string;revision:number;answers:string;status:SystemSnapshot['status'];review:string;updated_at:string;last_mutation:string|null};
type FileRow={id:string;system_id:string;field_id:string;original_name:string;safe_name:string;mime:string;size:number;sha256:string;storage_key:string;state:string;replaces_id:string|null;version:number;created_at:string;mutation_key:string};
function publicFile(row:FileRow):Attachment{return {id:row.id,systemId:row.system_id,fieldId:row.field_id,originalName:row.original_name,safeName:row.safe_name,mime:row.mime,size:row.size,sha256:row.sha256,state:row.state,replacesId:row.replaces_id,version:row.version,createdAt:row.created_at};}
export async function listFiles(id:string):Promise<Attachment[]>{await requireAccess(id);const rows=await database().prepare('SELECT * FROM attachments WHERE system_id=? ORDER BY created_at').bind(id).all<FileRow>();return rows.results.map(publicFile);}
async function snapshot(row:SubmissionRow|null,id:string):Promise<SystemSnapshot>{const answers:Answers=JSON.parse(row?.answers??'{}'),review:Review=JSON.parse(row?.review??'{}');const files=await database().prepare("SELECT * FROM attachments WHERE system_id=? AND state='complete' ORDER BY created_at").bind(id).all<FileRow>();const referenced=referencedAttachmentIds(getFields(id),answers);const attachments=files.results.filter(file=>referenced.has(file.id)).map(publicFile);return {id,answers,revision:row?.revision??0,status:row?.status??'draft',updatedAt:row?.updated_at??null,review,attachments,progress:computeProgress(getFields(id),answers,attachments,review),schemaVersion:SCHEMA_VERSION};}
export async function readSystem(id:string):Promise<SystemSnapshot>{await requireAccess(id);const row=await database().prepare('SELECT * FROM submissions WHERE id=?').bind(id).first<SubmissionRow>();return snapshot(row,id);}
export async function listSystems(){const member=await session();return {systems:await Promise.all(member.systemIds.map(async id=>{const item=await readSystem(id);return {id,revision:item.revision,status:item.status,updatedAt:item.updatedAt,progress:item.progress};}))};}
function requireRevision(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<0)throw new ApiError(400,'חסרה גרסת הבסיס של הטיוטה.');return Number(value);}
function requireMutation(value:unknown):string {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(value))throw new ApiError(400,'חסר מזהה שמירה תקין.');return value;}
export async function validateAnswers(id:string,input:unknown):Promise<Answers>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'מבנה התשובות אינו תקין.');
  const fields=getFields(id),output:Answers={},files=await database().prepare("SELECT * FROM attachments WHERE system_id=? AND state='complete'").bind(id).all<FileRow>();
  for(const [key,item] of Object.entries(input)){
    const field=fields.find(f=>f.id===key);if(!field)throw new ApiError(400,'נמצא שדה שאינו שייך למערכת: '+key);
    if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'תשובה אינה תקינה: '+field.label);
    const a=item as Record<string,unknown>;if(!['answered','unknown','na'].includes(String(a.status)))throw new ApiError(400,'יש לבחור מצב תשובה תקין.');
    if(typeof a.value!=='string'&&!Array.isArray(a.value))throw new ApiError(400,'מבנה ערך לא תקין: '+field.label);
    if(typeof a.value==='string'&&a.value.length>50000)throw new ApiError(413,'התשובה ארוכה מדי. אפשר לצרף פירוט כקובץ.');
    if(Array.isArray(a.value)){
      if(field.type!=='table'||a.value.length>200)throw new ApiError(400,'מספר או מבנה שורות הטבלה אינו תקין.');
      const seen=new Set();for(const row of a.value){if(!row||typeof row!=='object'||Array.isArray(row)||typeof row._id!=='string'||!/^[\w-]{1,120}$/.test(row._id)||seen.has(row._id))throw new ApiError(400,'לכל שורת טבלה דרוש מזהה ייחודי.');seen.add(row._id);for(const [col,val]of Object.entries(row)){if(col!=='_id'&&!field.columns?.some(c=>c.id===col))throw new ApiError(400,'עמודת טבלה לא מוכרת.');if(typeof val!=='string'||val.length>10000)throw new ApiError(400,'ערך בטבלה אינו תקין.');const column=field.columns?.find(c=>c.id===col);if(column?.options?.length&&val!==''&&!isUnknown(val)&&!isNotApplicable(val)&&!column.options.some(option=>option.value===val))throw new ApiError(400,'הבחירה בעמודת '+column.label+' אינה אחת האפשרויות המותרות.');}}
    } else if(field.type==='table'&&a.status==='answered'&&a.value!=='')throw new ApiError(400,'יש למלא את הטבלה בשורות.');
    if(a.reason!==undefined&&(typeof a.reason!=='string'||a.reason.length>10000))throw new ApiError(400,'הנימוק אינו תקין.');
    if(a.dependency!==undefined&&(typeof a.dependency!=='string'||a.dependency.length>1000))throw new ApiError(400,'תיאור התלות אינו תקין.');
    if(a.attachmentIds!==undefined&&(!Array.isArray(a.attachmentIds)||a.attachmentIds.length>40||a.attachmentIds.some(v=>typeof v!=='string'||!files.results.some(f=>f.id===v&&f.field_id===key))))throw new ApiError(400,'אחד הקבצים אינו זמין או אינו שייך לשדה הזה.');
    if(a.status==='answered'&&isNotApplicable(a.value))throw new ApiError(400,'אי־תחולה דורשת בחירת מצב לא רלוונטי, נימוק ובדיקת מהנדס.');
    if(field.type==='select'&&a.status==='answered'&&typeof a.value==='string'&&a.value!==''&&!field.options?.some(v=>v.value===a.value))throw new ApiError(400,'הבחירה אינה אחת האפשרויות המותרות.');
    if(a.sourceReview!==undefined&&!['pending','confirmed'].includes(String(a.sourceReview)))throw new ApiError(400,'מצב אימות המקור אינו תקין.');
    const provenance=a.provenance===undefined?undefined:validateProvenance(a.provenance);
    const importedBatchId=a.importedBatchId===undefined?undefined:validateBatchId(a.importedBatchId);
    if((a.sourceReview!==undefined||importedBatchId)&&!provenance)throw new ApiError(400,'נתוני אימות מקור דורשים הפניה למקורות.');
    output[key]={...(provenance?{provenance,sourceReview:(a.sourceReview??'pending') as 'pending'|'confirmed'}:{}),...(importedBatchId?{importedBatchId}:{}),status:a.status as Answer['status'],value:a.value as Answer['value'],...(a.reason!==undefined?{reason:a.reason as string}:{}),...(a.dependency!==undefined?{dependency:a.dependency as string}:{}),...(a.attachmentIds!==undefined?{attachmentIds:[...new Set(a.attachmentIds as string[])]}:{})};
  }
  return output;
}
async function commitSnapshot(id:string,member:Session,answers:Answers,baseRevision:number,mutationId:string,payloadHash:string,status:SystemSnapshot['status'],review:Review,event?:{action:string;reason:string;fieldIds:string[]},emptyFieldIds?:string[],editorialEvidence?:{fieldIds:string[];attachmentIds:string[]}):Promise<SystemSnapshot>{
  const db=database(),key=member.subject+':'+mutationId;
  const retry=await db.prepare('SELECT * FROM mutations WHERE id=?').bind(key).first<{system_id:string;payload_hash:string;revision:number}>();
  if(retry){if(retry.payload_hash!==payloadHash||retry.system_id!==id)throw new ApiError(409,'מזהה השמירה כבר שימש לפעולה אחרת.');return readRevision(id,retry.revision);}
  const revision=baseRevision+1,now=new Date().toISOString(),answersJson=canonical(answers),reviewJson=canonical(review),hash=await sha256(answersJson);
  // Imports already verified field emptiness in this exact base revision. The
  // additional atomic guard covers file uploads, whose bytes can arrive before
  // their answer revision commits. Any file history protects that field.
  const fileGuard=emptyFieldIds?' AND NOT EXISTS(SELECT 1 FROM attachments WHERE system_id=? AND field_id IN (SELECT value FROM json_each(?)))':'';
  const editorialGuard=editorialEvidence?' AND NOT EXISTS(SELECT 1 FROM attachments WHERE system_id=? AND field_id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?)))':'';
  const statements=[
    db.prepare("INSERT OR IGNORE INTO submissions(id,revision,answers,status,review,updated_at) VALUES(?,0,'{}','draft','{}',?)").bind(id,now),
    db.prepare('UPDATE submissions SET revision=?,answers=?,status=?,review=?,updated_at=?,last_mutation=? WHERE id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM mutations WHERE id=?)'+fileGuard+editorialGuard).bind(revision,answersJson,status,reviewJson,now,key,id,baseRevision,key,...(emptyFieldIds?[id,JSON.stringify(emptyFieldIds)]:[]),...(editorialEvidence?[id,JSON.stringify(editorialEvidence.fieldIds),JSON.stringify(editorialEvidence.attachmentIds)]:[])),
    db.prepare('INSERT OR IGNORE INTO revisions(id,system_id,revision,answers,status,review,schema_version,content_hash,actor,created_at,mutation_key) SELECT ?,id,revision,answers,status,review,?,?,?,updated_at,last_mutation FROM submissions WHERE id=? AND last_mutation=?').bind(id+':'+revision,SCHEMA_VERSION,hash,member.subject,id,key),
    db.prepare('INSERT OR IGNORE INTO mutations(id,system_id,payload_hash,revision,created_at) SELECT ?,id,?,revision,updated_at FROM submissions WHERE id=? AND last_mutation=?').bind(key,payloadHash,id,key),
    db.prepare('INSERT OR IGNORE INTO audit_events(id,system_id,action,revision,actor,created_at) SELECT ?,id,?,revision,?,updated_at FROM submissions WHERE id=? AND last_mutation=?').bind(key+':audit',event?.action??'save',member.subject,id,key),
  ];
  statements.push(translationQueueStatement(db,id,key));
  if(event)statements.push(db.prepare('INSERT OR IGNORE INTO review_events(id,system_id,revision,action,reason,field_ids,actor,role,created_at) SELECT ?,id,revision,?,?,?,?,?,updated_at FROM submissions WHERE id=? AND last_mutation=?').bind(key+':review',event.action,event.reason,JSON.stringify(event.fieldIds),member.subject,member.role,id,key));
  await db.batch(statements);
  const saved=await db.prepare('SELECT revision,payload_hash FROM mutations WHERE id=?').bind(key).first<{revision:number;payload_hash:string}>();
  if(!saved)throw new ApiError(409,'נשמרה גרסה חדשה במקביל. יש להשוות בין הגרסאות לפני שמירה נוספת.',{code:'CONFLICT',server:await readSystem(id)});
  if(saved.payload_hash!==payloadHash)throw new ApiError(409,'מזהה השמירה כבר שימש לפעולה אחרת.');
  // The source transaction is already durable. Provider work cannot block it.
  return readRevision(id,saved.revision);
}
export async function saveSystem(id:string,body:Record<string,unknown>):Promise<SystemSnapshot>{
  const member=await requireAccess(id,true),baseRevision=requireRevision(body.baseRevision),mutation=requireMutation(body.mutationId),incoming=await validateAnswers(id,body.answers);
  const requestHash=await sha256(canonical({type:'save',id,base:baseRevision,answers:incoming})),mutationKey=member.subject+':'+mutation;
  const replay=async()=>{const previous=await database().prepare('SELECT system_id,payload_hash,revision FROM mutations WHERE id=?').bind(mutationKey).first<{system_id:string;payload_hash:string;revision:number}>();if(!previous)return null;if(previous.system_id!==id||previous.payload_hash!==requestHash)throw new ApiError(409,'מזהה השמירה כבר שימש לפעולה אחרת.');return readRevision(id,previous.revision);};
  const saved=await replay();if(saved)return saved;
  let current=await readSystem(id);
  if(baseRevision>current.revision)throw new ApiError(409,'גרסת הבסיס אינה זמינה. יש לפתוח מחדש את המערכת לפני השוואת הטיוטה.',{code:'BASE_REVISION_UNAVAILABLE',server:current});
  let base:SystemSnapshot;
  if(baseRevision===current.revision)base=current;
  else if(baseRevision===0)base={...current,revision:0,answers:{},attachments:[],review:{},status:'draft',updatedAt:null,progress:computeProgress(getFields(id),{})};
  else try{base=await readRevision(id,baseRevision);}catch(error){if(error instanceof ApiError&&error.status===404)throw new ApiError(409,'גרסת הבסיס אינה זמינה. יש להשוות לטיוטה העדכנית.',{code:'BASE_REVISION_UNAVAILABLE',server:current});throw error;}
  for(let attempt=0;attempt<4;attempt++){
    if(attempt){const repeated=await replay();if(repeated)return repeated;current=await readSystem(id);}
    const merged=mergeAnswers(base.answers,current.answers,incoming);
    if(merged.conflictFieldIds.length)throw new ApiError(409,'אותו שדה השתנה במקביל. יש לבחור את התוכן לשמירה בשדות המסומנים.',{code:'REVISION_CONFLICT',conflictFieldIds:merged.conflictFieldIds,server:current,base});
    if(new TextEncoder().encode(canonical(merged.answers)).byteLength>1024*1024)throw new ApiError(413,'התשובות המשולבות גדולות מהמגבלה המותרת. אפשר לצרף פירוט כקובץ.');
    const review:Review={...current.review,fields:{...current.review.fields}};
    for(const key of merged.changedFieldIds)delete review.fields![key];
    try{return await commitSnapshot(id,member,merged.answers,current.revision,mutation,requestHash,merged.changedFieldIds.length?'draft':current.status,review);}
    catch(error){if(!(error instanceof ApiError&&error.status===409&&error.details.code==='CONFLICT'))throw error;}
  }
  throw new ApiError(409,'המערכת נשמרת כעת במקביל. הטיוטה נשמרה אצלך; יש לנסות שוב בעוד רגע.',{code:'CONCURRENT_SAVE_BUSY',conflictFieldIds:[],server:await readSystem(id),base});
}
export async function readRevision(id:string,revision:number):Promise<SystemSnapshot>{await requireAccess(id);const row=await database().prepare('SELECT *,system_id AS id,created_at AS updated_at FROM revisions WHERE system_id=? AND revision=?').bind(id,revision).first<SubmissionRow & {content_hash:string;schema_version:string}>();if(!row)throw new ApiError(404,'הגרסה המבוקשת אינה קיימת.');const result=await snapshot(row,id);result.contentHash=row.content_hash;result.schemaVersion=row.schema_version;return result;}
export async function getRevisions(id:string){await requireAccess(id);const result=await database().prepare('SELECT revision,answers,status,review,schema_version AS schemaVersion,content_hash AS contentHash,created_at AS createdAt FROM revisions WHERE system_id=? ORDER BY revision').bind(id).all<{revision:number;answers:string;status:string;review:string;schemaVersion:string;contentHash:string;createdAt:string}>();return result.results.map(r=>({...r,answers:JSON.parse(r.answers),review:JSON.parse(r.review)}));}
export async function getRevisionPage(id:string,limit=25,afterRevision=0,throughRevision=Number.MAX_SAFE_INTEGER){
  await requireAccess(id);
  if(!Number.isFinite(limit))throw new ApiError(400,'גודל העמוד אינו תקין.');
  const pageSize=Math.max(1,Math.min(100,Math.floor(limit)));
  if(!Number.isSafeInteger(afterRevision)||afterRevision<0||!Number.isSafeInteger(throughRevision)||throughRevision<0)throw new ApiError(400,'טווח הגרסאות אינו תקין.');
  const result=await database().prepare('SELECT revision,answers,status,review,schema_version AS schemaVersion,content_hash AS contentHash,created_at AS createdAt FROM revisions WHERE system_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT ?').bind(id,afterRevision,throughRevision,pageSize).all<{revision:number;answers:string;status:string;review:string;schemaVersion:string;contentHash:string;createdAt:string}>();
  return result.results.map(r=>({...r,answers:JSON.parse(r.answers) as Answers,review:JSON.parse(r.review) as Review}));
}
export async function getRevisionIndex(id:string,throughRevision=Number.MAX_SAFE_INTEGER){
  await requireAccess(id);
  if(!Number.isSafeInteger(throughRevision)||throughRevision<0)throw new ApiError(400,'גבול הגרסאות אינו תקין.');
  const result=await database().prepare('SELECT revision,status,schema_version AS schemaVersion,content_hash AS contentHash,created_at AS createdAt FROM revisions WHERE system_id=? AND revision<=? ORDER BY revision').bind(id,throughRevision).all<{revision:number;status:string;schemaVersion:string;contentHash:string;createdAt:string}>();
  return result.results;
}
export async function getReviewHistory(id:string){await requireAccess(id);const result=await database().prepare('SELECT id,revision,action,reason,field_ids AS fieldIds,role,created_at AS createdAt FROM review_events WHERE system_id=? ORDER BY created_at').bind(id).all<{id:string;revision:number;action:string;reason:string;fieldIds:string;role:string;createdAt:string}>();return result.results.map(r=>({...r,fieldIds:JSON.parse(r.fieldIds)}));}
export async function reviewSystem(id:string,body:Record<string,unknown>){
  const member=await requireAccess(id),base=requireRevision(body.baseRevision),current=await readSystem(id),action=String(body.action),reason=typeof body.reason==='string'?body.reason.slice(0,10000):'';
  const allFields=getFields(id).map(f=>f.id),fieldIds=Array.isArray(body.fieldIds)?body.fieldIds as string[]:allFields;
  const mutation=body.mutationId?requireMutation(body.mutationId):crypto.randomUUID(),hash=await sha256(canonical({type:'review',id,base,action,reason,fieldIds}));
  const retry=await database().prepare('SELECT system_id,payload_hash,revision FROM mutations WHERE id=?').bind(member.subject+':'+mutation).first<{system_id:string;payload_hash:string;revision:number}>();
  if(retry){if(retry.system_id!==id||retry.payload_hash!==hash)throw new ApiError(409,'מזהה הבדיקה כבר שימש לפעולה אחרת.');return readRevision(id,retry.revision);}
  if(!['submit','approve','request_changes'].includes(action))throw new ApiError(400,'פעולת הבדיקה אינה מוכרת.');
  if(action==='submit'&&member.role==='reviewer')throw new ApiError(403,'העברה לבדיקה נעשית בידי הצוות או רכז המסמכים.');
  if(action!=='submit'&&member.role==='contributor')throw new ApiError(403,'רק בודק הנדסי או רכז מסמכים רשאי לאשר או לבקש תיקון.');
  if(current.revision!==base)throw new ApiError(409,'הגרסה השתנתה. יש לפתוח את הגרסה העדכנית לפני הבדיקה.',{code:'CONFLICT',server:current});
  if(action!=='submit'&&!reason.trim())throw new ApiError(400,'יש לציין נימוק לבדיקה.');
  if(action!=='submit'&&!['in_review','changes_requested'].includes(current.status))throw new ApiError(409,'יש להעביר את הגרסה הנוכחית לבדיקה תחילה.');

  if(fieldIds.length===0||fieldIds.some(f=>!allFields.includes(f)))throw new ApiError(400,'רשימת השדות לבדיקה אינה תקינה.');
  const now=new Date().toISOString(),review:Review={...current.review,fields:{...current.review.fields}};
  let status:SystemSnapshot['status']='in_review';
  if(action==='submit'){review.submittedRevision=base+1;review.submittedAt=now;}
  else {for(const key of fieldIds)review.fields![key]={fingerprint:fingerprint(current.answers[key]),verdict:action==='approve'?'approved':'changes_requested',reason,role:member.role,at:now};status=action==='request_changes'?'changes_requested':'in_review';
    if(action==='approve'&&allFields.every(f=>review.fields?.[f]?.verdict==='approved'&&review.fields[f].fingerprint===fingerprint(current.answers[f]))){const progress=computeProgress(getFields(id),current.answers,current.attachments,review);if(progress.percent!==100)throw new ApiError(422,'חסרים פרטים או קבצים. אי אפשר לאשר מערכת עם דרישות שלא הושלמו.',{missing:progress.missing});status='approved';}
  }

  return commitSnapshot(id,member,current.answers,base,mutation,hash,status,review,{action,reason,fieldIds});
}
export async function getFileRecord(id:string):Promise<Attachment & {storageKey:string}>{await session();const row=await database().prepare("SELECT * FROM attachments WHERE id=? AND state='complete'").bind(id).first<FileRow>();if(!row)throw new ApiError(404,'הקובץ לא נמצא או שהעלאתו לא הסתיימה.');await requireAccess(row.system_id);return {...publicFile(row),storageKey:row.storage_key};}
export async function fileBytes(id:string):Promise<R2ObjectBody>{const file=await getFileRecord(id),object=await bucket().get(file.storageKey);if(!object)throw new ApiError(404,'תוכן הקובץ אינו זמין.');return object;}

function validateFile(file:File,bytes:Uint8Array):string {
  const extension=file.name.toLowerCase().split('.').pop()??'', signature=Array.from(bytes.slice(0,8)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const allowed:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain',csv:'text/csv',json:'application/json',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xls:'application/vnd.ms-excel',doc:'application/msword',zip:'application/zip',step:'application/step',stp:'application/step',iges:'model/iges',igs:'model/iges',kicad_sch:'text/plain',kicad_pcb:'text/plain',schdoc:'application/octet-stream',pcbdoc:'application/octet-stream',dxf:'application/dxf'};
  const mime=allowed[extension];if(!mime)throw new ApiError(415,'סוג הקובץ אינו נתמך. אפשר לצרף PDF, תמונה, מסמך, גיליון, ZIP או קובץ תכן נתמך.');
  const prefix=new TextDecoder().decode(bytes.slice(0,20));
  if(extension==='pdf'&&!prefix.startsWith('%PDF-'))throw new ApiError(415,'תוכן הקובץ אינו PDF תקין.');
  if(extension==='png'&&!signature.startsWith('89504e470d0a1a0a'))throw new ApiError(415,'תוכן התמונה אינו PNG תקין.');
  if(['jpg','jpeg'].includes(extension)&&!signature.startsWith('ffd8ff'))throw new ApiError(415,'תוכן התמונה אינו JPEG תקין.');
  if(extension==='webp'&&!(prefix.startsWith('RIFF')&&prefix.substring(8,12)==='WEBP'))throw new ApiError(415,'תוכן התמונה אינו WebP תקין.');
  if(['zip','xlsx','docx','pptx'].includes(extension)&&!signature.startsWith('504b0304')&&!signature.startsWith('504b0506'))throw new ApiError(415,'תוכן הארכיון או המסמך אינו תקין.');
  if(['xls','doc','schdoc','pcbdoc'].includes(extension)&&!signature.startsWith('d0cf11e0a1b11ae1'))throw new ApiError(415,'תוכן קובץ התכן או המסמך אינו תואם לסוג הקובץ.');
  if(['txt','csv','json','step','stp','iges','igs','kicad_sch','kicad_pcb'].includes(extension)&&bytes.some(b=>b===0))throw new ApiError(415,'הקובץ אינו קובץ טקסט מהסוג שנבחר.');
  if(file.type&&file.type!=='application/octet-stream'&&file.type!==mime&&!['zip','xlsx','docx','pptx','step','stp','iges','igs','dxf','kicad_sch','kicad_pcb','schdoc','pcbdoc'].includes(extension)&&!(extension==='csv'&&file.type==='application/vnd.ms-excel'))throw new ApiError(415,'סוג התוכן שהדפדפן דיווח אינו תואם לקובץ.');
  return mime;
}
export async function uploadFile(id:string,form:FormData){
  const member=await requireAccess(id,true),fieldId=String(form.get('fieldId')??''),field=getFields(id).find(f=>f.id===fieldId),file=form.get('file');
  if(!field)throw new ApiError(400,'השדה המבוקש לא נמצא.');if(!(file instanceof File))throw new ApiError(400,'לא נבחר קובץ.');
  if(file.size===0||file.size>MAX_FILE_BYTES)throw new ApiError(413,'יש לבחור קובץ שאינו ריק, עד 25 MiB.');
  const rawBase=form.get('baseRevision');if(typeof rawBase!=='string'||!/^\d+$/.test(rawBase))throw new ApiError(400,'חסרה גרסת הבסיס של ההעלאה.');
  const base=requireRevision(Number(rawBase)),mutation=requireMutation(form.get('mutationId')),key=member.subject+':'+mutation;
  const replaces=String(form.get('replaces')??'')||null,bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw new ApiError(400,'העלאת הקובץ נקטעה. יש לנסות שוב.');
  const mime=validateFile(file,bytes),digest=await sha256(bytes),payloadHash=await sha256(canonical({type:'upload',id,base,fieldId,replaces,name:file.name,size:file.size,sha256:digest})),db=database();
  const readExisting=()=>db.prepare('SELECT * FROM attachments WHERE mutation_key=?').bind(key).first<FileRow>();
  const replay=async()=>{
    const prior=await db.prepare('SELECT system_id,payload_hash,revision FROM mutations WHERE id=?').bind(key).first<{system_id:string;payload_hash:string;revision:number}>();
    if(!prior)return null;
    if(prior.system_id!==id||prior.payload_hash!==payloadHash)throw new ApiError(409,'מזהה ההעלאה כבר שימש לקובץ אחר.');
    const record=await readExisting();if(!record||record.state!=='complete')throw new ApiError(409,'לא ניתן לאמת את קובץ ההעלאה הקודמת. יש לפתוח את רשימת הקבצים לפני ניסיון נוסף.');
    return {attachment:publicFile(record),system:await readRevision(id,prior.revision)};
  };
  const replayed=await replay();if(replayed)return replayed;
  let replaced:Attachment|undefined;if(replaces){replaced=await getFileRecord(replaces);if(replaced.systemId!==id||replaced.fieldId!==fieldId)throw new ApiError(400,'הקובץ להחלפה אינו שייך לשדה.');}
  let existing=await readExisting();
  const verifyExisting=(record:FileRow)=>{if(record.system_id!==id||record.field_id!==fieldId||record.sha256!==digest||record.original_name!==file.name.slice(0,255)||record.replaces_id!==replaces)throw new ApiError(409,'מזהה ההעלאה כבר משויך לקובץ אחר.');};
  if(existing)verifyExisting(existing);
  const head=await readSystem(id),activeIds=new Set((head.answers[fieldId]?.attachmentIds??[]).filter(value=>value!==replaces));
  if(activeIds.size+(existing&&activeIds.has(existing.id)?0:1)>40)throw new ApiError(413,'אפשר לקשר עד 40 קבצים לתשובה אחת. יש להסיר שיוך קיים או להחליף קובץ; הגרסאות הקודמות נשמרות.');
  const quotaMessage='מכסת הקבצים התמלאה: עד 500 MiB למערכת ועד 950 MiB לפרויקט.';
  if(!existing){
    const attachmentId=crypto.randomUUID(),storageKey=`files/${id}/${attachmentId}`,now=new Date().toISOString(),safeName=file.name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'').slice(0,180)||'attachment';
    await db.prepare("INSERT OR IGNORE INTO attachments(id,system_id,field_id,original_name,safe_name,mime,size,sha256,storage_key,state,replaces_id,version,actor,created_at,mutation_key) SELECT ?,?,?,?,?,?,?,?,?,'uploading',?,?,?,?,? WHERE COALESCE((SELECT SUM(size) FROM attachments WHERE system_id=? AND state IN ('complete','uploading')),0)+?<=? AND COALESCE((SELECT SUM(size) FROM attachments WHERE state IN ('complete','uploading')),0)+?<=?").bind(attachmentId,id,fieldId,file.name.slice(0,255),safeName,mime,file.size,digest,storageKey,replaces,(replaced?.version??0)+1,member.subject,now,key,id,file.size,SYSTEM_QUOTA_BYTES,file.size,PROJECT_QUOTA_BYTES).run();
    // Another copy of the same request can reserve the row first. Both requests
    // must use that immutable object key instead of creating duplicate originals.
    existing=await readExisting();if(!existing)throw new ApiError(413,quotaMessage);verifyExisting(existing);
  }
  if(existing.state==='failed'){
    await db.prepare("UPDATE attachments SET state='uploading' WHERE id=? AND state='failed' AND COALESCE((SELECT SUM(size) FROM attachments WHERE system_id=? AND state IN ('complete','uploading')),0)+?<=? AND COALESCE((SELECT SUM(size) FROM attachments WHERE state IN ('complete','uploading')),0)+?<=?").bind(existing.id,id,existing.size,SYSTEM_QUOTA_BYTES,existing.size,PROJECT_QUOTA_BYTES).run();
    existing=(await readExisting())!;if(existing.state==='failed')throw new ApiError(413,quotaMessage);
  }
  const attachmentId=existing.id,storageKey=existing.storage_key;
  if(existing.state!=='complete'){
    try {const stored=await bucket().put(storageKey,bytes,{sha256:digest,httpMetadata:{contentType:mime},customMetadata:{system:id,attachmentId,sha256:digest}});if(!stored||stored.size!==file.size)throw Error('Upload verification failed');await db.prepare("UPDATE attachments SET state='complete' WHERE id=?").bind(attachmentId).run();}
    catch(error){await db.prepare("UPDATE attachments SET state='failed' WHERE id=? AND state!='complete'").bind(attachmentId).run();throw error;}
  }
  const current=await readSystem(id),attachment=await getFileRecord(attachmentId),{storageKey:_,...publicAttachment}=attachment;
  if(current.revision!==base){const concurrentReplay=await replay();if(concurrentReplay)return concurrentReplay;throw new ApiError(409,'הקובץ הועלה, אך הטיוטה השתנתה במקביל. יש לבחור לאיזו גרסה לצרף אותו.',{code:'CONFLICT',server:current,attachment:publicAttachment});}
  const answer:Answer=current.answers[fieldId]??{status:'answered',value:field.type==='table'?[]:''};
  const value=replaces&&Array.isArray(answer.value)?answer.value.map(row=>{const next={...row};for(const column of field.columns??[])if((column.type==='file'||column.kind==='file'||column.attachmentRequired)&&next[column.id]===replaces)next[column.id]=attachmentId;return next;}):answer.value;
  const answers={...current.answers,[fieldId]:{...answer,value,...(answer.provenance?.length?{sourceReview:'pending' as const}:{}),status:'answered' as const,attachmentIds:[...new Set([...(answer.attachmentIds??[]).filter(v=>v!==replaces),attachmentId])]}};
  const review:Review={...current.review,fields:{...current.review.fields}};delete review.fields![fieldId];
  try{const system=await commitSnapshot(id,member,answers,base,mutation,payloadHash,'draft',review);return {attachment:publicAttachment,system};}
  catch(error){if(error instanceof ApiError&&error.status===409&&error.details.code==='CONFLICT')throw new ApiError(409,'הקובץ נשמר, אך הטיוטה השתנתה במקביל. יש לשייך את הקובץ שכבר הועלה לגרסה העדכנית.',{...error.details,attachment:publicAttachment});throw error;}
}
export async function restoreRevision(id:string,body:Record<string,unknown>){const member=await requireAccess(id,true),base=requireRevision(body.baseRevision),target=requireRevision(body.revision),mutation=requireMutation(body.mutationId),source=await readRevision(id,target);const hash=await sha256(canonical({type:'restore',id,base,target}));return commitSnapshot(id,member,source.answers,base,mutation,hash,'draft',{}, {action:'restore',reason:'שחזור גרסה '+target,fieldIds:[]});}

export async function getMembers(){await requireCoordinator();const result=await database().prepare('SELECT subject,role,system_ids AS systemIds,active,created_at AS createdAt FROM memberships ORDER BY created_at').all<{subject:string;role:Session['role'];systemIds:string;active:number;createdAt:string}>();return {members:result.results.map(row=>({...row,systemIds:JSON.parse(row.systemIds),active:!!row.active}))};}
export async function updateMember(body:Record<string,unknown>){
  const actor=await requireCoordinator(),subject=String(body.subject??''),role=String(body.role??''),scope=body.systemIds;
  if(subject.length<5||subject.length>255||/[\s<>@]/.test(subject))throw new ApiError(400,'יש להזין מזהה חשבון פנימי תקין; אין להזין שם או דואר אלקטרוני.');
  if(!['contributor','reviewer','coordinator'].includes(role)||!Array.isArray(scope)||scope.some(v=>typeof v!=='string'||!getSystem(v)))throw new ApiError(400,'יש לבחור תפקיד ומערכות תקינים.');
  if(role!=='coordinator'&&scope.length===0&&body.active!==false)throw new ApiError(400,'יש להקצות לפחות מערכת אחת.');
  const owner=await database().prepare("SELECT owner_subject FROM workspace WHERE id='2027'").first<{owner_subject:string}>();
  if(owner?.owner_subject===subject&&(role!=='coordinator'||body.active===false))throw new ApiError(409,'אי אפשר לבטל את הרשאת רכז הבעלים.');
  await database().batch([
    database().prepare("INSERT INTO memberships(subject,role,system_ids,active,created_at,auth_source) VALUES(?,?,?,?,?,'manual') ON CONFLICT(subject) DO UPDATE SET role=excluded.role,system_ids=excluded.system_ids,active=excluded.active,auth_source='manual'").bind(subject,role,JSON.stringify([...new Set(scope)]),body.active===false?0:1,new Date().toISOString()),
    database().prepare('INSERT INTO audit_events(id,action,actor,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),'membership_update',actor.subject,new Date().toISOString()),
  ]);return getMembers();
}
type SharedRow={id:string;label:string;system_ids:string;value:string;unit:string;source:string;revision:number;updated_at:string};
type ProposalRow={id:string;record_id:string;value:string;unit:string;source:string;base_revision:number;status:string;actor:string;created_at:string};
export async function getSharedRecords(){
  const member=await session(),rows=await database().prepare('SELECT * FROM shared_records ORDER BY label').all<SharedRow>(),allowed=rows.results.filter(row=>member.role==='coordinator'||JSON.parse(row.system_ids).some((id:string)=>member.systemIds.includes(id)));
  return {records:await Promise.all(allowed.map(async row=>{const proposals=await database().prepare('SELECT id,record_id,value,unit,source,base_revision,status,created_at FROM shared_proposals WHERE record_id=? ORDER BY created_at').bind(row.id).all<ProposalRow>();const history=await database().prepare('SELECT revision,value,unit,source,created_at AS createdAt FROM shared_revisions WHERE record_id=? ORDER BY revision').bind(row.id).all();return {id:row.id,label:row.label,systemIds:JSON.parse(row.system_ids),value:row.value,unit:row.unit,source:row.source,revision:row.revision,updatedAt:row.updated_at,proposals:proposals.results.map(p=>({id:p.id,value:p.value,unit:p.unit,source:p.source,baseRevision:p.base_revision,status:p.status,createdAt:p.created_at})),history:history.results};}))};
}
function sharedText(body:Record<string,unknown>,key:string,max=10000):string {const text=body[key];if(typeof text!=='string'||!text.trim()||text.length>max)throw new ApiError(400,'יש למלא ערך, יחידה ומקור באופן ברור.');return text.trim();}
export async function updateShared(body:Record<string,unknown>){
  const member=await session(),action=String(body.action),now=new Date().toISOString(),db=database();
  if(action==='create'){
    if(member.role!=='coordinator')throw new ApiError(403,'רק רכז המסמכים יכול ליצור רשומה משותפת.');
    const id=sharedText(body,'id',100);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'מזהה הרשומה צריך לכלול אותיות לטיניות, ספרות, קו או קו תחתון.');
    const label=sharedText(body,'label',200),value=sharedText(body,'value'),unit=sharedText(body,'unit',100),source=sharedText(body,'source'),scope=body.systemIds;
    if(!Array.isArray(scope)||!scope.length||scope.some(s=>typeof s!=='string'||!getSystem(s)))throw new ApiError(400,'יש לבחור את המערכות המשתמשות ברשומה.');
    const scopeJson=JSON.stringify([...new Set(scope)].sort()),read=()=>db.prepare('SELECT * FROM shared_records WHERE id=?').bind(id).first<SharedRow>();
    const matches=(row:SharedRow)=>row.label===label&&row.value===value&&row.unit===unit&&row.source===source&&canonical([...new Set(JSON.parse(row.system_ids) as string[])].sort())===scopeJson;
    const existing=await read();if(existing){if(matches(existing))return getSharedRecords();throw new ApiError(409,'המזהה כבר קיים. יש להציע עדכון לרשומה הקיימת.');}
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO shared_records(id,label,system_ids,value,unit,source,revision,updated_at) VALUES(?,?,?,?,?,?,1,?)').bind(id,label,scopeJson,value,unit,source,now),
      db.prepare('INSERT OR IGNORE INTO shared_revisions(id,record_id,revision,value,unit,source,created_at) SELECT ?,id,revision,value,unit,source,updated_at FROM shared_records WHERE id=? AND revision=1').bind(id+':1',id),
    ]);
    const created=await read();if(!created||!matches(created))throw new ApiError(409,'המזהה נוצר במקביל עם נתונים אחרים. יש לפתוח את הרשומה הקיימת.');
  } else if(action==='propose'){
    const id=sharedText(body,'id',100),row=await db.prepare('SELECT * FROM shared_records WHERE id=?').bind(id).first<SharedRow>();
    if(!row)throw new ApiError(404,'הרשומה לא נמצאה.');
    if(member.role==='reviewer'||(member.role!=='coordinator'&&!JSON.parse(row.system_ids).some((system:string)=>member.systemIds.includes(system))))throw new ApiError(403,'אין הרשאת עריכה לרשומה הזו.');
    const base=requireRevision(body.baseRevision),value=sharedText(body,'value'),unit=sharedText(body,'unit',100),source=sharedText(body,'source'),proposalId=body.mutationId?requireMutation(body.mutationId):crypto.randomUUID();
    const read=()=>db.prepare('SELECT * FROM shared_proposals WHERE id=?').bind(proposalId).first<ProposalRow>();
    const verify=(proposal:ProposalRow)=>{if(proposal.actor!==member.subject||proposal.record_id!==id||proposal.base_revision!==base||proposal.value!==value||proposal.unit!==unit||proposal.source!==source)throw new ApiError(409,'מזהה ההצעה כבר שימש לתוכן אחר. יש לפתוח ניסיון שמירה חדש.',{code:'SHARED_MUTATION_REUSE'});};
    const existing=await read();if(existing){verify(existing);return getSharedRecords();}
    if(base!==row.revision)throw new ApiError(409,'הרשומה המשותפת השתנתה. יש לעיין בגרסה העדכנית לפני הצעת שינוי.',{code:'SHARED_CONFLICT',current:{value:row.value,unit:row.unit,source:row.source,revision:row.revision}});
    await db.prepare("INSERT OR IGNORE INTO shared_proposals(id,record_id,value,unit,source,base_revision,status,actor,created_at) SELECT ?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM shared_records WHERE id=? AND revision=?)").bind(proposalId,id,value,unit,source,base,member.subject,now,id,base).run();
    const proposed=await read();if(!proposed)throw new ApiError(409,'הרשומה השתנתה במקביל. יש לפתוח את הגרסה העדכנית לפני הצעת שינוי.',{code:'SHARED_CONFLICT'});verify(proposed);
  } else if(action==='resolve'){
    if(member.role!=='coordinator')throw new ApiError(403,'רק רכז המסמכים רשאי להכריע בסתירה.');
    const proposalId=sharedText(body,'proposalId',150),decision=String(body.decision);
    if(!['accept','reject'].includes(decision))throw new ApiError(400,'יש לבחור אישור או דחייה.');
    const base=decision==='accept'?requireRevision(body.baseRevision):0,desired=decision==='accept'?'accepted':'rejected';
    const read=()=>db.prepare('SELECT * FROM shared_proposals WHERE id=?').bind(proposalId).first<ProposalRow>();
    const proposal=await read();if(!proposal)throw new ApiError(404,'ההצעה לא נמצאה.');
    if(proposal.status===desired)return getSharedRecords();
    if(proposal.status!=='pending')throw new ApiError(409,'ההצעה כבר הוכרעה אחרת. יש לפתוח את הנתונים העדכניים.',{code:'SHARED_CONFLICT'});
    if(decision==='reject'){
      await db.prepare("UPDATE shared_proposals SET status='rejected' WHERE id=? AND status='pending'").bind(proposalId).run();
      if((await read())?.status!=='rejected')throw new ApiError(409,'ההצעה הוכרעה במקביל. יש לפתוח את הנתונים העדכניים.',{code:'SHARED_CONFLICT'});
    } else {
      const revision=base+1;
      const results=await db.batch([
        db.prepare("UPDATE shared_records SET value=?,unit=?,source=?,revision=?,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM shared_proposals WHERE id=? AND status='pending')").bind(proposal.value,proposal.unit,proposal.source,revision,now,proposal.record_id,base,proposalId),
        // SQLite changes() ties each following statement to the preceding write
        // in this transaction, avoiding timestamp-based false acknowledgements.
        db.prepare('INSERT INTO shared_revisions(id,record_id,revision,value,unit,source,created_at) SELECT ?,id,revision,value,unit,source,updated_at FROM shared_records WHERE id=? AND revision=? AND changes()=1').bind(proposal.record_id+':'+revision,proposal.record_id,revision),
        db.prepare("UPDATE shared_proposals SET status='accepted' WHERE id=? AND status='pending' AND changes()=1").bind(proposalId),
      ]);
      if(results[0].meta.changes!==1&&(await read())?.status!=='accepted')throw new ApiError(409,'הרשומה או ההצעה השתנו במקביל. יש לפתוח את הנתונים העדכניים.',{code:'SHARED_CONFLICT'});
    }
  } else throw new ApiError(400,'פעולת הממשק אינה מוכרת.');
  return getSharedRecords();
}

const importFields=(id:string)=>getSystem(id)?getFields(id):undefined;
async function importProtectedFields(id:string,current:SystemSnapshot):Promise<Record<string,string>>{
 const protectedFields:Record<string,string>={};
 for(const file of await listFiles(id))protectedFields[file.fieldId]='כבר קיימת פעילות קבצים בשדה, לרבות העלאה או גרסה קודמת.';
 for(const fieldId of Object.keys(current.review.fields??{}))protectedFields[fieldId]='כבר נשמרה החלטת בדיקה לשדה.';
 return protectedFields;
}
function importModeDigest(mode:ImportMode,value:unknown){return canonical(mode==='manual'?value:{mode,value});}
async function importMutation(mode:ImportMode,batchId:string,id:string){return (mode==='manual'?'import_':mode==='editorial_revision'?'editorial_':'weekly_')+await sha256(mode==='manual'?batchId+':'+id:mode+':'+batchId+':'+id);}
type EditorialExpectations={expectedOldFieldHashes:Record<string,string>;expectedAttachmentIds:string[]};
async function editorialExpectations(incoming:ImportSystem,current:SystemSnapshot):Promise<EditorialExpectations>{
 const expectedOldFieldHashes:Record<string,string>={};
 for(const id of Object.keys(incoming.answers))expectedOldFieldHashes[id]=await sha256(canonical({answer:current.answers[id]??null,review:current.review.fields?.[id]??null}));
 const expectedAttachmentIds=(await listFiles(incoming.id)).filter(file=>Object.hasOwn(incoming.answers,file.fieldId)).map(file=>file.id).sort();
 return {expectedOldFieldHashes,expectedAttachmentIds};
}
function readEditorialExpectations(body:Record<string,unknown>,incoming:ImportSystem):EditorialExpectations{
 const hashes=body.expectedOldFieldHashes,ids=body.expectedAttachmentIds;
 if(!hashes||typeof hashes!=='object'||Array.isArray(hashes)||canonical(Object.keys(hashes).sort())!==canonical(Object.keys(incoming.answers).sort())||Object.values(hashes).some(hash=>typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))||!Array.isArray(ids)||ids.length>20000||ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(ids).size!==ids.length)throw new ApiError(400,'חסרה השוואת העריכה לגרסה הקודמת. יש לבצע תצוגה מקדימה חדשה.');
 return {expectedOldFieldHashes:hashes as Record<string,string>,expectedAttachmentIds:[...ids].sort()};
}
function importSystemDigest(mode:ImportMode,incoming:ImportSystem,base:number,expectations?:EditorialExpectations){return sha256(importModeDigest(mode,mode==='editorial_revision'?{system:incoming,baseRevision:base,...expectations}:incoming));}
export async function getImportGaps(){
 await requireCoordinator();
 const result=await Promise.all(systems.map(async system=>{
  const current=await readSystem(system.id),protectedFields=await importProtectedFields(system.id,current),emptyFields=[],preservedFields=[];
  for(const field of getFields(system.id)){
   const decision=emptyAnswerDecision(current.answers[field.id],protectedFields[field.id]);
   if(decision.empty)emptyFields.push({...field,weeklyImportable:(field.type??field.kind)!=='file'});
   else preservedFields.push({id:field.id,label:field.label,reason:decision.reason});
  }
  return {id:system.id,label:system.label,revision:current.revision,counts:{total:emptyFields.length+preservedFields.length,empty:emptyFields.length,preserved:preservedFields.length,weeklyImportable:emptyFields.filter(field=>field.weeklyImportable).length},emptyFields,preservedFields};
 }));
 return {mode:'weekly_empty_fill',schemaVersion:SCHEMA_VERSION,generatedAt:new Date().toISOString(),systems:result,totals:{systems:result.length,empty:result.reduce((n,s)=>n+s.counts.empty,0),preserved:result.reduce((n,s)=>n+s.counts.preserved,0),weeklyImportable:result.reduce((n,s)=>n+s.counts.weeklyImportable,0)}};
}
export async function previewSourceImport(input:unknown,modeInput:unknown='manual'){
 await requireCoordinator();const mode=parseImportMode(modeInput),batch=parseImportBatch(input,importFields),digest=await sha256(importModeDigest(mode,batch));
 const previews=[];
 for(const incoming of batch.systems){
  if(mode==='weekly_empty_fill')validateWeeklyImport(incoming,getFields(incoming.id));
  await validateAnswers(incoming.id,incoming.answers);
  const current=await readSystem(incoming.id),protectedFields=mode==='weekly_empty_fill'?await importProtectedFields(incoming.id,current):{};
  const expectations=mode==='editorial_revision'?await editorialExpectations(incoming,current):undefined;
  const merged=mode==='editorial_revision'?mergeEditorialImport(current.answers,incoming,batch.batchId,getFields(incoming.id)):mergeSourceImport(current.answers,incoming,batch.batchId,getFields(incoming.id),protectedFields);
  if(mode==='editorial_revision')await validateAnswers(incoming.id,merged.answers);
  if(new TextEncoder().encode(canonical(merged.answers)).byteLength>1024*1024)throw new ApiError(413,'תשובות '+incoming.id+' גדולות מדי; יש לצמצם קטעי מקור.');
  previews.push({id:incoming.id,label:getSystem(incoming.id)!.label,baseRevision:current.revision,importCount:merged.imported,skipCount:merged.skipped,sourceCount:Object.values(incoming.answers).reduce((n,a)=>n+(a.provenance?.length??0),0),pendingUnknown:Object.values(incoming.answers).filter(a=>a.status==='unknown').length,systemDigest:await importSystemDigest(mode,incoming,current.revision,expectations),mutationId:await importMutation(mode,batch.batchId,incoming.id),fields:merged.decisions,...expectations});
 }
 return {mode,batchId:batch.batchId,digest,systems:previews,totals:{systems:previews.length,import:previews.reduce((n,s)=>n+s.importCount,0),preserve:previews.reduce((n,s)=>n+s.skipCount,0),sources:previews.reduce((n,s)=>n+s.sourceCount,0)}};
}
export async function applySourceImport(body:Record<string,unknown>){
 const member=await requireCoordinator(),mode=parseImportMode(body.mode),batchId=validateBatchId(body.batchId),incoming=parseImportSystem(body.system,importFields),base=requireRevision(body.baseRevision),mutation=requireMutation(body.mutationId),expectations=mode==='editorial_revision'?readEditorialExpectations(body,incoming):undefined,systemDigest=await importSystemDigest(mode,incoming,base,expectations);
 if(mode==='weekly_empty_fill')validateWeeklyImport(incoming,getFields(incoming.id));
 if(typeof body.batchDigest!=='string'||!/^[a-f0-9]{64}$/.test(body.batchDigest)||body.systemDigest!==systemDigest)throw new ApiError(400,'תוכן הייבוא או מצב הייבוא השתנו מאז התצוגה המקדימה. יש לבדוק את החבילה מחדש.');
 const expectedMutation=await importMutation(mode,batchId,incoming.id);if(mutation!==expectedMutation)throw new ApiError(400,'מזהה פעולת הייבוא אינו תואם לחבילה ולמצב הייבוא.');
 const action=mode==='manual'?'source_import':mode;
 const hash=await sha256(canonical({type:action,batchId,batchDigest:body.batchDigest,system:incoming,base,...expectations})),key=member.subject+':'+mutation;
 const previous=await database().prepare('SELECT system_id,payload_hash,revision FROM mutations WHERE id=?').bind(key).first<{system_id:string;payload_hash:string;revision:number}>();
 if(previous){if(previous.system_id!==incoming.id||previous.payload_hash!==hash)throw new ApiError(409,'חבילת המקורות כבר יובאה בתוכן או בגרסה אחרים. יש לבצע תצוגה מקדימה חדשה; תשובות קיימות יישמרו.',{code:'IMPORT_REPLAY_MISMATCH'});const system=await readRevision(incoming.id,previous.revision);return {mode,system,imported:Object.values(system.answers).filter(a=>a.importedBatchId===batchId).length,skipped:0,replayed:true};}
 const current=await readSystem(incoming.id);if(current.revision!==base)throw new ApiError(409,'המערכת השתנתה מאז התצוגה המקדימה. יש לבדוק שוב את החבילה; שום תוכן קיים לא הוחלף.',{code:'CONFLICT',server:current});
 if(expectations&&canonical(await editorialExpectations(incoming,current))!==canonical(expectations))throw new ApiError(409,'התוכן, החלטת הבדיקה או הקבצים השתנו מאז התצוגה המקדימה. לא הוחלף תוכן; יש לבדוק שוב את העריכה.',{code:'EDITORIAL_BASE_CHANGED',server:current});
 const protectedFields=mode==='weekly_empty_fill'?await importProtectedFields(incoming.id,current):{};
 const merged=mode==='editorial_revision'?mergeEditorialImport(current.answers,incoming,batchId,getFields(incoming.id)):mergeSourceImport(current.answers,incoming,batchId,getFields(incoming.id),protectedFields);
 if(!merged.imported)return {mode,system:current,imported:0,skipped:merged.skipped,replayed:false};
 const answers=await validateAnswers(incoming.id,merged.answers);if(new TextEncoder().encode(canonical(answers)).byteLength>1024*1024)throw new ApiError(413,'תשובות המערכת גדולות מדי. יש לצמצם את קטעי המקור ולשמור פירוט בקבצים.');
 const importedIds=merged.decisions.filter(field=>field.action!=='preserve').map(field=>field.id);
 const review:Review={...current.review,fields:{...current.review.fields}};for(const id of importedIds)delete review.fields![id];
 const system=await commitSnapshot(incoming.id,member,answers,base,mutation,hash,'draft',review,{action,reason:mode==='manual'?'ייבוא מקורות לאימות הצוות':mode==='editorial_revision'?'עריכת תוכן מפורשת ממקורות — לאימות הצוות':'השלמת שדות ריקים בלבד ממקורות — לאימות הצוות',fieldIds:importedIds},mode==='weekly_empty_fill'?importedIds:undefined,expectations?{fieldIds:importedIds,attachmentIds:expectations.expectedAttachmentIds}:undefined);
 return {mode,system,imported:merged.imported,skipped:merged.skipped,replayed:false};
}
export async function confirmSourceContent(id:string,body:Record<string,unknown>){
 const member=await requireAccess(id,true),base=requireRevision(body.baseRevision),mutation=requireMutation(body.mutationId),fieldId=String(body.fieldId??''),hash=await sha256(canonical({type:'source_confirm',id,base,fieldId})),key=member.subject+':'+mutation;
 const previous=await database().prepare('SELECT system_id,payload_hash,revision FROM mutations WHERE id=?').bind(key).first<{system_id:string;payload_hash:string;revision:number}>();
 if(previous){if(previous.system_id!==id||previous.payload_hash!==hash)throw new ApiError(409,'מזהה האימות כבר שימש לפעולה אחרת.');return readRevision(id,previous.revision);}
 const current=await readSystem(id);if(current.revision!==base)throw new ApiError(409,'התשובה השתנתה. יש לבדוק את הגרסה העדכנית לפני אישור תוכן המקור.',{code:'CONFLICT',server:current});
 const answer=current.answers[fieldId];if(!answer?.provenance?.length)throw new ApiError(400,'לשדה הזה אין תוכן מיובא לאימות.');
 const updated={...answer,sourceReview:'confirmed' as const},answers={...current.answers,[fieldId]:updated},review:Review={...current.review,fields:{...current.review.fields}};
 const priorReview=review.fields?.[fieldId];if(priorReview?.verdict==='changes_requested')review.fields![fieldId]={...priorReview,fingerprint:fingerprint(updated)};else delete review.fields![fieldId];
 return commitSnapshot(id,member,answers,base,mutation,hash,'draft',review,{action:'source_confirm',reason:'הצוות אישר שתוכן המקור נבדק ומתאים לתשובה; אין בכך אישור הנדסי.',fieldIds:[fieldId]});
}
