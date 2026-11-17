import {guard,readJson,previewSourceImport,applySourceImport,getImportGaps,ApiError} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return guard(request,async()=>{const action=new URL(request.url).searchParams.get('action')??'gaps';if(action!=='gaps')throw new ApiError(400,'פעולת הקריאה אינה נתמכת.');return getImportGaps();});}
export async function POST(request:Request){return guard(request,async()=>{const body=await readJson(request,8*1024*1024);if(body.action==='preview')return previewSourceImport(body.batch,body.mode);if(body.action==='apply')return applySourceImport(body);throw new ApiError(400,'יש לבחור תצוגה מקדימה או ייבוא.');});}
