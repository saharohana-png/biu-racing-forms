import {guard,getSharedRecords,updateShared,readJson} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return guard(request,getSharedRecords);}
export async function POST(request:Request){return guard(request,async()=>updateShared(await readJson(request)));}
