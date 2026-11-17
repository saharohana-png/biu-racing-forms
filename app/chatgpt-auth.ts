/** Legacy import name retained for compatibility; this standalone app does not use ChatGPT authentication. */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { verifyAccessIdentity } from '@/lib/access-identity';
export type ChatGPTUser = { userId: string; displayName: string; email: string; fullName: string | null };
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const h = await headers();
  // LOCAL_DEV is injected only by `vite serve`, whose listener is loopback-only.
  if (env.LOCAL_DEV === 'true') return { userId: 'local:coordinator', displayName: 'Local development', email: 'developer@example.invalid', fullName: null };
  return verifyAccessIdentity(h.get('cf-access-jwt-assertion'), { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD });
}
export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser(); if (user) return user; redirect(chatGPTSignInPath(returnTo));
}
export function chatGPTSignInPath(_returnTo: string): string { return '/admin-login'; }
export function chatGPTSignOutPath(_returnTo = '/'): string { return '/cdn-cgi/access/logout'; }
