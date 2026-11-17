import { headers } from 'next/headers';

// This is a self-declared entry policy, not proof of email ownership. Each
// browser receives an unrelated identity, so an entered owner email can never
// impersonate an existing member or inherit their permissions.
export const EMAIL_ENTRY_COOKIE = 'biu_email_session';
export const EMAIL_ENTRY_MAX_AGE = 14 * 24 * 60 * 60;

export async function readEmailEntryToken(): Promise<string | null> {
  return emailEntryTokenFromCookie((await headers()).get('cookie'));
}

export function emailEntryTokenFromCookie(cookie: string | null): string | null {
  if (!cookie) return null;
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(EMAIL_ENTRY_COOKIE + '='));
  if (values.length === 0) return null;
  if (values.length !== 1) return '';
  const token = values[0].slice(EMAIL_ENTRY_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

export async function emailEntryTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export function newEmailEntryToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
}

export function emailEntryCookie(request: Request, token: string | null): string {
  const url = new URL(request.url);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const secure = url.protocol === 'https:' || !local;
  return `${EMAIL_ENTRY_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? EMAIL_ENTRY_MAX_AGE : 0}${secure ? '; Secure' : ''}`;
}
