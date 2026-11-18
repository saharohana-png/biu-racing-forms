import { guard, logoutEmailEntry } from '@/lib/server';
import {cookies} from 'next/headers';
import {OWNER_COOKIE} from '@/lib/owner-session';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {return guard(request,async()=>{(await cookies()).delete(OWNER_COOKIE);return logoutEmailEntry(request);});}
