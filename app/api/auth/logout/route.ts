import { guard, logoutEmailEntry } from '@/lib/server';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return guard(request, () => logoutEmailEntry(request));
}
