import {guard,readSystem,saveSystem,readJson} from '@/lib/server';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return guard(request,async()=>readSystem((await context.params).id));}
export async function PUT(request:Request,context:Context){return guard(request,async()=>saveSystem((await context.params).id,await readJson(request)));}
