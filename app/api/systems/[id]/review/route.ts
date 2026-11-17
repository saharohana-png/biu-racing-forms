import {guard,reviewSystem,readJson} from '@/lib/server';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>reviewSystem((await context.params).id,await readJson(request)));}
