import {guard,uploadFile,listFiles,readUploadForm} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>({files:await listFiles((await context.params).id)}));}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>uploadFile((await context.params).id,await readUploadForm(request)));}
