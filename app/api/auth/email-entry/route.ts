import { enterWithEmail, guard, readJson } from '@/lib/server';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return guard(request, async () => enterWithEmail(request, await readJson(request, 1024)));
}
