import { guard, session, ApiError } from '@/lib/server';
import images from '@/private-data/example-images.json';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return guard(request,async()=>{await session();const {id}=await params;const data=(images as Record<string,string>)[id];if(!data)throw new ApiError(404,'הדוגמה לא נמצאה.');const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));return new Response(bytes,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});});}
