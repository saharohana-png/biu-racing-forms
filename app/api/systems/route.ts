import {guard,listSystems} from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(request:Request){return guard(request,listSystems);}
