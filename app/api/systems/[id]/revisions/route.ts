import {guard,getRevisionIndex,getReviewHistory,readRevision,restoreRevision,readJson} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>{const id=(await context.params).id,r=new URL(request.url).searchParams.get('revision');return r?readRevision(id,Number(r)):{revisions:await getRevisionIndex(id),reviews:await getReviewHistory(id)};});}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return guard(request,async()=>restoreRevision((await context.params).id,await readJson(request)));}
