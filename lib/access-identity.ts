/** Verify Cloudflare Access identity in the application, including origin-direct requests. */
type AccessConfig = { teamDomain?: string; audience?: string; fetcher?: typeof fetch; now?: number };
type Jwk = JsonWebKey & { kid?: string };
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const parse = (value: string) => JSON.parse(new TextDecoder().decode(decode(value)));
export async function verifyAccessIdentity(token: string | null, config: AccessConfig) {
  if (!token || token.length > 16384 || !config.audience || !config.teamDomain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.teamDomain)) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const head = parse(parts[0]), claims = parse(parts[1]);
    const now = config.now ?? Date.now() / 1000;
    if (head.alg !== 'RS256' || typeof head.kid !== 'string' ||
        claims.iss !== `https://${config.teamDomain}` || !Array.isArray(claims.aud) || !claims.aud.includes(config.audience) ||
        typeof claims.exp !== 'number' || claims.exp <= now || (typeof claims.nbf === 'number' && claims.nbf > now + 30) ||
        typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) return null;
    // Keys only come from the configured issuer, never a token-provided jku/x5u.
    const response = await (config.fetcher ?? fetch)(`https://${config.teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const jwks = await response.json() as { keys?: Jwk[] };
    const jwk = jwks.keys?.find(key => key.kid === head.kid && key.kty === 'RSA'); if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return valid ? { userId: 'access:' + claims.sub, email: claims.email, fullName: null, displayName: claims.email } : null;
  } catch { return null; }
}
