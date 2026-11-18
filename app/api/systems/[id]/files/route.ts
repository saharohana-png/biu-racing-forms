import {guard,uploadFile,listFiles,readUploadForm,readJson} from '@/lib/server';
import {prepareUpload,stagedForm} from '@/lib/staged-upload';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>({files:await listFiles((await context.params).id)}));}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>{
 const id=(await context.params).id;
 if(new URL(request.url).searchParams.get('stage')==='1')return prepareUpload(id,await readJson(request,4096));
 if(request.headers.get('content-type')?.includes('application/json')){
  const staged=await stagedForm(id,await readJson(request,8192));
  const result=await uploadFile(id,staged.form);await staged.cleanup().catch(()=>{});return result;
 }
 return uploadFile(id,await readUploadForm(request));
});}
