import {guard,getMembers,updateMember,readJson} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return guard(request,getMembers);}
export async function POST(request:Request){return guard(request,async()=>updateMember(await readJson(request)));}
