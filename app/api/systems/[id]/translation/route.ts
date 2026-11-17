import {guard,requireAccess,readSystem,readRevision,readJson,database,ApiError} from '@/lib/server';
import {getTranslationSnapshot,acceptLocalTranslations} from '@/lib/translation';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return guard(request,async()=>{
 const {id}=await params;await requireAccess(id);
 const raw=new URL(request.url).searchParams.get('revision');
 if(raw!==null&&(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw))))throw new ApiError(400,'גרסת התרגום אינה תקינה.');
 const snapshot=raw!==null&&Number(raw)>0?await readRevision(id,Number(raw)):await readSystem(id);
 if(raw==='0'&&snapshot.revision!==0)throw new ApiError(404,'גרסת התרגום אינה קיימת.');
 return getTranslationSnapshot(database(),snapshot);
});}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return guard(request,async()=>{
 const {id}=await params;await requireAccess(id,true);const body=await readJson(request,131072);
 if(body.action!=='complete'||!Number.isSafeInteger(body.sourceRevision)||Number(body.sourceRevision)<1)throw new ApiError(400,'פעולת התרגום אינה תקינה.');
 const current=await readSystem(id);
 try{return await acceptLocalTranslations(database(),current,body);}
 catch(error){if((error as {status?:number}).status===409)throw new ApiError(409,'גרסת המקור השתנתה. התרגום הישן לא נשמר.');
 if(error instanceof Error&&/^(INVALID_|PROTECTED_|NUMBER_)/.test(error.message))throw new ApiError(422,'התרגום לא עבר את בדיקת הטקסט, המספרים והאותות. המקור נשמר.');
 throw error;}
});}
