import {guard,readJson,ApiError,json} from '@/lib/server';
import {ownerKeyMatches,ownerToken,OWNER_COOKIE} from '@/lib/owner-session';
import {cookies} from 'next/headers';
import {EMAIL_ENTRY_COOKIE} from '@/lib/email-entry-session';
export async function POST(request:Request){return guard(request,async()=>{
 const body=await readJson(request,2048);
 if(!ownerKeyMatches(body.key))throw new ApiError(401,'מפתח הניהול אינו נכון.');
 const jar=await cookies();jar.delete(EMAIL_ENTRY_COOKIE);
 jar.set(OWNER_COOKIE,ownerToken(),{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'lax',path:'/',maxAge:14*86400});
 return json({ok:true});
});}
